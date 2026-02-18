
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkLayout() {
  // Use the HTML file we generated for Prince
  // __dirname is .../new_pipeline
  const htmlPath = path.resolve(__dirname, 'output/canonical_ch1_quickwins_prince.html');
  const cssPath = path.resolve(__dirname, 'templates/prince-af-two-column.css');
  
  if (!fs.existsSync(htmlPath)) {
    console.error('HTML file not found:', htmlPath);
    process.exit(1);
  }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport to roughly A4 size
  await page.setViewport({ width: 794, height: 1123 }); // ~96 DPI A4

  // Load content
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  
  // Inject CSS manually to ensure it's applied
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  await page.addStyleTag({ content: cssContent });

  // Evaluate the layout of images
  const results = await page.evaluate(() => {
    const figures = Array.from(document.querySelectorAll('figure.figure-block'));
    const body = document.querySelector('.chapter-body');
    const bodyWidth = body ? body.getBoundingClientRect().width : 0;
    
    return figures.map((fig, index) => {
      const rect = fig.getBoundingClientRect();
      const img = fig.querySelector('img');
      const imgRect = img ? img.getBoundingClientRect() : null;
      const imgStyle = img ? img.getAttribute('style') : '';
      const parent = fig.parentElement;
      
      return {
        index,
        figureWidth: rect.width,
        figureHeight: rect.height,
        imgWidth: imgRect ? imgRect.width : 0,
        imgStyle,
        parentTag: parent ? parent.tagName : 'unknown',
        bodyWidth, // Reference width
        isFullWidth: fig.classList.contains('full-width'),
        computedStyle: window.getComputedStyle(fig).columnSpan
      };
    });
  });

  console.log('--- Layout Analysis ---');
  console.log(`Chapter Body Width: ${results[0]?.bodyWidth}px`);
  
  results.forEach(r => {
    // Filter for our target image if possible, or just log interesting ones
    const style = r.imgStyle || '';
    const toMM = (px) => (px * 25.4 / 96).toFixed(1);
    
    if (style.includes('150mm') || r.index < 3) {
      console.log(`\nFigure #${r.index + 1}:`);
      console.log(`  Container Width: ${r.figureWidth}px (${toMM(r.figureWidth)}mm)`);
      console.log(`  Image Width:     ${r.imgWidth}px (${toMM(r.imgWidth)}mm)`);
      console.log(`  Style:           ${style}`);
      console.log(`  Parent:          ${r.parentTag}`);
      console.log(`  Full Width?:     ${r.isFullWidth}`);
      console.log(`  Column Span:     ${r.computedStyle}`); 
    }
  });

  await browser.close();
}

checkLayout();

