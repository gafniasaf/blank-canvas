#!/usr/bin/env npx tsx
/**
 * Generate styled TOC, Colofon pages for all books using the bundle templates
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const MATTER_DIR = path.join(OUTPUT_DIR, 'book_matter');

// Page dimensions (same as bundle)
const PAGE_WIDTH = 553;
const PAGE_HEIGHT = 751;
const SCALE = 2; // 2x for high resolution

interface TocItem {
  level: number;
  num: string;
  label: string;
  page: string;
}

interface TocData {
  bookId: string;
  title: string;
  items: TocItem[];
}

interface BookConfig {
  id: string;
  title: string;
  subtitle?: string;
  niveau: string;
  isbn: string;
}

const BOOKS: BookConfig[] = [
  { id: 'af4', title: 'Anatomie & Fysiologie', niveau: 'N4', isbn: '978-90-832513-7-0' },
  { id: 'communicatie', title: 'Communicatie', niveau: 'N3', isbn: '978-90-83251-38-7' },
  { id: 'wetgeving', title: 'Wetgeving', niveau: 'N3', isbn: '978-90-83412-06-1' },
  { id: 'persoonlijke_verzorging', title: 'Persoonlijke Verzorging', niveau: 'N3', isbn: '978-90-83412-02-3' },
  { id: 'klinisch_redeneren', title: 'Praktijkgestuurd Klinisch Redeneren', niveau: 'N4', isbn: '978-90-83412-03-0' },
  { id: 'methodisch_werken', title: 'Methodisch Werken', niveau: 'N3', isbn: '978-90-83251-39-4' },
  { id: 'pathologie', title: 'Pathologie', niveau: 'N4', isbn: '978-90-83412-01-6' },
];

function generateTocHtml(tocData: TocData, config: BookConfig, pageNum: number, totalPages: number): string {
  // Generate TOC items HTML
  const itemsHtml = tocData.items.map(item => {
    const cls = item.level === 1 ? 'chapter' : 'section';
    return `<div class="item ${cls}"><span class="num">${item.num}</span><span class="lbl">${escapeHtml(item.label)}</span><span class="pg">${item.page}</span></div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="nl">
<head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; }
body { background: white; font-family: 'Source Sans 3', sans-serif; }
.page { width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; display: flex; flex-direction: column; }
.header { background: #2d5a3d; padding: 22px 38px 28px; position: relative; flex-shrink: 0; }
.header h1 { font-family: 'Inter', sans-serif; font-size: 32px; font-weight: 700; color: white; }
.header::after { content: ''; position: absolute; bottom: -11px; left: 38px; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 11px solid #2d5a3d; }
.content { padding: 26px 28px 18px; flex: 1; column-count: 2; column-gap: 18px; column-fill: balance; }
.item { display: flex; align-items: baseline; line-height: 1.3; break-inside: avoid; }
.chapter { margin-top: 10px; margin-bottom: 3px; font-family: 'Inter', sans-serif; font-weight: 700; color: #1a365d; font-size: 9.5pt; }
.chapter:first-child { margin-top: 0; }
.section { font-size: 8pt; color: #1a1a1a; padding-left: 8px; }
.num { min-width: 24px; flex-shrink: 0; color: #4a5568; font-variant-numeric: tabular-nums; }
.lbl { flex: 1; padding-right: 4px; }
.pg { color: #4a5568; min-width: 24px; text-align: right; font-variant-numeric: tabular-nums; }
.footer { padding: 8px 28px; text-align: center; font-size: 8pt; color: #666; }
</style></head>
<body>
  <div class="page">
    <header class="header"><h1>Inhoudsopgave</h1></header>
    <div class="content">
${itemsHtml}
    </div>
    <div class="footer">${pageNum} / ${totalPages}</div>
  </div>
</body>
</html>`;
}

function generateColophonHtml(config: BookConfig): string {
  return `<!doctype html>
<html lang="nl">
<head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; }
body { background: white; font-family: 'Source Sans 3', sans-serif; font-size: 9pt; color: #1a1a1a; }
.page { width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; padding: 140px 38px 38px; }
h1 { font-family: 'Inter', sans-serif; font-size: 14pt; font-weight: 700; color: #1a365d; margin-bottom: 16px; }
.block { margin-bottom: 12px; line-height: 1.5; }
.label { font-weight: 600; color: #2d5a3d; }
.legal { margin-top: 24px; font-size: 8pt; color: #666; line-height: 1.4; text-align: left; }
</style></head>
<body>
  <div class="page">
    <h1>Colofon</h1>
    <div class="block">
      <span class="label">${escapeHtml(config.title)}</span><br>
      MBO Zorg
    </div>
    <div class="block">
      <span class="label">ISBN:</span> ${config.isbn}
    </div>
    <div class="block">
      <span class="label">Uitgeverij</span><br>
      ExpertCollege, Amsterdam (NL)
    </div>
    <div class="block">
      <span class="label">Redactie en samenstelling</span><br>
      ExpertCollege
    </div>
    <div class="block">
      <span class="label">Vormgeving en realisatie</span><br>
      ExpertCollege
    </div>
    <div class="block">
      <span class="label">Beeldrecht</span><br>
      Alle afbeeldingen zijn met zorg geselecteerd en geproduceerd. Voor overname van beeldmateriaal dient contact opgenomen te worden met de uitgever.
    </div>
    <div class="legal">
      © 2026 ExpertCollege. Alle rechten voorbehouden. Niets uit deze uitgave mag worden verveelvoudigd, opgeslagen in een geautomatiseerd gegevensbestand, of openbaar gemaakt, in enige vorm of op enige wijze, hetzij elektronisch, mechanisch, door fotokopieën, opnamen, of enige andere manier, zonder voorafgaande schriftelijke toestemming van de uitgever.
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderHtmlToPng(html: string, outputPath: string): Promise<void> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport to exact page size (no scaling in viewport, scale via deviceScaleFactor)
  await page.setViewport({
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    deviceScaleFactor: SCALE
  });
  
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  // Screenshot the full page at the viewport size
  await page.screenshot({
    path: outputPath,
    type: 'png',
  });
  
  await browser.close();
}

async function generateBookMatter(bookId: string): Promise<void> {
  const config = BOOKS.find(b => b.id === bookId);
  if (!config) {
    console.error(`Unknown book: ${bookId}`);
    return;
  }
  
  const bookDir = path.join(MATTER_DIR, bookId);
  fs.mkdirSync(bookDir, { recursive: true });

  // Clean previous outputs to avoid stale TOC pages when the page count changes
  // (e.g., TOC used to be 6 pages and becomes 4 pages; old toc_page_5/6 must be removed).
  try {
    for (const f of fs.readdirSync(bookDir)) {
      if (f.startsWith('toc_page_') && (f.endsWith('.png') || f.endsWith('.html'))) {
        try {
          fs.unlinkSync(path.join(bookDir, f));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  
  // Load TOC data - prefer _toc_with_pages.json which has section page numbers
  const withPagesPath = path.join(OUTPUT_DIR, `${bookId}_toc_with_pages.json`);
  const pdfTocPath = path.join(OUTPUT_DIR, `${bookId}_toc.json`);
  const fullTocPath = path.join(OUTPUT_DIR, `${bookId}_toc_full.json`);
  
  let tocData: TocData;
  
  if (fs.existsSync(withPagesPath)) {
    // Use pre-merged TOC with section pages
    tocData = JSON.parse(fs.readFileSync(withPagesPath, 'utf-8'));
    
    // Also merge chapter pages from PDF TOC
    if (fs.existsSync(pdfTocPath)) {
      const pdfData: TocData = JSON.parse(fs.readFileSync(pdfTocPath, 'utf-8'));
      const pageMap: Record<string, string> = {};
      for (const item of pdfData.items) {
        if (item.num && item.page) {
          pageMap[item.num] = item.page;
        }
      }
      for (const item of tocData.items) {
        if (!item.page && pageMap[item.num]) {
          item.page = pageMap[item.num];
        }
      }
    }
  } else if (fs.existsSync(fullTocPath) && fs.existsSync(pdfTocPath)) {
    // Merge: full structure + PDF page numbers
    const fullData: TocData = JSON.parse(fs.readFileSync(fullTocPath, 'utf-8'));
    const pdfData: TocData = JSON.parse(fs.readFileSync(pdfTocPath, 'utf-8'));
    
    const pageMap: Record<string, string> = {};
    for (const item of pdfData.items) {
      if (item.num && item.page) {
        pageMap[item.num] = item.page;
      }
    }
    
    for (const item of fullData.items) {
      if (pageMap[item.num]) {
        item.page = pageMap[item.num];
      }
    }
    
    tocData = fullData;
  } else if (fs.existsSync(pdfTocPath)) {
    tocData = JSON.parse(fs.readFileSync(pdfTocPath, 'utf-8'));
  } else if (fs.existsSync(fullTocPath)) {
    tocData = JSON.parse(fs.readFileSync(fullTocPath, 'utf-8'));
  } else {
    console.error(`TOC not found for ${bookId}`);
    return;
  }
  console.log(`\n=== ${bookId} ===`);
  console.log(`TOC items: ${tocData.items.length}`);
  
  // Split items into pages (approx 35-40 items per page for 2-column layout)
  const ITEMS_PER_PAGE = 38;
  const pages: TocItem[][] = [];
  
  for (let i = 0; i < tocData.items.length; i += ITEMS_PER_PAGE) {
    pages.push(tocData.items.slice(i, i + ITEMS_PER_PAGE));
  }
  
  const totalPages = pages.length;
  console.log(`Generating ${totalPages} TOC page(s)...`);
  
  // Generate each TOC page
  for (let pageNum = 0; pageNum < totalPages; pageNum++) {
    const pageItems = pages[pageNum];
    const pageData: TocData = { ...tocData, items: pageItems };
    
    const tocHtml = generateTocHtml(pageData, config, pageNum + 1, totalPages);
    const tocHtmlPath = path.join(bookDir, `toc_page_${pageNum + 1}.html`);
    const tocPngPath = path.join(bookDir, `toc_page_${pageNum + 1}.png`);
    
    fs.writeFileSync(tocHtmlPath, tocHtml);
    await renderHtmlToPng(tocHtml, tocPngPath);
    console.log(`  Saved: toc_page_${pageNum + 1}.png`);
  }
  
  // Generate Colophon
  const colophonHtml = generateColophonHtml(config);
  const colophonHtmlPath = path.join(bookDir, 'colophon.html');
  const colophonPngPath = path.join(bookDir, 'colophon.png');
  
  fs.writeFileSync(colophonHtmlPath, colophonHtml);
  console.log(`Rendering Colophon...`);
  await renderHtmlToPng(colophonHtml, colophonPngPath);
  console.log(`  Saved: ${colophonPngPath}`);
}

async function main(): Promise<void> {
  const bookId = process.argv[2];
  
  if (!bookId) {
    console.log('Available books:', BOOKS.map(b => b.id).join(', '));
    console.log('\nUsage: npx tsx generate-book-matter.ts <bookId>');
    console.log('       npx tsx generate-book-matter.ts all');
    process.exit(1);
  }
  
  fs.mkdirSync(MATTER_DIR, { recursive: true });
  
  const booksToProcess = bookId === 'all' ? BOOKS.map(b => b.id) : [bookId];
  
  for (const id of booksToProcess) {
    await generateBookMatter(id);
  }
  
  console.log(`\nDone! Output in: ${MATTER_DIR}`);
}

main().catch(console.error);

