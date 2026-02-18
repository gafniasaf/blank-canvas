/**
 * Prince XML PDF Renderer
 * 
 * Generates professional PDF using Prince XML.
 * 
 * Usage:
 *   npx tsx new_pipeline/renderer/render-prince-pdf.ts <input.json> [--out output.pdf]
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import type {
  CanonicalBook,
  ContentBlock,
  ListBlock,
  ParagraphBlock,
  StepsBlock,
  SubparagraphBlock,
} from '../schema/canonical-schema';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Hyphenation exceptions (Prince pipeline only)
// =============================================================================

type HyphenationExceptions = {
  // Map: exact word -> array of 1-based forbidden break positions (index in string)
  // Example: { "wijzen": [2] } means forbid a line break between "wi" and "jzen".
  words?: Record<string, number[]>;
};

type HyphenationMode = 'enhanced' | 'standard';
let HYPHENATION_MODE: HyphenationMode = 'enhanced';

type TextAlignMode = 'justify' | 'left';
let TEXT_ALIGN_MODE: TextAlignMode = 'justify';

let KD_INDEX_ENABLED = false;
let KD_INDEX_SHOW_CODES = false;
let KD_BOOK_ID: string | null = null;
let KD_MAPPING_PATH: string | null = null;

// Book context for figure path resolution
let CURRENT_BOOK_TITLE: string = '';
let CURRENT_BOOK_SLUG: string = '';

const HYPH_EXCEPTIONS_PATH = path.resolve(__dirname, '../templates/hyphenation_exceptions.json');
let HYPH_EXCEPTIONS: HyphenationExceptions | null = null;

const OVERLAYS_MAP_PATH = path.resolve(__dirname, '../generated/figure_overlays_map.json');
const NUMBER_MAP_PATH = path.resolve(__dirname, '../generated/figure_number_map.json');
let FIGURE_OVERLAYS_MAP: Record<string, any> | null = null;
let FIGURE_NUMBER_MAP: Record<string, string> | null = null;

function loadFigureOverlays() {
  if (FIGURE_OVERLAYS_MAP) return;
  try {
    if (fs.existsSync(OVERLAYS_MAP_PATH)) {
      const raw = fs.readFileSync(OVERLAYS_MAP_PATH, 'utf-8');
      FIGURE_OVERLAYS_MAP = JSON.parse(raw);
    } else {
      FIGURE_OVERLAYS_MAP = {};
    }
    
    if (fs.existsSync(NUMBER_MAP_PATH)) {
      const raw = fs.readFileSync(NUMBER_MAP_PATH, 'utf-8');
      FIGURE_NUMBER_MAP = JSON.parse(raw);
    } else {
      FIGURE_NUMBER_MAP = {};
    }
  } catch (e) {
    console.warn('Failed to load figure overlays map:', e);
    FIGURE_OVERLAYS_MAP = {};
    FIGURE_NUMBER_MAP = {};
  }
}
try {
  if (fs.existsSync(HYPH_EXCEPTIONS_PATH)) {
    HYPH_EXCEPTIONS = JSON.parse(fs.readFileSync(HYPH_EXCEPTIONS_PATH, 'utf8')) as HyphenationExceptions;
  }
} catch {
  HYPH_EXCEPTIONS = null;
}

function applyHyphenationExceptions(text: string): string {
  // "standard" means: let Prince handle hyphenation normally (no injected WORD JOINER rules).
  if (HYPHENATION_MODE === 'standard') return text;

  const rules = HYPH_EXCEPTIONS?.words;
  if (!rules) return text;

  let out = text;

  for (const [word, positions] of Object.entries(rules)) {
    if (!word) continue;
    const posList = (positions || []).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n));
    if (!posList.length) continue;

    // Replace exact word occurrences. Use a boundary-ish check to avoid partial matches.
    // (Unicode-aware full word boundaries are tricky in JS; this is good enough for our Dutch text.)
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'giu');

    out = out.replace(re, (m, pre, w) => {
      // Insert WORD JOINER (U+2060) at forbidden break positions.
      const inserts = Array.from(new Set(posList)).sort((a, b) => b - a);
      let patched = String(w);
      for (const p of inserts) {
        if (p <= 0 || p >= patched.length) continue;
        patched = patched.slice(0, p) + '\u2060' + patched.slice(p);
      }
      return String(pre) + patched;
    });
  }

  return out;
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

function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// For visible text nodes (not attributes): apply hyphenation exceptions first.
function escapeHtmlText(str: string | undefined | null): string {
  return escapeHtml(applyHyphenationExceptions(String(str ?? '')));
}

// Headings: prevent ugly wraps that leave a dangling "-" at end of a heading line.
// This is common in Dutch shorthand like "bloedings-, opbouw- en ...":
// the break happens at the space after the hyphen, leaving "opbouw-" at line end
// (our validator flags this as heading hyphenation).
function normalizeHeadingText(raw: string | undefined | null): string {
  let t = applyHyphenationExceptions(String(raw ?? ''));
  // Keep "- en" / "- of" together (NBSP after the hyphen).
  t = t.replace(/-\s+(en|of)\b/giu, '-\u00A0$1');
  return t;
}

function escapeHtmlHeadingText(str: string | undefined | null): string {
  return escapeHtml(normalizeHeadingText(str));
}

// Headings may contain inline bold markers; render them as HTML for visible text.
function renderHeadingInlineText(str: string | undefined | null): string {
  const normalized = normalizeHeadingText(str);
  return renderInlineText(normalized, { preserveLineBreaks: false });
}

/**
 * Render inline formatting markers from our rewrite/Indesign conventions:
 * - `<<BOLD_START>>...<<BOLD_END>>` => <strong>...</strong>
 * - `\n` => <br>
 *
 * Everything else is HTML-escaped.
 */
type RenderInlineTextOptions = {
  /**
   * When true, '\n' becomes <br> (forced line break).
   * When false, all newline runs are normalized to spaces so text can flow/justify normally.
   */
  preserveLineBreaks?: boolean;
};

function renderBoxText(text: string | undefined | null): string {
  let raw = String(text ?? '').trim();
  if (!raw) return '';

  // Strip any <span class="box-lead">…</span> wrapper from LLM output —
  // renderBoxText adds its own box-lead wrapper below.
  raw = raw.replace(/<span\s+class="box-lead">/gi, '').replace(/<\/span>/gi, '');

  // Fix common "stretched first line" issue in justified box paragraphs:
  // The first line often contains very few words (e.g., "Bij een") and Prince can
  // expand the inter-word space massively. We wrap the first two words in an
  // inline-block span so the internal spacing isn't stretched by justification.
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return renderInlineText(raw, { preserveLineBreaks: false });

  const leadRaw = parts.slice(0, 2).join(' ');
  const restRaw = parts.slice(2).join(' ');

  const leadHtml = renderInlineText(leadRaw, { preserveLineBreaks: false });
  const restHtml = restRaw ? renderInlineText(restRaw, { preserveLineBreaks: false }) : '';
  return `<span class="box-lead">${leadHtml}</span>${restHtml ? ` ${restHtml}` : ''}`;
}

function renderInlineText(text: string | undefined | null, opts?: RenderInlineTextOptions): string {
  let t = applyHyphenationExceptions(String(text ?? ''));
  if (!t) return '';

  // Convert HTML bold tags to marker format so they render as actual bold.
  // LLM-generated content often uses <strong>…</strong> instead of <<BOLD_START>>…<<BOLD_END>>.
  t = t.replace(/<strong>/gi, '<<BOLD_START>>').replace(/<\/strong>/gi, '<<BOLD_END>>');
  // Also handle <b>…</b> and <em>…</em> (treat em as bold for display)
  t = t.replace(/<b>/gi, '<<BOLD_START>>').replace(/<\/b>/gi, '<<BOLD_END>>');
  t = t.replace(/<em>/gi, '<<BOLD_START>>').replace(/<\/em>/gi, '<<BOLD_END>>');
  // Strip any other HTML tags that might have slipped through from LLM output
  // (e.g. <span class="box-lead">…</span>, <p>, <br>, etc.)
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/?(span|p|div|ul|ol|li|a|h[1-6])[^>]*>/gi, '');

  // Remove invisible soft hyphens (U+00AD). These can otherwise survive into the PDF and
  // create unwanted hyphenation points even when CSS hyphenation is disabled.
  t = t.replace(/\u00AD/g, '');

  // Micro-title markers are layout directives; never render them as literal text.
  // (They are converted to styled micro titles in renderParagraphBlock, but we also strip
  // them here as a safety net so they can never leak into the PDF.)
  t = t.replace(/<<MICRO_TITLE>>/g, '').replace(/<<MICRO_TITLE_END>>/g, '');

  if (HYPHENATION_MODE !== 'standard') {
    // Prevent ugly hyphenation inside short parenthetical tags like "(vervolg)" / "(toepassing)".
    // We only protect the parenthetical form so the normal word (outside parentheses) can still hyphenate if needed.
    t = t.replace(/\((toepassing|vervolg|kern|samenvatting)\)/gi, (_m, w: string) => {
      // If already patched (contains WORD JOINER), keep as-is.
      if (String(w).includes('\u2060')) return `(${w})`;
      const joined = Array.from(String(w)).join('\u2060');
      return `(${joined})`;
    });
  }

  const preserveLineBreaks = opts?.preserveLineBreaks ?? true;
  if (!preserveLineBreaks) {
    // Newlines in source are usually "soft returns"/hard wraps. In Prince these become <br> which:
    // - prevents normal justification
    // - creates "one sentence per line" blocks
    // Normalize them to spaces for flowing text.
    t = t.replace(/\s*\n+\s*/g, ' ');

    if (HYPHENATION_MODE !== 'standard') {
      // Typography: prevent very short connector fragments at end-of-line that create
      // “uitgesmeerde regels” in justified text (and look unprofessional).
      //
      // Example: "Sommige woorden zijn lang, zoals Katabolisme ..." should not break as:
      //   "Sommige woorden zijn lang, zoals"
      //   "Katabolisme ..."
      //
      // We keep connector + next word together using NBSP.
      try {
        // Also keep comma + connector together so we don't end a line with "...,"
        // and start the next with "zoals".
        t = t.replace(/,\s+(?=(zoals|bijvoorbeeld|namelijk)\b)/giu, ',\u00A0');
        t = t.replace(/\b(zoals|bijvoorbeeld|namelijk)\b\s+(?=[\p{L}\p{N}])/giu, '$1\u00A0');
        // Also avoid breaking after a colon in running text (keep ':' + next word together),
        // but do not touch time-like patterns (we require a letter before ':').
        t = t.replace(/([\p{L}]):\s+(?=[\p{L}\p{N}])/gu, '$1:\u00A0');
        // Note: we intentionally only bind ':' + next word, not more.
        // Over-binding after ':' can reduce line-break flexibility and can make some justified lines worse.
      } catch {
        // If Unicode property escapes aren't available for some reason, skip silently.
      }
    }
  }

  const re = /(<<BOLD_START>>|<<BOLD_END>>|\n)/g;
  let out = '';
  let last = 0;
  let inBold = false;

  for (;;) {
    const m = re.exec(t);
    if (!m) break;

    const idx = m.index;
    const token = m[1];
    const chunk = t.slice(last, idx);
    if (chunk) out += escapeHtml(chunk);

    if (token === '<<BOLD_START>>') {
      if (!inBold) {
        out += '<strong>';
        inBold = true;
      }
    } else if (token === '<<BOLD_END>>') {
      if (inBold) {
        out += '</strong>';
        inBold = false;
      }
    } else {
      // '\n'
      out += '<br>';
    }

    last = re.lastIndex;
  }

  const tail = t.slice(last);
  if (tail) out += escapeHtml(tail);
  if (inBold) out += '</strong>';

  return out;
}

function stripInlineMarkers(text: string): string {
  return String(text || '')
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type MicroTitleSegment = { type: 'title' | 'body'; text: string };

function parseMicroTitles(raw: string | undefined | null): MicroTitleSegment[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];

  const MICRO_RE = /<<MICRO_TITLE>>([\s\S]*?)<<MICRO_TITLE_END>>/gu;
  const segments: MicroTitleSegment[] = [];

  let last = 0;
  let m: RegExpExecArray | null;
  MICRO_RE.lastIndex = 0;
  while ((m = MICRO_RE.exec(s)) !== null) {
    const before = s.slice(last, m.index).trim();
    if (before) segments.push({ type: 'body', text: before });

    const title = String(m[1] ?? '').trim();
    if (title) segments.push({ type: 'title', text: title });

    last = m.index + m[0].length;
  }

  const tail = s.slice(last).trim();
  if (tail) segments.push({ type: 'body', text: tail });

  // Upstream sometimes duplicates the same micro-title marker twice in a row:
  //   <<MICRO_TITLE>>X<<MICRO_TITLE_END>>\n\n<<MICRO_TITLE>>X<<MICRO_TITLE_END>>
  // Render only one in that case (keep repeats only if there's body content in between).
  const deduped: MicroTitleSegment[] = [];
  let lastTitleNorm: string | null = null;
  for (const seg of segments) {
    if (seg.type === 'title') {
      const n = stripInlineMarkers(seg.text).replace(/\s+/g, ' ').trim().toLowerCase();
      if (n && lastTitleNorm === n) continue;
      lastTitleNorm = n || null;
      deduped.push(seg);
    } else {
      lastTitleNorm = null;
      deduped.push(seg);
    }
  }

  return deduped;
}

