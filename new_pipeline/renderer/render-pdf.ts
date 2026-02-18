/**
 * Professional PDF Renderer
 * 
 * Converts canonical JSON to professional textbook PDF
 * using Puppeteer with proper page layout.
 * 
 * Usage:
 *   npx tsx new_pipeline/renderer/render-pdf.ts <input.json> [--out output.pdf]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

import type { CanonicalBook, ParagraphBlock, SubparagraphBlock } from '../schema/canonical-schema.js';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =============================================================================
// Professional HTML Generation
// =============================================================================

function generateProfessionalHTML(book: CanonicalBook): string {
  const css = fs.readFileSync(path.resolve(__dirname, '../templates/textbook-professional.css'), 'utf8');
  
  let html = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(book.meta.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
${css}
  </style>
</head>
<body>
`;

  // Title Page
  html += `
  <div class="title-page">
    <div class="book-title">${escapeHtml(book.meta.title)}</div>
    <div class="book-subtitle">Anatomie & Fysiologie voor MBO Zorg</div>
    <div class="book-level">Niveau ${book.meta.level.toUpperCase()}</div>
    <div class="book-meta">
      ${book.meta.isbn ? `ISBN: ${escapeHtml(book.meta.isbn)}<br>` : ''}
      ${book.meta.publisher ? `${escapeHtml(book.meta.publisher)}<br>` : ''}
      ${book.meta.edition ? `${escapeHtml(book.meta.edition)}` : ''}
    </div>
  </div>
`;

  // Table of Contents
  html += `
  <div class="toc">
    <h1 class="toc-title">Inhoudsopgave</h1>
`;
  
  for (const chapter of book.chapters) {
    html += `
    <div class="toc-chapter">
      <a href="#chapter-${chapter.number}" class="toc-chapter-link">
        <span class="toc-number">${escapeHtml(chapter.number)}</span>
        <span>${escapeHtml(chapter.title)}</span>
      </a>
      <div class="toc-section-list">
`;
    for (const section of chapter.sections) {
      html += `
        <a href="#section-${section.number}" class="toc-section-link">
          <span class="toc-number">${escapeHtml(section.number)}</span>
          <span>${section.title ? escapeHtml(section.title) : ''}</span>
        </a>
`;
    }
    html += `
      </div>
    </div>
`;
  }
  
  html += `
  </div>
`;

  // Chapters
  for (const chapter of book.chapters) {
    html += `
  <div class="chapter" id="chapter-${chapter.number}">
    <div class="chapter-opener">
      <div class="chapter-label">Hoofdstuk</div>
      <div class="chapter-number" data-title="Hoofdstuk ${chapter.number} — ${escapeHtml(chapter.title)}">${chapter.number}</div>
      <h1 class="chapter-title">${escapeHtml(chapter.title)}</h1>
    </div>
`;

    for (const section of chapter.sections) {
      html += `
    <section class="section" id="section-${section.number}">
      <h2 class="section-header">
        <span class="section-number">${escapeHtml(section.number)}</span>
        ${section.title ? `<span class="section-title">${escapeHtml(section.title)}</span>` : ''}
      </h2>
`;

      for (const block of section.content) {
        if (block.type === 'paragraph') {
          html += renderParagraphBlock(block);
        } else if (block.type === 'subparagraph') {
          html += renderSubparagraphBlock(block);
        }
      }

      html += `
    </section>
`;
    }

    html += `
  </div>
`;
  }

  // Colophon
  html += `
  <div class="colophon">
    <div class="colophon-text">
      <strong>${escapeHtml(book.meta.title)}</strong><br><br>
      Gegenereerd met New Pipeline<br>
      ${new Date(book.export.exportedAt).toLocaleDateString('nl-NL', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}<br><br>
      Schema versie: ${book.export.schemaVersion}
    </div>
  </div>
`;

  html += `
</body>
</html>`;

  return html;
}

function renderParagraphBlock(block: ParagraphBlock): string {
  let html = `
      <div class="paragraph-block">
        <p class="basis-text">${escapeHtml(block.basis)}</p>
`;

  if (block.praktijk && block.praktijk.trim()) {
    html += `
        <aside class="praktijk-block">
          <div class="praktijk-header">
            <svg class="praktijk-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <span class="praktijk-label">In de praktijk</span>
          </div>
          <p class="praktijk-text">${escapeHtml(block.praktijk)}</p>
        </aside>
`;
  }

  if (block.verdieping && block.verdieping.trim()) {
    html += `
        <aside class="verdieping-block">
          <div class="verdieping-header">
            <svg class="verdieping-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
            </svg>
            <span class="verdieping-label">Verdieping</span>
          </div>
          <p class="verdieping-text">${escapeHtml(block.verdieping)}</p>
        </aside>
`;
  }

  html += `
      </div>
`;
  return html;
}

function renderSubparagraphBlock(block: SubparagraphBlock): string {
  let html = `
      <div class="subparagraph" id="subparagraph-${block.number}">
        <h3 class="subparagraph-header">
          ${escapeHtml(block.number)}${block.title ? ` ${escapeHtml(block.title)}` : ''}
        </h3>
`;

  for (const p of block.content) {
    html += renderParagraphBlock(p);
  }

  html += `
      </div>
`;
  return html;
}

// =============================================================================
// PDF Rendering with Headers/Footers
// =============================================================================

async function renderPDF(html: string, outputPath: string, book: CanonicalBook): Promise<void> {
  console.log('🚀 Launching Puppeteer...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  
  try {
    const page = await browser.newPage();
    
    console.log('📄 Loading HTML content...');
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    
    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('📝 Generating PDF with headers and footers...');
    
    const chapterTitle = book.chapters[0]?.title || book.meta.title;
    
    await page.pdf({
      path: outputPath,
      width: '195mm',
      height: '265mm',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width: 100%; font-size: 8pt; font-family: 'Inter', 'Helvetica', sans-serif; color: #666; padding: 0 20mm; display: flex; justify-content: space-between;">
          <span class="pageNumber"></span>
          <span style="text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">${escapeHtml(chapterTitle)}</span>
          <span></span>
        </div>
      `,
      footerTemplate: `
        <div style="width: 100%; font-size: 9pt; font-family: 'Inter', 'Helvetica', sans-serif; color: #666; padding: 0 20mm; text-align: center;">
          <span class="pageNumber"></span>
        </div>
      `,
      margin: {
        top: '30mm',
        right: '20mm',
        bottom: '25mm',
        left: '25mm',
      },
    });
    
    console.log(`✅ PDF saved to: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npx tsx render-pdf.ts <input.json> [--out output.pdf] [--html-only]');
    process.exit(1);
  }
  
  const outArg = getArg('--out');
  const htmlOnly = process.argv.includes('--html-only');
  
  // Resolve paths
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`❌ Input file not found: ${resolvedInput}`);
    process.exit(1);
  }
  
  // Load canonical JSON
  console.log(`📖 Loading canonical JSON: ${resolvedInput}`);
  const bookJson = fs.readFileSync(resolvedInput, 'utf8');
  const book = JSON.parse(bookJson) as CanonicalBook;
  
  // Count content
  let totalParagraphs = 0;
  let withPraktijk = 0;
  let withVerdieping = 0;
  
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const block of section.content) {
        if (block.type === 'paragraph') {
          totalParagraphs++;
          if (block.praktijk) withPraktijk++;
          if (block.verdieping) withVerdieping++;
        } else if (block.type === 'subparagraph') {
          for (const p of block.content) {
            totalParagraphs++;
            if (p.praktijk) withPraktijk++;
            if (p.verdieping) withVerdieping++;
          }
        }
      }
    }
  }
  
  console.log(`   Title: ${book.meta.title}`);
  console.log(`   Level: ${book.meta.level.toUpperCase()}`);
  console.log(`   Chapters: ${book.chapters.length}`);
  console.log(`   Paragraphs: ${totalParagraphs}`);
  console.log(`   With praktijk: ${withPraktijk}`);
  console.log(`   With verdieping: ${withVerdieping}`);
  
  // Generate professional HTML
  console.log('🔄 Generating professional HTML...');
  const html = generateProfessionalHTML(book);
  
  // Determine output paths
  const baseName = path.basename(resolvedInput, '.json');
  const outputDir = path.resolve(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Save HTML
  const htmlPath = path.join(outputDir, `${baseName}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`✅ HTML saved to: ${htmlPath}`);
  
  if (htmlOnly) {
    console.log('🏁 HTML-only mode, skipping PDF generation');
    return;
  }
  
  // Render PDF
  const pdfPath = outArg ? path.resolve(outArg) : path.join(outputDir, `${baseName}.pdf`);
  await renderPDF(html, pdfPath, book);
  
  console.log('\n🎉 Rendering complete!');
}

main().catch((err) => {
  console.error('❌ Render failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
