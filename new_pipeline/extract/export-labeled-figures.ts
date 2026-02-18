/**
 * export-labeled-figures.ts
 *
 * JSON/manifest-driven exporter that generates PNGs with figure labels + captions
 * baked into the image (no InDesign required).
 *
 * Inputs:
 * - new_pipeline/extract/figure_manifest_ch<N>.json files (generated earlier from the canonical INDD/IDML)
 * - new_pipeline/assets/figures/ch<N>/*.png (atomic figure exports)
 *
 * Output (gitignored):
 * - output/figure_assets/<book_id>/<runId>/
 *   - labeled_pngs/ch<N>/<FigureId>.png
 *   - figures.manifest.json
 *
 * Usage:
 *   cd new_pipeline
 *   npm run export:labeled-figures -- --book MBO_AF4_2024_COMMON_CORE --chapters 1,2
 *
 * Options:
 *   --book <book_id>          Optional (default: first entry in books/manifest.json)
 *   --chapters "1,2,3"        Optional (default: all figure_manifest_ch*.json found)
 *   --in-dir <dir>            Optional (default: new_pipeline/extract)
 *   --out-dir <dir>           Optional (default: output/figure_assets/<book>/<runId>)
 *   --dsf <n>                 Optional deviceScaleFactor for crisp caption text (default: 2)
 *   --out-scale <n>           Optional output scale relative to source image pixels (default: 1)
 *   --overlay-only            If set: DO NOT render any caption/label into the PNG.
 *                             Instead, copy the best available source image to output and
 *                             keep label/caption as metadata only in figures.manifest.json.
 *                             (Prefer new_pipeline/assets/figures_overlays/<book_id>/chN/<FigureId>.png if present.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');

type FigureManifest = {
  chapter?: string;
  figures?: Array<{
    asset?: { path?: string; kind?: string; source?: string };
    caption?: { label?: string; body?: string; raw?: string; styleName?: string };
    image?: { atomicPath?: string; linkPath?: string; linkName?: string; kind?: string };
    page?: { documentOffset?: number; name?: string };
    anchor?: any;
  }>;
};

type OutputFigure = {
  book_id: string;
  chapter: string;
  figure_id: string;
  label: string;
  caption: string;
  source_asset_path: string; // repo-relative if possible
  source_asset_abs: string;
  labeled_png_path: string; // repo-relative (under output/)
  labeled_png_abs: string;
  page?: any;
  anchor?: any;
};

type ImageMapEntry = {
  originalFilename?: string;
  sourcePath?: string; // absolute on disk
  localPath?: string; // repo-relative path
};

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function parseCsvNumbers(s: string | null): number[] {
  const raw = String(s || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function runIdStamp(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function decodeLinkPath(linkPath: string): string {
  // linkPath examples:
  // - file:/Users/... (URL-encoded)
  // - /Users/... (already a path)
  let p = String(linkPath || '');
  if (p.startsWith('file:')) p = p.replace(/^file:/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // best effort (common case)
    p = p.replace(/%20/g, ' ');
  }
  if (p.startsWith('//')) p = p.substring(1);
  return p;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeWhitespace(s: string): string {
  return String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mimeFromExt(pth: string): string {
  const ext = path.extname(pth || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function readAsDataUrl(absPath: string): { dataUrl: string; mime: string } {
  const mime = mimeFromExt(absPath);
  const buf = fs.readFileSync(absPath);
  const b64 = buf.toString('base64');
  return { dataUrl: `data:${mime};base64,${b64}`, mime };
}

function normalizeFigureId(labelOrRaw: string, fallbackFilename: string): string {
  const raw = normalizeWhitespace(labelOrRaw);
  if (raw) {
    // Prefer things like "Afbeelding 1.10:" or "Figuur 2.3:"
    let t = raw.replace(/[:\s]+$/g, '').trim();
    // Keep only the first token part if raw includes a full sentence.
    // Example: "Afbeelding 1.10 DNA draagt ..." -> keep "Afbeelding 1.10"
    const m = t.match(/^(Afbeelding|Figuur)\s+\d+(?:\.\d+)?/i);
    if (m) t = m[0]!;
    t = t.replace(/\s+/g, '_');
    t = t.replace(/[^A-Za-z0-9_.-]/g, '');
    if (t) return t;
  }
  const base = path.basename(fallbackFilename || 'figure', path.extname(fallbackFilename || ''));
  return base.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function splitCaption(label: string | undefined, body: string | undefined, raw: string | undefined): { label: string; body: string } {
  const l0 = normalizeWhitespace(label || '');
  const b0 = normalizeWhitespace(body || '');
  const r0 = normalizeWhitespace(raw || '');
  if (l0 && b0) return { label: l0.endsWith(':') ? l0 : `${l0}:`, body: b0 };
  if (r0) {
    // Common pattern: "Afbeelding 1.10 DNA draagt ..."
    const m = r0.match(/^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)?)\s*:?\s*(.*)$/i);
    if (m) {
      const lab = `${m[1]} ${m[2]}:`;
      const body2 = normalizeWhitespace(m[3] || '');
      return { label: lab, body: body2 };
    }
    // Fallback: treat first sentence-like chunk as label if it ends with ":"
    if (r0.includes(':')) {
      const idx = r0.indexOf(':');
      const lab = normalizeWhitespace(r0.slice(0, idx + 1));
      const body2 = normalizeWhitespace(r0.slice(idx + 1));
      return { label: lab, body: body2 };
    }
    return { label: '', body: r0 };
  }
  return { label: l0, body: b0 };
}

function resolveAbsFromRepoOrPipeline(pth: string): string {
  if (!pth) return '';
  if (path.isAbsolute(pth)) return pth;
  const repoAbs = path.resolve(REPO_ROOT, pth);
  if (fs.existsSync(repoAbs)) return repoAbs;
  const pipeAbs = path.resolve(PIPELINE_ROOT, pth);
  if (fs.existsSync(pipeAbs)) return pipeAbs;
  return repoAbs; // best effort
}

function toRepoRel(pthAbs: string): string {
  const abs = path.resolve(pthAbs);
  const rel = path.relative(REPO_ROOT, abs);
  if (!rel.startsWith('..')) return rel.replace(/\\/g, '/');
  return abs.replace(/\\/g, '/');
}

function loadChapterImageMap(chapter: string): Map<string, string> {
  // Returns: sourcePath (absolute) -> localPath (repo-relative)
  const ch = String(chapter || '').trim();
  if (!ch) return new Map();
  const p = path.resolve(PIPELINE_ROOT, 'extract', `ch${ch}-images-map.json`);
  if (!fs.existsSync(p)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as ImageMapEntry[];
    const m = new Map<string, string>();
    for (const it of raw || []) {
      const src = String(it?.sourcePath || '').trim();
      const loc = String(it?.localPath || '').trim();
      if (!src || !loc) continue;
      m.set(src, loc);
    }
    return m;
  } catch {
    return new Map();
  }
}

function listFigureManifests(inDirAbs: string, chapters: number[] | null): Array<{ chapter: string; pathAbs: string }> {
  if (!fs.existsSync(inDirAbs)) die(`Input dir not found: ${inDirAbs}`);
  const files = fs.readdirSync(inDirAbs);
  const found: Array<{ chapter: string; pathAbs: string }> = [];
  for (const f of files) {
    const m = f.match(/^figure_manifest_ch(\d+)\.json$/i);
    if (!m) continue;
    const ch = String(parseInt(m[1]!, 10));
    if (chapters && chapters.length && !chapters.includes(Number(ch))) continue;
    found.push({ chapter: ch, pathAbs: path.resolve(inDirAbs, f) });
  }
  found.sort((a, b) => Number(a.chapter) - Number(b.chapter));
  return found;
}

async function renderLabeledPng(opts: {
  page: puppeteer.Page;
  imgAbs: string;
  label: string;
  caption: string;
  outAbs: string;
  deviceScaleFactor: number;
  outScale: number;
}) {
  const { page, imgAbs, label, caption, outAbs, deviceScaleFactor, outScale } = opts;

  const imgUrl = readAsDataUrl(imgAbs).dataUrl;
  const labelHtml = escapeHtml(label || '');
  const capHtml = escapeHtml(caption || '');

  // Render strategy:
  // - Use deviceScaleFactor (dsf) for crisp text.
  // - Scale the displayed image down by (outScale / dsf) so the output image is ~outScale * natural pixels.
  const renderScale = outScale / deviceScaleFactor;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { --pad: 24px; --capTop: 14px; --fg: #111; --bg: #fff; }
      html, body { margin:0; padding:0; background: var(--bg); }
      #wrap { position:absolute; left:0; top:0; padding: var(--pad); background: var(--bg); }
      #figure { display:inline-block; background: var(--bg); }
      #img { display:block; max-width:none; height:auto; }
      #cap {
        margin-top: var(--capTop);
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        color: var(--fg);
        font-size: 28px;
        line-height: 1.25;
      }
      #label { font-weight: 700; }
    </style>
  </head>
  <body>
    <div id="wrap">
      <div id="figure">
        <img id="img" src="${imgUrl}" />
        <div id="cap">${labelHtml ? `<span id="label">${labelHtml}</span>` : ''}${labelHtml && capHtml ? ' ' : ''}${capHtml}</div>
      </div>
    </div>
  </body>
</html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  // Wait for the image to finish attempting to load. For broken file URLs, naturalWidth stays 0 forever.
  await page.waitForFunction(
    () => {
      const img = document.getElementById('img') as HTMLImageElement | null;
      return !!img && img.complete;
    },
    { timeout: 20000 }
  );

  const imgInfo = await page.evaluate(() => {
    const img = document.getElementById('img') as HTMLImageElement | null;
    return {
      complete: !!img && img.complete,
      naturalWidth: img ? img.naturalWidth : 0,
      naturalHeight: img ? img.naturalHeight : 0,
      currentSrc: img ? img.currentSrc : '',
    };
  });
  if (!imgInfo.naturalWidth || !imgInfo.naturalHeight) {
    throw new Error(`Image failed to load (naturalWidth=0): ${String(imgInfo.currentSrc || '')} srcAbs=${imgAbs}`);
  }

  // Apply scaling and make caption width match image width (after scaling)
  await page.evaluate((scale: number) => {
    const img = document.getElementById('img') as HTMLImageElement;
    const fig = document.getElementById('figure') as HTMLElement;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    img.style.width = `${sw}px`;
    img.style.height = `${sh}px`;
    fig.style.width = `${sw}px`;
  }, renderScale);

  // Resize viewport to fit content snugly, then screenshot just the wrap box.
  const bbox = await page.$eval('#wrap', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  const vw = Math.min(6000, Math.max(800, Math.ceil(bbox.width) + 10));
  const vh = Math.min(6000, Math.max(800, Math.ceil(bbox.height) + 10));
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor });

  const bbox2 = await page.$eval('#wrap', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  ensureDir(path.dirname(outAbs));
  await page.screenshot({
    path: outAbs,
    clip: {
      x: Math.max(0, Math.floor(bbox2.x)),
      y: Math.max(0, Math.floor(bbox2.y)),
      width: Math.ceil(bbox2.width),
      height: Math.ceil(bbox2.height),
    },
    type: 'png',
  });
}

function overlayCandidateAbs(bookId: string, chapter: string, figureId: string): string {
  // Preferred source when callouts/labels exist as separate InDesign page items:
  // new_pipeline/assets/figures_overlays/<book_id>/chN/<FigureId>.png
  return path.resolve(PIPELINE_ROOT, 'assets', 'figures_overlays', bookId, `ch${chapter}`, `${figureId}.png`);
}

async function main() {
  // book_id for naming only (JSON-first exporter doesn’t depend on DB)
  const manifestPath = path.resolve(REPO_ROOT, 'books', 'manifest.json');
  let defaultBookId = 'BOOK';
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { books?: Array<{ book_id?: string }> };
    defaultBookId = String(m.books?.[0]?.book_id || defaultBookId);
  } catch {
    // ignore; fallback to BOOK
  }

  const bookId = getArg('--book') || defaultBookId;
  const chaptersArg = getArg('--chapters');
  const chapters = chaptersArg ? parseCsvNumbers(chaptersArg) : [];
  const inDirArg = getArg('--in-dir') || path.resolve(PIPELINE_ROOT, 'extract');
  const outDirArg = getArg('--out-dir'); // absolute or relative-to-repo
  const overlayOnly = hasFlag('--overlay-only');

  const dsf = Math.max(1, Math.min(4, parseInt(getArg('--dsf') || '2', 10) || 2));
  const outScale = Math.max(1, Math.min(4, parseInt(getArg('--out-scale') || '1', 10) || 1));

  const inDirAbs = path.isAbsolute(inDirArg) ? inDirArg : path.resolve(REPO_ROOT, inDirArg);
  const runId = runIdStamp();
  const outDirAbs = outDirArg
    ? (path.isAbsolute(outDirArg) ? outDirArg : path.resolve(REPO_ROOT, outDirArg))
    : path.resolve(REPO_ROOT, 'output', 'figure_assets', bookId, runId);

  const manifestFiles = listFigureManifests(inDirAbs, chapters.length ? chapters : null);
  if (!manifestFiles.length) {
    die(`No figure manifests found in ${inDirAbs} (expected figure_manifest_ch<N>.json).`);
  }

  console.log(
    overlayOnly
      ? `Export figure PNGs (overlay-only, no caption baked): book=${bookId}`
      : `Export labeled figures: book=${bookId} dsf=${dsf} outScale=${outScale}`
  );
  console.log(`Input dir:  ${inDirAbs}`);
  console.log(`Output dir: ${outDirAbs}`);
  console.log(`Chapters:   ${manifestFiles.map((x) => x.chapter).join(', ')}`);

  ensureDir(outDirAbs);
  const outPngRoot = path.resolve(outDirAbs, overlayOnly ? 'overlay_pngs' : 'labeled_pngs');
  ensureDir(outPngRoot);

  const browser = overlayOnly
    ? null
    : await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
      });

  const page = overlayOnly ? null : await browser!.newPage();
  if (!overlayOnly) await page!.setViewport({ width: 1800, height: 2600, deviceScaleFactor: dsf });

  const outFigures: OutputFigure[] = [];
  let rendered = 0;
  let skippedMissingAsset = 0;
  let skippedLoadFailed = 0;
  const errors: Array<{ chapter: string; figure_id: string; asset: string; error: string }> = [];

  // Preload link→local maps (so we can resolve figures whose atomic export is missing).
  const chapterImageMaps = new Map<string, Map<string, string>>();
  for (const mf of manifestFiles) {
    chapterImageMaps.set(mf.chapter, loadChapterImageMap(mf.chapter));
  }

  try {
    for (const mf of manifestFiles) {
      const raw = fs.readFileSync(mf.pathAbs, 'utf8');
      const parsed = JSON.parse(raw) as FigureManifest;
      const ch = String(parsed.chapter || mf.chapter || '');
      const figures = parsed.figures || [];

      for (const fig of figures) {
        const cap = splitCaption(fig.caption?.label, fig.caption?.body, fig.caption?.raw);
        const label = cap.label || '';
        const body = cap.body || '';
        const figureId = normalizeFigureId(label || fig.caption?.raw || '', String(fig.asset?.path || fig.image?.atomicPath || '') || 'figure');

        // Resolve source image:
        // 0) Prefer overlay-baked export (InDesign-exported composite: image + callouts, no captions)
        // 1) Prefer atomic export (asset.path / image.atomicPath)
        // 2) Fallback to linkPath, optionally mapped to a local copy under new_pipeline/assets/images/chN/
        const overlayAbs = overlayCandidateAbs(bookId, ch, figureId);
        const assetRel0 = String(fig.asset?.path || fig.image?.atomicPath || '').trim();
        let assetAbs = fs.existsSync(overlayAbs) ? overlayAbs : (assetRel0 ? resolveAbsFromRepoOrPipeline(assetRel0) : '');
        let sourceAssetPathForManifest = fs.existsSync(overlayAbs)
          ? toRepoRel(overlayAbs)
          : (assetRel0 ? String(assetRel0).replace(/\\/g, '/') : '');

        const atomicOk = assetAbs && fs.existsSync(assetAbs);
        if (!atomicOk) {
          const linkPath = String(fig.image?.linkPath || '').trim();
          if (linkPath) {
            const srcPath = decodeLinkPath(linkPath);
            const map = chapterImageMaps.get(ch) || new Map<string, string>();
            const localRel = map.get(srcPath);
            if (localRel) {
              assetAbs = resolveAbsFromRepoOrPipeline(localRel);
              sourceAssetPathForManifest = String(localRel).replace(/\\/g, '/');
            } else if (srcPath && fs.existsSync(srcPath)) {
              assetAbs = srcPath;
              sourceAssetPathForManifest = srcPath.replace(/\\/g, '/');
            }
          }
        }

        if (!assetAbs || !fs.existsSync(assetAbs)) {
          skippedMissingAsset++;
          continue;
        }

        const outChapterDir = path.resolve(outPngRoot, `ch${ch}`);
        const outAbs = path.resolve(outChapterDir, `${figureId}.png`);

        try {
          ensureDir(outChapterDir);
          if (overlayOnly) {
            // Overlay-only mode: keep PNG exactly as-is; captions remain metadata in figures.manifest.json.
            fs.copyFileSync(assetAbs, outAbs);
          } else {
            await renderLabeledPng({
              page: page!,
              imgAbs: assetAbs,
              label,
              caption: body,
              outAbs,
              deviceScaleFactor: dsf,
              outScale,
            });
          }
        } catch (e) {
          skippedLoadFailed++;
          const msg = String((e as any)?.message || e || 'unknown error');
          errors.push({ chapter: ch, figure_id: figureId, asset: assetAbs, error: msg });
          console.warn(`WARN: render failed ch=${ch} figure=${figureId} asset=${assetAbs}: ${msg}`);
          continue;
        }

        rendered++;
        outFigures.push({
          book_id: bookId,
          chapter: ch,
          figure_id: figureId,
          label,
          caption: body,
          source_asset_path: sourceAssetPathForManifest || toRepoRel(assetAbs),
          source_asset_abs: assetAbs,
          labeled_png_path: toRepoRel(outAbs),
          labeled_png_abs: outAbs,
          page: fig.page,
          anchor: fig.anchor,
        });

        if (rendered % 25 === 0) console.log(`Rendered ${rendered}…`);
      }
    }
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  // Stable manifest ordering
  outFigures.sort((a, b) => {
    const ac = Number(a.chapter) - Number(b.chapter);
    if (ac !== 0) return ac;
    return a.figure_id.localeCompare(b.figure_id);
  });

  const outManifest = {
    book_id: bookId,
    run_id: runId,
    generated_at: new Date().toISOString(),
    input_dir: toRepoRel(inDirAbs),
    output_dir: toRepoRel(outDirAbs),
    mode: overlayOnly ? 'overlay_only' : 'label_and_caption_baked',
    device_scale_factor: dsf,
    out_scale: outScale,
    rendered,
    skipped_missing_asset: skippedMissingAsset,
    skipped_load_failed: skippedLoadFailed,
    errors: errors.slice(0, 200),
    figures: outFigures.map((f) => ({
      book_id: f.book_id,
      chapter: f.chapter,
      figure_id: f.figure_id,
      label: f.label,
      caption: f.caption,
      source_asset_path: f.source_asset_path,
      labeled_png_path: f.labeled_png_path,
      page: f.page,
      anchor: f.anchor,
    })),
  };

  fs.writeFileSync(path.resolve(outDirAbs, 'figures.manifest.json'), JSON.stringify(outManifest, null, 2), 'utf8');

  console.log(`✅ Done. rendered=${rendered} skipped_missing_asset=${skippedMissingAsset}`);
  console.log(`Manifest: ${path.resolve(outDirAbs, 'figures.manifest.json')}`);
  console.log(`PNGs:     ${outPngRoot}`);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});


