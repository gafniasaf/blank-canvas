/**
 * Map CH1 figure manifest entries to Supabase DB paragraph_ids deterministically.
 *
 * Inputs:
 * - new_pipeline/extract/figure_manifest_ch1.json (from InDesign extraction)
 * - new_pipeline/extract/ch1-images-map.json (copied non-atomic linked images)
 *
 * Output:
 * - new_pipeline/extract/figures_by_paragraph_ch<N>.json
 *
 * Usage:
 *   npx tsx new_pipeline/extract/map-figures-to-paragraphs.ts <uploadId> --chapter 1
 */

import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { loadEnv } from '../lib/load-env';

// ESM __dirname shim
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

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/<<BOLD_START>>/g, '').replace(/<<BOLD_END>>/g, '');
  t = t.replace(/\u00ad/gi, ''); // soft hyphen
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

function getDbUrl(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${encodeURIComponent(process.env.DB_USER || 'postgres')}:${encodeURIComponent(
      process.env.DB_PASSWORD || 'postgres'
    )}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '54322'}/${process.env.DB_NAME || 'postgres'}`
  );
}

type DbPara = {
  id: string;
  text_original: string;
  source_seq: number | null;
  style_name: string | null;
};

async function loadChapterParagraphs(opts: {
  uploadId: string;
  chapter: string;
}): Promise<Array<DbPara & { norm: string }>> {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: getDbUrl(), max: 5, idleTimeoutMillis: 10_000 });
  try {
    const res = await pool.query<DbPara>(
      `
      SELECT
        p.id,
        p.text_original,
        NULLIF((p.formatting_metadata->>'source_seq'), '')::INT AS source_seq,
        p.style_name
      FROM public.book_paragraphs p
      WHERE p.upload_id = $1
        AND p.chapter_number = $2
      ORDER BY source_seq ASC NULLS LAST, p.id ASC
      `,
      [opts.uploadId, opts.chapter]
    );
    return res.rows.map((r) => ({ ...r, norm: normalizeText(r.text_original) }));
  } finally {
    await pool.end();
  }
}

function isHeaderStyle(styleName: string | null | undefined): boolean {
  const s = String(styleName || '').toLowerCase();
  return s.includes('header') || s.includes('hoofdstuk') || s.includes('titel');
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

function matchAnchorToParagraphId(opts: {
  paragraphs: Array<DbPara & { norm: string }>;
  anchorText: string;
  beforeText?: string;
  afterText?: string;
  anchorIndexHint?: number;
}): string {
  const { paragraphs, anchorText, beforeText, afterText } = opts;
  const target = normalizeText(anchorText);
  if (!target) throw new Error('Empty anchor text');

  const beforeNorm = beforeText ? normalizeText(beforeText) : '';
  const afterNorm = afterText ? normalizeText(afterText) : '';
  const anchorIdxHint =
    typeof opts.anchorIndexHint === 'number' && Number.isFinite(opts.anchorIndexHint) ? opts.anchorIndexHint : null;

  const pickClosestBySourceSeq = (idxs: number[]): number | null => {
    if (anchorIdxHint === null || idxs.length === 0) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const idx of idxs) {
      const seq = typeof paragraphs[idx].source_seq === 'number' ? paragraphs[idx].source_seq : idx;
      const dist = Math.abs(seq - anchorIdxHint);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }
    return best;
  };

  const candidates: number[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].norm === target) candidates.push(i);
  }

  if (candidates.length === 0) {
    // Fallback A: try substring match (handles cases where InDesign split/merged paragraphs differ)
    const needle = target.length > 120 ? target.slice(0, 120) : target;
    if (needle.length >= 30) {
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i].norm.includes(needle)) candidates.push(i);
      }
    }
  }

  if (candidates.length === 1) return paragraphs[candidates[0]].id;
  if (candidates.length === 0) {
    // Fallback: if we have neighbor context, find the paragraph between before/after
    if (beforeNorm && afterNorm) {
      // Case A: anchor paragraph exists between before/after
      for (let i = 1; i + 1 < paragraphs.length; i++) {
        if (paragraphs[i - 1].norm === beforeNorm && paragraphs[i + 1].norm === afterNorm) {
          return paragraphs[i].id;
        }
      }
      // Case B: in DB the anchor sentence may be merged; before/after become adjacent.
      for (let i = 0; i + 1 < paragraphs.length; i++) {
        if (paragraphs[i].norm === beforeNorm && paragraphs[i + 1].norm === afterNorm) {
          return paragraphs[i].id;
        }
      }
    }

    // Case C: fall back to beforeText match directly
    if (beforeNorm) {
      const idxs = paragraphs.map((p, i) => (p.norm === beforeNorm ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 1) return paragraphs[idxs[0]].id;
    }
    // Case D: fall back to afterText match and attach to the paragraph before it
    if (afterNorm) {
      const idxs = paragraphs.map((p, i) => (p.norm === afterNorm ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 1) {
        // If afterText points at the first paragraph in the chapter slice, attach to it.
        // (Downstream we will shift away from headers if needed.)
        if (idxs[0] === 0) return paragraphs[0].id;
        return paragraphs[idxs[0] - 1].id;
      }
    }

    // Fallback E (short anchors): sometimes the exporter anchors on a single bullet item
    // like "vetten;" which won't match a full semicolon-list paragraph verbatim.
    // In that case, try matching the anchor as a *token* within a paragraph.
    const token = target.replace(/[;:.,]+$/g, '').trim();
    if (token.length >= 4 && token.length < 30) {
      const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${esc}\\b`, 'i');
      const hits: number[] = [];
      for (let i = 0; i < paragraphs.length; i++) {
        if (re.test(paragraphs[i].norm)) hits.push(i);
      }
      if (hits.length === 1) return paragraphs[hits[0]].id;
      if (hits.length > 1 && (beforeNorm || afterNorm)) {
        // Prefer the hit whose neighbors match our before/after context best.
        const needle = (s: string) => (s.length > 120 ? s.slice(0, 120) : s);
        const beforeNeedle = beforeNorm ? needle(beforeNorm) : '';
        const afterNeedle = afterNorm ? needle(afterNorm) : '';
        const scored = hits.map((idx) => {
          let score = 0;
          if (beforeNeedle && idx > 0) {
            const prev = paragraphs[idx - 1].norm;
            if (prev === beforeNorm) score += 4;
            else if (prev.includes(beforeNeedle)) score += 2;
          }
          if (afterNeedle && idx + 1 < paragraphs.length) {
            const next = paragraphs[idx + 1].norm;
            if (next === afterNorm) score += 4;
            else if (next.includes(afterNeedle)) score += 2;
          }
          return { idx, score };
        });
        const bestScore = Math.max(...scored.map((s) => s.score));
        if (bestScore > 0) {
          const best = scored.filter((s) => s.score === bestScore);
          if (best.length === 1) return paragraphs[best[0]!.idx].id;
        }
      }

      // If still ambiguous, fall back to the closest paragraph by source_seq vs the anchor index hint.
      const closest = pickClosestBySourceSeq(hits);
      if (closest !== null) return paragraphs[closest].id;
    }

    // Fallback F (token sandwich): when before/after are also short tokens, prefer a paragraph
    // that contains before+anchor+after in order. This is common for semicolon micro-lists.
    const beforeTok = beforeNorm ? beforeNorm.replace(/[;:.,]+$/g, '').trim() : '';
    const afterTok = afterNorm ? afterNorm.replace(/[;:.,]+$/g, '').trim() : '';
    if (
      token.length >= 3 &&
      beforeTok.length >= 3 &&
      afterTok.length >= 3 &&
      token.length < 30 &&
      beforeTok.length < 30 &&
      afterTok.length < 30
    ) {
      const t0 = token.toLowerCase();
      const b0 = beforeTok.toLowerCase();
      const a0 = afterTok.toLowerCase();
      const hitsOrdered: number[] = [];
      const hitsAny: number[] = [];
      for (let i = 0; i < paragraphs.length; i++) {
        const s = paragraphs[i].norm.toLowerCase();
        const ib = s.indexOf(b0);
        const it = s.indexOf(t0);
        const ia = s.indexOf(a0);
        if (ib >= 0 && it >= 0 && ia >= 0) {
          hitsAny.push(i);
          if (ib < it && it < ia) hitsOrdered.push(i);
        }
      }
      if (hitsOrdered.length === 1) return paragraphs[hitsOrdered[0]].id;
      if (hitsOrdered.length === 0 && hitsAny.length === 1) return paragraphs[hitsAny[0]].id;
      const closest = pickClosestBySourceSeq(hitsOrdered.length > 0 ? hitsOrdered : hitsAny);
      if (closest !== null) return paragraphs[closest].id;
    }

    // Final fallback (rare): if we still can't match by text, attach by proximity in story order.
    // This is safer than failing the whole chapter mapping for a single hard-to-match anchor.
    if (anchorIdxHint !== null && paragraphs.length > 0) {
      const all = Array.from({ length: paragraphs.length }, (_, i) => i);
      const closest = pickClosestBySourceSeq(all);
      if (closest !== null) return paragraphs[closest].id;
    }

    throw new Error(`No DB match for anchor text: ${target.slice(0, 120)}...`);
  }

  // Disambiguate by neighbor context when possible
  const filtered = candidates.filter((idx) => {
    let ok = true;
    if (beforeNorm) ok = ok && idx > 0 && paragraphs[idx - 1].norm === beforeNorm;
    if (afterNorm) ok = ok && idx + 1 < paragraphs.length && paragraphs[idx + 1].norm === afterNorm;
    return ok;
  });

  if (filtered.length === 1) return paragraphs[filtered[0]].id;

  // Fuzzy disambiguation: prefer the candidate whose neighbors most closely match the
  // before/after context (handles small whitespace/punctuation/merge differences).
  if ((beforeNorm || afterNorm) && candidates.length > 1) {
    const needle = (s: string) => (s.length > 120 ? s.slice(0, 120) : s);
    const beforeNeedle = beforeNorm ? needle(beforeNorm) : '';
    const afterNeedle = afterNorm ? needle(afterNorm) : '';

    const scored = candidates.map((idx) => {
      let score = 0;
      if (beforeNeedle && idx > 0) {
        const prev = paragraphs[idx - 1].norm;
        if (prev === beforeNorm) score += 4;
        else if (prev.includes(beforeNeedle)) score += 2;
      }
      if (afterNeedle && idx + 1 < paragraphs.length) {
        const next = paragraphs[idx + 1].norm;
        if (next === afterNorm) score += 4;
        else if (next.includes(afterNeedle)) score += 2;
      }
      return { idx, score };
    });

    const bestScore = Math.max(...scored.map((s) => s.score));
    if (bestScore > 0) {
      const best = scored.filter((s) => s.score === bestScore);
      if (best.length === 1) return paragraphs[best[0]!.idx].id;
    }
  }

  // Final fallback: if still ambiguous, pick the closest paragraph by source_seq vs the
  // anchor's paragraphIndexInStory hint (when available).
  const closest = pickClosestBySourceSeq(candidates);
  if (closest !== null) return paragraphs[closest].id;

  throw new Error(`Ambiguous anchor match (${candidates.length} candidates) for: ${target.slice(0, 80)}...`);
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

  // Full-width only when the original bounds truly exceed a column (designer intent),
  // otherwise keep single-column for better page rhythm.
  // Additionally, allow "hero" promotion for wide/complex figures (keyword + near-full-column width).
  if (
    originalWidthMm > colW + gutter * 0.5 ||
    (r >= HERO_RATIO && KEYWORD_RE.test(captionBody)) ||
    isTall
  ) {
    // Render as a centered full-width figure but not edge-to-edge (feels designed).
    const targetMm = Math.min(metrics.contentWidthMm * 0.85, metrics.contentWidthMm);
    return { placement: 'full-width', width: `${targetMm.toFixed(1)}mm` };
  }

  // Readability-first snapping for single-column figures:
  // - small insets → 55% column
  // - medium → 75% column
  // - most textbook figures → full column
  // (we keep true tiny figures compact, but give medium figures more presence)
  if (r < 0.35) return { placement: 'inline', width: '55%' };
  if (r < 0.60) return { placement: 'inline', width: '75%' };
  return { placement: 'inline', width: '100%' };
}

