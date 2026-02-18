import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Only process PDFs that are likely valid (based on file size)
const VALID_PDFS = [
  { name: 'MBO_AF4_2024_COMMON_CORE', pdf: 'MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf' },
  { name: 'MBO_VTH_N4', pdf: 'MBO_VTH_N4_2024_HIGHRES.pdf' },
  { name: 'MBO_VTH_N3', pdf: 'MBO_VTH_N3_2024_HIGHRES.pdf' },
  { name: 'MBO_PATHOLOGIE_N4', pdf: 'MBO_PATHOLOGIE_N4_2024_HIGHRES.pdf' },
];

const PDF_BASE = path.resolve(__dirname, '../new_pipeline/output/highres_exports');
const OUTPUT_BASE = path.resolve(__dirname, '../new_pipeline/output/fullpage_renders');

if (!fs.existsSync(OUTPUT_BASE)) {
  fs.mkdirSync(OUTPUT_BASE, { recursive: true });
}

function getPageCount(pdfPath: string): number {
  try {
    const output = execSync(`pdfinfo "${pdfPath}" | grep Pages`, { encoding: 'utf-8' });
    const match = output.match(/Pages:\s+(\d+)/);
    return match ? parseInt(match[1]) : 0;
  } catch (e) {
    return 0;
  }
}

function renderPages(pdfPath: string, totalPages: number, outputDir: string, bookName: string) {
  const DPI = 300;
  
  console.log(`Rendering ${totalPages} pages at ${DPI} DPI...`);
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const outFile = path.join(outputDir, `${bookName}_page_${String(pageNum).padStart(4, '0')}`);
    
    if (fs.existsSync(outFile + '.png')) {
      continue; // Skip already rendered
    }
    
    try {
      const cmd = `pdftocairo -png -r ${DPI} -f ${pageNum} -l ${pageNum} -singlefile "${pdfPath}" "${outFile}"`;
      execSync(cmd, { stdio: 'ignore' });
      process.stdout.write(`\r  Page ${pageNum}/${totalPages}   `);
    } catch (e) {
      console.error(`\n  Failed page ${pageNum}`);
    }
  }
  console.log('\n  Done.');
}

async function main() {
  for (const book of VALID_PDFS) {
    console.log(`\n========================================`);
    console.log(`Processing: ${book.name}`);
    console.log(`========================================`);

    const pdfPath = path.join(PDF_BASE, book.pdf);
    
    if (!fs.existsSync(pdfPath)) {
      console.error(`PDF not found: ${pdfPath}`);
      continue;
    }

    const bookOutDir = path.join(OUTPUT_BASE, book.name);
    if (!fs.existsSync(bookOutDir)) fs.mkdirSync(bookOutDir, { recursive: true });

    const totalPages = getPageCount(pdfPath);
    console.log(`PDF has ${totalPages} pages`);
    
    renderPages(pdfPath, totalPages, bookOutDir, book.name);
  }

  console.log(`\n\nDone. Full-page renders saved to: ${OUTPUT_BASE}`);
}

main().catch(e => console.error(e));



