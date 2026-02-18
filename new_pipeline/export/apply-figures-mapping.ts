/**
 * Apply a figures_by_paragraph mapping onto an existing canonical JSON (already rewritten/assembled).
 *
 * Why:
 * - Some "full_rewritten" JSONs were assembled without figure injection.
 * - We can inject images deterministically by matching paragraph/list/steps block `id` to the mapping keys.
 *
 * Usage:
 *   npx tsx new_pipeline/export/apply-figures-mapping.ts <input.json> <figures_by_paragraph.json> --out <output.json>
 */
import * as fs from 'fs';
import * as path from 'path';

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

type FiguresByParagraph = Record<
  string,
  Array<{
    src: string;
    alt?: string;
    figureNumber: string;
    caption: string;
    placement?: 'inline' | 'float' | 'full-width';
    width?: string;
  }>
>;

function injectFiguresIntoBook(book: any, figuresByParagraph: FiguresByParagraph): number {
  let injected = 0;

  const mapBlock = (block: any) => {
    if (!block || typeof block !== 'object') return;

    const t = String(block.type || '');
    if (t === 'paragraph' || t === 'list' || t === 'steps') {
      const figs = figuresByParagraph[String(block.id || '')];
      if (figs && figs.length > 0) {
        block.images = figs.map((f) => ({
          src: f.src,
          alt: f.alt || '',
          figureNumber: f.figureNumber,
          caption: f.caption,
          width: f.width || (f.placement === 'inline' ? '50%' : '100%'),
        }));
        injected += figs.length;
      }
      return;
    }

    if (t === 'subparagraph' && Array.isArray(block.content)) {
      for (const inner of block.content) mapBlock(inner);
      return;
    }
  };

  for (const chapter of book?.chapters || []) {
    for (const section of chapter?.sections || []) {
      for (const block of section?.content || []) mapBlock(block);
    }
  }

  return injected;
}

async function main() {
  const input = process.argv[2];
  const figuresPath = process.argv[3];
  const outArg = getArg('--out');

  if (!input || !figuresPath || !outArg) {
    console.error(
      'Usage: npx tsx new_pipeline/export/apply-figures-mapping.ts <input.json> <figures_by_paragraph.json> --out <output.json>'
    );
    process.exit(1);
  }

  const inputAbs = path.resolve(input);
  const figuresAbs = path.resolve(figuresPath);
  const outAbs = path.resolve(outArg);

  if (!fs.existsSync(inputAbs)) throw new Error(`Input not found: ${inputAbs}`);
  if (!fs.existsSync(figuresAbs)) throw new Error(`Figures mapping not found: ${figuresAbs}`);

  const book = JSON.parse(fs.readFileSync(inputAbs, 'utf8')) as any;
  const figuresByParagraph = JSON.parse(fs.readFileSync(figuresAbs, 'utf8')) as FiguresByParagraph;

  const injected = injectFiguresIntoBook(book, figuresByParagraph);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(book, null, 2), 'utf8');

  console.log(`✅ Applied figures mapping`);
  console.log(`   input: ${inputAbs}`);
  console.log(`   figures: ${figuresAbs}`);
  console.log(`   injected: ${injected}`);
  console.log(`   out: ${outAbs}`);
}

main().catch((err) => {
  console.error('❌ apply-figures-mapping failed:', err?.message || String(err));
  process.exit(1);
});











