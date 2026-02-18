/**
 * Export Canonical JSON from Supabase Database
 * 
 * Reads from the same database as the existing rewrite pipeline,
 * but outputs clean, renderer-agnostic JSON without InDesign markers.
 * 
 * Usage:
 *   npx tsx new_pipeline/export/export-canonical-from-db.ts <uploadId> [--chapter 1] [--out output.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import pg from 'pg';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  type CanonicalBook,
  type CanonicalChapter,
  type CanonicalSection,
  type ContentBlock,
  type ListBlock,
  type ParagraphBlock,
  type StepsBlock,
  type SubparagraphBlock,
  type ExportOptions,
} from '../schema/canonical-schema';

import { inferStyleRole, type StyleRoleMap } from '../schema/style-roles';

import { loadEnv } from '../lib/load-env';

// Load environment (portable): prefer repo-root/new_pipeline .env(.local), or use --env-file / ENV_FILE.
loadEnv({ envFile: getArg('--env-file') || undefined });

// Deterministic style-role mapping (stable rendering hook)
const styleRoleMapPath = path.resolve(__dirname, '../schema/style-role-map.json');
let STYLE_ROLE_MAP: StyleRoleMap = {};
try {
  if (fs.existsSync(styleRoleMapPath)) {
    STYLE_ROLE_MAP = JSON.parse(fs.readFileSync(styleRoleMapPath, 'utf8')) as StyleRoleMap;
  }
} catch {
  STYLE_ROLE_MAP = {};
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function getDbUrl(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${encodeURIComponent(process.env.DB_USER || 'postgres')}:${encodeURIComponent(
      process.env.DB_PASSWORD || 'postgres'
    )}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '54322'}/${process.env.DB_NAME || 'postgres'}`
  );
}

// =============================================================================
// Database Types
// =============================================================================

interface DbParagraph {
  id: string;
  chapter_number: string;
  paragraph_number: number | null;
  subparagraph_number: number | null;
  text_original: string;
  style_name: string | null;
  content_type: string | null;
  formatting_metadata: Record<string, unknown> | null;
  basis: string | null;
  praktijk: string | null;
  verdieping: string | null;
}

interface DbBook {
  id: string;
  title: string;
  level: string;
}

// =============================================================================
// Text Cleaning
// =============================================================================

/**
 * Clean text for structural fields (titles/labels) — strips InDesign markers.
 */
function cleanPlainText(text: string | null): string {
  if (!text) return '';

  let t = text;

  // Remove InDesign bold markers
  t = t.replace(/<<BOLD_START>>/g, '');
  t = t.replace(/<<BOLD_END>>/g, '');

  // Remove soft hyphens
  t = t.replace(/\u00AD/g, '');

  // Normalize line breaks (keep \n, remove \r)
  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/\r/g, '\n');

  // Remove control chars except \n and \t
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  // Collapse multiple spaces
  t = t.replace(/ {2,}/g, ' ');

  return t.trim();
}

/**
 * Clean text for renderer content fields — preserves inline markers/newlines.
 *
 * Rules:
 * - Keep `<<BOLD_START>>...<<BOLD_END>>` for downstream renderers (Prince/InDesign)
 * - Never emit `\r` (only `\n`)
 * - Remove soft hyphens (U+00AD)
 */
function cleanRichText(text: string | null): string {
  if (!text) return '';

  let t = text;

  // Remove soft hyphens
  t = t.replace(/\u00AD/g, '');

  // Normalize line breaks (keep \n, remove \r)
  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/\r/g, '\n');

  // Remove control chars except \n and \t
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  // Collapse multiple spaces (do not touch newlines)
  t = t.replace(/ {2,}/g, ' ');

  return t.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// IDML inline bold extraction (for Prince parity with InDesign)
// =============================================================================

type StoryBoldIndex = {
  offset: number;
  paragraphs: Array<{ normalizedText: string; boldSegments: string[] }>;
};

