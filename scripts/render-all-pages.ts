import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// --- CONFIG ---
const MANIFEST_PATH = path.resolve(__dirname, '../books/manifest.json');
const OUTPUT_BASE = path.resolve(__dirname, '../new_pipeline/output/fullpage_renders');

if (!fs.existsSync(OUTPUT_BASE)) {
  fs.mkdirSync(OUTPUT_BASE, { recursive: true });
}

interface Manifest {
  books: BookEntry[];
}

interface BookEntry {
  book_id: string;
  canonical_n4_indd_path: string;
}

function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

/**
 * Get pages with figures from InDesign (simplified - just get all pages with linked images)
 */
function getPagesWithFigures(boundsJsonPath: string): Set<number> {
  if (!fs.existsSync(boundsJsonPath)) return new Set();
  const data = JSON.parse(fs.readFileSync(boundsJsonPath, 'utf-8'));
  const pages = new Set<number>();
  for (const fig of data.figures) {
    pages.add(fig.pageIndex);
  }
  return pages;
}

/**
 * Render specific pages from PDF at high resolution
 */
function renderPages(pdfPath: string, pages: Set<number>, outputDir: string, bookId: string) {
  const DPI = 300;
  const sortedPages = Array.from(pages).sort((a, b) => a - b);
  
  console.log(`Rendering ${sortedPages.length} pages at ${DPI} DPI...`);
  
  for (const pageNum of sortedPages) {
    const outFile = path.join(outputDir, `${bookId}_page_${String(pageNum).padStart(4, '0')}`);
    
    if (fs.existsSync(outFile + '.png')) {
      // console.log(`Skipping page ${pageNum} (already exists)`);
      continue;
    }
    
    try {
      const cmd = `pdftocairo -png -r ${DPI} -f ${pageNum} -l ${pageNum} -singlefile "${pdfPath}" "${outFile}"`;
      execSync(cmd, { stdio: 'ignore' });
      process.stdout.write(`\rRendered page ${pageNum}/${sortedPages[sortedPages.length - 1]}   `);
    } catch (e) {
      console.error(`\nFailed to render page ${pageNum}`);
    }
  }
  console.log('\nDone rendering pages.');
}

async function processBook(book: BookEntry) {
  console.log(`\n========================================`);
  console.log(`Processing: ${book.book_id}`);
  console.log(`========================================`);

  const bookOutDir = path.join(OUTPUT_BASE, book.book_id);
  if (!fs.existsSync(bookOutDir)) fs.mkdirSync(bookOutDir, { recursive: true });

  // Check for high-res PDF
  const pdfPath = path.resolve(__dirname, `../new_pipeline/output/highres_exports/${book.book_id}_HIGHRES.pdf`);
  
  if (!fs.existsSync(pdfPath)) {
    console.error(`High-res PDF not found: ${pdfPath}`);
    return;
  }

  // Check for bounds JSON (from previous extraction) or extract fresh
  const boundsJsonPath = path.join(bookOutDir, 'raw_bounds.json');
  
  // If we don't have bounds yet, we need to extract from InDesign
  // For now, let's just render ALL pages from the PDF (simpler approach)
  
  // Get total page count from PDF
  let totalPages = 0;
  try {
    const output = execSync(`pdfinfo "${pdfPath}" | grep Pages`, { encoding: 'utf-8' });
    const match = output.match(/Pages:\s+(\d+)/);
    if (match) totalPages = parseInt(match[1]);
  } catch (e) {
    console.error('Could not determine page count');
    return;
  }

  console.log(`PDF has ${totalPages} pages`);
  
  // Render all pages (we can filter later if needed)
  const allPages = new Set<number>();
  for (let i = 1; i <= totalPages; i++) allPages.add(i);
  
  renderPages(pdfPath, allPages, bookOutDir, book.book_id);
}

async function main() {
  const manifest = loadManifest();
  
  for (const book of manifest.books) {
    await processBook(book);
  }

  console.log(`\n\nAll books processed. Full-page renders saved to: ${OUTPUT_BASE}`);
}

main().catch(e => console.error(e));