function capitalizeFirstLetter(s: string): string {
  // Capitalize only a leading lowercase letter (Dutch), keeping any leading quotes/brackets.
  return String(s).replace(/^([\s"'“‘(]*)([a-zà-ÿ])/u, (_m, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`);
}

/**
 * Prince-only typography assist:
 * Split a single canonical paragraph into multiple HTML paragraphs when we detect a
 * "new sentence starts with lowercase and quickly contains 'gaat over'".
 *
 * Why:
 * - These patterns come from our demo/placeholder and some rewrite edge cases.
 * - In justified text, this often creates a very short mid-paragraph line (huge word gaps),
 *   e.g. "en praktisch. cellen en onderdelen".
 * - Splitting makes the short sentence the LAST line of a paragraph, which is not justified
 *   (closer to InDesign's visually pleasing output).
 *
 * This is conservative and only triggers when:
 * - sentence-ending punctuation followed by spaces, then a lowercase letter, and
 * - within ~120 chars we see the token "gaat over".
 */
function splitParagraphForJustification(raw: string | undefined | null): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];

  const re = /([.!?])\s+(?=[a-zà-ÿ][\s\S]{0,120}?\bgaat over\b)/gu;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(s)) !== null) {
    const cut = m.index + String(m[1]).length; // include punctuation
    const before = s.slice(last, cut).trim();
    if (before) parts.push(before);
    last = re.lastIndex; // skip the whitespace after punctuation
  }

  const tail = s.slice(last).trim();
  if (tail) parts.push(tail);

  if (parts.length <= 1) return [s];

  // Make subsequent parts start with a capital letter (they were starting lowercase).
  for (let i = 1; i < parts.length; i++) {
    parts[i] = capitalizeFirstLetter(parts[i]);
  }
  return parts;
}

function normalizeListItemForHeuristic(s: string): string {
  // Keep it conservative and deterministic.
  // - Strip markers
  // - Strip trailing punctuation that is common in enumerations
  // - Normalize whitespace
  const t = stripInlineMarkers(s)
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*[.,;:]+$/g, '')
    .trim();
  return t;
}

/**
 * "Short parallel item" heuristic for keeping bullet lists.
 * We only keep bullets when:
 * - there are >= 3 items AND
 * - every item looks like a short phrase (not a sentence).
 */
function isShortParallelItem(s: string): boolean {
  const t = normalizeListItemForHeuristic(s);
  if (!t) return false;
  // Sentence punctuation → not a short list item (but allow single trailing period)
  if (/[!?]/.test(t)) return false;
  if (/\.\s/.test(t)) return false;
  // Length cap: much more lenient to keep most list items as bullets
  if (t.length > 120) return false;
  // Word-count cap: allow longer explanatory items (up to 20 words)
  const words = t.split(/\s+/g).filter(Boolean);
  if (words.length > 20) return false;
  return true;
}

function shouldKeepAsBullets(items: string[]): boolean {
  const nonEmpty = items.map((s) => String(s || '').trim()).filter(Boolean);
  // Style target: keep bullets for most lists (more lenient than before).
  // Keep bullets when 2+ items and they're reasonably sized.
  if (nonEmpty.length < 2) return false;
  // Allow up to 15 items for longer lists
  if (nonEmpty.length > 15) return false;
  // Allow lists where at least 60% of items are short parallel items
  // This handles cases where most items are short but one is explanatory
  const shortCount = nonEmpty.filter(isShortParallelItem).length;
  return shortCount >= Math.ceil(nonEmpty.length * 0.6);
}

function escapeRegExp(s: string): string {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Some upstream exports store titles redundantly as "<number> <title>".
 * Our renderer already prints the number separately, so we strip any leading
 * "<number> " / "<number>." / "<number>:" / ".<number>" prefix from the title.
 */
function normalizeNumberedTitle(number: string, title: string): string {
  const t = String(title || '').trim();
  const num = String(number || '').trim();
  if (!t) return '';
  if (!num) return t;

  const escaped = escapeRegExp(num);
  // Examples we strip:
  // - "10.3 Activiteiten uitvoeren"
  // - "10.3. Activiteiten uitvoeren"
  // - "10.3: Activiteiten uitvoeren"
  // - ".1 De cel"
  const re = new RegExp(`^(?:\\.)?${escaped}(?:[\\s.:]+)([\\s\\S]+)$`, 'u');
  const m = re.exec(t);
  if (!m) return t;
  const stripped = String(m[1] || '').trim();
  return stripped || t;
}

function normalizeChapterTitle(chapterNumber: string, title: string): string {
  const t = String(title || '').trim();
  const num = String(chapterNumber || '').trim();
  if (!t) return '';

  // Prefer exact-number stripping first (handles ".1 ..." and "1. ...").
  if (num) {
    const stripped = normalizeNumberedTitle(num, t);
    if (stripped && stripped !== t) return stripped;
  }

  // Generic fallback: ".<digits> <title>"
  // NOTE: this is a RegExp literal, so we must NOT double-escape backslashes.
  // We want to match a literal '.' prefix (not a backslash).
  const stripped2 = t.replace(/^\.[0-9]+(?:[.:])?\s*/, '').trim();
  if (stripped2 && stripped2 !== t) return stripped2;

  return t;
}

function normalizeSectionTitle(sectionNumber: string, title: string): string {
  return normalizeNumberedTitle(sectionNumber, title);
}

function normalizeSubparagraphTitle(subparagraphNumber: string, title: string): string {
  return normalizeNumberedTitle(subparagraphNumber, title);
}

function slugifyForCssClass(s: string): string {
  const raw = String(s || '').trim();
  if (!raw) return '';
  const ascii = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveBookSlug(book: CanonicalBook, inputJsonPath?: string): string {
  const titleSlug = slugifyForCssClass(book.meta.title || '');
  let fileSlug = '';
  if (inputJsonPath) {
    const base = path.basename(inputJsonPath, '.json');
    const primary = base.split('__')[0] || '';
    // Avoid generic directory names and canonical labels
    if (primary && !/canonical/i.test(primary)) {
      fileSlug = slugifyForCssClass(primary);
    }
  }
  const candidate = fileSlug || titleSlug;
  if (!candidate || candidate === 'output' || candidate === 'canonical-jsons-all') {
    return titleSlug;
  }
  return candidate;
}

function isAfBookMeta(book: CanonicalBook, slug?: string): boolean {
  const title = String(book.meta.title || '').toLowerCase();
  const fullTitle = String((book.meta as any).full_title || '').toLowerCase();
  const slugLower = String(slug || '').toLowerCase();
  return (
    slugLower.startsWith('af') ||
    title.includes('a&f') ||
    title.includes('af4') ||
    (title.includes('anatomie') && title.includes('fysiologie')) ||
    (fullTitle.includes('anatomie') && fullTitle.includes('fysiologie'))
  );
}

// =============================================================================
// HTML Generation
// =============================================================================

interface IndexEntry { term: string; seeAlso?: string[]; page?: string; }
interface GlossaryItem { term: string; definition: string; }

/** Recursively collect all text from a content block tree */
function collectBlockText(blocks: any[]): string {
  if (!blocks || !Array.isArray(blocks)) return '';
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.basis) parts.push(String(b.basis));
    if (b.praktijk) parts.push(String(b.praktijk));
    if (b.verdieping) parts.push(String(b.verdieping));
    if (b.items && Array.isArray(b.items)) {
      for (const item of b.items) {
        if (typeof item === 'string') parts.push(item);
        else if (item?.text) parts.push(String(item.text));
      }
    }
    if (b.content && Array.isArray(b.content)) parts.push(collectBlockText(b.content));
    if (b.blocks && Array.isArray(b.blocks)) parts.push(collectBlockText(b.blocks));
  }
  return parts.join(' ');
}

/**
 * Extract author-emphasized keywords from book text.
 * These are terms wrapped in <strong>…</strong>, <b>…</b>, or <<BOLD_START>>…<<BOLD_END>>
 * in the canonical JSON — the author/LLM highlighted them as key concepts.
 * Returns a deduplicated, cleaned list of terms.
 */
function extractBoldTerms(book: CanonicalBook): string[] {
  const allText: string[] = [];
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      allText.push(collectBlockText(section.content));
    }
  }
  const joined = allText.join(' ');

  // Extract from HTML bold tags
  const htmlBold = [...joined.matchAll(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/gi)].map(m => m[1]);
  // Extract from marker format
  const markerBold = [...joined.matchAll(/<<BOLD_START>>(.*?)<<BOLD_END>>/g)].map(m => m[1]);
  const raw = [...htmlBold, ...markerBold];

  // Clean, deduplicate, filter
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const r of raw) {
    let t = r.replace(/<[^>]+>/g, '').trim().replace(/:$/, '');
    if (!t || t.length < 3 || t.length > 60) continue;
    // Skip very generic Dutch words
    const skip = new Set(['het', 'een', 'van', 'met', 'voor', 'door', 'maar', 'ook', 'dat', 'dit', 'wel', 'niet', 'nog']);
    if (skip.has(t.toLowerCase())) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Capitalise first letter for display
    t = t.charAt(0).toUpperCase() + t.slice(1);
    terms.push(t);
  }
  return terms.sort((a, b) => a.localeCompare(b, 'nl'));
}

/** Max page references per index term. When a term appears in more sections,
 *  we keep only the N most relevant ones (bold-presence → frequency → first). */
const INDEX_MAX_PAGE_REFS = 4;

interface SectionScore {
  sectionId: string;
  /** Number of times the term appears in this section's plain text */
  frequency: number;
  /** Whether the term appears inside a <strong>/<b>/<<BOLD>> tag in this section (= definition site) */
  isBoldHere: boolean;
  /** Section order index (lower = earlier in book) */
  order: number;
}

/**
 * Build a mapping: term → list of section IDs where the term appears.
 * When a term appears in more than INDEX_MAX_PAGE_REFS sections, only the
 * most relevant ones are kept. Relevance scoring:
 *   1. Sections where the term is bold (definition / introduction site)  +100
 *   2. Sections with higher frequency of the term                        +freq
 *   3. Earlier sections (first mention bias)                              +0.01*(totalSections - order)
 */
function buildTermSectionMap(book: CanonicalBook, terms: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!terms.length) return map;

  const lowerTerms = terms.map(t => t.toLowerCase());

  // Pre-compute per-section: raw text (for frequency) and raw html (for bold detection)
  interface SectionData { sectionId: string; chapterNum: number; plainText: string; rawText: string; order: number; }
  const sections: SectionData[] = [];
  let order = 0;
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      const raw = collectBlockText(section.content);
      sections.push({
        sectionId: `sec-${section.number}`,
        chapterNum: chapter.number,
        plainText: raw.toLowerCase().replace(/<[^>]+>/g, ''),
        rawText: raw,
        order: order++,
      });
    }
  }

  // For each term, collect scored sections
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const lower = lowerTerms[i];
    const scored: SectionScore[] = [];

    for (const sec of sections) {
      if (!sec.plainText.includes(lower)) continue;

      // Count frequency (number of non-overlapping occurrences)
      let freq = 0;
      let pos = 0;
      while ((pos = sec.plainText.indexOf(lower, pos)) !== -1) {
        freq++;
        pos += lower.length;
      }

      // Check if the term appears inside a bold tag in this section
      const boldRe = new RegExp(
        `<(?:strong|b)>[^<]*?${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*?<\\/(?:strong|b)>` +
        `|<<BOLD_START>>[^<]*?${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*?<<BOLD_END>>`,
        'i'
      );
      const isBoldHere = boldRe.test(sec.rawText);

      scored.push({
        sectionId: sec.sectionId,
        frequency: freq,
        isBoldHere,
        order: sec.order,
      });
    }

    if (scored.length === 0) continue;

    // Step 1: Deduplicate — keep only the best section per chapter
    // (sections in the same chapter often land on the same PDF page → duplicate page numbers)
    const totalSections = sections.length;
    const byChapter = new Map<number, SectionScore[]>();
    for (const s of scored) {
      const ch = sections[s.order].chapterNum;
      if (!byChapter.has(ch)) byChapter.set(ch, []);
      byChapter.get(ch)!.push(s);
    }
    const deduped: SectionScore[] = [];
    for (const [, chScored] of byChapter) {
      // Pick the best section within this chapter
      chScored.sort((a, b) => {
        const scoreA = (a.isBoldHere ? 100 : 0) + a.frequency + 0.01 * (totalSections - a.order);
        const scoreB = (b.isBoldHere ? 100 : 0) + b.frequency + 0.01 * (totalSections - b.order);
        return scoreB - scoreA;
      });
      deduped.push(chScored[0]);
    }

    // Step 2: Cap at INDEX_MAX_PAGE_REFS
    if (deduped.length <= INDEX_MAX_PAGE_REFS) {
      deduped.sort((a, b) => a.order - b.order);
      map.set(term, deduped.map(s => s.sectionId));
    } else {
      deduped.sort((a, b) => {
        const scoreA = (a.isBoldHere ? 100 : 0) + a.frequency + 0.01 * (totalSections - a.order);
        const scoreB = (b.isBoldHere ? 100 : 0) + b.frequency + 0.01 * (totalSections - b.order);
        return scoreB - scoreA;
      });
      const top = deduped.slice(0, INDEX_MAX_PAGE_REFS);
      top.sort((a, b) => a.order - b.order);
      map.set(term, top.map(s => s.sectionId));
    }
  }
  return map;
}