const STORY_BOLD = new Map<string, StoryBoldIndex>();
let IDML_PATH_FOR_BOLD: string | null = null;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeInlineText(s: string): string {
  return decodeXmlEntities(String(s || ''))
    .replace(/<\?ACE\b[^?]*\?>/g, '')
    .replace(/<\?[^?]*\?>/g, '')
    .replace(/\u00AD/g, '') // soft hyphen
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // nbsp + spaces
    .replace(/[\u2028\u2029]/g, '\n') // separators
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIdmlStoryParagraphs(storyXml: string): Array<{ normalizedText: string; boldSegments: string[] }> {
  const out: Array<{ normalizedText: string; boldSegments: string[] }> = [];

  const paraRe = /<ParagraphStyleRange\b[\s\S]*?<\/ParagraphStyleRange>/g;
  const charRe = /<CharacterStyleRange\b[\s\S]*?<\/CharacterStyleRange>/g;
  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`\\b${escapeRegExp(name)}=\"([^\"]*)\"`));
    return m ? m[1] : null;
  };

  let mPara: RegExpExecArray | null;
  while ((mPara = paraRe.exec(storyXml))) {
    const paraBlock = mPara[0];
    const boldSegs: string[] = [];
    let plain = '';
    let boldBuf = '';

    const flushBold = () => {
      const seg = normalizeInlineText(boldBuf);
      boldBuf = '';
      if (!seg) return;
      // Avoid excessive duplicates when the same bold segment is split across multiple runs.
      if (!boldSegs.length || boldSegs[boldSegs.length - 1] !== seg) boldSegs.push(seg);
    };

    let mChar: RegExpExecArray | null;
    while ((mChar = charRe.exec(paraBlock))) {
      const charBlock = mChar[0];
      const fontStyle = attr(charBlock, 'FontStyle') || '';
      const appliedCharStyle = attr(charBlock, 'AppliedCharacterStyle') || '';
      const isBold = /bold/i.test(fontStyle) || /bold/i.test(appliedCharStyle);

      // Walk tokens inside the CharacterStyleRange in-order (Content or Br)
      const inner = charBlock
        .replace(/^<CharacterStyleRange\b[^>]*>/, '')
        .replace(/<\/CharacterStyleRange>\s*$/, '');

      const tokenRe = /<Content>([\s\S]*?)<\/Content>|<Br\s*\/>/g;
      let t: RegExpExecArray | null;
      while ((t = tokenRe.exec(inner))) {
        if (t[0].startsWith('<Br')) {
          // Treat line breaks as boundaries for bold segments
          if (boldBuf) flushBold();
          plain += '\n';
          continue;
        }
        const raw = t[1] ?? '';
        const cleaned = decodeXmlEntities(raw)
          .replace(/<\?ACE\b[^?]*\?>/g, '')
          .replace(/<\?[^?]*\?>/g, '')
          .replace(/\u00AD/g, '')
          .replace(/[\u2028\u2029]/g, '\n');

        plain += cleaned;

        if (isBold) {
          boldBuf += cleaned;
        } else if (boldBuf) {
          flushBold();
        }
      }
    }

    if (boldBuf) flushBold();
    out.push({ normalizedText: normalizeInlineText(plain), boldSegments: boldSegs });
  }

  return out;
}

function applyBoldMarkers(text: string, boldSegments: string[]): string {
  if (!text) return text;
  if (!boldSegments || boldSegments.length === 0) return text;
  if (text.includes('<<BOLD_START>>')) return text; // already marked

  const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
  const isAbbrevLike = (s: string) => /^[A-Z0-9]{2,}$/.test(s);

  const findNext = (hay: string, needle: string, from: number): number => {
    let idx = hay.indexOf(needle, from);
    while (idx !== -1) {
      const before = idx === 0 ? '' : hay[idx - 1];
      const after = idx + needle.length >= hay.length ? '' : hay[idx + needle.length];
      const first = needle[0] || '';
      const last = needle[needle.length - 1] || '';

      const okBefore = first && isWordChar(first) ? !before || !isWordChar(before) : true;
      const okAfter = last && isWordChar(last) ? !after || !isWordChar(after) : true;

      if (okBefore && okAfter) return idx;
      idx = hay.indexOf(needle, idx + 1);
    }
    return -1;
  };

  let out = '';
  let pos = 0;

  for (const seg of boldSegments) {
    const s = String(seg || '').trim();
    if (!isAbbrevLike(s) && s.length < 3) continue;

    const idx = findNext(text, s, pos);
    if (idx === -1) continue;

    out += text.slice(pos, idx);
    out += `<<BOLD_START>>${s}<<BOLD_END>>`;
    pos = idx + s.length;
  }

  out += text.slice(pos);
  return out;
}