async function main() {
  // Ensure DB env vars are loaded (repo .env.local/.env, etc).
  // This keeps CLI usage deterministic and avoids relying on the caller shell.
  loadEnv();

  const uploadId = process.argv[2];
  if (!uploadId) {
    console.error(
      'Usage: npx tsx new_pipeline/extract/map-figures-to-paragraphs.ts <uploadId> --chapter 1 [--book <book_id>]'
    );
    process.exit(1);
  }

  const chapter = getArg('--chapter') || '1';
  const bookId = String(getArg('--book') || getArg('--book-id') || '').trim();

  const repoRoot = path.resolve(__dirname, '../..'); // TestRun/
  const manifestPath = bookId
    ? path.resolve(__dirname, `figure_manifests/${bookId}/figure_manifest_${bookId}_ch${chapter}.json`)
    : path.resolve(__dirname, `figure_manifest_ch${chapter}.json`);
  const imagesMapPath = bookId
    ? path.resolve(__dirname, `figure_manifests/${bookId}/ch${chapter}-images-map.json`)
    : path.resolve(__dirname, `ch${chapter}-images-map.json`);
  const outPath = bookId
    ? path.resolve(__dirname, `figures_by_paragraph/${bookId}/figures_by_paragraph_ch${chapter}.json`)
    : path.resolve(__dirname, `figures_by_paragraph_ch${chapter}.json`);
  const overridesPath = bookId
    ? path.resolve(__dirname, `figure_manifests/${bookId}/figure_overrides_ch${chapter}.json`)
    : path.resolve(__dirname, `figure_overrides_ch${chapter}.json`);
  const legacyOverridesPath = path.resolve(__dirname, 'figure_overrides.json'); // backward-compat (CH1)

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing figure manifest for chapter ${chapter}: ${manifestPath}`);
  }
  if (!fs.existsSync(imagesMapPath)) {
    throw new Error(`Missing images map for chapter ${chapter}: ${imagesMapPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FigureManifest;
  const imagesMap = JSON.parse(fs.readFileSync(imagesMapPath, 'utf8')) as ImagesMap;
  const imagesMapByName = new Map(imagesMap.map((m) => [m.originalFilename, m]));

  const overrides: Record<string, string> = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : fs.existsSync(legacyOverridesPath)
      ? JSON.parse(fs.readFileSync(legacyOverridesPath, 'utf8'))
      : {};

  const paragraphs = await loadChapterParagraphs({ uploadId, chapter });

  const figuresByParagraph: FiguresByParagraph = {};

  const errors: string[] = [];
  const metrics = loadLayoutMetrics();

  for (const fig of manifest.figures) {
    const label = fig.caption?.label || '';
    const captionBody = fig.caption?.body || '';

    if (!label || !captionBody) {
      errors.push(`Figure missing label/body: label=${label}`);
      continue;
    }

    let paragraphId: string | null = null;

    if (overrides[label]) {
      paragraphId = overrides[label];
    } else if (fig.anchor?.text) {
      try {
        paragraphId = matchAnchorToParagraphId({
          paragraphs,
          anchorText: fig.anchor.text,
          beforeText: fig.anchor.beforeText,
          afterText: fig.anchor.afterText,
          anchorIndexHint: fig.anchor.paragraphIndexInBodyStory,
        });
      } catch (e) {
        errors.push(`${label}: ${(e as Error).message}`);
        continue;
      }
    } else {
      errors.push(`${label}: missing anchor in manifest`);
      continue;
    }

    // If the chosen anchor paragraph is a header (skipped by exporter), shift to the next non-header paragraph.
    const idx = paragraphs.findIndex((p) => p.id === paragraphId);
    if (idx >= 0 && isHeaderStyle(paragraphs[idx].style_name)) {
      let j = idx + 1;
      while (j < paragraphs.length && (isHeaderStyle(paragraphs[j].style_name) || paragraphs[j].norm.length < 5)) {
        j++;
      }
      if (j < paragraphs.length) {
        paragraphId = paragraphs[j].id;
      } else {
        errors.push(`${label}: anchor resolved to header (${paragraphId}) and no following content paragraph found`);
        continue;
      }
    }

    let src: string;
    try {
      src = resolveFigureSrc({ repoRoot, fig, imagesMapByName });
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      continue;
    }

    // Compute figure sizing. We treat the extracted InDesign bounds as the baseline intent,
    // but snap to a small set of "designed" widths for better visual rhythm in Prince.
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
    const msg =
      `Mapping failed with ${errors.length} error(s):\n` + errors.map((e) => `- ${e}`).join('\n');
    console.error(msg);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(figuresByParagraph, null, 2), 'utf8');
  console.log(`✅ Wrote figures mapping: ${outPath}`);
  console.log(`   Paragraphs with figures: ${Object.keys(figuresByParagraph).length}`);
}

main().catch((err) => {
  console.error('❌ map-figures-to-paragraphs failed:', err.message);
  process.exit(1);
});


