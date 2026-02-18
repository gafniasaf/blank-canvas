import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

type FiguresByParagraph = Record<
  string,
  Array<{
    src: string;
    alt: string;
    figureNumber: string;
    caption: string;
    placement?: 'inline' | 'float' | 'full-width';
    width?: string;
  }>
>;

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v ? String(v) : null;
}

function parseChaptersList(raw: string | null): number[] {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

async function main() {
  const bookId = String(getArg('--book') || getArg('--book-id') || '').trim();
  const chaptersArg = getArg('--chapters');
  const chapters = parseChaptersList(chaptersArg);
  const resolvedChapters = chapters.length ? chapters : Array.from({ length: 14 }, (_, i) => i + 1);

  const outArg = getArg('--out');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : bookId
      ? path.resolve(__dirname, `figures_by_paragraph/${bookId}/figures_by_paragraph_all.json`)
      : path.resolve(__dirname, 'figures_by_paragraph_all.json');

  const merged: FiguresByParagraph = {};
  const collisions: Array<{ paragraphId: string; fromChapter: number; toChapter: number }> = [];

  for (const ch of resolvedChapters) {
    const inPath = bookId
      ? path.resolve(__dirname, `figures_by_paragraph/${bookId}/figures_by_paragraph_ch${ch}.json`)
      : path.resolve(__dirname, `figures_by_paragraph_ch${ch}.json`);
    if (!fs.existsSync(inPath)) {
      console.warn(`⚠️  Missing mapping file for CH${ch}${bookId ? ` (book=${bookId})` : ''}: ${inPath}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(inPath, 'utf8')) as FiguresByParagraph;
    for (const [pid, figs] of Object.entries(data)) {
      if (merged[pid]) {
        // Record collision (should not happen in normal operation)
        collisions.push({ paragraphId: pid, fromChapter: ch, toChapter: ch });
        merged[pid] = [...merged[pid], ...figs];
      } else {
        merged[pid] = figs;
      }
    }
  }

  if (collisions.length > 0) {
    console.warn(`⚠️  Detected ${collisions.length} paragraph-id collision(s) while merging figure mappings.`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`✅ Wrote merged figures mapping: ${outPath}`);
  console.log(`   Paragraphs with figures: ${Object.keys(merged).length}`);
}

main().catch((err) => {
  console.error('❌ merge-figures-by-paragraph failed:', err?.message || String(err));
  process.exit(1);
});


