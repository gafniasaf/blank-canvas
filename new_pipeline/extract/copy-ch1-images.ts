import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LocalImage {
  /** Original linked filename as it appears in InDesign */
  originalFilename: string;
  /** Source path on disk (absolute) */
  sourcePath: string;
  /** Local filename in repo (may change extension for TIFF→PNG) */
  localFilename: string;
  /** Local path relative to repo root */
  localPath: string;
  /** Which figure labels reference this asset */
  usedInFigureLabels: string[];
}

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v ? String(v) : null;
}

const chapter = getArg('--chapter') || '1';
const bookId = String(getArg('--book') || getArg('--book-id') || '').trim();

const FIGURE_MANIFEST_FILE = bookId
  ? path.resolve(__dirname, `figure_manifests/${bookId}/figure_manifest_${bookId}_ch${chapter}.json`)
  : path.resolve(__dirname, `figure_manifest_ch${chapter}.json`);

// Destination:
// - Legacy (single-book) mode: new_pipeline/assets/images/ch<N>/
// - Book-aware mode: new_pipeline/assets/figures_by_book/<book_id>/ch<N>/linked/
const DEST_DIR = bookId
  ? path.resolve(__dirname, `../assets/figures_by_book/${bookId}/ch${chapter}/linked`)
  : path.resolve(__dirname, `../assets/images/ch${chapter}`);

const RELATIVE_DEST_DIR = bookId
  ? `new_pipeline/assets/figures_by_book/${bookId}/ch${chapter}/linked`
  : `new_pipeline/assets/images/ch${chapter}`;

const MAP_OUTPUT_FILE = bookId
  ? path.resolve(__dirname, `figure_manifests/${bookId}/ch${chapter}-images-map.json`)
  : path.resolve(__dirname, `ch${chapter}-images-map.json`);

function decodeLinkPath(linkPath: string): string {
  // linkPath can be:
  // - file:/Users/... (URL-encoded)
  // - /Users/... (already a path)
  let p = linkPath || '';
  if (p.startsWith('file:')) p = p.replace(/^file:/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // best effort
    p = p.replace(/%20/g, ' ');
  }
  if (p.startsWith('//')) p = p.substring(1);
  return p;
}

async function main() {
  if (!fs.existsSync(FIGURE_MANIFEST_FILE)) {
    console.error('Figure manifest not found:', FIGURE_MANIFEST_FILE);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(FIGURE_MANIFEST_FILE, 'utf8')) as {
    figures: Array<{
      caption?: { label?: string };
      image?: { kind?: string; linkName?: string; linkPath?: string };
      asset?: { path?: string };
    }>;
  };

  const figures = manifest.figures || [];

  // Collect unique linked images used by figures that do NOT have an atomic asset
  // (atomic assets are exported separately by the manifest exporter)
  const bySource = new Map<
    string,
    { originalFilename: string; linkPath: string; usedIn: string[] }
  >();

  for (const fig of figures) {
    const label = fig.caption?.label || '';
    const img = fig.image;
    const hasAtomic = !!fig.asset?.path || !!(img as any)?.atomicPath;
    if (!img || img.kind !== 'link') continue;
    if (hasAtomic) continue;

    const linkPath = img.linkPath || '';
    const sourcePath = decodeLinkPath(linkPath);
    if (!sourcePath) continue;
    const originalFilename = img.linkName || path.basename(sourcePath);

    const existing = bySource.get(sourcePath);
    if (existing) {
      if (label) existing.usedIn.push(label);
    } else {
      bySource.set(sourcePath, { originalFilename, linkPath, usedIn: label ? [label] : [] });
    }
  }

  const sources = Array.from(bySource.keys()).sort((a, b) => a.localeCompare(b));
  console.log(
    `Found ${sources.length} linked images to copy for CH${chapter} (non-atomic)` +
      (bookId ? ` book=${bookId}` : '') +
      '.'
  );

  if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });

  const imageMap: LocalImage[] = [];

  for (const sourcePath of sources) {
    const meta = bySource.get(sourcePath)!;
    if (!fs.existsSync(sourcePath)) {
      console.warn(`Source image not found: ${sourcePath}`);
      continue;
    }

    const ext = path.extname(sourcePath).toLowerCase();
    const basename = path.basename(sourcePath, path.extname(sourcePath));
    
    let destFilename = meta.originalFilename;
    // Convert TIF to PNG
    if (ext === '.tif' || ext === '.tiff') {
      destFilename = `${basename}.png`;
    }

    const destPath = path.join(DEST_DIR, destFilename);
    
    // Copy or Convert
    if ((ext === '.tif' || ext === '.tiff') && !fs.existsSync(destPath)) {
      console.log(`Converting ${meta.originalFilename} to PNG...`);
      try {
        execSync(`sips -s format png "${sourcePath}" --out "${destPath}"`, { stdio: 'ignore' });
      } catch (e) {
        console.error(`Failed to convert ${sourcePath}`);
        continue;
      }
    } else if (!fs.existsSync(destPath)) {
      console.log(`Copying ${meta.originalFilename}...`);
      fs.copyFileSync(sourcePath, destPath);
    }

    imageMap.push({
      originalFilename: meta.originalFilename,
      sourcePath,
      localFilename: destFilename,
      localPath: `${RELATIVE_DEST_DIR}/${destFilename}`,
      usedInFigureLabels: meta.usedIn.sort(),
    });
  }

  // Deterministic ordering
  imageMap.sort((a, b) => a.originalFilename.localeCompare(b.originalFilename));

  fs.writeFileSync(MAP_OUTPUT_FILE, JSON.stringify(imageMap, null, 2), 'utf8');
  console.log(`Saved image map to ${MAP_OUTPUT_FILE}`);
}

main();