function generateHTML(book: CanonicalBook, opts?: { inputJsonPath?: string; indexEntries?: IndexEntry[]; glossaryItems?: GlossaryItem[] }): string {
  // Set book context for figure path resolution
  CURRENT_BOOK_TITLE = book.meta.title || '';
  CURRENT_BOOK_SLUG = resolveBookSlug(book, opts?.inputJsonPath);
  const isAfBook = isAfBookMeta(book, CURRENT_BOOK_SLUG);
  
  const cssArg = getArg('--css');
  const baseCssPath = path.resolve(__dirname, '../templates/prince-af-two-column.css');
  const tokenCssPath = path.resolve(__dirname, '../templates/prince-af-two-column.tokens.css');
  // If we're rendering from a per-run output folder (e.g. skeleton-first runs),
  // allow a "sidecar" token CSS next to the input JSON to avoid cross-run clobbering.
  const sidecarTokenCssPath = opts?.inputJsonPath
    ? path.resolve(path.dirname(opts.inputJsonPath), 'prince-af-two-column.tokens.css')
    : null;
  const cssPath = (() => {
    if (cssArg) return path.resolve(cssArg);
    // Prefer sidecar token CSS when present (keeps parallel builds deterministic).
    try {
      if (sidecarTokenCssPath && fs.existsSync(sidecarTokenCssPath)) return sidecarTokenCssPath;
    } catch {
      // ignore and fall back
    }
    // Prefer token CSS when it exists AND is fresh (generated from the current base CSS).
    // If base CSS was edited more recently than token CSS, fall back to base CSS so dev renders
    // reflect the latest layout rules (prevents confusing “why didn’t my CSS change apply?”).
    try {
      if (fs.existsSync(tokenCssPath)) {
        const baseStat = fs.existsSync(baseCssPath) ? fs.statSync(baseCssPath) : null;
        const tokenStat = fs.statSync(tokenCssPath);
        if (!baseStat) return tokenCssPath;
        if (tokenStat.mtimeMs >= baseStat.mtimeMs) return tokenCssPath;
        console.warn(
          `⚠️ Token CSS is older than base CSS; using base CSS for this render.\n` +
            `   base:  ${baseCssPath}\n` +
            `   token: ${tokenCssPath}\n` +
            `   (Regenerate token CSS via build:book/build:ch1 or templates/generate-prince-css-from-tokens.ts)`
        );
        return baseCssPath;
      }
    } catch {
      // ignore and fall back
    }
    return baseCssPath;
  })();
  const css = fs.readFileSync(cssPath, 'utf8');

  // Optional front/back matter templates (Prince-first, repo-local).
  // These are plain HTML fragments injected into the book HTML.
  const frontmatterArg = getArg('--frontmatter');
  const backmatterArg = getArg('--backmatter');
  const frontmatterDefault = path.resolve(__dirname, '../templates/frontmatter.html');
  const backmatterDefault = path.resolve(__dirname, '../templates/backmatter.html');

  function readOptionalFragment(p: string | null, fallbackAbs: string): string {
    const raw = p ? path.resolve(p) : fallbackAbs;
    try {
      if (raw && fs.existsSync(raw)) return fs.readFileSync(raw, 'utf8');
    } catch {
      // ignore
    }
    return '';
  }

  const frontmatterHtml = (frontmatterArg || isAfBook)
    ? readOptionalFragment(frontmatterArg, frontmatterDefault).trim()
    : '';
  // Always include backmatter (sources / index / glossary) — not just for AF books.
  const backmatterHtml = readOptionalFragment(backmatterArg, backmatterDefault).trim();
  
  const bodyClasses: string[] = [];
  if (TEXT_ALIGN_MODE === 'left') bodyClasses.push('ragged-right');
  const bookSlug = slugifyForCssClass(book.meta.title);
  if (bookSlug) bodyClasses.push(`book-${bookSlug}`);
  const bodyClassAttr = bodyClasses.length ? ` class="${bodyClasses.join(' ')}"` : '';

  // Check for cover images
  const bookSlugLower = (book.meta.title || '').toLowerCase();
  let coverDir = '';
  if (bookSlugLower.includes('a&f 4') || bookSlugLower.includes('af4') || 
      (bookSlugLower.includes('anatomie') && bookSlugLower.includes('fysiologie') && !bookSlugLower.includes('niveau 3'))) {
    coverDir = 'af4';
  } else if (bookSlugLower.includes('pathologie')) {
    coverDir = 'pathologie';
  } else if (bookSlugLower.includes('persoonlijke') || bookSlugLower.includes('verzorging')) {
    coverDir = 'persoonlijke_verzorging';
  } else if (bookSlugLower.includes('vth') || bookSlugLower.includes('verpleegtechnische')) {
    coverDir = 'vth_n4';
  }
  const frontCoverPath = coverDir ? path.resolve(REPO_ROOT, 'new_pipeline/assets/covers', coverDir, 'front_only.png') : '';
  const backCoverPath = coverDir ? path.resolve(REPO_ROOT, 'new_pipeline/assets/covers', coverDir, 'back_only.png') : '';
  const hasFrontCover = frontCoverPath && fs.existsSync(frontCoverPath);
  const hasBackCover = backCoverPath && fs.existsSync(backCoverPath);

  // Cover page CSS
  const coverCss = `
/* Cover pages - full bleed */
@page cover {
  margin: 0;
  @top-left { content: none; }
  @top-right { content: none; }
  @top-center { content: none; }
  @bottom-center { content: none; }
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
.cover-page {
  page: cover;
  width: var(--page-width);
  height: var(--page-height);
  margin: 0;
  padding: 0;
  break-after: page;
}
.cover-page img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.back-cover-page {
  page: cover;
  width: var(--page-width);
  height: var(--page-height);
  margin: 0;
  padding: 0;
  break-before: page;
}
.back-cover-page img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
`;

  // Additional inline CSS for enhanced TOC, chapter openers, index, glossary
  const enhancedCss = `
/* ===== Enhanced TOC (matching generate-book-matter design) ===== */
.toc {
  page-break-after: always;
}
.toc-header {
  background: var(--accent, #2d7a4e);
  padding: 8mm 10mm 10mm;
  margin: 0 calc(0mm - var(--margin-outer, 18mm)) 0 calc(0mm - var(--margin-inner, 22mm));
  padding-left: var(--margin-inner, 22mm);
  padding-right: var(--margin-outer, 18mm);
  position: relative;
}
.toc-header h1 {
  font-family: var(--font-sans);
  font-size: 26pt;
  font-weight: 700;
  color: #fff;
  margin: 0;
}
.toc-header::after {
  content: '';
  position: absolute;
  bottom: -4mm;
  left: var(--margin-inner, 22mm);
  width: 0;
  height: 0;
  border-left: 3mm solid transparent;
  border-right: 3mm solid transparent;
  border-top: 4mm solid var(--accent, #2d7a4e);
}
.toc-body {
  padding-top: 6mm;
  column-count: 2;
  column-gap: 6mm;
  column-fill: balance;
}
.toc-entry a {
  text-decoration: none;
  color: inherit;
  display: block;
}
.toc-entry.chapter-entry {
  margin-top: 3mm;
  break-inside: avoid;
}
.toc-entry.chapter-entry:first-child {
  margin-top: 0;
}
.toc-entry.chapter-entry a {
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 10pt;
  color: #1a365d;
}
.toc-entry.section-entry {
  padding-left: 2mm;
  break-inside: avoid;
}
.toc-entry.section-entry a {
  font-size: 9pt;
  color: #333;
}
.toc-num {
  display: inline-block;
  min-width: 8mm;
  white-space: nowrap;
  color: var(--muted, #555);
  font-variant-numeric: tabular-nums;
}
.toc-label {
  /* fill remaining space */
}
.toc-entry a::after {
  content: leader('.') " " target-counter(attr(href), page);
  float: right;
  font-family: var(--font-sans);
  font-size: 9pt;
  color: var(--muted, #555);
}

/* ===== Chapter opener placeholder (no image) ===== */
@page chapter-placeholder {
  margin: 0;
  @top-left { content: none; }
  @top-right { content: none; }
  @top-center { content: none; }
  @bottom-left { content: none; }
  @bottom-right { content: none; }
  @bottom-center { content: none; }
}
.chapter-opener-placeholder {
  page: chapter-placeholder;
  break-before: page;
  break-after: page;
  position: relative;
  width: var(--page-width, 195mm);
  height: var(--page-height, 265mm);
  overflow: hidden;
}
.opener-bg {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(135deg, var(--accent, #2d7a4e) 0%, #1a4a30 100%);
}
.opener-content {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 18mm 14mm 22mm;
  color: #fff;
}
.opener-label {
  font-family: var(--font-sans);
  font-size: 10pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.8;
  margin-bottom: 3mm;
}
.opener-number {
  font-family: var(--font-sans);
  font-size: 80pt;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 3mm;
}
.opener-title {
  font-family: var(--font-sans);
  font-size: 32pt;
  font-weight: 700;
  line-height: 1.15;
  color: #fff;
  margin: 0;
}

/* ===== Glossary (Begrippenlijst) ===== */
.matter-glossary, .matter-index {
  break-before: page;
}
.matter-header {
  background: var(--accent, #2d7a4e);
  padding: 6mm 10mm 8mm;
  margin: 0 calc(0mm - var(--margin-outer, 18mm)) 4mm calc(0mm - var(--margin-inner, 22mm));
  padding-left: var(--margin-inner, 22mm);
  padding-right: var(--margin-outer, 18mm);
}
.matter-header h1 {
  font-family: var(--font-sans);
  font-size: 22pt;
  font-weight: 700;
  color: #fff;
  margin: 0;
}
.glossary-body, .index-body {
  column-count: 2;
  column-gap: 6mm;
}
.glossary-letter-group, .index-letter-group {
  break-inside: avoid-column;
  margin-bottom: 3mm;
}
.glossary-letter, .index-letter {
  font-family: var(--font-sans);
  font-size: 16pt;
  font-weight: 700;
  color: var(--accent, #2d7a4e);
  border-bottom: 1pt solid var(--accent, #2d7a4e);
  padding-bottom: 1mm;
  margin: 2mm 0 1.5mm;
}
.glossary-entry {
  margin-bottom: 2mm;
  break-inside: avoid;
}
.glossary-term {
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 9.5pt;
  color: #1a1a1a;
  display: inline;
}
.glossary-def {
  font-size: 9pt;
  color: #333;
  display: inline;
  margin-left: 0;
}
.glossary-term::after {
  content: " – ";
  font-weight: 400;
}
.index-entry {
  font-size: 9pt;
  color: #1a1a1a;
  line-height: 1.5;
  break-inside: avoid;
  margin-bottom: 0.5mm;
}
.index-term {
  /* term text, inline */
}
/* First page-ref link gets leader dots before it */
.index-entry a.index-page-ref:first-of-type::before {
  content: leader('. ') ' ';
  color: #bbb;
}
/* Subsequent page-ref links get a comma separator */
.index-entry a.index-page-ref + .index-page-sep + a.index-page-ref::before {
  content: none;
}
.index-page-ref {
  text-decoration: none;
  color: #555;
  font-variant-numeric: tabular-nums;
}
.index-page-ref::after {
  /* Prince resolves this to the actual page number of the referenced element */
  content: target-counter(attr(href), page);
}
.index-page-sep {
  color: #555;
}
.index-see-also {
  font-style: italic;
  color: var(--muted, #555);
  font-size: 8.5pt;
}
`;

  let html = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(book.meta.title)}</title>
  <style>
${css}
${hasFrontCover || hasBackCover ? coverCss : ''}
${enhancedCss}
  </style>
</head>
<body${bodyClassAttr}>
`;

  // Front Cover (if exists)
  if (hasFrontCover) {
    html += `
  <div class="cover-page">
    <img src="${frontCoverPath}" alt="Voorblad">
  </div>
`;
  }

  // Title Page
  const subtitle = String((book.meta as any).full_title || '').trim();
  html += `
  <div class="title-page">
    <div class="book-title">${escapeHtmlText(book.meta.title)}</div>
    ${subtitle ? `<div class="book-subtitle">${escapeHtmlText(subtitle)}</div>` : ''}
    <div class="book-level">Niveau ${book.meta.level.toUpperCase()}</div>
  </div>
`;

  // Table of Contents — styled header matching generate-book-matter design
  html += `
  <div class="toc">
    <div class="toc-header">
      <h1>Inhoudsopgave</h1>
    </div>
    <div class="toc-body">
`;
  
  for (const chapter of book.chapters) {
    const chapterTitle = normalizeChapterTitle(chapter.number, chapter.title);
    html += `
      <div class="toc-entry chapter-entry">
        <a href="#ch-${chapter.number}">
          <span class="toc-num">${escapeHtml(chapter.number)}.</span>
          <span class="toc-label">${renderHeadingInlineText(chapterTitle)}</span>
        </a>
      </div>
`;
    for (const section of chapter.sections) {
      const sectionTitle = normalizeSectionTitle(section.number, section.title || '');
      if (!sectionTitle) continue;
      html += `
      <div class="toc-entry section-entry">
        <a href="#sec-${section.number}">
          <span class="toc-num">${escapeHtml(section.number)}</span>
          <span class="toc-label">${renderHeadingInlineText(sectionTitle)}</span>
        </a>
      </div>
`;
    }
  }
  
  html += `
    </div>
  </div>
`;

  // Optional frontmatter (preface/colophon/etc) in Prince style.
  if (frontmatterHtml) {
    html += `\n  ${frontmatterHtml}\n`;
  }

  // Chapters
  for (const chapter of book.chapters) {
    const chapterTitle = normalizeChapterTitle(chapter.number, chapter.title);
    const chapterBookmark = `${chapter.number}. ${stripInlineMarkers(chapterTitle || '')}`.trim();
    // Chapter openers:
    // Prefer chapter.images (book-specific, JSON-driven) so we can ingest per-book opener sets without
    // relying on a shared `assets/images/chapter_openers/` directory that would collide across books.
    // Fallback to the legacy per-chapter opener directory if chapter.images is absent.
    //
    // Legacy per-chapter images are exported from InDesign to:
    //   new_pipeline/assets/images/<chapterOpenerDir>/chapter_N_opener.jpg
    // Use --chapter-openers to specify a different directory (e.g. pathologie_chapter_openers).
    const chapterOpenerDirArg = getArg('--chapter-openers');
    const chapterOpenerDir = chapterOpenerDirArg || (isAfBook ? 'chapter_openers' : '');
    const chapterOpenerRel = chapterOpenerDir
      ? `new_pipeline/assets/images/${chapterOpenerDir}/chapter_${chapter.number}_opener.jpg`
      : '';
    const chapterOpenerAbs = chapterOpenerRel ? path.resolve(REPO_ROOT, chapterOpenerRel) : '';
    const defaultOpenerRel = 'new_pipeline/assets/images/ch1/Book_chapter_opener.jpg';

    let openerImg: any = null;
    const jsonOpener = chapter.images && chapter.images.length > 0 ? chapter.images[0] : null;
    const jsonOpenerAbs = jsonOpener?.src ? path.resolve(REPO_ROOT, jsonOpener.src) : '';

    if (jsonOpener && jsonOpenerAbs && fs.existsSync(jsonOpenerAbs)) {
      openerImg = jsonOpener;
    } else if (chapterOpenerAbs && fs.existsSync(chapterOpenerAbs)) {
      openerImg = { src: chapterOpenerRel, alt: `Hoofdstuk ${chapter.number} opener`, width: '100%' };
    } else if (jsonOpener) {
      // Keep the JSON opener even if the file is missing (we'll still gate via hasOpener below).
      openerImg = jsonOpener;
    } else if (isAfBook) {
      openerImg = { src: defaultOpenerRel, alt: 'Hoofdstuk opener', width: '100%' };
    } else {
      openerImg = null;
    }
    const openerAbs = openerImg?.src ? path.resolve(REPO_ROOT, openerImg.src) : '';
    const hasOpener = fs.existsSync(openerAbs);
    html += `
  <div class="chapter${hasOpener ? ' has-opener' : ''}" id="ch-${chapter.number}" data-chapter-title="${escapeHtml(chapterTitle)}">
