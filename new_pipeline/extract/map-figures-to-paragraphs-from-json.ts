/**
 * Map figure manifest entries to canonical JSON block IDs (no DB required).
 *
 * Why:
 * - Local Supabase may not have book_uploads/book_paragraphs seeded.
 * - We still have a canonical (pre-rewrite) JSON export that contains the same stable block IDs.
 *
 * Inputs (book-aware):
 * - new_pipeline/extract/figure_manifests/<book_id>/figure_manifest_<book_id>_ch<N>.json
 * - new_pipeline/extract/figure_manifests/<book_id>/ch<N>-images-map.json
 * - new_pipeline/output/_canonical_jsons_all/<book_id>__canonical_book_with_figures.json  (default)
 *
 * Output:
 * - new_pipeline/extract/figures_by_paragraph/<book_id>/figures_by_paragraph_ch<N>.json
 *
 * Usage:
 *   npx tsx new_pipeline/extract/map-figures-to-paragraphs-from-json.ts --book <book_id> --chapter <N>
 *
 * Optional:
 *   --canonical <path>     Override canonical JSON path
 *   --out <path>           Override output path
 *   --allow-missing        Don't hard-fail on unmatched anchors (will warn + skip)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type FigureManifest = {
  chapter: string;
  figures: Array<{
    page?: { documentOffset: number; name: string };
    image: null | {
      kind: 'link' | 'pageItem' | string;
      linkName?: string;
      linkPath?: string;
      atomicPath?: string;
      bounds?: [number, number, number, number];
    };
    asset?: null | { path?: string; kind?: string; source?: string };
    caption: { raw: string; label: string; body: string; styleName?: string };
    anchor: null | {
      text: string;
      beforeText?: string;
      afterText?: string;
      paragraphIndexInBodyStory?: number;
      pageDocumentOffset?: number;
    };
  }>;
};

type ImagesMap = Array<{
  originalFilename: string;
  sourcePath: string;
  localFilename: string;
  localPath: string;
  usedInFigureLabels: string[];
}>;

type FiguresByParagraph = Record<
  string,
  Array<{
    src: string;
    alt: string;
    figureNumber: string; // e.g. "Afbeelding 1.10:"
    caption: string; // caption body only
    placement?: 'inline' | 'float' | 'full-width';
    width?: string; // e.g. "54.0mm" or "100%"
  }>
>;

type CanonBlock = {
  id: string;
  norm: string;
  styleHint?: string;
};

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/<<BOLD_START>>/g, '').replace(/<<BOLD_END>>/g, '');
  // InDesign special chars:
  t = t.replace(/\u00ad/gi, ''); // soft hyphen
  t = t.replace(/\uFEFF/g, ''); // BOM
  t = t.replace(/\uFFFC/g, ''); // object replacement char (often rendered as "￼")
  // normalize unicode spaces to regular spaces
  t = t.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // remove other control chars
  t = t.replace(/[\u0000-\u001F]/g, ' ');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{2,}/g, '\n');
  t = t.trim();
  return t;
}

function isHeaderStyleHint(styleHint: string | null | undefined): boolean {
  const s = String(styleHint || '').toLowerCase();
  return (
    s.includes('header') ||
    s.includes('hoofdstuk') ||
    s.includes('titel') ||
    s.includes('kop') ||
    // Internal marker we add for subparagraph-title pseudo-blocks.
    s.includes('subparagraph')
  );
}

function fileExists(repoRoot: string, rel: string): boolean {
  const p = path.resolve(repoRoot, rel);
  return fs.existsSync(p);
}

function resolveFigureSrc(opts: {
  repoRoot: string;
  fig: FigureManifest['figures'][number];
  imagesMapByName: Map<string, ImagesMap[number]>;
}): string {
  const { repoRoot, fig, imagesMapByName } = opts;

  // Prefer atomic export if present
  const atomic = fig.asset?.path || fig.image?.atomicPath;
  if (atomic) {
    if (!fileExists(repoRoot, atomic)) {
      throw new Error(`Atomic figure asset missing on disk: ${atomic}`);
    }
    return atomic;
  }

  if (fig.image?.kind === 'link') {
    const name = fig.image.linkName || '';
    const mapped = imagesMapByName.get(name);
    if (!mapped) {
      throw new Error(`No local image mapping for linked image: ${name}`);
    }
    if (!fileExists(repoRoot, mapped.localPath)) {
      throw new Error(`Mapped local image missing on disk: ${mapped.localPath}`);
    }
    return mapped.localPath;
  }

  throw new Error(`Figure has no usable src (label=${fig.caption?.label || 'unknown'})`);
}

function widthMmFromBounds(bounds: [number, number, number, number] | undefined): number | null {
  if (!bounds) return null;
  const widthPt = bounds[3] - bounds[1];
  if (!isFinite(widthPt) || widthPt <= 0) return null;
  const mmPerPt = 25.4 / 72;
  return widthPt * mmPerPt;
}

function heightMmFromBounds(bounds: [number, number, number, number] | undefined): number | null {
  if (!bounds) return null;
  const heightPt = bounds[2] - bounds[0];
  if (!isFinite(heightPt) || heightPt <= 0) return null;
  const mmPerPt = 25.4 / 72;
  return heightPt * mmPerPt;
}

type LayoutMetrics = {
  pageWidthMm: number;
  contentWidthMm: number;
  columnCount: number;
  columnGutterMm: number;
  columnWidthMm: number;
};

function loadLayoutMetrics(): LayoutMetrics {
  // Best-effort: prefer extracted design tokens if present.
  // Fallback values match CH1 A&F grid (195mm page, 15mm margins, 2 cols, 9mm gutter).
  const fallback: LayoutMetrics = {
    pageWidthMm: 195,
    contentWidthMm: 165,
    columnCount: 2,
    columnGutterMm: 9,
    columnWidthMm: 78,
  };

  try {
    const tokensPath = path.resolve(__dirname, 'design_tokens.json');
    if (!fs.existsSync(tokensPath)) return fallback;
    const t = JSON.parse(fs.readFileSync(tokensPath, 'utf8')) as any;

    const pageWidthMm = Number(t?.page?.widthMm);
    const side = t?.marginsAndColumns?.right || t?.marginsAndColumns?.left;
    const columnCount = Number(side?.columnCount);
    const columnGutterMm = Number(side?.columnGutterMm);
    const leftMm = Number(side?.leftMm);
    const rightMm = Number(side?.rightMm);

    if (
      !Number.isFinite(pageWidthMm) ||
      !Number.isFinite(columnCount) ||
      !Number.isFinite(columnGutterMm) ||
      !Number.isFinite(leftMm) ||
      !Number.isFinite(rightMm) ||
      columnCount <= 0
    ) {
      return fallback;
    }

    const contentWidthMm = pageWidthMm - leftMm - rightMm;
    const columnWidthMm = (contentWidthMm - columnGutterMm * (columnCount - 1)) / columnCount;
    if (!Number.isFinite(contentWidthMm) || !Number.isFinite(columnWidthMm) || columnWidthMm <= 0) {
      return fallback;
    }

    return {
      pageWidthMm,
      contentWidthMm,
      columnCount,
      columnGutterMm,
      columnWidthMm,
    };
  } catch {
    return fallback;
  }
}

function designedFigureSizing(opts: {
  originalWidthMm: number | null;
  originalHeightMm: number | null;
  captionBody: string;
  metrics: LayoutMetrics;
}): { placement: 'inline' | 'full-width'; width: string | undefined } {
  const { originalWidthMm, originalHeightMm, captionBody, metrics } = opts;
  if (!originalWidthMm || !Number.isFinite(originalWidthMm) || originalWidthMm <= 0) {
    return { placement: 'inline', width: undefined };
  }

  const colW = metrics.columnWidthMm;
  const gutter = metrics.columnGutterMm;
  const r = originalWidthMm / colW;

  // "Feels designed" variation:
  // Promote a small subset of figures to full-width "hero" figures:
  // - overview/process diagrams (readability + pacing)
  // - tall diagrams that look awkward squeezed into a single column
  const HERO_RATIO = 0.70; // near-full-column figures can be promoted when they are conceptually "big"
  const KEYWORD_RE = /\b(overzicht|schema|schematisch|cyclus|fasen|stappen)\b/i;
  const aspect =
    originalHeightMm && Number.isFinite(originalHeightMm) && originalHeightMm > 0
      ? originalHeightMm / originalWidthMm
      : null;
  const isTall = aspect !== null && aspect >= 1.15 && r >= 0.65;

  if (originalWidthMm > colW + gutter * 0.5 || (r >= HERO_RATIO && KEYWORD_RE.test(captionBody)) || isTall) {
    const targetMm = Math.min(metrics.contentWidthMm * 0.85, metrics.contentWidthMm);
    return { placement: 'full-width', width: `${targetMm.toFixed(1)}mm` };
  }

  if (r < 0.35) return { placement: 'inline', width: '55%' };
  if (r < 0.60) return { placement: 'inline', width: '75%' };
  return { placement: 'inline', width: '100%' };
}

function extractChapterBlocks(book: any, chapter: string): CanonBlock[] {
  const chapters: any[] = Array.isArray(book?.chapters) ? book.chapters : [];
  const chObj = chapters.find((c) => String(c?.number || '').trim() === String(chapter).trim());
  if (!chObj) throw new Error(`Chapter ${chapter} not found in canonical JSON`);

  const out: CanonBlock[] = [];

  function pushText(id: any, text: any, styleHint?: any) {
    const pid = String(id || '').trim();
    const norm = normalizeText(String(text || ''));
    if (!pid || !norm) return;
    out.push({ id: pid, norm, styleHint: styleHint ? String(styleHint) : undefined });
  }

  function walkBlock(block: any) {
    if (!block || typeof block !== 'object') return;
    const type = String(block.type || '').trim();
    if (type === 'paragraph') {
      pushText(block.id, block.basis, block.styleHint);
      return;
    }
    if (type === 'list') {
      const items: any[] = Array.isArray(block.items) ? block.items : [];
      for (const it of items) pushText(block.id, it, block.styleHint);
      // Also include the full list as a single "paragraph" candidate (helps when anchors merge list items)
      if (items.length) pushText(block.id, items.join(' '), block.styleHint);
      return;
    }
    if (type === 'steps') {
      const items: any[] = Array.isArray(block.items) ? block.items : [];
      for (const it of items) pushText(block.id, it, block.styleHint);
      // Also include the full steps block as a single candidate (anchors sometimes land on a later step line).
      if (items.length) pushText(block.id, items.join(' '), block.styleHint);
      return;
    }
    if (type === 'subparagraph') {
      // Treat the subparagraph title as a header candidate, then walk its content.
      pushText(block.id, block.title, 'subparagraph');
      const inner: any[] = Array.isArray(block.content) ? block.content : [];
      for (const b of inner) walkBlock(b);
      return;
    }

    // Unknown/other block types: try common text fields best-effort
    if (block.id && block.basis) pushText(block.id, block.basis, block.styleHint);
  }

  const sections: any[] = Array.isArray(chObj?.sections) ? chObj.sections : [];
  for (const sec of sections) {
    const content: any[] = Array.isArray(sec?.content) ? sec.content : [];
    for (const b of content) walkBlock(b);
  }

  return out;
}

function matchAnchorToBlockIdx(opts: {
  blocks: CanonBlock[];
  anchorText: string;
  beforeText?: string;
  afterText?: string;
}): number {
  const { blocks, anchorText, beforeText, afterText } = opts;
  let target = normalizeText(anchorText);
  // Sometimes the exporter "anchors" on the caption line (e.g. "Afbeelding 9.2 ...").
  // Our canonical JSON usually does NOT contain the "Afbeelding X.Y" prefix, so strip it.
  target = target.replace(/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+(?:\.\d+)?\s*:?\s+/i, '');
  if (!target) throw new Error('Empty anchor text');

  const beforeNorm = beforeText ? normalizeText(beforeText) : '';
  const afterNorm = afterText ? normalizeText(afterText) : '';

  const tokenize = (s: string): string[] => {
    const raw = String(s || '').toLowerCase();
    const parts = raw
      .split(/[^\p{L}\p{N}]+/gu)
      .map((x) => x.trim())
      .filter(Boolean);
    const stop = new Set([
      'de',
      'het',
      'een',
      'en',
      'of',
      'van',
      'voor',
      'met',
      'op',
      'aan',
      'bij',
      'in',
      'naar',
      'om',
      'als',
      'dan',
      'dat',
      'dit',
      'die',
      'deze',
      'daar',
      'hier',
      'je',
      'jij',
      'u',
      'hij',
      'zij',
      'we',
      'wij',
      'jullie',
      'hun',
      'hen',
      'zijn',
      'haar',
      'wat',
      'welke',
      'welk',
      'waar',
      'hoe',
      'moet',
      'moeten',
      'kan',
      'kun',
      'kunnen',
      'wordt',
      'worden',
      'is',
      'zijn',
      'was',
      'waren',
    ]);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      if (p.length < 4) continue; // skip very short tokens
      if (stop.has(p)) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  };

  const candidates: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].norm === target) candidates.push(i);
  }

  if (candidates.length === 0) {
    // Fallback A: try substring match
    const needle = target.length > 120 ? target.slice(0, 120) : target;
    // Allow relatively short needles too (e.g. headings like "Wat is klinisch redeneren?")
    if (needle.length >= 8) {
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].norm.includes(needle)) candidates.push(i);
      }
    }
  }

  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    // Fallback B: neighbor context
    if (beforeNorm && afterNorm) {
      for (let i = 1; i + 1 < blocks.length; i++) {
        if (blocks[i - 1].norm === beforeNorm && blocks[i + 1].norm === afterNorm) return i;
      }
      for (let i = 0; i + 1 < blocks.length; i++) {
        if (blocks[i].norm === beforeNorm && blocks[i + 1].norm === afterNorm) return i;
      }
    }

    // Fallback C: beforeText match directly
    if (beforeNorm) {
      const idxs = blocks.map((b, i) => (b.norm === beforeNorm ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 1) return idxs[0]!;
    }
    // Fallback D: afterText match and attach to the block before it
    if (afterNorm) {
      const idxs = blocks.map((b, i) => (b.norm === afterNorm ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 1) return Math.max(0, idxs[0]! - 1);
    }

    // Fallback E: token match (handles very short anchors like a single bullet word)
    const token = target.replace(/[;:.,!?]+$/g, '').trim();
    if (token.length >= 4 && token.length < 30) {
      const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${esc}\\b`, 'i');
      for (let i = 0; i < blocks.length; i++) {
        if (re.test(blocks[i].norm)) return i;
      }
    }

    // Fallback F: fuzzy token overlap (handles paraphrased anchors; especially common around steps/stappenplannen).
    const toks = tokenize(target);
    if (toks.length >= 4) {
      let bestIdx: number | null = null;
      let bestHits = 0;
      let bestRatio = 0;
      for (let i = 0; i < blocks.length; i++) {
        const hay = blocks[i].norm.toLowerCase();
        let hits = 0;
        for (const tk of toks) {
          if (hay.includes(tk)) hits++;
        }
        if (hits <= 0) continue;
        const ratio = hits / toks.length;
        if (hits > bestHits || (hits == bestHits && ratio > bestRatio)) {
          bestHits = hits;
          bestRatio = ratio;
          bestIdx = i;
        }
      }
      // Guardrail: require a minimum absolute overlap.
      if (bestIdx !== null && bestHits >= 3) return bestIdx;
    }

    throw new Error(`No match for anchor text: ${target.slice(0, 80)}...`);
  }

  // If ambiguous, pick the first candidate.
  return candidates[0]!;
}

function parseLabelChapter(label: string): number | null {
  const t = String(label || '').trim();
  const m = t.match(/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+(\d+)(?:\.\d+)?\s*:/i);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function main() {
  const bookId = String(getArg('--book') || getArg('--book-id') || '').trim();
  const chapter = String(getArg('--chapter') || '').trim();
  if (!bookId || !chapter) {
    console.error(
      'Usage: npx tsx new_pipeline/extract/map-figures-to-paragraphs-from-json.ts --book <book_id> --chapter <N> [--canonical <path>] [--out <path>] [--allow-missing]'
    );
    process.exit(1);
  }

  const allowMissing = hasFlag('--allow-missing');
  const repoRoot = path.resolve(__dirname, '../..'); // TestRun/

  const manifestPath = path.resolve(
    __dirname,
    `figure_manifests/${bookId}/figure_manifest_${bookId}_ch${chapter}.json`
  );
  const imagesMapPath = path.resolve(__dirname, `figure_manifests/${bookId}/ch${chapter}-images-map.json`);
  const overridesPath = path.resolve(__dirname, `figure_manifests/${bookId}/figure_overrides_ch${chapter}.json`);
  const legacyOverridesPath = path.resolve(__dirname, 'figure_overrides.json'); // backward-compat (CH1)

  const outArg = getArg('--out');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.resolve(__dirname, `figures_by_paragraph/${bookId}/figures_by_paragraph_ch${chapter}.json`);

  const canonArg = getArg('--canonical');
  const canonicalPath = canonArg
    ? path.resolve(process.cwd(), canonArg)
    : path.resolve(
        repoRoot,
        'new_pipeline',
        'output',
        '_canonical_jsons_all',
        `${bookId}__canonical_book_with_figures.json`
      );

  if (!fs.existsSync(manifestPath)) throw new Error(`Missing figure manifest: ${manifestPath}`);
  if (!fs.existsSync(imagesMapPath)) throw new Error(`Missing images map: ${imagesMapPath}`);
  if (!fs.existsSync(canonicalPath)) throw new Error(`Missing canonical JSON: ${canonicalPath}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FigureManifest;
  const imagesMap = JSON.parse(fs.readFileSync(imagesMapPath, 'utf8')) as ImagesMap;
  const imagesMapByName = new Map(imagesMap.map((m) => [m.originalFilename, m]));
  const overrides: Record<string, string> = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : fs.existsSync(legacyOverridesPath)
      ? JSON.parse(fs.readFileSync(legacyOverridesPath, 'utf8'))
      : {};

  const book = JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) as any;
  const blocks = extractChapterBlocks(book, chapter);

  const metrics = loadLayoutMetrics();
  const figuresByParagraph: FiguresByParagraph = {};
  const errors: string[] = [];

  for (const fig of manifest.figures) {
    const label = fig.caption?.label || '';
    const captionBody = fig.caption?.body || '';
    if (!label || !captionBody) {
      errors.push(`Figure missing label/body: label=${label}`);
      continue;
    }

    // Guardrail: skip figures that clearly belong to a different chapter (common when page ranges bleed).
    const labelCh = parseLabelChapter(label);
    const chapterNum = Number(chapter);
    if (labelCh !== null && Number.isFinite(chapterNum) && chapterNum > 0 && labelCh !== chapterNum) {
      continue;
    }

    let idx: number | null = null;
    if (overrides[label]) {
      const forcedId = overrides[label]!;
      const forcedIdx = blocks.findIndex((b) => b.id === forcedId);
      if (forcedIdx === -1) {
        errors.push(`${label}: override id not found in canonical chapter: ${forcedId}`);
        continue;
      }
      idx = forcedIdx;
    } else {
      const a = fig.anchor;
      const aText = a?.text || '';
      const aBefore = a?.beforeText || '';
      const aAfter = a?.afterText || '';
      if (!aText && !aBefore && !aAfter) {
        errors.push(`${label}: missing anchor in manifest`);
        continue;
      }
      try {
        // Some exporters put the object replacement char (U+FFFC) into anchor.text ("￼"),
        // or anchor on a very short label like "Stappenplan". Try all anchor candidates,
        // preferring the most informative (longest normalized) first.
        const cand = [aText, aBefore, aAfter]
          .map((raw) => ({ raw: String(raw || ''), norm: normalizeText(raw) }))
          .filter((c) => c.norm.length > 0)
          .sort((a, b) => b.norm.length - a.norm.length);
        let lastErr: any = null;
        for (const c of cand) {
          try {
            idx = matchAnchorToBlockIdx({ blocks, anchorText: c.raw, beforeText: aBefore, afterText: aAfter });
            lastErr = null;
            break;
          } catch (e2) {
            lastErr = e2;
          }
        }
        if (idx === null) throw lastErr || new Error('No usable anchor candidates');
      } catch (e) {
        const msg = (e as Error).message || String(e);
        if (allowMissing) {
          console.warn(`⚠️  ${label}: ${msg} (skipping)`);
          continue;
        }
        errors.push(`${label}: ${msg}`);
        continue;
      }
    }

    if (idx === null) continue;

    // Shift away from headers to the next content block.
    if (idx >= 0 && idx < blocks.length && isHeaderStyleHint(blocks[idx].styleHint)) {
      let j = idx + 1;
      while (j < blocks.length && (isHeaderStyleHint(blocks[j].styleHint) || blocks[j].norm.length < 5)) j++;
      if (j < blocks.length) idx = j;
      else {
        const msg = `anchor resolved to header (${blocks[idx].id}) and no following content block found`;
        if (allowMissing) {
          console.warn(`⚠️  ${label}: ${msg} (skipping)`);
          continue;
        }
        errors.push(`${label}: ${msg}`);
        continue;
      }
    }

    const paragraphId = blocks[idx].id;

    let src: string;
    try {
      src = resolveFigureSrc({ repoRoot, fig, imagesMapByName });
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (allowMissing) {
        console.warn(`⚠️  ${label}: ${msg} (skipping)`);
        continue;
      }
      errors.push(`${label}: ${msg}`);
      continue;
    }

    const wmm = widthMmFromBounds(fig.image?.bounds);
    const hmm = heightMmFromBounds(fig.image?.bounds);
    const sizing = designedFigureSizing({ originalWidthMm: wmm, originalHeightMm: hmm, captionBody, metrics });

    const entry = {
      src,
      alt: `${label} ${captionBody}`.trim(),
      figureNumber: label,
      caption: captionBody,
      placement: sizing.placement,
      width: sizing.width,
    };

    if (!figuresByParagraph[paragraphId]) figuresByParagraph[paragraphId] = [];
    figuresByParagraph[paragraphId].push(entry);
  }

  if (errors.length > 0) {
    const msg = `Mapping failed with ${errors.length} error(s):\n` + errors.map((e) => `- ${e}`).join('\n');
    console.error(msg);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(figuresByParagraph, null, 2), 'utf8');
  console.log(`✅ Wrote figures mapping (from canonical JSON): ${outPath}`);
  console.log(`   Paragraphs with figures: ${Object.keys(figuresByParagraph).length}`);
}

main().catch((err) => {
  console.error('❌ map-figures-to-paragraphs-from-json failed:', err?.message || String(err));
  process.exit(1);
});


