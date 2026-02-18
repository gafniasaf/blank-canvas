/**
 * Generate a Prince CSS file from exported InDesign design tokens.
 *
 * Reads:
 * - new_pipeline/extract/design_tokens.json (from export-design-tokens.jsx)
 * - new_pipeline/templates/prince-af-two-column.css (base template)
 *
 * Writes:
 * - new_pipeline/templates/prince-af-two-column.tokens.css
 *
 * Usage:
 *   npx tsx new_pipeline/templates/generate-prince-css-from-tokens.ts
 *   npx tsx new_pipeline/templates/generate-prince-css-from-tokens.ts --tokens <path> --base <path> --out <path>
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

type Tokens = {
  meta?: { exportedAt?: string; docName?: string; docPath?: string; source?: string };
  page?: { widthMm?: number; heightMm?: number; facingPages?: boolean };
  textFrames?: {
    representative?: {
      textColumnCount?: number | null;
      textColumnGutterMm?: number | null;
    } | null;
  };
  marginsAndColumns?: {
    left?: { topMm?: number; bottomMm?: number; leftMm?: number; rightMm?: number; columnCount?: number; columnGutterMm?: number } | null;
    right?: { topMm?: number; bottomMm?: number; leftMm?: number; rightMm?: number; columnCount?: number; columnGutterMm?: number } | null;
  };
  baselineGrid?: { baselineDivisionMm?: number; baselineStartMm?: number };
  paragraphStyles?: Array<{
    name: string;
    path?: string;
    appliedFont?: { family?: string; style?: string; name?: string } | null;
    pointSize?: number | null;
    leading?: number | null;
    fillColor?: string | null;
    spaceBeforePt?: number | null;
    spaceAfterPt?: number | null;
    leftIndentPt?: number | null;
    firstLineIndentPt?: number | null;
  }>;
  swatches?: Array<{ name: string; colorValue?: any; space?: string | null; model?: string | null }>;
};

function round(n: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

function fmtMm(n: number | undefined | null, fallback: string): string {
  if (typeof n !== 'number' || !isFinite(n)) return fallback;
  const v = round(n, 1);
  return `${v}mm`;
}

function fmtPt(n: number | undefined | null, fallback: string): string {
  if (typeof n !== 'number' || !isFinite(n)) return fallback;
  const v = round(n, 1);
  return `${v}pt`;
}

function fmtRatio(n: number | undefined | null, fallback: string): string {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return fallback;
  return String(round(n, 2));
}

function ptToMm(pt: number): number {
  return pt * (25.4 / 72);
}

function fmtMmFromPt(pt: number | undefined | null, fallback: string): string {
  if (typeof pt !== 'number' || !isFinite(pt)) return fallback;
  return `${round(ptToMm(pt), 1)}mm`;
}

function fmtMmFromPtAbs(pt: number | undefined | null, fallback: string): string {
  if (typeof pt !== 'number' || !isFinite(pt)) return fallback;
  return `${round(ptToMm(Math.abs(pt)), 1)}mm`;
}

function quoteFontFamily(family: string): string {
  const f = family.trim();
  if (!f) return '';
  // If already quoted, keep
  if ((f.startsWith('"') && f.endsWith('"')) || (f.startsWith("'") && f.endsWith("'"))) return f;
  // Quote when contains spaces or special chars
  if (/[^a-zA-Z0-9_-]/.test(f)) return `"${f.replace(/"/g, '\\"')}"`;
  return `"${f}"`;
}

function normalizeName(s: string | undefined | null): string {
  return String(s || '').trim().toLowerCase();
}

function pickStyle(tokens: Tokens, candidates: string[]): Tokens['paragraphStyles'][number] | undefined {
  const styles = tokens.paragraphStyles || [];
  const candNorm = candidates.map((c) => normalizeName(c));

  // Exact name match first
  for (const c of candNorm) {
    const hit = styles.find((s) => normalizeName(s.name) === c);
    if (hit) return hit;
  }

  // Path ends-with match
  for (const c of candNorm) {
    const hit = styles.find((s) => normalizeName(s.path || '').endsWith(`/${c}`));
    if (hit) return hit;
  }

  // Contains match (last resort)
  for (const c of candNorm) {
    const hit = styles.find((s) => normalizeName(s.name).includes(c));
    if (hit) return hit;
  }

  return undefined;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toHexByte(n: number): string {
  const v = clampInt(Math.round(n), 0, 255);
  return v.toString(16).padStart(2, '0');
}

function swatchToHex(swatch: { colorValue?: any }): string | null {
  const cv = (swatch as any).colorValue;
  if (!Array.isArray(cv)) return null;

  // RGB likely 0-255
  if (cv.length === 3) {
    const [r, g, b] = cv.map((x) => Number(x));
    if (![r, g, b].every((x) => isFinite(x))) return null;
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }

  // CMYK likely 0-100
  if (cv.length === 4) {
    const [c, m, y, k] = cv.map((x) => Number(x));
    if (![c, m, y, k].every((x) => isFinite(x))) return null;
    const C = clampInt(c, 0, 100) / 100;
    const M = clampInt(m, 0, 100) / 100;
    const Y = clampInt(y, 0, 100) / 100;
    const K = clampInt(k, 0, 100) / 100;
    const r = 255 * (1 - C) * (1 - K);
    const g = 255 * (1 - M) * (1 - K);
    const b = 255 * (1 - Y) * (1 - K);
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }

  // Gray (0-100 or 0-255)
  if (cv.length === 1) {
    const v0 = Number(cv[0]);
    if (!isFinite(v0)) return null;
    const v = v0 <= 100 ? 255 * (1 - clampInt(v0, 0, 100) / 100) : clampInt(v0, 0, 255);
    return `#${toHexByte(v)}${toHexByte(v)}${toHexByte(v)}`;
  }

  return null;
}

function swatchToCssColor(swatch: { colorValue?: any }): string | null {
  const cv = (swatch as any).colorValue;
  if (!Array.isArray(cv)) return null;

  // RGB (0-255) => hex
  if (cv.length === 3) return swatchToHex(swatch);

  // CMYK (0-100) => Prince supports cmyk() with percentages
  if (cv.length === 4) {
    const [c, m, y, k] = cv.map((x) => Number(x));
    if (![c, m, y, k].every((x) => isFinite(x))) return null;
    const pct = (n: number) => `${round(clampInt(n, 0, 100), 1)}%`;
    return `cmyk(${pct(c)}, ${pct(m)}, ${pct(y)}, ${pct(k)})`;
  }

  // Gray => hex
  if (cv.length === 1) return swatchToHex(swatch);

  return null;
}

function parseRootBlock(css: string): { fullMatch: string; inner: string; vars: Map<string, string>; order: string[] } {
  const m = css.match(/:root\s*\{([\s\S]*?)\}\s*/m);
  if (!m) throw new Error('Base CSS has no :root { ... } block');

  const fullMatch = m[0];
  const inner = m[1];

  const vars = new Map<string, string>();
  const order: string[] = [];

  for (const line of inner.split('\n')) {
    const mm = line.match(/\s*(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/);
    if (!mm) continue;
    const k = mm[1].trim();
    const v = mm[2].trim();
    if (!vars.has(k)) {
      vars.set(k, v);
      order.push(k);
    }
  }

  return { fullMatch, inner, vars, order };
}