`;

    if (hasOpener) {
      const img = openerImg;
      const src = path.resolve(REPO_ROOT, img.src); // Resolve relative to repo root
      html += `
    <div class="chapter-opener-page">
      <figure class="figure-block full-width chapter-opener">
        <img src="${src}" alt="${escapeHtml(img.alt)}">
      </figure>
    </div>
`;
    } else {
      // Styled chapter opener placeholder — full-page colored banner with large number
      html += `
    <div class="chapter-opener-placeholder">
      <div class="opener-bg"></div>
      <div class="opener-content">
        <div class="opener-label">Hoofdstuk</div>
        <div class="opener-number">${chapter.number}</div>
        <h1 class="opener-title" data-bookmark="${escapeHtml(chapterBookmark)}">${renderHeadingInlineText(chapterTitle)}</h1>
      </div>
    </div>
`;
    }

    html += `
    <div class="chapter-body">
`;

    for (const section of chapter.sections) {
      const sectionTitle = normalizeSectionTitle(section.number, section.title || '');
      const sectionBookmark = `${section.number} ${stripInlineMarkers(sectionTitle || '')}`.trim();
      // FLATTENED: No <section> wrapper to allow column-span to work reliably
      // If there is no section title, do not render a visible heading (avoids stray “2.2” headings).
      if (sectionTitle) {
        html += `
      <h2 class="section-title" id="sec-${section.number}" data-bookmark="${escapeHtml(sectionBookmark)}">
        <span class="section-number">${escapeHtml(section.number)}</span>
        ${renderHeadingInlineText(sectionTitle)}
      </h2>
`;
      }

    html += renderContentBlocks(section.content);
    }

    html += `
    </div>
  </div>
`;
  }

  // Optional KD appendix (teacher-only)
  if (KD_INDEX_ENABLED) {
    const kdHtml = renderKdAppendix(book);
    if (kdHtml) html += kdHtml;
  }

  // Optional static backmatter (sources etc) in Prince style.
  // Strip the placeholder "Register" section — we'll replace it with the real generated index below.
  let cleanedBackmatter = backmatterHtml;
  if (cleanedBackmatter && (opts?.indexEntries?.length || opts?.glossaryItems?.length)) {
    // Remove placeholder register section
    cleanedBackmatter = cleanedBackmatter.replace(/<div class="matter-section" id="bm-register">[\s\S]*?<\/div>\s*<\/div>/i, '');
  }
  if (cleanedBackmatter) {
    html += `\n  ${cleanedBackmatter}\n`;
  }

  // Dynamic Glossary (Begrippenlijst)
  const glossaryItems = opts?.glossaryItems || [];
  if (glossaryItems.length > 0) {
    html += `
  <div class="matter matter-glossary" id="glossary">
    <div class="matter-header"><h1 class="matter-title" data-bookmark="Begrippenlijst">Begrippenlijst</h1></div>
    <div class="matter-body glossary-body">
`;
    // Group by first letter
    const grouped: Record<string, GlossaryItem[]> = {};
    for (const item of glossaryItems) {
      const letter = (item.term || '?')[0].toUpperCase();
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push(item);
    }
    const sortedLetters = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'nl'));
    for (const letter of sortedLetters) {
      html += `      <div class="glossary-letter-group">
        <h2 class="glossary-letter">${escapeHtml(letter)}</h2>
`;
      for (const item of grouped[letter]) {
        html += `        <div class="glossary-entry">
          <dt class="glossary-term">${escapeHtml(item.term)}</dt>
          <dd class="glossary-def">${escapeHtml(item.definition)}</dd>
        </div>
`;
      }
      html += `      </div>
`;
    }
    html += `    </div>
  </div>
`;
  }

  // Dynamic Index (Register / Trefwoordenregister) — built from author-emphasized bold terms
  // Extract bold terms directly from book content — these are the real key concepts
  const autoTerms = extractBoldTerms(book);
  // Also merge any externally provided index terms
  const externalTerms = (opts?.indexEntries || []).map(e => e.term);
  const allTermsSet = new Set<string>(autoTerms.map(t => t.toLowerCase()));
  const mergedTerms = [...autoTerms];
  for (const ext of externalTerms) {
    if (!allTermsSet.has(ext.toLowerCase())) {
      mergedTerms.push(ext.charAt(0).toUpperCase() + ext.slice(1));
      allTermsSet.add(ext.toLowerCase());
    }
  }
  mergedTerms.sort((a, b) => a.localeCompare(b, 'nl'));

  if (mergedTerms.length > 0) {
    const termSectionMap = buildTermSectionMap(book, mergedTerms);
    // Only include terms that actually appear in the book text
    const foundTerms = mergedTerms.filter(t => {
      const sections = termSectionMap.get(t);
      return sections && sections.length > 0;
    });

    if (foundTerms.length > 0) {
      console.log(`📇 Auto-extracted index: ${foundTerms.length} terms with page references`);
      html += `
  <div class="matter matter-index" id="index">
    <div class="matter-header"><h1 class="matter-title" data-bookmark="Register">Register</h1></div>
    <div class="matter-body index-body">
`;
      // Group by first letter
      const grouped: Record<string, string[]> = {};
      for (const term of foundTerms) {
        const letter = (term || '?')[0].toUpperCase();
        if (!grouped[letter]) grouped[letter] = [];
        grouped[letter].push(term);
      }
      const sortedLetters = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'nl'));
      for (const letter of sortedLetters) {
        html += `      <div class="index-letter-group"><span class="index-letter">${escapeHtml(letter)}</span>
`;
        for (const term of grouped[letter]) {
          const sections = termSectionMap.get(term) || [];
          // Build page refs: first link gets leader dots via CSS ::before,
          // subsequent ones are comma-separated.
          const pageRefParts: string[] = [];
          for (let ri = 0; ri < sections.length; ri++) {
            if (ri > 0) pageRefParts.push(`<span class="index-page-sep">, </span>`);
            pageRefParts.push(`<a href="#${sections[ri]}" class="index-page-ref"></a>`);
          }

          html += `        <p class="index-entry">${escapeHtml(term)}${pageRefParts.join('')}</p>
`;
        }
        html += `      </div>
`;
      }
      html += `    </div>
  </div>
`;
    }
  }

  // Back Cover (if exists)
  if (hasBackCover) {
    html += `
  <div class="back-cover-page">
    <img src="${backCoverPath}" alt="Achterblad">
  </div>
`;
  }

  html += `
</body>
</html>`;

  return html;
}

type KdWp = {
  code: string;
  title: string;
  kerntaak_code: string;
  kerntaak_title: string;
  kd_part: string;
  track?: string;
  levels?: number[];
};

type KdWpDetailed = KdWp & {
  explanation_short?: string;
  keywords?: string[];
  example?: string;
  notes?: string;
};

type KdModule = {
  module_id: string;
  title: string;
  kind: 'praktijk' | 'verdieping' | string;
  kd_workprocesses: string[];
  intent?: string;
};

let KD_INDEX_VIEW: 'chapter' | 'workprocess' | 'both' = 'chapter';
let KD_INDEX_TOP_N = 5;

function resolveKdMappingPath(): string | null {
  if (KD_MAPPING_PATH) return KD_MAPPING_PATH;
  if (KD_BOOK_ID) {
    return path.resolve(REPO_ROOT, 'docs/kd/mappings', `${KD_BOOK_ID}.mapping.json`);
  }
  return null;
}

function loadKdWorkprocesses(): { kerntaken: Array<{ code: string; title: string; workprocesses: KdWp[] }> } | null {
  try {
    const p = path.resolve(REPO_ROOT, 'docs/kd/kd_2025_workprocesses.json');
    if (!fs.existsSync(p)) return null;
    const kd = JSON.parse(fs.readFileSync(p, 'utf8')) as any;

    const kerntaken: Array<{ code: string; title: string; workprocesses: KdWp[] }> = [];

    const basisKts = (kd?.basisdeel?.kerntaken || []) as any[];
    for (const kt of basisKts) {
      const wps: KdWp[] = [];
      for (const wp of (kt?.werkprocessen || []) as any[]) {
        wps.push({
          code: String(wp?.code || '').trim(),
          title: String(wp?.title || '').trim(),
          kerntaak_code: String(kt?.code || '').trim(),
          kerntaak_title: String(kt?.title || '').trim(),
          kd_part: 'basisdeel',
          track: 'basis',
          levels: [3, 4],
        });
      }
      kerntaken.push({ code: String(kt?.code || '').trim(), title: String(kt?.title || '').trim(), workprocesses: wps.filter((x) => x.code) });
    }

    const profKts = (kd?.profieldeel_niveau_4?.kerntaken || []) as any[];
    for (const kt of profKts) {
      const wps: KdWp[] = [];
      for (const wp of (kt?.werkprocessen || []) as any[]) {
        wps.push({
          code: String(wp?.code || '').trim(),
          title: String(wp?.title || '').trim(),
          kerntaak_code: String(kt?.code || '').trim(),
          kerntaak_title: String(kt?.title || '').trim(),
          kd_part: 'profieldeel_n4',
          track: 'verdieping',
          levels: [4],
        });
      }
      kerntaken.push({ code: String(kt?.code || '').trim(), title: String(kt?.title || '').trim(), workprocesses: wps.filter((x) => x.code) });
    }

    return { kerntaken };
  } catch {
    return null;
  }
}

function loadKdWorkprocessesDetailed(): KdWpDetailed[] | null {
  try {
    const p = path.resolve(REPO_ROOT, 'docs/kd/kd_2025_workprocesses_detailed.json');
    if (!fs.existsSync(p)) return null;
    const jd = JSON.parse(fs.readFileSync(p, 'utf8')) as any;
    const wps = Array.isArray(jd?.workprocesses) ? (jd.workprocesses as any[]) : [];
    const out: KdWpDetailed[] = [];
    for (const wp of wps) {
      const code = String(wp?.code || '').trim();
      const title = String(wp?.title || '').trim();
      const kerntaak_code = String(wp?.kerntaak_code || '').trim();
      const kerntaak_title = String(wp?.kerntaak_title || '').trim();
      if (!code || !title) continue;
      out.push({
        code,
        title,
        kerntaak_code,
        kerntaak_title,
        kd_part: String(wp?.kd_part || '').trim() || 'basisdeel',
        track: String(wp?.track || '').trim() || undefined,
        levels: Array.isArray(wp?.levels) ? (wp.levels as any[]).map((n) => Number(n)).filter((n) => Number.isFinite(n)) : undefined,
        explanation_short: String(wp?.explanation_short || '').trim() || undefined,
        keywords: Array.isArray(wp?.keywords) ? (wp.keywords as any[]).map((k) => String(k || '').trim()).filter(Boolean) : undefined,
        example: String(wp?.example || '').trim() || undefined,
        notes: String(wp?.notes || '').trim() || undefined,
      });
    }
    return out;
  } catch {
    return null;
  }
}

function loadKdModulesRegistry(): KdModule[] | null {
  try {
    const p = path.resolve(REPO_ROOT, 'docs/kd/modules/module_registry.json');
    if (!fs.existsSync(p)) return null;
    const jd = JSON.parse(fs.readFileSync(p, 'utf8')) as any;
    const mods = Array.isArray(jd?.modules) ? (jd.modules as any[]) : [];
    const out: KdModule[] = [];
    for (const m of mods) {
      const module_id = String(m?.module_id || '').trim();
      if (!module_id) continue;
      out.push({
        module_id,
        title: String(m?.title || '').trim(),
        kind: String(m?.kind || '').trim() || 'praktijk',
        kd_workprocesses: Array.isArray(m?.kd_workprocesses) ? (m.kd_workprocesses as any[]).map((c) => String(c || '').trim()).filter(Boolean) : [],
        intent: String(m?.intent || '').trim() || undefined,
      });
    }
    return out;
  } catch {
    return null;
  }
}

function collectRenderedSubparagraphNumbers(book: CanonicalBook): Set<string> {
  const s = new Set<string>();
  for (const ch of book.chapters || []) {
    for (const sec of ch.sections || []) {
      for (const sp of sec.content || []) {
        if ((sp as any)?.type === 'subparagraph') {
          const num = String((sp as any)?.number || '').trim();
          if (num) s.add(num);
        }
      }
    }
  }
  return s;
}

function renderKdAppendixByWorkprocessRefs(book: CanonicalBook): string {
  const mappingPath = resolveKdMappingPath();
  if (!mappingPath || !fs.existsSync(mappingPath)) {
    console.warn(`⚠️ KD appendix requested but mapping file not found. Provide --kd-mapping <path> or --kd-book-id <book_id>.`);
    return '';
  }
  const kd = loadKdWorkprocesses();
  if (!kd) {
    console.warn(`⚠️ KD appendix requested but KD workprocess list not found at docs/kd/kd_2025_workprocesses.json`);
    return '';
  }

  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8')) as any;
  const entries = (mapping?.entries || []) as any[];

  const presentSubs = collectRenderedSubparagraphNumbers(book);

  const refsByCode = new Map<string, Array<{ key: string; title: string }>>();
  for (const e of entries) {
    if (String(e?.kind || '') !== 'subparagraph') continue;
    const key = String(e?.key || '').trim();
    if (!key) continue;
    if (!presentSubs.has(key)) continue; // avoid dangling links in partial PDFs
    const title = String(e?.title || '').trim();
    const codes = Array.isArray(e?.kd_workprocesses) ? (e.kd_workprocesses as any[]) : [];
    for (const c of codes) {
      const cc = String(c || '').trim();
      if (!cc) continue;
      if (!refsByCode.has(cc)) refsByCode.set(cc, []);
      refsByCode.get(cc)!.push({ key, title });
    }
  }

  let html = `
  <div class="kd-appendix">
    <h1>KD 2025 — Werkprocessen (overzicht)</h1>
    <p class="kd-note">Docentenoverzicht: waar werkprocessen terugkomen in dit boek (indicatief). Deze pagina’s zijn niet bedoeld als studentcontent.</p>