function getSourceSeq(p: DbParagraph): number | null {
  const fm: any = p.formatting_metadata || null;
  const v = fm ? (fm.source_seq ?? fm.sourceSeq) : null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function getStoryFile(p: DbParagraph): string | null {
  const fm: any = p.formatting_metadata || null;
  const v = fm ? (fm.story_file ?? fm.storyFile) : null;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function buildBoldIndexFromIdml(opts: { idmlPath: string; paragraphs: DbParagraph[] }) {
  STORY_BOLD.clear();

  if (!opts.idmlPath || !fs.existsSync(opts.idmlPath)) return;

  const zip = new AdmZip(opts.idmlPath);
  const byStory = new Map<string, DbParagraph[]>();
  for (const p of opts.paragraphs) {
    const story = getStoryFile(p);
    const seq = getSourceSeq(p);
    if (!story || !seq) continue;
    if (!byStory.has(story)) byStory.set(story, []);
    byStory.get(story)!.push(p);
  }

  for (const [story, paras] of byStory.entries()) {
    const entry = zip.getEntry(story);
    if (!entry) continue;
    const storyXml = entry.getData().toString('utf8');
    const storyParas = extractIdmlStoryParagraphs(storyXml);
    if (!storyParas.length) continue;

    // Find mapping offset by matching the first DB paragraph text in this story.
    const sorted = paras
      .slice()
      .map((p) => ({ p, seq: getSourceSeq(p) || 0 }))
      .filter((x) => x.seq > 0)
      .sort((a, b) => a.seq - b.seq);

    let offset: number | null = null;
    for (let i = 0; i < Math.min(5, sorted.length); i++) {
      const cand = sorted[i];
      const needle = normalizeInlineText(cand.p.text_original || '');
      if (!needle) continue;
      const idx = storyParas.findIndex((sp) => sp.normalizedText === needle);
      if (idx >= 0) {
        const storyIndex = idx + 1; // 1-based
        offset = cand.seq - storyIndex;
        break;
      }
    }

    if (offset === null) continue;

    STORY_BOLD.set(story, { offset, paragraphs: storyParas });
  }
}

function getBoldSegmentsForParagraph(p: DbParagraph): string[] {
  const story = getStoryFile(p);
  const seq = getSourceSeq(p);
  if (!story || !seq) return [];
  const idx = STORY_BOLD.get(story);
  if (!idx) return [];
  const storyIndex = seq - idx.offset;
  if (!Number.isFinite(storyIndex) || storyIndex <= 0 || storyIndex > idx.paragraphs.length) return [];
  return idx.paragraphs[storyIndex - 1]?.boldSegments || [];
}

/**
 * Extract section title from header-style paragraph(s) like:
 * "1.3 Celcyclus"
 */
function extractSectionTitle(sectionParas: DbParagraph[], sectionNumber: string): string | undefined {
  // Prefer explicit header kind/style if present
  for (const p of sectionParas) {
    const style = (p.style_name || '').toLowerCase();
    if (!style) continue;
    if (!style.includes('chapter header') && !style.includes('hoofdstuk') && !style.includes('header')) continue;

    const txt = cleanPlainText(p.text_original);
    if (!txt) continue;

    const re = new RegExp(`^${escapeRegExp(sectionNumber)}\\s+`);
    if (re.test(txt)) {
      const title = txt.replace(re, '').trim();
      if (title && title.length < 200) return title;
    }
  }

  return undefined;
}

/**
 * Extract subparagraph title from header-style paragraph(s) like:
 * "1.3.2 Celcyclus"
 */
function extractSubparagraphTitle(subParas: DbParagraph[], subNumber: string): string | undefined {
  for (const p of subParas) {
    const style = (p.style_name || '').toLowerCase();
    if (!style) continue;
    if (!style.includes('subchapter header') && !style.includes('header') && !style.includes('kop')) continue;

    const txt = cleanPlainText(p.text_original);
    if (!txt) continue;

    const re = new RegExp(`^${escapeRegExp(subNumber)}\\s+`);
    if (re.test(txt)) {
      const title = txt.replace(re, '').trim();
      if (title && title.length < 200) return title;
    }
  }
  return undefined;
}

/**
 * Extract chapter title from first header-style paragraph if available
 */
function extractChapterTitle(paragraphs: DbParagraph[], chapterNumber: string): string {
  // Look for a header-style paragraph in this chapter
  const headerStyles = ['header', 'kop', 'titel', 'hoofdstuk'];
  
  for (const p of paragraphs) {
    if (p.chapter_number !== chapterNumber) continue;
    const style = (p.style_name || '').toLowerCase();
    if (headerStyles.some(h => style.includes(h))) {
      const title = cleanPlainText(p.text_original);
      // Remove chapter number prefix if present
      const cleaned = title.replace(new RegExp(`^${chapterNumber}\\s*`), '').trim();
      if (cleaned.length > 0 && cleaned.length < 200) {
        return cleaned;
      }
    }
  }
  
  return `Hoofdstuk ${chapterNumber}`;
}

// =============================================================================
// Structure Building
// =============================================================================

/**
 * Group paragraphs by chapter and section
 */
function buildChapters(paragraphs: DbParagraph[], options: ExportOptions): CanonicalChapter[] {
  // Group by chapter
  const chapterMap = new Map<string, DbParagraph[]>();
  
  for (const p of paragraphs) {
    const ch = p.chapter_number || '0';
    if (!chapterMap.has(ch)) {
      chapterMap.set(ch, []);
    }
    chapterMap.get(ch)!.push(p);
  }
  
  // Sort chapters numerically
  const sortedChapters = Array.from(chapterMap.keys()).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (isNaN(numA) && isNaN(numB)) return a.localeCompare(b);
    if (isNaN(numA)) return 1;
    if (isNaN(numB)) return -1;
    return numA - numB;
  });
  
  // Apply chapter filter if specified
  const filteredChapters = options.chapters
    ? sortedChapters.filter(ch => options.chapters!.includes(ch))
    : sortedChapters;
  
  return filteredChapters.map(chapterNumber => {
    const chapterParas = chapterMap.get(chapterNumber) || [];
    return {
      number: chapterNumber,
      title: extractChapterTitle(chapterParas, chapterNumber),
      sections: buildSections(chapterParas, chapterNumber, options),
    };
  });
}