function buildRootBlock(order: string[], vars: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(':root {');
  for (const k of order) {
    const v = vars.get(k);
    if (!v) continue;
    lines.push(`  ${k}: ${v};`);
  }
  // Include any vars not in the original order (deterministic)
  const extra = Array.from(vars.keys()).filter((k) => !order.includes(k)).sort();
  for (const k of extra) {
    const v = vars.get(k);
    if (!v) continue;
    lines.push(`  ${k}: ${v};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n\n';
}

function computeInsideOutside(tokens: Tokens): { top?: number; bottom?: number; inner?: number; outer?: number; colGap?: number } {
  const L = tokens.marginsAndColumns?.left || undefined;
  const R = tokens.marginsAndColumns?.right || undefined;

  const top = typeof R?.topMm === 'number' ? R.topMm : typeof L?.topMm === 'number' ? L.topMm : undefined;
  const bottom = typeof R?.bottomMm === 'number' ? R.bottomMm : typeof L?.bottomMm === 'number' ? L.bottomMm : undefined;

  // Facing-pages: inside on RIGHT page is left margin, inside on LEFT page is right margin
  const innerCandidates: number[] = [];
  const outerCandidates: number[] = [];

  if (typeof R?.leftMm === 'number') innerCandidates.push(R.leftMm);
  if (typeof L?.rightMm === 'number') innerCandidates.push(L.rightMm);

  if (typeof R?.rightMm === 'number') outerCandidates.push(R.rightMm);
  if (typeof L?.leftMm === 'number') outerCandidates.push(L.leftMm);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined);
  const inner = avg(innerCandidates);
  const outer = avg(outerCandidates);

  // Column gap: prefer page column gutter when page columns > 1 (IDML master column grid),
  // else allow text-frame gutter (InDesign-only), else undefined.
  const pageCols = Math.max(Number(R?.columnCount || 0), Number(L?.columnCount || 0));
  const pageGutter = typeof R?.columnGutterMm === 'number' ? R.columnGutterMm : typeof L?.columnGutterMm === 'number' ? L.columnGutterMm : undefined;
  const colGap = pageCols >= 2 && typeof pageGutter === 'number' ? pageGutter : undefined;

  return { top, bottom, inner, outer, colGap };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');

  const resolveRepoPath = (p: string) => (path.isAbsolute(p) ? p : path.resolve(repoRoot, p));

  const tokensPath = resolveRepoPath(getArg('--tokens') || 'new_pipeline/extract/design_tokens.json');
  const baseCssPath = resolveRepoPath(getArg('--base') || 'new_pipeline/templates/prince-af-two-column.css');
  const outCssPath = resolveRepoPath(getArg('--out') || 'new_pipeline/templates/prince-af-two-column.tokens.css');

  if (!fs.existsSync(tokensPath)) {
    console.error(`❌ Tokens file not found: ${tokensPath}`);
    console.error(`   Run InDesign script export-design-tokens.jsx first.`);
    process.exit(1);
  }
  if (!fs.existsSync(baseCssPath)) {
    console.error(`❌ Base CSS not found: ${baseCssPath}`);
    process.exit(1);
  }

  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8')) as Tokens;
  const baseCss = fs.readFileSync(baseCssPath, 'utf8');

  const source = String(tokens.meta?.source || '').toLowerCase();
  const isInDesign = source.includes('indesign');

  const root = parseRootBlock(baseCss);
  const vars = new Map(root.vars);

  // --- Layout vars ---
  vars.set('--page-width', fmtMm(tokens.page?.widthMm, vars.get('--page-width') || '195mm'));
  vars.set('--page-height', fmtMm(tokens.page?.heightMm, vars.get('--page-height') || '265mm'));

  const m = computeInsideOutside(tokens);
  vars.set('--margin-top', fmtMm(m.top, vars.get('--margin-top') || '20mm'));
  vars.set('--margin-bottom', fmtMm(m.bottom, vars.get('--margin-bottom') || '22mm'));
  vars.set('--margin-inner', fmtMm(m.inner, vars.get('--margin-inner') || '22mm'));
  vars.set('--margin-outer', fmtMm(m.outer, vars.get('--margin-outer') || '18mm'));
  if (typeof m.colGap === 'number' && isFinite(m.colGap) && m.colGap > 0) {
    vars.set('--col-gap', fmtMm(m.colGap, vars.get('--col-gap') || '6mm'));
  }

  // Body columns: prefer page column count when > 1 (IDML master column grid),
  // else use InDesign representative text-frame columns.
  const pageCols = Math.max(
    Number(tokens.marginsAndColumns?.left?.columnCount || 0),
    Number(tokens.marginsAndColumns?.right?.columnCount || 0)
  );
  let bodyColsFromTf: number | null = null;
  if (isFinite(pageCols) && pageCols >= 2 && pageCols <= 4) {
    vars.set('--body-columns', String(Math.round(pageCols)));
  } else {
    const bodyCols = tokens.textFrames?.representative?.textColumnCount;
    bodyColsFromTf = typeof bodyCols === 'number' && isFinite(bodyCols) ? bodyCols : null;
    // Only override when we have an actual multi-column value, or when tokens came from InDesign (trusted).
    if (typeof bodyCols === 'number' && isFinite(bodyCols) && bodyCols >= 1 && bodyCols <= 4 && (isInDesign || bodyCols > 1)) {
      vars.set('--body-columns', String(Math.round(bodyCols)));
    }
  }

  const tfGap = tokens.textFrames?.representative?.textColumnGutterMm;
  if (typeof tfGap === 'number' && isFinite(tfGap) && tfGap > 0 && (isInDesign || (typeof bodyColsFromTf === 'number' && bodyColsFromTf > 1))) {
    vars.set('--col-gap', fmtMm(tfGap, vars.get('--col-gap') || '6mm'));
  }

  // --- Typography vars (best-effort mapping) ---
  const body = pickStyle(tokens, ['•Basis', 'Basis']);
  const chapterTitle = pickStyle(tokens, ['•Hoofdstuktitel', 'Hoofdstuktitel', 'Introductie']);
  const section = pickStyle(tokens, ['_Chapter Header', 'Chapter Header']);
  const sub = pickStyle(tokens, ['_Subchapter Header', 'Subchapter Header']);
  const steps = pickStyle(tokens, ['_Numbered Paragraph', 'Numbered Paragraph']);
  const bullets1 = pickStyle(tokens, ['_Bullets', 'Bullets']);
  const bullets2 = pickStyle(tokens, ['_Bullets lvl 2', 'Bullets lvl 2', '_Bullets lvl2']);
  const bullets3 = pickStyle(tokens, ['_Bullets lvl3', 'Bullets lvl3', '_Bullets lvl 3']);

  // Fonts
  const bodyFamily = body?.appliedFont?.family || '';
  if (bodyFamily) {
    const bodyFallback = /sans/i.test(bodyFamily)
      ? `${quoteFontFamily(bodyFamily)}, "Source Sans 3", "Helvetica Neue", Arial, sans-serif`
      : `${quoteFontFamily(bodyFamily)}, "Source Serif 4", "Georgia", serif`;
    vars.set('--font-body', bodyFallback);
  }
  const headingFamily = section?.appliedFont?.family || sub?.appliedFont?.family || '';
  if (headingFamily) {
    vars.set('--font-sans', `${quoteFontFamily(headingFamily)}, "Source Sans 3", "Helvetica Neue", Arial, sans-serif`);
  }

  // Sizes
  if (typeof body?.pointSize === 'number' && body.pointSize > 0) {
    vars.set('--body-size', fmtPt(body.pointSize, vars.get('--body-size') || '10.5pt'));
  }
  if (typeof body?.pointSize === 'number' && body.pointSize > 0 && typeof body?.leading === 'number' && body.leading > 0) {
    vars.set('--body-leading', fmtRatio(body.leading / body.pointSize, vars.get('--body-leading') || '1.45'));
  }
  if (typeof (body as any)?.spaceAfterPt === 'number') {
    vars.set('--p-space-after', fmtMmFromPt((body as any).spaceAfterPt, vars.get('--p-space-after') || '2mm'));
  }

  // Spacing (SpaceBefore/SpaceAfter) from the paragraph styles used by our renderer
  if (typeof (section as any)?.spaceBeforePt === 'number') {
    vars.set('--h2-space-before', fmtMmFromPt((section as any).spaceBeforePt, vars.get('--h2-space-before') || '8mm'));
  }
  if (typeof (section as any)?.spaceAfterPt === 'number') {
    vars.set('--h2-space-after', fmtMmFromPt((section as any).spaceAfterPt, vars.get('--h2-space-after') || '3mm'));
  }
  if (typeof (sub as any)?.spaceBeforePt === 'number') {
    vars.set('--h3-space-before', fmtMmFromPt((sub as any).spaceBeforePt, vars.get('--h3-space-before') || '5mm'));
  }
  if (typeof (sub as any)?.spaceAfterPt === 'number') {
    vars.set('--h3-space-after', fmtMmFromPt((sub as any).spaceAfterPt, vars.get('--h3-space-after') || '2mm'));
  }
  if (typeof (steps as any)?.spaceAfterPt === 'number') {
    vars.set('--steps-space-after-token', fmtMmFromPt((steps as any).spaceAfterPt, vars.get('--steps-space-after-token') || '2mm'));
  }

  // Bullet indents (from InDesign paragraph styles)
  if (typeof (bullets1 as any)?.leftIndentPt === 'number') {
    vars.set('--bullet-lvl1-left-indent', fmtMmFromPt((bullets1 as any).leftIndentPt, vars.get('--bullet-lvl1-left-indent') || '7mm'));
  }
  if (typeof (bullets1 as any)?.firstLineIndentPt === 'number') {
    vars.set('--bullet-lvl1-hang', fmtMmFromPtAbs((bullets1 as any).firstLineIndentPt, vars.get('--bullet-lvl1-hang') || '7mm'));
  }
  if (typeof (bullets2 as any)?.leftIndentPt === 'number') {
    vars.set('--bullet-lvl2-left-indent', fmtMmFromPt((bullets2 as any).leftIndentPt, vars.get('--bullet-lvl2-left-indent') || '11.6mm'));
  }
  if (typeof (bullets2 as any)?.firstLineIndentPt === 'number') {
    vars.set('--bullet-lvl2-hang', fmtMmFromPtAbs((bullets2 as any).firstLineIndentPt, vars.get('--bullet-lvl2-hang') || '5.3mm'));
  }
  if (typeof (bullets3 as any)?.leftIndentPt === 'number') {
    vars.set('--bullet-lvl3-left-indent', fmtMmFromPt((bullets3 as any).leftIndentPt, vars.get('--bullet-lvl3-left-indent') || '17mm'));
  }
  if (typeof (bullets3 as any)?.firstLineIndentPt === 'number') {
    vars.set('--bullet-lvl3-hang', fmtMmFromPtAbs((bullets3 as any).firstLineIndentPt, vars.get('--bullet-lvl3-hang') || '5.3mm'));
  }
  if (typeof section?.pointSize === 'number' && section.pointSize > 0) {
    vars.set('--h2', fmtPt(section.pointSize, vars.get('--h2') || '15pt'));
  }
  if (typeof sub?.pointSize === 'number' && sub.pointSize > 0) {
    vars.set('--h3', fmtPt(sub.pointSize, vars.get('--h3') || '12pt'));
  }
  if (typeof chapterTitle?.pointSize === 'number' && chapterTitle.pointSize > 0) {
    vars.set('--h1', fmtPt(chapterTitle.pointSize, vars.get('--h1') || '26pt'));
  }

  // Accent color from section heading fillColor swatch (IDML and InDesign can both provide CMYK/RGB values).
  const swatchName = (section?.fillColor || '').trim();
  if (swatchName && tokens.swatches && tokens.swatches.length) {
    const sw = tokens.swatches.find((s) => normalizeName(s.name) === normalizeName(swatchName));
    if (sw) {
      const col = swatchToCssColor(sw);
      if (col) vars.set('--accent', col);
    }
  }

  // Build replacement :root block
  const newRootBlock = buildRootBlock(root.order, vars);
  const headerComment =
    `/* AUTO-GENERATED from design tokens.\n` +
    ` * tokens: ${tokensPath}\n` +
    ` * doc: ${(tokens.meta?.docName || '').trim()} ${(tokens.meta?.docPath || '').trim()}\n` +
    ` * exportedAt: ${(tokens.meta?.exportedAt || '').trim()}\n` +
    ` */\n\n`;

  const outCss = headerComment + baseCss.replace(root.fullMatch, newRootBlock);
  fs.writeFileSync(outCssPath, outCss, 'utf8');

  console.log(`✅ Wrote token CSS: ${outCssPath}`);
  console.log(`   Base CSS: ${baseCssPath}`);
  console.log(`   Tokens: ${tokensPath}`);
}

main().catch((e) => {
  console.error('❌ Failed generating CSS:', e);
  process.exit(1);
});