`;

  for (const kt of kd.kerntaken) {
    const wps = kt.workprocesses || [];
    const anyHits = wps.some((wp) => (refsByCode.get(wp.code) || []).length > 0);
    if (!anyHits) continue;

    html += `\n    <div class="kd-kerntaak">\n      ${escapeHtmlText(`${kt.code} ${kt.title}`.trim())}\n    </div>\n`;

    for (const wp of wps) {
      const refs = refsByCode.get(wp.code) || [];
      if (refs.length === 0) continue;

      const wpLabel = KD_INDEX_SHOW_CODES ? `${wp.code} — ${wp.title}` : wp.title;
      const refsHtml = refs
        .map((r) => `<a href="#sub-${escapeHtml(r.key)}">${escapeHtml(r.key)}</a>${r.title ? ` ${escapeHtmlText(r.title)}` : ''}`)
        .join(' · ');

      html += `
    <div class="kd-wp">
      <div class="kd-wp-title">${escapeHtmlText(wpLabel)}</div>
      <div class="kd-refs">${refsHtml}</div>
    </div>
`;
    }
  }

  html += `
  </div>
`;
  return html;
}

function normalizeForKdMatch(s: string): string {
  const t = stripInlineMarkers(String(s || '')).toLowerCase().replace(/’/g, "'");
  return t
    .replace(/[^0-9a-zà-ÿ]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyPraktijkModule(text: string): string | null {
  const t = normalizeForKdMatch(text);
  if (!t) return null;

  // Acute first
  if (/\b(acuut|reanimat|bls|protocol|spoed|bewusteloos)\b/iu.test(t)) return 'PRAKTIJK_ACUTE_PROTOCOL_BLS';
  // Mantelzorg alignment
  if (/\b(mantelzorg|naasten|familie|overbelasting)\b/iu.test(t)) return 'PRAKTIJK_MANTELZORG_ALIGN';
  // Observe/signal/report
  if (/\b(sbar|rapporteer|rapportage|rapporteren|observeer|observatie|signaleer|signaleren|meet|meten|noteer|noteren|meld|melden|bijhouden)\b/iu.test(t)) {
    return 'PRAKTIJK_OBSERVE_SIGNAL_REPORT_SBAR';
  }
  // Default to info/advice framing
  return 'PRAKTIJK_INFO_ADVICE_HEALTH';
}

function collectChapterKdSignals(ch: CanonicalChapter): {
  chapterNumber: string;
  chapterTitle: string;
  basisText: string;
  boxText: string;
  praktijkBlocks: string[];
  verdiepingBlocks: string[];
} {
  const basisParts: string[] = [];
  const boxParts: string[] = [];
  const praktijkBlocks: string[] = [];
  const verdiepingBlocks: string[] = [];

  const chapterNumber = String((ch as any)?.number ?? '').trim();
  const chapterTitle = String((ch as any)?.title ?? '').trim();

  basisParts.push(chapterTitle);

  for (const sec of (ch.sections || []) as any[]) {
    basisParts.push(String(sec?.title || '').trim());
    for (const sp of (sec?.content || []) as any[]) {
      if (String(sp?.type || '') !== 'subparagraph') continue;
      basisParts.push(String(sp?.title || '').trim());
      for (const p of (sp?.content || []) as any[]) {
        if (String(p?.type || '') !== 'paragraph') continue;
        const b = String(p?.basis || '').trim();
        if (b) basisParts.push(b);
        const pr = String(p?.praktijk || '').trim();
        const vd = String(p?.verdieping || '').trim();
        if (pr) {
          boxParts.push(pr);
          praktijkBlocks.push(pr);
        }
        if (vd) {
          boxParts.push(vd);
          verdiepingBlocks.push(vd);
        }
      }
    }
  }

  return {
    chapterNumber,
    chapterTitle,
    basisText: normalizeForKdMatch(basisParts.join(' ')),
    boxText: normalizeForKdMatch(boxParts.join(' ')),
    praktijkBlocks,
    verdiepingBlocks,
  };
}

function renderKdAppendixByChapterTop(book: CanonicalBook): string {
  const detailed = loadKdWorkprocessesDetailed();
  const modules = loadKdModulesRegistry();
  if (!detailed) {
    console.warn(`⚠️ KD appendix requested but detailed KD workprocess list not found at docs/kd/kd_2025_workprocesses_detailed.json`);
    return '';
  }
  if (!modules) {
    console.warn(`⚠️ KD appendix requested but module registry not found at docs/kd/modules/module_registry.json`);
    return '';
  }

  const moduleById = new Map<string, KdModule>();
  for (const m of modules) moduleById.set(m.module_id, m);

  // Only keep practice modules for scoring
  const practiceModuleIds = modules.filter((m) => String(m.kind || '') === 'praktijk').map((m) => m.module_id);
  const practiceModuleSet = new Set(practiceModuleIds);

  let html = `
  <div class="kd-appendix">
    <h1>KD 2025 — Hoofdstukken (top ${escapeHtmlText(String(KD_INDEX_TOP_N))})</h1>
    <p class="kd-note">Docentenoverzicht (indicatief): per hoofdstuk de meest waarschijnlijke KD‑werkprocessen op basis van praktijk-/verdiepingscues en trefwoorden. Dit is géén officiële KD-verantwoording en is niet bedoeld als studentcontent.</p>
`;

  const chapters = (book.chapters || []) as any[];
  for (const ch of chapters) {
    const signals = collectChapterKdSignals(ch);
    if (!signals.chapterNumber) continue;

    // 1) Module-driven scoring from praktijk blocks (dominant)
    const moduleCounts = new Map<string, number>();
    const moduleExamples = new Map<string, string[]>();
    for (const pr of signals.praktijkBlocks) {
      const mid = classifyPraktijkModule(pr);
      if (!mid) continue;
      if (!practiceModuleSet.has(mid)) continue;
      moduleCounts.set(mid, (moduleCounts.get(mid) || 0) + 1);
      const arr = moduleExamples.get(mid) || [];
      if (arr.length < 2) {
        const snippet = stripInlineMarkers(pr).slice(0, 140).trim();
        if (snippet && !arr.includes(snippet)) arr.push(snippet);
      }
      moduleExamples.set(mid, arr);
    }

    const codeModuleScore = new Map<string, number>();
    const codeModuleWhy = new Map<string, Array<{ module_id: string; count: number; examples: string[] }>>();
    for (const [mid, cnt] of moduleCounts.entries()) {
      const m = moduleById.get(mid);
      if (!m) continue;
      for (const code of m.kd_workprocesses || []) {
        const c = String(code || '').trim();
        if (!c) continue;
        codeModuleScore.set(c, (codeModuleScore.get(c) || 0) + cnt);
        const whyArr = codeModuleWhy.get(c) || [];
        whyArr.push({ module_id: mid, count: cnt, examples: moduleExamples.get(mid) || [] });
        codeModuleWhy.set(c, whyArr);
      }
    }

    // 2) Keyword-driven tie-breaker (light)
    const codeKeywordScore = new Map<string, number>();
    const codeKeywordHits = new Map<string, string[]>();
    for (const wp of detailed) {
      const kws = (wp.keywords || []).map((k) => normalizeForKdMatch(k)).filter(Boolean);
      let hits: string[] = [];
      let s = 0;
      for (const kw of kws) {
        if (!kw) continue;
        // Phrase match vs word match
        let inBox = false;
        let inBasis = false;
        if (kw.includes(' ')) {
          inBox = signals.boxText.includes(kw);
          inBasis = signals.basisText.includes(kw);
        } else {
          const re = new RegExp(`(^|[^0-9a-zà-ÿ])${kw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}([^0-9a-zà-ÿ]|$)`, 'iu');
          inBox = re.test(signals.boxText);
          inBasis = re.test(signals.basisText);
        }
        if (inBox || inBasis) {
          hits.push(kw);
          // Box hits matter more than basis hits
          s += inBox ? 2 : 1;
        }
      }
      hits = Array.from(new Set(hits)).slice(0, 6);
      codeKeywordScore.set(wp.code, s);
      codeKeywordHits.set(wp.code, hits);
    }

    // Combine + rank
    const ranked = detailed
      .map((wp) => {
        const m = codeModuleScore.get(wp.code) || 0;
        const k = codeKeywordScore.get(wp.code) || 0;
        const total = m * 10 + k; // module-driven dominates
        return { wp, total, moduleScore: m, keywordScore: k };
      })
      .sort((a, b) => b.total - a.total || a.wp.code.localeCompare(b.wp.code));

    const top = ranked.filter((r) => r.total > 0).slice(0, Math.max(1, KD_INDEX_TOP_N));

    const chapterLabel = `${signals.chapterNumber} ${signals.chapterTitle}`.trim();
    html += `\n    <div class="kd-chapter">\n      <div class="kd-chapter-title">${escapeHtmlText(chapterLabel)}</div>\n`;

    if (!top.length || (top.length === 1 && top[0].total === 0)) {
      html += `      <div class="kd-chapter-note">Geen sterke KD-signalen gedetecteerd in praktijk-/verdiepingscues voor dit hoofdstuk.</div>\n    </div>\n`;
      continue;
    }

    for (const r of top.slice(0, KD_INDEX_TOP_N)) {
      const wp = r.wp;
      const label = KD_INDEX_SHOW_CODES ? `${wp.code} — ${wp.title}` : wp.title;
      const whyMods = (codeModuleWhy.get(wp.code) || [])
        .sort((a, b) => b.count - a.count || a.module_id.localeCompare(b.module_id))
        .slice(0, 2);
      const whyKws = (codeKeywordHits.get(wp.code) || []).slice(0, 5);

      const modLine = whyMods
        .map((m) => {
          const mt = moduleById.get(m.module_id);
          const name = mt?.title ? mt.title : m.module_id;
          return `${name} × ${m.count}`;
        })
        .join(' · ');

      const exs: string[] = [];
      for (const m of whyMods) {
        for (const e of m.examples || []) {
          if (exs.length >= 2) break;
          const cleaned = stripInlineMarkers(e).trim();
          if (cleaned && !exs.includes(cleaned)) exs.push(cleaned);
        }
        if (exs.length >= 2) break;
      }

      html += `\n      <div class="kd-wp">\n        <div class="kd-wp-title">${escapeHtmlText(label)}</div>\n`;
      if (wp.explanation_short) {
        html += `        <div class="kd-wp-expl">${escapeHtmlText(wp.explanation_short)}</div>\n`;
      }
      html += `        <div class="kd-wp-why">Waarom matcht dit hoofdstuk (auto): ${escapeHtmlText(modLine || 'trefwoorden/signalen in tekst')}${whyKws.length ? ` · gevonden: ${escapeHtmlText(whyKws.join(', '))}` : ''}</div>\n`;
      if (exs.length) {
        html += `        <div class="kd-wp-examples">Voorbeelden uit praktijkcues: ${escapeHtmlText(exs.join(' · '))}</div>\n`;
      }
      html += `      </div>\n`;
    }

    html += `    </div>\n`;
  }

  html += `\n  </div>\n`;
  return html;
}

function renderKdAppendix(book: CanonicalBook): string {
  if (KD_INDEX_VIEW === 'workprocess') return renderKdAppendixByWorkprocessRefs(book);
  if (KD_INDEX_VIEW === 'both') {
    const a = renderKdAppendixByChapterTop(book);
    const b = renderKdAppendixByWorkprocessRefs(book);
    return `${a}\n${b}`.trim();
  }
  // default
  return renderKdAppendixByChapterTop(book);
}

function renderContentBlock(block: ContentBlock): string {
  if (!block) return '';
  if (block.type === 'paragraph') return renderParagraphBlock(block);
  if (block.type === 'subparagraph') return renderSubparagraphBlock(block);
  if (block.type === 'list') return renderListBlock(block); // fallback (most lists handled in renderContentBlocks)
  if (block.type === 'steps') return renderStepsBlock(block);
  if (block.type === 'figure') return renderFigureBlock(block);
  // tables not yet rendered in this pipeline
  return '';
}

type ListNode = {
  level: number;
  roleClass: string;
  items: Array<{ html: string; children: ListNode[] }>;
};

function renderListNode(node: ListNode): string {
  const cls = `bullets lvl${node.level}${node.roleClass}`;
  let html = `\n        <ul class=\"${cls}\">\n`;
  for (const it of node.items) {
    html += `          <li>${it.html}`;
    for (const child of it.children) {
      html += renderListNode(child);
    }
    html += `</li>\n`;
  }
  html += `        </ul>\n`;
  return html;
}