/**
 * Build sections from paragraphs within a chapter
 */
function buildSections(paragraphs: DbParagraph[], chapterNumber: string, options: ExportOptions): CanonicalSection[] {
  // Group by section (chapter.paragraph_number, e.g., "1.1", "1.2")
  const sectionMap = new Map<string, DbParagraph[]>();
  
  for (const p of paragraphs) {
    const paraNum = p.paragraph_number;
    const sectionKey = paraNum !== null ? `${chapterNumber}.${paraNum}` : `${chapterNumber}.0`;
    
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, []);
    }
    sectionMap.get(sectionKey)!.push(p);
  }
  
  // Sort sections by paragraph number
  const sortedSections = Array.from(sectionMap.keys()).sort((a, b) => {
    const partsA = a.split('.').map(x => parseInt(x, 10) || 0);
    const partsB = b.split('.').map(x => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  
  return sortedSections.map(sectionNumber => {
    const sectionParas = sectionMap.get(sectionNumber) || [];
    return {
      number: sectionNumber,
      title: extractSectionTitle(sectionParas, sectionNumber),
      content: buildContent(sectionParas, options),
    };
  });
}

/**
 * Build content blocks from paragraphs within a section
 */
function buildContent(paragraphs: DbParagraph[], options: ExportOptions): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  
  // Group by subparagraph if present
  const subparagraphMap = new Map<number, DbParagraph[]>();
  const noSubparagraph: DbParagraph[] = [];
  
  for (const p of paragraphs) {
    if (p.subparagraph_number !== null) {
      if (!subparagraphMap.has(p.subparagraph_number)) {
        subparagraphMap.set(p.subparagraph_number, []);
      }
      subparagraphMap.get(p.subparagraph_number)!.push(p);
    } else {
      noSubparagraph.push(p);
    }
  }
  
  // Add paragraphs without subparagraph first
  for (const p of noSubparagraph) {
    const block = buildBlock(p, options);
    if (block) blocks.push(block);
  }
  
  // Add subparagraphs
  const sortedSubparas = Array.from(subparagraphMap.keys()).sort((a, b) => a - b);
  for (const subNum of sortedSubparas) {
    const subParas = subparagraphMap.get(subNum) || [];
    const subBlock = buildSubparagraphBlock(subParas, subNum, options);
    if (subBlock) blocks.push(subBlock);
  }
  
  return blocks;
}

function splitListItems(text: string): string[] {
  const raw = cleanRichText(text);
  if (!raw) return [];
  // Most of our DB bullet extraction collapses items with semicolons.
  // Keep deterministic: split on ';' and newlines.
  const parts = raw
    .split(/;|\n+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length ? parts : [raw];
}

function parseNumberedSteps(text: string): string[] | null {
  const raw = cleanPlainText(text);
  if (!raw) return null;

  // Numbered steps are often extracted as "....1 Tijdens ...2 Tijdens ..." (sometimes without a space before the next number).
  // Accept common boundaries: start, whitespace, or punctuation.
  const re = /(^|[\s\.\!\?\:;])(\d{1,3})\s+(?=[A-ZÀ-ÖØ-Þ])/g;
  const hits: Array<{ num: number; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const numStr = m[2];
    const num = Number(numStr);
    if (!Number.isFinite(num)) continue;
    const offsetInMatch = m[0].indexOf(numStr);
    const start = m.index + (offsetInMatch >= 0 ? offsetInMatch : 0);
    hits.push({ num, start });
  }

  if (hits.length < 2) return null;

  // Ensure starts at 1 and is strictly increasing (typical for step lists)
  hits.sort((a, b) => a.start - b.start);
  if (hits[0].num !== 1) return null;
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].num <= hits[i - 1].num) return null;
  }

  const out: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].start;
    const end = i + 1 < hits.length ? hits[i + 1].start : raw.length;
    const chunk = raw.slice(start, end).trim();
    const cleaned = chunk.replace(/^\d{1,3}\s+/, '').trim();
    if (cleaned) out.push(cleaned);
  }
  return out.length >= 2 ? out : null;
}

