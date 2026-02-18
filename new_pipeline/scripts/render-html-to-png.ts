/**
 * Render a single HTML page to a PNG at a fixed physical page size.
 *
 * This is used for "matter" pages (TOC / colofon / voorwoord / begrippenlijst)
 * that are authored in HTML and then embedded into the final PDF as images.
 *
 * Usage:
 *   npx tsx new_pipeline/scripts/render-html-to-png.ts \
 *     --input  /abs/path/page.html \
 *     --out    /abs/path/page.png \
 *     --width-mm 195 --height-mm 265 --dpi 300 \
 *     --wait-selector "body.ready"
 *
 * Notes:
 * - Prefer `--selector` when the HTML contains multiple pages (e.g. Paged.js output)
 *   and you want to screenshot a specific element like `.pagedjs_page[data-page-number="2"]`.
 */

import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function getNumArg(flag: string, fallback: number): number {
  const raw = getArg(flag);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function mmToPx(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

async function main() {
  const input = getArg('--input');
  const out = getArg('--out');

  if (!input || !out) {
    console.error(
      'Usage: npx tsx new_pipeline/scripts/render-html-to-png.ts --input <page.html> --out <page.png> ' +
        '[--width-mm 195 --height-mm 265 --dpi 300 --selector <css> --wait-selector <css> --wait-ms 0]'
    );
    process.exit(1);
  }

  const widthMm = getNumArg('--width-mm', 195);
  const heightMm = getNumArg('--height-mm', 265);
  const dpi = getNumArg('--dpi', 300);
  const waitMs = getNumArg('--wait-ms', 0);
  const selector = getArg('--selector');
  const waitSelector = getArg('--wait-selector');

  const absIn = path.resolve(input);
  const absOut = path.resolve(out);

  if (!fs.existsSync(absIn)) {
    console.error(`❌ Input HTML not found: ${absIn}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  const widthPx = mmToPx(widthMm, dpi);
  const heightPx = mmToPx(heightMm, dpi);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: widthPx, height: heightPx, deviceScaleFactor: 1 });

    // Use file:// so relative assets resolve naturally.
    const url = `file://${absIn}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    // Wait for fonts (best-effort).
    try {
      await page.evaluateHandle('document.fonts && document.fonts.ready');
    } catch {
      // ignore
    }

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 120_000 });
    }

    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, Math.floor(waitMs)));
    }

    if (selector) {
      const el = await page.$(selector);
      if (!el) {
        console.error(`❌ Selector not found: ${selector}`);
        process.exit(1);
      }
      await el.screenshot({ path: absOut, type: 'png' });
    } else {
      await page.screenshot({ path: absOut, type: 'png' });
    }

    console.log(`✅ PNG saved: ${absOut}`);
    console.log(`   size: ${widthPx}x${heightPx}px (@${dpi} DPI, ${widthMm}x${heightMm}mm)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌ render-html-to-png failed:', err?.message || String(err));
  process.exit(1);
});