function renderDemotedListBlock(block: ListBlock): string {
  const roleClass = block.role ? ` role-${String(block.role)}` : '';
  const items = (block.items || []).map((it) => it.trim()).filter(Boolean);
  if (items.length === 0) return '';

  const splitHeadingishLead = (raw: string): { title: string | null; body: string } => {
    const s = String(raw || '').trim();
    // Pattern: "Title. Body..." (common in demoted bullets like "De temperatuur. ...")
    const m = /^([^.!?]{2,64})\.\s+([\s\S]{8,})$/u.exec(s);
    if (!m) return { title: null, body: s };
    const title = String(m[1] || '').trim();
    const body = String(m[2] || '').trim();
    if (!title || !body) return { title: null, body: s };

    // Conservative "looks like a subheading" heuristic:
    // - short noun-phrase-ish title (<= 6 words)
    // - starts with an uppercase letter (Dutch)
    // - no obvious verb tokens (to avoid misclassifying real sentences)
    const words = title.split(/\s+/g).filter(Boolean);
    if (words.length > 6) return { title: null, body: s };
    if (!/^[A-ZÀ-Ý]/u.test(words[0] || '')) return { title: null, body: s };

    // If the "title" looks like a full sentence (subject + verb), DO NOT render it as a micro-title.
    // Example: "Lactase breekt lactose af. Lactose is ..." is NOT a heading; it's just the first sentence of the item.
    const titleLower = title.toLowerCase();
    if (
      /\b(is|zijn|was|waren|wordt|worden|heeft|hebben|doet|doen|breekt|herstelt|kopieert|maakt|werkt|helpt|zorgt|geeft|neemt|levert|beïnvloedt|versnelt|vertraagt|remt|activeert|bindt|koppelt|splitst|vormt)\b/iu.test(
        titleLower
      )
    ) {
      return { title: null, body: s };
    }
    // Separable-verb particle at end strongly suggests a sentence, not a label.
    if (/\b(af|aan|uit|op|mee|door|over|terug|samen)\b$/iu.test(titleLower)) return { title: null, body: s };
    // Verb-second heuristic: if the second word looks like a 3rd-person verb ending in -t,
    // and the first word is NOT an article/determiner, treat as sentence-like.
    if (words.length >= 2) {
      const w1 = String(words[0] || '').toLowerCase();
      const w2 = String(words[1] || '');
      const determiner = new Set(['de', 'het', 'een', 'dit', 'dat', 'deze', 'die', 'uw', 'mijn', 'jouw', 'zijn', 'haar', 'ons', 'onze']);
      if (!determiner.has(w1) && /^[a-zà-ÿ]/u.test(w2) && w2.length >= 4 && /t$/iu.test(w2)) {
        return { title: null, body: s };
      }
    }

    return { title, body };
  };

  let html = '';
  if (items.length === 1) {
    html += `\n        <p class=\"p role-body list-demoted${roleClass}\">${renderInlineText(items[0], { preserveLineBreaks: false })}</p>\n`;
  } else {
    // IMPORTANT: don't use <br> between demoted items — it prevents justification and creates
    // "one sentence per line" blocks.
    //
    // New behavior (recommended): demoted lists should still look like intentional lists.
    // We render each item as its own paragraph line, and we preserve embedded micro-titles
    // (<<MICRO_TITLE>>...<<MICRO_TITLE_END>>) by converting them into real micro-title blocks.

    const renderDemotedBodyBlock = (bodyRaw: string) => {
      const body = String(bodyRaw || '').trim();
      if (!body) return;
      const { title, body: body2 } = splitHeadingishLead(body);
      if (title) {
        html += `\n        <p class=\"micro-title\">${renderInlineText(title, { preserveLineBreaks: false })}</p>\n`;
        html += `\n        <p class=\"p role-body list-demoted list-lines${roleClass}\">${renderInlineText(
          body2,
          { preserveLineBreaks: false }
        )}</p>\n`;
      } else {
        html += `\n        <p class=\"p role-body list-demoted list-lines${roleClass}\">${renderInlineText(
          body2,
          { preserveLineBreaks: false }
        )}</p>\n`;
      }
    };

    const renderDemotedItem = (rawItem: string) => {
      for (const seg of parseMicroTitles(rawItem)) {
        if (seg.type === 'title') {
          html += `\n        <p class=\"micro-title\">${renderInlineText(seg.text, { preserveLineBreaks: false })}</p>\n`;
        } else {
          renderDemotedBodyBlock(seg.text);
        }
      }
    };

    for (const it of items) renderDemotedItem(it);
  }
  html += renderFigures(block.images);
  return html;
}

function renderListRun(run: ListBlock[]): string {
  let html = '';

  let roots: ListNode[] = [];
  let stack: Array<{ level: number; node: ListNode }> = [];
  const forceKeepIdx = new Set<number>();

  const flush = () => {
    for (const r of roots) html += renderListNode(r);
    roots = [];
    stack = [];
  };

  const ensureListAtLevel = (level: number, roleClass: string): ListNode | null => {
    if (level <= 1) {
      // Reuse current root if same level and same roleClass
      const top = stack.length ? stack[stack.length - 1] : null;
      if (top && top.level === 1 && top.node.roleClass === roleClass) return top.node;
      // Otherwise start a new root list
      const n: ListNode = { level: 1, roleClass, items: [] };
      roots.push(n);
      stack = [{ level: 1, node: n }];
      return n;
    }

    // Need a parent list at level-1
    while (stack.length && stack[stack.length - 1]!.level > level - 1) stack.pop();
    const parent = stack.length && stack[stack.length - 1]!.level === level - 1 ? stack[stack.length - 1]!.node : null;
    if (!parent || parent.items.length === 0) return null;

    const parentLast = parent.items[parent.items.length - 1]!;
    // Reuse last child list at this level if exists and matches roleClass
    const existing = parentLast.children.find((c) => c.level === level && c.roleClass === roleClass);
    if (existing) {
      stack.push({ level, node: existing });
      return existing;
    }

    const child: ListNode = { level, roleClass, items: [] };
    parentLast.children.push(child);
    stack.push({ level, node: child });
    return child;
  };

  const isShortParallelGroupCandidate = (items: string[]) => {
    const nonEmpty = items.map((s) => String(s || '').trim()).filter(Boolean);
    if (nonEmpty.length === 0) return false;
    return nonEmpty.every(isShortParallelItem);
  };

  for (let i = 0; i < run.length; i++) {
    const block = run[i]!;
    // Deterministic rules:
    // - Only keep bullets when >=3 short parallel items
    // - lvl2/lvl3 only when they can be nested under a kept parent list
    const roleClass = block.role ? ` role-${String(block.role)}` : '';
    const level = (block.level || 1) as number;
    const items = (block.items || []).map((it) => it.trim()).filter(Boolean);

    // Special case: some real enumerations are stored as multiple consecutive list blocks (e.g. 2+2 items).
    // Treat consecutive short-parallel list blocks at the same level as ONE combined list for the >=3 rule.
    let keepBullets = forceKeepIdx.has(i) || shouldKeepAsBullets(items);
    if (!keepBullets && level === 1 && isShortParallelGroupCandidate(items)) {
      let j = i + 1;
      const combined: string[] = [...items];
      while (j < run.length) {
        const nb = run[j]!;
        const nLevel = (nb.level || 1) as number;
        const nRoleClass = nb.role ? ` role-${String(nb.role)}` : '';
        if (nLevel !== 1) break;
        if (nRoleClass !== roleClass) break;
        if (nb.images && nb.images.length > 0) break;
        const nItems = (nb.items || []).map((it) => String(it || '').trim()).filter(Boolean);
        if (!isShortParallelGroupCandidate(nItems)) break;
        combined.push(...nItems);
        j++;
      }

      if (shouldKeepAsBullets(combined)) {
        // Mark the whole group as keep-bullets so we append items into a single list.
        for (let k = i; k < j; k++) forceKeepIdx.add(k);
        keepBullets = true;
      }
    }
    if (!keepBullets) {
      flush();
      html += renderDemotedListBlock(block);
      continue;
    }

    let listNode = ensureListAtLevel(level, roleClass);
    if (!listNode && level > 1) {
      // Can't nest level 2+ under a parent, but if items pass shouldKeepAsBullets,
      // render as a standalone level 1 list instead of demoting
      listNode = ensureListAtLevel(1, roleClass);
    }
    if (!listNode) {
      // Still can't create a list => demote
      flush();
      html += renderDemotedListBlock(block);
      continue;
    }

    for (const it of items) {
              listNode.items.push({ html: renderInlineText(it, { preserveLineBreaks: false }), children: [] });
    }

    // If this list block has images anchored to it, flush lists before rendering images
    if (block.images && block.images.length > 0) {
      flush();
      html += renderFigures(block.images);
    }
  }

  flush();
  return html;
}

function renderContentBlocks(blocks: ContentBlock[]): string {
  let html = '';
  let lastBoxKind: 'praktijk' | 'verdieping' | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as any;
    if (!b || typeof b !== 'object') continue;

    // Helpers (kept local; renderContentBlocks is the only place with "next block" context)
    const hasLayerBoxes = (p: any): boolean => {
      const pr = String(p?.praktijk ?? '').trim();
      const vd = String(p?.verdieping ?? '').trim();
      return !!pr || !!vd;
    };
    const endsWithColon = (p: any): boolean => {
      const t = String(p?.basis ?? '').trim();
      return t.endsWith(':');
    };

    if (b.type === 'list') {
      // Group consecutive list blocks to support nesting rules.
      const run: ListBlock[] = [];
      while (i < blocks.length && (blocks[i] as any)?.type === 'list') {
        run.push(blocks[i] as ListBlock);
        i++;
      }
      i--; // loop will i++
      const listHtml = renderListRun(run);
      html += listHtml;
      // Only break box continuation if we actually rendered something.
      if (listHtml) lastBoxKind = null;
      continue;
    }

    if (b.type === 'paragraph') {
      const renderBoxesAfter = (p: ParagraphBlock) => {
        if (!hasLayerBoxes(p)) return;
        const showPraktijkLabel = lastBoxKind !== 'praktijk';
        const showVerdiepingLabel = lastBoxKind !== 'verdieping';
        html += renderLayerBoxes(p, { showPraktijkLabel, showVerdiepingLabel });
        const hasPr = String((p as any)?.praktijk ?? '').trim().length > 0;
        const hasVd = String((p as any)?.verdieping ?? '').trim().length > 0;
        if (hasVd) lastBoxKind = 'verdieping';
        else if (hasPr) lastBoxKind = 'praktijk';
      };

      // Formatting rule: never place praktijk/verdieping *between* a list-intro paragraph
      // ending with ':' and the list run that follows. This breaks reading flow (colon implies
      // bullets immediately next) and violates our repo rule about layer placement.
      //
      // If we detect this pattern, render the paragraph WITHOUT boxes, then render the list run,
      // then render the boxes after the bullet run.
      const next = (i + 1 < blocks.length ? (blocks[i + 1] as any) : null) as any;
      if (hasLayerBoxes(b) && endsWithColon(b) && next && next.type === 'list') {
        const paraHtml = renderParagraphBlock(b as ParagraphBlock, { suppressBoxes: true });
        if (paraHtml) {
          html += paraHtml;
          lastBoxKind = null;
        }
        const run: ListBlock[] = [];
        let j = i + 1;
        while (j < blocks.length && (blocks[j] as any)?.type === 'list') {
          run.push(blocks[j] as ListBlock);
          j++;
        }
        html += renderListRun(run);
        lastBoxKind = null;
        renderBoxesAfter(b as ParagraphBlock);
        i = j - 1; // loop will i++
        continue;
      }
      if (hasLayerBoxes(b) && endsWithColon(b) && next && next.type === 'steps') {
        const paraHtml = renderParagraphBlock(b as ParagraphBlock, { suppressBoxes: true });
        if (paraHtml) {
          html += paraHtml;
          lastBoxKind = null;
        }
        html += renderStepsBlock(next as StepsBlock);
        lastBoxKind = null;
        renderBoxesAfter(b as ParagraphBlock);
        i++; // consume the steps block
        continue;
      }

      const paraHtml = renderParagraphBlock(b as ParagraphBlock, { suppressBoxes: true });
      if (paraHtml) {
        html += paraHtml;
        lastBoxKind = null; // any non-box content breaks box continuation
      }
      renderBoxesAfter(b as ParagraphBlock);
      continue;
    }
    if (b.type === 'steps') {
      const stepsHtml = renderStepsBlock(b as StepsBlock);
      html += stepsHtml;
      if (stepsHtml) lastBoxKind = null;
      continue;
    }
    if (b.type === 'subparagraph') {
      html += renderSubparagraphBlock(b as SubparagraphBlock);
      lastBoxKind = null;
      continue;
    }
    if (b.type === 'figure' || b.type === 'image') {
      html += renderFigureBlock(b);
      lastBoxKind = null;
      continue;
    }
  }
  return html;
}

// Repository root (parent of new_pipeline/)
const REPO_ROOT = path.resolve(__dirname, '../..');