function parseHeuristicSteps(text: string): string[] | null {
  const raw = cleanPlainText(text);
  if (!raw) return null;

  const sentences = raw
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length < 2) return null;

  const isMarker = (s: string) =>
    /^Eerst\b/i.test(s) ||
    /^Daarna\b/i.test(s) ||
    /^(Als\s+laatste|Ten\s+slotte)\b/i.test(s) ||
    /^In\s+de\b/i.test(s);

  const markerSents = sentences.filter(isMarker);
  if (markerSents.length >= 2) return markerSents;

  return null;
}

function buildBlock(p: DbParagraph, options: ExportOptions): ContentBlock | null {
  const basisRaw = cleanRichText(p.basis || p.text_original);
  const boldSegments = getBoldSegmentsForParagraph(p);
  const basis = applyBoldMarkers(basisRaw, boldSegments);
  if (!basis || basis.length < 5) return null;

  // Skip header/title styles for content blocks
  const styleLower = (p.style_name || '').toLowerCase();
  if (styleLower.includes('header') || styleLower.includes('hoofdstuk') || styleLower.includes('titel')) {
    return null;
  }

  const role = inferStyleRole({ styleName: p.style_name, map: STYLE_ROLE_MAP });

  if (role === 'bullet_lvl1' || role === 'bullet_lvl2' || role === 'bullet_lvl3') {
    const level: 1 | 2 | 3 = role === 'bullet_lvl2' ? 2 : role === 'bullet_lvl3' ? 3 : 1;
    const items = splitListItems(basis);
    const block: ListBlock = {
      type: 'list',
      id: p.id,
      ordered: false,
      level,
      items,
      styleHint: p.style_name || undefined,
      role,
    };
    return block;
  }

  if (role === 'numbered_steps') {
    const items = parseNumberedSteps(basis) || parseHeuristicSteps(basis);
    if (items && items.length >= 2) {
      const block: StepsBlock = {
        type: 'steps',
        id: p.id,
        items,
        styleHint: p.style_name || undefined,
        role,
      };
      return block;
    }
    // fallback to paragraph if we can't parse steps reliably
  }

  return buildParagraphBlock(p, options);
}

