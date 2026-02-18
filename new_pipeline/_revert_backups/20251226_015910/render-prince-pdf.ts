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

const HYPH_EXCEPTIONS_PATH = path.resolve(__dirname, '../templates/hyphenation_exceptions.json');
let HYPH_EXCEPTIONS: HyphenationExceptions | null = null;
try {
  if (fs.existsSync(HYPH_EXCEPTIONS_PATH)) {
    HYPH_EXCEPTIONS = JSON.parse(fs.readFileSync(HYPH_EXCEPTIONS_PATH, 'utf8')) as HyphenationExceptions;
  }
} catch {
  HYPH_EXCEPTIONS = null;
}

function applyHyphenationExceptions(text: string): string {
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
// Image Size Conversion
// =============================================================================

// InDesign column width in mm (calculated from design tokens)
const INDESIGN_COLUMN_WIDTH_MM = 78;

/**
 * Convert canonical JSON figure sizing to Prince sizing.
 *
 * System docs (new_pipeline/docs/PARITY_SCORECARD.md + extractor comments):
 * - Figures must keep their label+caption and remain near anchors.
 * - CH1 figures are predominantly single-column and sized from InDesign bounds (mm).
 * - The “small figure” bug was caused by excess whitespace in exported PNGs, not by CSS width.
 *
 * Therefore:
 * - Respect extracted mm widths if present.
 * - Do NOT auto-span unless explicitly requested or width exceeds a single column.
 */
function convertToColumnRelativeWidth(
  widthStr: string | undefined,
  placement?: string | null
): { width: string; spanColumns: boolean } {
  // Explicit placement hook (future-proof; mapping supports it)
  if (placement === 'full-width') {
    const w = String(widthStr || '').trim();
    return { width: w || '100%', spanColumns: true };
  }

  const w = String(widthStr || '').trim();
  if (!w) return { width: '100%', spanColumns: false };

  const m = w.match(/^([0-9]+(?:\\.[0-9]+)?)mm$/i);
  if (m) {
    const mm = Number(m[1]);
    if (Number.isFinite(mm) && mm > INDESIGN_COLUMN_WIDTH_MM + 1) {
      return { width: w, spanColumns: true };
    }
    return { width: w, spanColumns: false };
  }

  return { width: w, spanColumns: false };
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
  const raw = String(text ?? '').trim();
  if (!raw) return '';

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

  // Prevent ugly hyphenation inside short parenthetical tags like "(vervolg)" / "(toepassing)".
  // We only protect the parenthetical form so the normal word (outside parentheses) can still hyphenate if needed.
  t = t.replace(/\((toepassing|vervolg|kern|samenvatting)\)/gi, (_m, w: string) => {
    // If already patched (contains WORD JOINER), keep as-is.
    if (String(w).includes('\u2060')) return `(${w})`;
    const joined = Array.from(String(w)).join('\u2060');
    return `(${joined})`;
  });

  const preserveLineBreaks = opts?.preserveLineBreaks ?? true;
  if (!preserveLineBreaks) {
    // Newlines in source are usually "soft returns"/hard wraps. In Prince these become <br> which:
    // - prevents normal justification
    // - creates "one sentence per line" blocks
    // Normalize them to spaces for flowing text.
    t = t.replace(/\s*\n+\s*/g, ' ');

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
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  const re = /([.!?])\s+(?=(?:[a-zà-ÿ][\s\S]{0,120}?\bgaat over\b|Waar\s+gebruik\b|In\s+dit\s+hoofdstuk\b|Let\s+op\b))/gu;
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
  // Sentence punctuation → not a short list item
  if (/[!?]/.test(t)) return false;
  if (/\.\s/.test(t)) return false;
  // Length cap (allow multi-word noun phrases)
  if (t.length > 48) return false;
  // Word-count cap: sentences tend to be long
  const words = t.split(/\s+/g).filter(Boolean);
  if (words.length > 6) return false;
  return true;
}

function shouldKeepAsBullets(items: string[]): boolean {
  const nonEmpty = items.map((s) => String(s || '').trim()).filter(Boolean);
  if (nonEmpty.length < 3) return false;
  return nonEmpty.every(isShortParallelItem);
}

function normalizeChapterTitle(chapterNumber: string, title: string): string {
  const t = String(title || '').trim();
  const num = String(chapterNumber || '').trim();
  if (!t) return '';

  // Some extracted titles come in like ".1 De cel" – strip the redundant ".<chapterNumber>" prefix.
  if (num) {
    const re = new RegExp(`^\\.${num}(?:[\\.:])?\\s*`);
    const stripped = t.replace(re, '').trim();
    if (stripped && stripped !== t) return stripped;
  }

  // Generic fallback: ".<digits> <title>"
  const stripped2 = t.replace(/^\\.[0-9]+(?:[\\.:])?\\s*/, '').trim();
  if (stripped2 && stripped2 !== t) return stripped2;

  return t;
}

// =============================================================================
// HTML Generation
// =============================================================================

function generateHTML(book: CanonicalBook): string {
  const cssArg = getArg('--css');
  const baseCssPath = path.resolve(__dirname, '../templates/prince-af-two-column.css');
  const tokenCssPath = path.resolve(__dirname, '../templates/prince-af-two-column.tokens.css');
  const cssPath = (() => {
    if (cssArg) return path.resolve(cssArg);
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

  const frontmatterHtml = readOptionalFragment(frontmatterArg, frontmatterDefault).trim();
  const backmatterHtml = readOptionalFragment(backmatterArg, backmatterDefault).trim();
  
  let html = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(book.meta.title)}</title>
  <style>
${css}
  </style>
</head>
<body>
`;

  // Title Page
  html += `
  <div class="title-page">
    <div class="book-title">${escapeHtmlText(book.meta.title)}</div>
    <div class="book-subtitle">Anatomie & Fysiologie voor MBO Zorg</div>
    <div class="book-level">Niveau ${book.meta.level.toUpperCase()}</div>
  </div>
`;

  // Table of Contents
  html += `
  <div class="toc">
    <h1>Inhoudsopgave</h1>
`;
  
  for (const chapter of book.chapters) {
    const chapterTitle = normalizeChapterTitle(chapter.number, chapter.title);
    html += `
    <div class="toc-entry chapter-entry">
      <a href="#ch-${chapter.number}">
        <span class="title">${chapter.number}. ${escapeHtmlText(chapterTitle)}</span>
        <span class="page"></span>
      </a>
    </div>
`;
    for (const section of chapter.sections) {
      html += `
      <div class="toc-entry section-entry" style="margin-left: 1.5em;">
        <a href="#sec-${section.number}">
          <span class="title">${escapeHtml(section.number)} ${section.title ? escapeHtmlText(section.title) : ''}</span>
          <span class="page"></span>
        </a>
      </div>
`;
    }
  }
  
  html += `
  </div>
`;

  // Optional frontmatter (preface/colophon/etc) in Prince style.
  if (frontmatterHtml) {
    html += `\n  ${frontmatterHtml}\n`;
  }

  // Chapters
  for (const chapter of book.chapters) {
    const chapterTitle = normalizeChapterTitle(chapter.number, chapter.title);
    const chapterBookmark = `${chapter.number}. ${chapterTitle}`;
    const hasOpener = !!(chapter.images && chapter.images.length > 0);
    html += `
  <div class="chapter${hasOpener ? ' has-opener' : ''}" id="ch-${chapter.number}">
    <div class="chapter-title-block">
      <div class="chapter-number">Hoofdstuk ${chapter.number}</div>
      <h1 class="chapter-title" data-bookmark="${escapeHtml(chapterBookmark)}">${escapeHtmlText(chapterTitle)}</h1>
    </div>
`;

    // Chapter Opener Image
    if (chapter.images && chapter.images.length > 0) {
      const img = chapter.images[0];
      const src = path.resolve(REPO_ROOT, img.src); // Resolve relative to repo root
      html += `
    <figure class="figure-block full-width chapter-opener">
      <img src="${src}" alt="${escapeHtml(img.alt)}">
    </figure>
`;
    }

    html += `
    <div class="chapter-body">
`;

    for (const section of chapter.sections) {
      const sectionBookmark = `${section.number} ${section.title || ''}`.trim();
      // FLATTENED: No <section> wrapper to allow column-span to work reliably
      html += `
      <h2 class="section-title" id="sec-${section.number}" data-bookmark="${escapeHtml(sectionBookmark)}">
        <span class="section-number">${escapeHtml(section.number)}</span>
        ${section.title ? escapeHtmlText(section.title) : ''}
      </h2>
`;

    html += renderContentBlocks(section.content);
    }

    html += `
    </div>
  </div>
`;
  }

  // Optional backmatter (sources/index/etc) in Prince style.
  if (backmatterHtml) {
    html += `\n  ${backmatterHtml}\n`;
  }

  html += `
</body>
</html>`;

  return html;
}

function renderContentBlock(block: ContentBlock): string {
  if (!block) return '';
  if (block.type === 'paragraph') return renderParagraphBlock(block);
  if (block.type === 'subparagraph') return renderSubparagraphBlock(block);
  if (block.type === 'list') return renderListBlock(block); // fallback (most lists handled in renderContentBlocks)
  if (block.type === 'steps') return renderStepsBlock(block);
  // tables/images not yet rendered in this pipeline
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

  let html = '';
  if (items.length === 1) {
    html += `\n        <p class=\"p role-body list-demoted${roleClass}\">${renderInlineText(items[0], { preserveLineBreaks: false })}</p>\n`;
  } else {
    // IMPORTANT: don't use <br> between demoted items — it prevents justification and creates
    // "one sentence per line" blocks. Merge into a normal paragraph so it flows/justifies.
    const body = items.map((it) => renderInlineText(it, { preserveLineBreaks: false })).join(' ');
    html += `\n        <p class=\"p role-body list-demoted${roleClass}\">${body}</p>\n`;
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

    const listNode = ensureListAtLevel(level, roleClass);
    if (!listNode) {
      // Can't nest => demote
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
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as any;
    if (!b || typeof b !== 'object') continue;

    if (b.type === 'list') {
      // Group consecutive list blocks to support nesting rules.
      const run: ListBlock[] = [];
      while (i < blocks.length && (blocks[i] as any)?.type === 'list') {
        run.push(blocks[i] as ListBlock);
        i++;
      }
      i--; // loop will i++
      html += renderListRun(run);
      continue;
    }

    if (b.type === 'paragraph') {
      html += renderParagraphBlock(b as ParagraphBlock);
      continue;
    }
    if (b.type === 'steps') {
      html += renderStepsBlock(b as StepsBlock);
      continue;
    }
    if (b.type === 'subparagraph') {
      html += renderSubparagraphBlock(b as SubparagraphBlock);
      continue;
    }
  }
  return html;
}

// Repository root (parent of new_pipeline/)
const REPO_ROOT = path.resolve(__dirname, '../..');

function renderFigures(images: Array<any> | undefined): string {
  if (!images || images.length === 0) return '';
  let html = '';
  for (const img of images) {
    // Resolve relative to repo root since paths in JSON are relative to repo root
    const src = path.resolve(REPO_ROOT, img.src);

    // Respect per-figure sizing from the mapping step:
    // - placement: 'inline' | 'full-width'
    // - width: '55%' | '75%' | '100%' | '140.2mm' (etc)
    const placement = String(img.placement || '').toLowerCase();
    const width = String(img.width || '').trim();
    const isMm = /mm$/.test(width);
    const mmVal = isMm ? Number.parseFloat(width.replace(/mm$/, '')) : NaN;

    const isFullWidth =
      placement === 'full-width' ||
      placement === 'fullwidth' ||
      placement === 'page' ||
      // Heuristic fallback: an absolute mm width larger than a single column is treated as full-width.
      (Number.isFinite(mmVal) && mmVal > 90);

    const figureClass = isFullWidth ? 'figure-block full-width' : 'figure-block';
    const figureStyle = width ? ` style="width: ${escapeHtml(width)}; max-width: 100%;"` : '';
    const imgStyle = ` style="width: 100%; height: auto;"`;
    
    html += `
        <figure class="${figureClass}"${figureStyle}>
          <img src="${src}" alt="${escapeHtml(img.alt)}"${imgStyle}>
          ${(img.figureNumber || img.caption) ? `<figcaption class="figure-caption"><span class="figure-label">${renderInlineText(img.figureNumber || '', { preserveLineBreaks: false })}</span> ${renderInlineText(img.caption || '', { preserveLineBreaks: false })}</figcaption>` : ''}
        </figure>
`;
  }
  return html;
}

function renderParagraphBlock(block: ParagraphBlock): string {
  const hint = String((block as any).styleHint || '').toLowerCase();
  const roleClass = block.role ? ` role-${String(block.role)}` : '';

  // Bullets: our DB extraction often collapses bullet items using semicolons.
  // Reconstruct list items deterministically from style hint.
  if (hint.includes('bullets')) {
    let lvl = 1;
    if (hint.includes('lvl 2') || hint.includes('lvl2')) lvl = 2;
    if (hint.includes('lvl 3') || hint.includes('lvl3')) lvl = 3;

    const raw = block.basis || '';
    const hasSemicolons = raw.includes(';');
    const parts = raw
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Prince-first UX: if a paragraph is *styled* as bullets but the rewritten text is clearly prose
    // (no semicolon list encoding), render it as a normal paragraph so we don't get a weird
    // bullet-indent paragraph in the final PDF.
    if (!hasSemicolons || parts.length < 2) {
      let html = `\n        <p class=\"p${roleClass}\">${renderInlineText(raw, { preserveLineBreaks: false })}</p>\n`;
      html += renderFigures(block.images);
      return html;
    }

    // Semicolon-encoded multi-item list => render as bullets.
    const lis = parts.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
    let html = `\n        <ul class=\"bullets lvl${lvl}${roleClass}\">\n          ${lis}\n        </ul>\n`;
    html += renderFigures(block.images);
    return html;
  }

  const raw = String(block.basis ?? '');
  const parts = splitParagraphForJustification(raw);
  let html = '';
  if (parts.length <= 1) {
    html = `\n        <p class=\"p${roleClass}\">${renderInlineText(raw, { preserveLineBreaks: false })}</p>\n`;
  } else {
    // Internal split: do NOT apply role-based spacing to intermediate pieces.
    // Keep the overall block spacing by applying roleClass only to the last paragraph.
    for (let i = 0; i < parts.length; i++) {
      const cls = i === parts.length - 1 ? `p${roleClass}` : 'p';
      html += `\n        <p class=\"${cls}\">${renderInlineText(parts[i], { preserveLineBreaks: false })}</p>\n`;
    }
  }

  // Images attached to paragraph
  html += renderFigures(block.images);

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

  return html;
}

function renderListBlock(block: ListBlock): string {
  const roleClass = block.role ? ` role-${String(block.role)}` : '';
  const items = (block.items || []).map((it) => it.trim()).filter(Boolean);
  if (items.length === 0) return '';

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
  if (items.length === 0) return '';
  const lis = items.map((it) => `<li>${renderInlineText(it, { preserveLineBreaks: false })}</li>`).join('\n');
  let html = `\n        <ol class=\"steps${roleClass}\">\n          ${lis}\n        </ol>\n`;
  html += renderFigures(block.images);
  return html;
}

function renderSubparagraphBlock(block: SubparagraphBlock): string {
  const subBookmark = `${block.number} ${block.title || ''}`.trim();
  // FLATTENED: No <div> wrapper
  let html = `
      <h3 class="subparagraph-title" id="sub-${block.number}" data-bookmark="${escapeHtml(subBookmark)}">
        ${escapeHtml(block.number)}${block.title ? ` ${escapeHtmlText(block.title)}` : ''}
      </h3>
`;

  html += renderContentBlocks(block.content);

  return html;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npx tsx render-prince-pdf.ts <input.json> [--out output.pdf]');
    process.exit(1);
  }
  
  const outArg = getArg('--out');
  const logArg = getArg('--log');
  
  // Resolve paths
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`❌ Input file not found: ${resolvedInput}`);
    process.exit(1);
  }
  
  // Load canonical JSON
  console.log(`📖 Loading canonical JSON: ${resolvedInput}`);
  const bookJson = fs.readFileSync(resolvedInput, 'utf8');
  const book = JSON.parse(bookJson) as CanonicalBook;
  
  // Generate HTML
  console.log('🔄 Generating HTML for Prince...');
  const html = generateHTML(book);
  
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