function renderFigures(images: Array<any> | undefined): string {
  if (!images || images.length === 0) return '';
  
  // Ensure map is loaded
  loadFigureOverlays();
  const allowLegacyChFolders =
    /anatomie|fysiologie|a&f|af4/i.test(CURRENT_BOOK_TITLE || '') || /^af/.test(CURRENT_BOOK_SLUG || '');
  
  let html = '';
  for (const img of images) {
    // Check for high-res overlay override
    const imgFilename = path.basename(img.src);
    let overlayData = null;
    
    if (FIGURE_OVERLAYS_MAP) {
        // 1. Try mapping via Figure Number (e.g. "Afbeelding 1.2" -> "MAF_Ch1_Img2.tif")
        // We look for figure number in 'img.figureNumber' or parse it from alt/caption.
        let figNum = '';
        if (img.figureNumber) {
            figNum = img.figureNumber.replace(/^Afbeelding\s+/i, '').replace(/^Figuur\s+/i, '').replace(/:$/, '').trim();
        } else if (img.alt) {
            const m = img.alt.match(/(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)/i);
            if (m) figNum = m[1];
        }

        if (figNum && FIGURE_NUMBER_MAP && FIGURE_NUMBER_MAP[figNum]) {
            const originalFilename = FIGURE_NUMBER_MAP[figNum];
            if (FIGURE_OVERLAYS_MAP[originalFilename]) {
                overlayData = FIGURE_OVERLAYS_MAP[originalFilename];
            }
        }

        // 2. If no number match, try filename matching (fallback)
        if (!overlayData) {
            // Try exact match or base match
            if (FIGURE_OVERLAYS_MAP[imgFilename]) {
                overlayData = FIGURE_OVERLAYS_MAP[imgFilename];
            } else {
                const base = path.parse(imgFilename).name;
                const key = Object.keys(FIGURE_OVERLAYS_MAP).find(k => path.parse(k).name === base);
                if (key) overlayData = FIGURE_OVERLAYS_MAP[key];
            }
        }
    }

    if (overlayData) {
        // Use OneDrive images WITH labels baked in (assets/figures/chX/Afbeelding_X.Y.png)
        // Extract figure number to construct path
        let figNum = '';
        if (img.figureNumber) {
            figNum = img.figureNumber.replace(/^Afbeelding\s+/i, '').replace(/^Figuur\s+/i, '').replace(/:$/, '').trim();
        } else if (img.alt) {
            const m = img.alt.match(/(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)/i);
            if (m) figNum = m[1];
        }
        
        // Build path: try book-specific folder first, then legacy per-chapter folders
        const chapterNum = figNum.split('.')[0];
        const bookDirs = Array.from(
            new Set([
                CURRENT_BOOK_SLUG,
                CURRENT_BOOK_SLUG.replace(/-/g, '_'),
            ].filter(Boolean)),
        );
        const labeledImagePaths = [
            ...bookDirs.map((dir) =>
                path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'figures', dir, `Afbeelding_${figNum}.png`),
            ),
            ...(allowLegacyChFolders
                ? [path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'figures', `ch${chapterNum}`, `Afbeelding_${figNum}.png`)]
                : []),
        ];
        
        // Find first existing labeled image
        let labeledImagePath = labeledImagePaths.find(p => fs.existsSync(p)) || '';
        
        // Fall back to highres if labeled version doesn't exist
        const highResSrc = labeledImagePath 
            ? labeledImagePath 
            : path.resolve(REPO_ROOT, 'new_pipeline', overlayData.src);

        html += `
        <figure class="figure-block full-width reconstructed-figure" style="position: relative; width: 100%;">
           <div class="figure-wrapper" style="position: relative;">
             <img src="${highResSrc}" style="width: 100%; height: auto; display: block;" alt="${escapeHtml(img.alt)}">
           </div>
           ${(img.figureNumber || img.caption) ? `<figcaption class="figure-caption"><span class="figure-label">${renderInlineText(img.figureNumber || '', { preserveLineBreaks: false })}</span> ${renderInlineText(img.caption || '', { preserveLineBreaks: false })}</figcaption>` : ''}
        </figure>
        `;
        continue;
    }

    // Try to find labeled version of the image first
    let figNumForLookup = '';
    if (img.figureNumber) {
        figNumForLookup = img.figureNumber.replace(/^Afbeelding\s+/i, '').replace(/^Figuur\s+/i, '').replace(/:$/, '').trim();
    } else if (img.alt) {
        const m = img.alt.match(/(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)/i);
        if (m) figNumForLookup = m[1];
    }
    
    let src = path.resolve(REPO_ROOT, img.src);
    
    // Check for labeled versions in known locations
    // Prioritize book-specific folder, then legacy per-chapter folders
    if (figNumForLookup) {
        const chapterNum = figNumForLookup.split('.')[0];
        const bookDirs = Array.from(
            new Set([
                CURRENT_BOOK_SLUG,
                CURRENT_BOOK_SLUG.replace(/-/g, '_'),
            ].filter(Boolean)),
        );
        const labeledPaths = [
            ...bookDirs.map((dir) =>
                path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'figures', dir, `Afbeelding_${figNumForLookup}.png`),
            ),
            ...(allowLegacyChFolders
                ? [path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'figures', `ch${chapterNum}`, `Afbeelding_${figNumForLookup}.png`)]
                : []),
        ];
        const foundLabeled = labeledPaths.find(p => fs.existsSync(p));
        if (foundLabeled) src = foundLabeled;
    }

    // Project styling choice: by default, figures span the 2-column text area (paginabreed).
    //
    // Exception: images exported as "embedded_figures" (grouped PNGs from InDesign) tend to be tall
    // and when floated full-width they can create many underfilled pages (page-fill gate failures).
    // Render those as column-contained "content figures" to keep pagination stable.
    const srcRel = String(img?.src || '').replace(/\\/g, '/');
    const isEmbeddedGrouped = srcRel.includes('extracted_images/') && srcRel.includes('/embedded_figures/');
    const figureClass = isEmbeddedGrouped ? 'figure-block content-figure' : 'figure-block full-width';
    const figureStyle = '';
    const imgStyle = '';
    
    html += `
        <figure class="${figureClass}"${figureStyle}>
          <img src="${src}" alt="${escapeHtml(img.alt)}"${imgStyle}>
          ${(img.figureNumber || img.caption) ? `<figcaption class="figure-caption"><span class="figure-label">${renderInlineText(img.figureNumber || '', { preserveLineBreaks: false })}</span> ${renderInlineText(img.caption || '', { preserveLineBreaks: false })}</figcaption>` : ''}
        </figure>
`;
  }
  return html;
}

type RenderParagraphBlockOptions = {
  /** When true, don't render praktijk/verdieping boxes for this paragraph (caller will place them elsewhere). */
  suppressBoxes?: boolean;
};

type RenderLayerBoxesOptions = {
  /** If false, the first praktijk box in this call will NOT render the label/icon (continuation). */
  showPraktijkLabel?: boolean;
  /** If false, the first verdieping box in this call will NOT render the label/icon (continuation). */
  showVerdiepingLabel?: boolean;
};

function renderLayerBoxes(block: ParagraphBlock, opts?: RenderLayerBoxesOptions): string {
  let html = '';

  const BOX_SPLIT_TOKEN = '[[BOX_SPLIT]]';

  const renderBoxParts = (kind: 'praktijk' | 'verdieping', raw: string, showLabel: boolean) => {
    const parts = String(raw || '')
      .split(BOX_SPLIT_TOKEN)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    const label = kind === 'praktijk' ? 'In de praktijk:' : 'Verdieping:';
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx]!;
      const includeLabel = idx === 0 && showLabel;
      html += `
        <div class="box ${kind}">
          <p>${includeLabel ? `<span class="box-label">${label}</span>` : ''}${renderBoxText(part)}</p>
        </div>
`;
    }
  };

  const showPraktijkLabel = opts?.showPraktijkLabel ?? true;
  const showVerdiepingLabel = opts?.showVerdiepingLabel ?? true;

  if (block.praktijk && String(block.praktijk).trim()) renderBoxParts('praktijk', String(block.praktijk), showPraktijkLabel);
  if (block.verdieping && String(block.verdieping).trim()) renderBoxParts('verdieping', String(block.verdieping), showVerdiepingLabel);

  return html;
}