/**
 * Build a paragraph block from a database row
 */
function buildParagraphBlock(p: DbParagraph, options: ExportOptions): ParagraphBlock | null {
  const basisRaw = cleanRichText(p.basis || p.text_original);
  const boldSegments = getBoldSegmentsForParagraph(p);
  const basis = applyBoldMarkers(basisRaw, boldSegments);
  const praktijk = cleanRichText(p.praktijk);
  const verdieping = cleanRichText(p.verdieping);
  
  // Skip empty paragraphs
  if (!basis || basis.length < 5) {
    return null;
  }
  
  // Skip header/title styles for content blocks
  const style = (p.style_name || '').toLowerCase();
  if (style.includes('header') || style.includes('hoofdstuk') || style.includes('titel')) {
    return null;
  }
  
  const block: ParagraphBlock = {
    type: 'paragraph',
    id: p.id,
    paragraphNumber: p.paragraph_number ?? undefined,
    basis,
  };

  // Always carry styleName as a rendering hint (needed to reconstruct bullets, etc.)
  if (p.style_name) {
    block.styleHint = p.style_name;
    block.role = inferStyleRole({ styleName: p.style_name, map: STYLE_ROLE_MAP });
  }
  
  // Add optional layers
  if (praktijk && praktijk.length > 0) {
    block.praktijk = praktijk;
  } else if (options.includeEmpty) {
    block.praktijk = '';
  }
  
  if (verdieping && verdieping.length > 0) {
    block.verdieping = verdieping;
  } else if (options.includeEmpty) {
    block.verdieping = '';
  }
  
  // (options.includeStyleHints is kept for compatibility but no longer required)
  
  return block;
}

/**
 * Build a subparagraph block from multiple database rows
 */
function buildSubparagraphBlock(
  paragraphs: DbParagraph[],
  subparagraphNumber: number,
  options: ExportOptions
): SubparagraphBlock | null {
  if (paragraphs.length === 0) return null;
  
  const firstP = paragraphs[0];
  const chapterNumber = firstP.chapter_number || '0';
  const paraNumber = firstP.paragraph_number || 0;
  
  const content: ContentBlock[] = [];
  for (const p of paragraphs) {
    const block = buildBlock(p, options);
    if (block) content.push(block);
  }
  
  if (content.length === 0) return null;
  
  const subNumber = `${chapterNumber}.${paraNumber}.${subparagraphNumber}`;

  return {
    type: 'subparagraph',
    id: subNumber,
    number: subNumber,
    title: extractSubparagraphTitle(paragraphs, subNumber),
    content,
  };
}

// =============================================================================
// Main Export Function
// =============================================================================