function renderParagraphBlock(block: ParagraphBlock, opts?: RenderParagraphBlockOptions): string {
  const hintRaw = String((block as any).styleHint || '').toLowerCase();
  const hint = hintRaw.replace(/\s+/g, ''); // normalize "Paragraaf kop" -> "paragraafkop"
  const roleClass = block.role ? ` role-${String(block.role)}` : '';
  const rawText = String((block as any).basis ?? (block as any).text ?? '');

  const renderProseParagraph = (rawText: string, classSuffix: string): string => {
    const raw = String(rawText ?? '');
    let html = '';

    // Prince-first style: allow intentional block splitting + micro-titles INSIDE a single canonical paragraph.
    // This lets the LLM output smaller blocks without changing paragraph IDs.
    //
    // Syntax:
    // - Separate blocks with a blank line: "\n\n"
    // - Optional micro title markers anywhere:
    //   "<<MICRO_TITLE>>Titel<<MICRO_TITLE_END>>"
    //   (Opus sometimes emits these inline; we treat them as hard split points.)
    const blocks = String(raw)
      .replace(/\r/g, '\n')
      .split(/\n\s*\n+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const renderBodyBlock = (body: string) => {
      const parts = splitParagraphForJustification(body);
      if (parts.length <= 1) {
        html += `\n        <p class=\"p${classSuffix}\">${renderInlineText(body, { preserveLineBreaks: false })}</p>\n`;
        return;
      }
      // Internal split: keep overall spacing by applying classSuffix only to the last paragraph.
      for (let i = 0; i < parts.length; i++) {
        const cls = i === parts.length - 1 ? `p${classSuffix}` : 'p';
        html += `\n        <p class=\"${cls}\">${renderInlineText(parts[i], { preserveLineBreaks: false })}</p>\n`;
      }
    };

    const inputBlocks = blocks.length ? blocks : [String(raw).trim()];
    let lastMicroTitleNorm: string | null = null;
    for (const bRaw of inputBlocks) {
      const b = String(bRaw || '').trim();
      if (!b) continue;
      for (const seg of parseMicroTitles(b)) {
        if (seg.type === 'title') {
          // De-dupe back-to-back identical micro-titles across blank-line splits.
          // Example upstream pattern:
          //   <<MICRO_TITLE>>X<<MICRO_TITLE_END>>\n\n<<MICRO_TITLE>>X<<MICRO_TITLE_END>> Met ...
          const n = stripInlineMarkers(seg.text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (n && lastMicroTitleNorm === n) continue;
          lastMicroTitleNorm = n || null;
          html += `\n        <p class=\"micro-title\">${renderInlineText(seg.text, { preserveLineBreaks: false })}</p>\n`;
        } else {
          lastMicroTitleNorm = null;
          renderBodyBlock(seg.text);
        }
      }
    }

    return html;
  };

  // Micro-title (small green thin heading inside a section; not a numbered heading)
  if (hint.includes('microtitle') || hint.includes('micro-title') || hint.includes('_micro')) {
    const raw = String(rawText ?? '').trim();
    if (!raw) return '';
    let html = `\n        <p class=\"micro-title\">${renderInlineText(raw, { preserveLineBreaks: false })}</p>\n`;
    html += renderFigures(block.images);
    return html;
  }

  // Section heading paragraphs (common in DB exports): render as a real section title.
  // Example basis: "2.1 Waaruit bestaat een zorgplan?"
  // IMPORTANT: exclude "subparagraafkop" - those are handled by renderSubparagraphBlock
  if (hint.includes('paragraafkop') && !hint.includes('subparagraafkop') && !hint.includes('subparagraaf')) {
    const raw = String(rawText ?? '').trim();
    if (!raw) {
      // Still allow figures/boxes to render even if the text is empty.
      let html = '';
      html += renderFigures(block.images);
      if (!opts?.suppressBoxes) html += renderLayerBoxes(block);
      return html;
    }
    const m = raw.match(/^\s*(\d+(?:\.\d+)+)\s+([\s\S]+?)\s*$/u);
    if (m) {
      const secNum = String(m[1] || '').trim();
      const secTitle = String(m[2] || '').trim();
      const bookmark = `${secNum} ${stripInlineMarkers(secTitle)}`.trim();
      let html = `
      <h2 class="section-title" id="sec-${escapeHtml(secNum)}" data-bookmark="${escapeHtml(bookmark)}">
        <span class="section-number">${escapeHtml(secNum)}</span>
        ${renderHeadingInlineText(secTitle)}
      </h2>
`;
      html += renderFigures(block.images);
      if (!opts?.suppressBoxes) html += renderLayerBoxes(block);
      return html;
    }
    // Fallback: if it doesn't parse cleanly, render as normal prose.
  }

  // Bullets: our DB extraction often collapses bullet items using semicolons.
  // Reconstruct list items deterministically from style hint.
  if (hint.includes('bullets')) {
    let lvl = 1;
    if (hint.includes('lvl 2') || hint.includes('lvl2')) lvl = 2;
    if (hint.includes('lvl 3') || hint.includes('lvl3')) lvl = 3;

    const raw = rawText || '';
    const hasSemicolons = raw.includes(';');
    const parts = raw
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Also support newline/bullet formatted lists from the LLM (Prince mode).
    // Without this, the list can get demoted into a paragraph and the renderer's
    // newline normalization will mash items together (classic "floating bullets").
    const splitBulletOrNumberedLines = (txt: string): { items: string[]; ordered: boolean } | null => {
      const t = String(txt || '').replace(/\r/g, '\n').trim();
      if (!t.includes('\n')) return null;
      const lines = t
        .split(/\n+/g)
        .map((x) => String(x || '').trim())
        .filter(Boolean);
      if (lines.length < 2) return null;

      const reBullet = /^([•\u2022]|[-–—*])\s+/;
      const reNum = /^\s*\d+[.)]\s+/;

      let bulletHits = 0;
      let numHits = 0;
      const items: string[] = [];
      for (const line of lines) {
        if (reNum.test(line)) {
          numHits++;
          items.push(line.replace(reNum, '').trim());
          continue;
        }
        if (reBullet.test(line)) {
          bulletHits++;
          items.push(line.replace(reBullet, '').trim());
          continue;
        }
        // Continuation/hard-wrap: keep as-is (but reduces confidence).
        items.push(line.trim());
      }
      const marked = bulletHits + numHits;
      if (marked < 2) return null;
      if (marked / Math.max(1, lines.length) < 0.6) return null;
      const clean = items.map((x) => x.trim()).filter(Boolean);
      if (clean.length < 2) return null;
      return { items: clean, ordered: numHits > bulletHits };
    };

    const splitInlineBulletGlyphs = (txt: string): string[] | null => {
      const t = String(txt || '').replace(/\r/g, '\n').trim();
      if (!t.includes('•')) return null;
      const parts = t
        .split('•')
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .map((x) => x.replace(/^[-–—*]\s+/, '').trim())
        .filter(Boolean);
      return parts.length >= 2 ? parts : null;
    };

    // Prince-first UX: if a paragraph is *styled* as bullets but the rewritten text is clearly prose
    // (no semicolon list encoding), render it as a normal paragraph so we don't get a weird
    // bullet-indent paragraph in the final PDF.
    if (!hasSemicolons || parts.length < 2) {
      const nl = splitBulletOrNumberedLines(raw);
      const inline = nl ? null : splitInlineBulletGlyphs(raw);
      // If the LLM actually provided a list, preserve it as a real list.
      if (nl && nl.items.length >= 2) {
        if (nl.ordered) {
          const lis = nl.items.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
          let html = `\n        <ol class=\"steps${roleClass}\">\n          ${lis}\n        </ol>\n`;
          html += renderFigures(block.images);
          return html;
        }
        const lis = nl.items.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
        let html = `\n        <ul class=\"bullets lvl${lvl}${roleClass}\">\n          ${lis}\n        </ul>\n`;
        html += renderFigures(block.images);
        return html;
      }
      if (inline && inline.length >= 2) {
        const lis = inline.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
        let html = `\n        <ul class=\"bullets lvl${lvl}${roleClass}\">\n          ${lis}\n        </ul>\n`;
        html += renderFigures(block.images);
        return html;
      }
      // Treat as a normal body paragraph (demoted list), with micro-title + blank-line splitting enabled.
      // This prevents markers from leaking as text AND gives proper paragraph spacing.
      let html = renderProseParagraph(raw, ' role-body list-demoted');
      html += renderFigures(block.images);
      // Respect suppressBoxes - boxes are rendered by renderContentBlocks via renderBoxesAfter
      // (DO NOT render boxes here if suppressBoxes is true, otherwise they get rendered twice!)
      if (!opts?.suppressBoxes) {
        if (block.praktijk && block.praktijk.trim()) {
          html += `
        <div class="box praktijk">
          <p><span class="box-label">In de praktijk:</span>${renderBoxText(block.praktijk)}</p>
        </div>
`;
        }
        if (block.verdieping && block.verdieping.trim()) {
          html += `
        <div class="box verdieping">
          <p><span class="box-label">Verdieping:</span>${renderBoxText(block.verdieping)}</p>
        </div>
`;
        }
      }
      return html;
    }

    // Semicolon-encoded multi-item list => render as bullets.
    const lis = parts.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
    let html = `\n        <ul class=\"bullets lvl${lvl}${roleClass}\">\n          ${lis}\n        </ul>\n`;
    html += renderFigures(block.images);
    return html;
  }

  const raw = String(rawText ?? '');
  let html = renderProseParagraph(raw, roleClass);

  // Images attached to paragraph
  html += renderFigures(block.images);

  if (!opts?.suppressBoxes) html += renderLayerBoxes(block);

  return html;
}

function renderListBlock(block: ListBlock): string {
  const roleClass = block.role ? ` role-${String(block.role)}` : '';
  const items = (block.items || []).map((it) => it.trim()).filter(Boolean);
  
  // Fallback: If items is empty but basis exists (from assembled rewrite), render basis with micro-title support
  if (items.length === 0) {
    const basis = String((block as any).basis ?? '').trim();
    // IMPORTANT: Some figures are anchored to list blocks that become empty after rewrite/merge.
    // Never drop images just because the list has no visible text/items.
    if (!basis) {
      return renderFigures((block as any).images);
    }

    const blocks = basis
      .replace(/\r/g, '\n')
      .split(/\n\s*\n+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    let html = '';
    let lastMicroTitleNorm: string | null = null;
    for (const bRaw of blocks) {
      for (const seg of parseMicroTitles(bRaw)) {
        if (seg.type === 'title') {
          const n = stripInlineMarkers(seg.text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (n && lastMicroTitleNorm === n) continue;
          lastMicroTitleNorm = n || null;
          html += `\n        <p class="micro-title">${renderInlineText(seg.text, { preserveLineBreaks: false })}</p>\n`;
        } else {
          lastMicroTitleNorm = null;
          html += `\n        <p class="p role-body list-demoted${roleClass}">${renderInlineText(seg.text, { preserveLineBreaks: false })}</p>\n`;
        }
      }
    }
    html += renderFigures(block.images);
    return html;
  }

  if (block.ordered) {
    const lis = items.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
    let html = `\n        <ol class=\"steps${roleClass}\">\n          ${lis}\n        </ol>\n`;
    html += renderFigures(block.images);
    return html;
  }

  // NOTE: Bullet lists are rendered via renderContentBlocks() so we can apply deterministic
  // "keep bullets only when >=3 short parallel items" AND proper nesting for lvl2/lvl3.
  // Fallback (should rarely be hit): render as demoted text.
  if (items.length === 1) {
    let html = `\n        <p class=\"p role-body list-demoted${roleClass}\">${renderInlineText(items[0], { preserveLineBreaks: false })}</p>\n`;
    html += renderFigures(block.images);
    return html;
  }
  // Keep the fallback consistent with renderDemotedListBlock(): merge to a normal paragraph.
  const body = items.map((it) => renderInlineText(it, { preserveLineBreaks: false })).join(' ');
  let html = `\n        <p class=\"p role-body list-demoted${roleClass}\">${body}</p>\n`;
  html += renderFigures(block.images);
  return html;
}

function renderStepsBlock(block: StepsBlock): string {
  const roleClass = block.role ? ` role-${String(block.role)}` : '';
  const items = (block.items || []).map((it) => it.trim()).filter(Boolean);
  // Keep figures even when the steps list itself is empty (rare, but happens after merges).
  if (items.length === 0) return renderFigures((block as any).images);
  const lis = items.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
  let html = `\n        <ol class=\"steps${roleClass}\">\n          ${lis}\n        </ol>\n`;
  html += renderFigures(block.images);
  return html;
}

function renderFigureBlock(block: any): string {
  // Render standalone figure blocks (injected from InDesign)
  // Support two formats:
  // 1. { type: 'figure', images: [{ src, alt }] } - methodisch_werken style
  // 2. { type: 'figure', src, number, caption } - pathologie style
  
  let html = '';
  
  // Handle direct src format (pathologie style)
  if (block.src && !block.images) {
    const src = path.resolve(REPO_ROOT, block.src);
    if (!fs.existsSync(src)) {
      console.warn(`⚠️ Figure image not found: ${src}`);
      return '';
    }
    const alt = escapeHtml(block.caption || `Afbeelding ${block.number || ''}`);
    const label = block.number ? `<strong>Afbeelding ${escapeHtml(block.number)}:</strong> ` : '';
    const caption = block.caption ? `<figcaption>${label}${escapeHtml(block.caption)}</figcaption>` : '';
    return `
    <figure class="figure-block content-figure">
      <img src="${src}" alt="${alt}">
      ${caption}
    </figure>
`;
  }
  
  // Handle images array format (methodisch_werken style)
  const images = block.images || [];
  if (images.length === 0) return '';
  
  for (const img of images) {
    const src = path.resolve(REPO_ROOT, img.src);
    if (!fs.existsSync(src)) {
      console.warn(`⚠️ Figure image not found: ${src}`);
      continue;
    }
    const alt = escapeHtml(img.alt || block.caption || 'Afbeelding');
    const label = block.label ? `<span class="figure-label">${escapeHtml(block.label)}</span>` : '';
    const caption = block.caption ? `<figcaption>${label}${escapeHtml(block.caption)}</figcaption>` : '';
    html += `
    <figure class="figure-block content-figure">
      <img src="${src}" alt="${alt}">
      ${caption}
    </figure>
`;
  }
  return html;
}

function renderSubparagraphBlock(block: SubparagraphBlock): string {
  const subTitle = normalizeSubparagraphTitle(block.number, block.title || '');
  const subBookmark = `${block.number} ${stripInlineMarkers(subTitle || '')}`.trim();
  // FLATTENED: No <div> wrapper
  let html = `
      <h3 class="subparagraph-title" id="sub-${block.number}" data-bookmark="${escapeHtml(subBookmark)}">
        ${escapeHtml(block.number)}${subTitle ? ` ${renderHeadingInlineText(subTitle)}` : ''}
      </h3>
`;

  // Avoid double headings:
  // Many exports include a first paragraph inside the subparagraph content that repeats the same
  // "1.1.1 Title" line. We already render the subparagraph heading above, so skip that redundant
  // internal heading paragraph when it matches.
  const content = Array.isArray((block as any).content) ? ((block as any).content as any[]) : [];
  const hintNorm = (h: any) => String(h || '').toLowerCase().replace(/\s+/g, '');
  const looksLikeSubHeading = (b: any) => {
    const t = String(b?.type || '');
    if (t !== 'paragraph') return false;
    const sh = hintNorm(b?.styleHint);
    if (sh.includes('subparagraafkop')) return true;
    // Some books use generic "kop" hints for these; keep conservative.
    return false;
  };
  const stripNum = (txt: string) => normalizeSubparagraphTitle(block.number, String(txt || ''));
  const first = content.length ? content[0] : null;
  // Compare after stripping both the number prefix AND inline markers
  const firstBasisStripped = stripInlineMarkers(stripNum(String(first?.basis || ''))).trim();
  const subTitleStripped = stripInlineMarkers(String(subTitle || '')).trim();
  const isRedundantInternalHeading =
    !!first &&
    looksLikeSubHeading(first) &&
    subTitle &&
    firstBasisStripped === subTitleStripped;

  // IMPORTANT:
  // Sometimes the internal "Subparagraaf kop" paragraph is redundant *as a heading line*,
  // but it carries praktijk/verdieping boxes or images that MUST still render.
  //
  // Example: a subparagraph with only a praktijk box would become empty if we slice(1).
  // In that case, keep the block but blank its basis so we don't show the duplicated heading.
  if (isRedundantInternalHeading) {
    const hasImages = Array.isArray((first as any)?.images) && ((first as any).images as any[]).length > 0;
    const hasPraktijk = String((first as any)?.praktijk ?? '').trim().length > 0;
    const hasVerdieping = String((first as any)?.verdieping ?? '').trim().length > 0;
    const hasExtras = hasImages || hasPraktijk || hasVerdieping;

    if (hasExtras) {
      const patchedFirst = { ...(first as any), basis: '' };
      html += renderContentBlocks([patchedFirst, ...content.slice(1)]);
    } else {
      html += renderContentBlocks(content.slice(1));
    }
  } else {
    html += renderContentBlocks(content);
  }

  return html;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      'Usage: npx tsx render-prince-pdf.ts <input.json> [--out output.pdf] [--hyphenation standard|enhanced] [--align justify|left] [--kd-index --kd-index-view chapter|workprocess|both --kd-index-top 5 --kd-index-show-codes --kd-book-id <id>|--kd-mapping <path>]'
    );
    process.exit(1);
  }
  
  const outArg = getArg('--out');
  const logArg = getArg('--log');
  const hyphArg = String(getArg('--hyphenation') || '').trim().toLowerCase();
  if (hyphArg === 'standard' || hyphArg === 'prince' || hyphArg === 'default') HYPHENATION_MODE = 'standard';
  else if (hyphArg === 'enhanced' || hyphArg === 'tuned') HYPHENATION_MODE = 'enhanced';
  // else: keep default ('enhanced')
  console.log(`🔤 Hyphenation mode: ${HYPHENATION_MODE}`);

  const alignArg = String(getArg('--align') || '').trim().toLowerCase();
  if (alignArg === 'left' || alignArg === 'ragged' || alignArg === 'ragged-right') TEXT_ALIGN_MODE = 'left';
  else if (alignArg === 'justify' || !alignArg) TEXT_ALIGN_MODE = 'justify';
  console.log(`↔️ Text align: ${TEXT_ALIGN_MODE === 'left' ? 'left (ragged-right)' : 'justify (left-justified)'}`);

  KD_INDEX_ENABLED = process.argv.includes('--kd-index');
  KD_INDEX_SHOW_CODES = process.argv.includes('--kd-index-show-codes');
  const kdViewArg = String(getArg('--kd-index-view') || '').trim().toLowerCase();
  if (kdViewArg === 'workprocess' || kdViewArg === 'workprocesses' || kdViewArg === 'refs' || kdViewArg === 'by-workprocess') KD_INDEX_VIEW = 'workprocess';
  else if (kdViewArg === 'both') KD_INDEX_VIEW = 'both';
  else KD_INDEX_VIEW = 'chapter';

  const kdTopArg = Number(getArg('--kd-index-top'));
  if (Number.isFinite(kdTopArg) && kdTopArg > 0) KD_INDEX_TOP_N = Math.max(1, Math.min(10, Math.floor(kdTopArg)));

  KD_BOOK_ID = String(getArg('--kd-book-id') || '').trim() || null;
  KD_MAPPING_PATH = String(getArg('--kd-mapping') || '').trim() || null;
  if (KD_INDEX_ENABLED) {
    console.log(`📌 KD appendix: enabled (${KD_INDEX_SHOW_CODES ? 'show codes' : 'hide codes'})`);
    console.log(`   kd-index-view: ${KD_INDEX_VIEW} (top ${KD_INDEX_TOP_N})`);
    if (KD_BOOK_ID) console.log(`   kd-book-id: ${KD_BOOK_ID}`);
    if (KD_MAPPING_PATH) console.log(`   kd-mapping: ${KD_MAPPING_PATH}`);
  }
  
  // Resolve paths
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`❌ Input file not found: ${resolvedInput}`);
    process.exit(1);
  }
  
  // Load optional index/glossary JSON
  const indexJsonPath = getArg('--index-json');
  const glossaryJsonPath = getArg('--glossary-json');
  let indexEntries: IndexEntry[] = [];
  let glossaryItems: GlossaryItem[] = [];
  if (indexJsonPath) {
    try {
      const absPath = path.resolve(indexJsonPath);
      if (fs.existsSync(absPath)) {
        const data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
        indexEntries = data.entries || data.index || (Array.isArray(data) ? data : []);
        console.log(`📇 Index loaded: ${indexEntries.length} entries from ${absPath}`);
      }
    } catch (e) { console.warn(`⚠️ Failed to load index JSON: ${e}`); }
  }
  if (glossaryJsonPath) {
    try {
      const absPath = path.resolve(glossaryJsonPath);
      if (fs.existsSync(absPath)) {
        const data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
        glossaryItems = data.items || data.terms || data.glossary || (Array.isArray(data) ? data : []);
        console.log(`📖 Glossary loaded: ${glossaryItems.length} items from ${absPath}`);
      }
    } catch (e) { console.warn(`⚠️ Failed to load glossary JSON: ${e}`); }
  }

  // Load canonical JSON
  console.log(`📖 Loading canonical JSON: ${resolvedInput}`);
  const bookJson = fs.readFileSync(resolvedInput, 'utf8');
  const book = JSON.parse(bookJson) as CanonicalBook;
  
  // Generate HTML
  console.log('🔄 Generating HTML for Prince...');
  const html = generateHTML(book, { inputJsonPath: resolvedInput, indexEntries, glossaryItems });
  
  // Determine output paths
  const baseName = path.basename(resolvedInput, '.json');
  const outputDir = path.resolve(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Save HTML (Prince needs a file)
  const htmlPath = path.join(outputDir, `${baseName}_prince.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`✅ HTML saved to: ${htmlPath}`);
  
  // Render PDF
  const pdfPath = outArg ? path.resolve(outArg) : path.join(outputDir, `${baseName}_professional.pdf`);
  const logPath = logArg ? path.resolve(logArg) : path.join(outputDir, `${baseName}_prince.log`);
  console.log(`🚀 Running Prince XML...`);
  
  try {
    const res = spawnSync('prince', [htmlPath, '-o', pdfPath], { encoding: 'utf8' });
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    fs.writeFileSync(logPath, out, 'utf8');
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.status !== 0) {
      throw new Error(`Prince exited with code ${res.status}`);
    }
    console.log(`\n🎉 PDF generated successfully: ${pdfPath}`);
    console.log(`✅ Prince log saved to: ${logPath}`);
  } catch (error) {
    console.error('❌ Prince execution failed.');
    // Check if prince is installed
    try {
      spawnSync('prince', ['--version'], { stdio: 'ignore' });
    } catch {
      console.error('   Prince XML is not installed or not in PATH.');
      console.error('   Please install from https://www.princexml.com/');
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Render failed:', err.message);
  process.exit(1);
});