async function exportCanonical(uploadId: string, options: ExportOptions = {}): Promise<CanonicalBook> {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: getDbUrl(), max: 5, idleTimeoutMillis: 10_000 });
  
  try {
    // Get book metadata
    const bookRes = await pool.query<DbBook>(
      `SELECT id, title, level FROM public.book_uploads WHERE id = $1`,
      [uploadId]
    );
    const book = bookRes.rows[0];
    if (!book) {
      throw new Error(`Upload not found: ${uploadId}`);
    }
    
    // Build query with optional chapter filter
    const chapterFilter = options.chapters && options.chapters.length > 0
      ? `AND p.chapter_number = ANY($2)`
      : '';
    
    const queryParams: unknown[] = [uploadId];
    if (options.chapters && options.chapters.length > 0) {
      queryParams.push(options.chapters);
    }
    
    const query = `
      WITH best AS (
        SELECT
          r.paragraph_id,
          r.layer_tag,
          r.text_rewritten,
          ROW_NUMBER() OVER (PARTITION BY r.paragraph_id, r.layer_tag ORDER BY r.created_at DESC) AS rn
        FROM public.book_rewrites r
        WHERE r.status = 'approved'
          AND r.layer_tag IN ('basis', 'praktijk', 'verdieping')
      )
      SELECT
        p.id,
        p.chapter_number,
        p.paragraph_number,
        p.subparagraph_number,
        p.text_original,
        p.style_name,
        p.content_type,
        p.formatting_metadata,
        MAX(CASE WHEN b.layer_tag = 'basis' THEN b.text_rewritten END) AS basis,
        MAX(CASE WHEN b.layer_tag = 'praktijk' THEN b.text_rewritten END) AS praktijk,
        MAX(CASE WHEN b.layer_tag = 'verdieping' THEN b.text_rewritten END) AS verdieping
      FROM public.book_paragraphs p
      LEFT JOIN best b ON b.paragraph_id = p.id AND b.rn = 1
      WHERE p.upload_id = $1
        ${chapterFilter}
      GROUP BY p.id, p.chapter_number, p.paragraph_number, p.subparagraph_number, 
               p.text_original, p.style_name, p.content_type, p.formatting_metadata
      ORDER BY
        NULLIF((p.formatting_metadata->>'source_seq'), '')::INT ASC NULLS LAST,
        CASE WHEN p.chapter_number ~ '^[0-9]+$' THEN p.chapter_number::INT ELSE 999999 END ASC,
        p.paragraph_number ASC NULLS LAST,
        p.subparagraph_number ASC NULLS LAST
    `;
    
    const paraRes = await pool.query<DbParagraph>(query, queryParams);
    const paragraphs = paraRes.rows;
    
    console.log(`📚 Loaded ${paragraphs.length} paragraphs from database`);

    if (IDML_PATH_FOR_BOLD && fs.existsSync(IDML_PATH_FOR_BOLD)) {
      console.log('🅱️  Extracting inline bold from IDML for Prince parity...');
      buildBoldIndexFromIdml({ idmlPath: IDML_PATH_FOR_BOLD, paragraphs });
      console.log(`   bold stories indexed: ${STORY_BOLD.size}`);
    }
    
    // Build canonical structure
    const canonicalBook: CanonicalBook = {
      meta: {
        id: book.id,
        title: book.title,
        level: book.level as 'n3' | 'n4',
      },
      chapters: buildChapters(paragraphs, options),
      export: {
        exportedAt: new Date().toISOString(),
        source: 'supabase',
        schemaVersion: '1.0',
      },
    };
    
    return canonicalBook;
  } finally {
    await pool.end();
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main() {
  const uploadId = process.argv[2];
  if (!uploadId) {
    console.error('Usage: npx tsx export-canonical-from-db.ts <uploadId> [--chapter 1] [--out output.json]');
    process.exit(1);
  }
  
  // Optional: IDML used to extract inline bold (defaults to the canonical snapshot used by tokens:ch1)
  const repoRoot = path.resolve(__dirname, '../..');
  const idmlArg = getArg('--idml');
  const defaultIdml = path.resolve(
    repoRoot,
    '_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml'
  );
  const resolvedIdml = idmlArg ? path.resolve(repoRoot, idmlArg) : defaultIdml;
  IDML_PATH_FOR_BOLD = fs.existsSync(resolvedIdml) ? resolvedIdml : null;

  const chapterArg = getArg('--chapter');
  const outArg = getArg('--out');
  const figuresArg = getArg('--figures');
  const includeEmpty = process.argv.includes('--include-empty');
  const includeStyleHints = process.argv.includes('--include-style-hints');
  
  const options: ExportOptions = {
    chapters: chapterArg ? [chapterArg] : undefined,
    includeEmpty,
    includeStyleHints,
    includeImages: !!figuresArg,
  };

  let figuresByParagraph: Record<string, any[]> = {};
  if (figuresArg && fs.existsSync(figuresArg)) {
    console.log(`🖼️  Loading figures mapping from ${figuresArg}`);
    figuresByParagraph = JSON.parse(fs.readFileSync(figuresArg, 'utf8'));
  }
  
  console.log('🔄 Exporting canonical JSON...');
  console.log(`   Upload ID: ${uploadId}`);
  if (options.chapters) {
    console.log(`   Chapter filter: ${options.chapters.join(', ')}`);
  }
  
  const book = await exportCanonical(uploadId, options);

  // Inject figures deterministically if mapping provided
  const figureKeys = Object.keys(figuresByParagraph || {});
  if (figureKeys.length > 0) {
    console.log('🖼️  Injecting figures into book structure...');
    let injected = 0;

    for (const chapter of book.chapters) {
      for (const section of chapter.sections) {
        for (const block of section.content) {
          if (block.type === 'paragraph' || block.type === 'list' || block.type === 'steps') {
            const figs = figuresByParagraph[block.id];
            if (figs && figs.length > 0) {
              block.images = figs.map((f: any) => ({
                src: f.src,
                alt: f.alt || '',
                figureNumber: f.figureNumber,
                caption: f.caption,
                width: f.width || (f.placement === 'inline' ? '50%' : '100%'),
              }));
              injected += figs.length;
            }
          } else if (block.type === 'subparagraph') {
            for (const inner of block.content) {
              if (inner.type === 'paragraph' || inner.type === 'list' || inner.type === 'steps') {
                const figs = figuresByParagraph[inner.id];
                if (figs && figs.length > 0) {
                  inner.images = figs.map((f: any) => ({
                    src: f.src,
                    alt: f.alt || '',
                    figureNumber: f.figureNumber,
                    caption: f.caption,
                    width: f.width || (f.placement === 'inline' ? '50%' : '100%'),
                  }));
                  injected += figs.length;
                }
              }
            }
          }
        }
      }
    }

    console.log(`   Injected ${injected} figure(s).`);
  }

  // Chapter opener (optional) – render as chapter-level image.
  // Convention: new_pipeline/assets/images/ch{N}/Book_chapter_opener.jpg
  for (const ch of book.chapters) {
    const chNum = String((ch as any).number ?? '').trim();
    if (!chNum) continue;
    const openerRel = `new_pipeline/assets/images/ch${chNum}/Book_chapter_opener.jpg`;
    const openerAbs = path.resolve(__dirname, '../..', openerRel);
    if (fs.existsSync(openerAbs)) {
      ch.images = [
        {
          src: openerRel,
          alt: 'Hoofdstuk opener',
          width: '100%',
        },
      ];
    }
  }
  
  // Calculate stats
  let totalParagraphs = 0;
  let withPraktijk = 0;
  let withVerdieping = 0;
  
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const block of section.content) {
        if (block.type === 'paragraph') {
          totalParagraphs++;
          if (block.praktijk) withPraktijk++;
          if (block.verdieping) withVerdieping++;
        } else if (block.type === 'subparagraph') {
          for (const inner of block.content) {
            if (inner.type === 'paragraph') {
              totalParagraphs++;
              if (inner.praktijk) withPraktijk++;
              if (inner.verdieping) withVerdieping++;
            }
          }
        }
      }
    }
  }
  
  console.log(`\n📊 Export Statistics:`);
  console.log(`   Chapters: ${book.chapters.length}`);
  console.log(`   Total paragraphs: ${totalParagraphs}`);
  console.log(`   With praktijk: ${withPraktijk} (${Math.round(withPraktijk / totalParagraphs * 100)}%)`);
   console.log(`   With verdieping: ${withVerdieping} (${Math.round(withVerdieping / totalParagraphs * 100)}%)`);
  
  // Write output
  const outputDir = path.resolve(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const defaultName = options.chapters
    ? `canonical_ch${options.chapters.join('-')}.json`
    : 'canonical_full.json';
  const outputPath = outArg ? path.resolve(outArg) : path.join(outputDir, defaultName);
  
  fs.writeFileSync(outputPath, JSON.stringify(book, null, 2), 'utf8');
  console.log(`\n✅ Wrote canonical JSON to: ${outputPath}`);
}

main().catch((err) => {
  console.error('❌ Export failed:', err.message);
  process.exit(1);
});
