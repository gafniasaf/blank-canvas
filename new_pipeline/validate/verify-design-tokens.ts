/**
 * Verify presence and sanity of extracted design tokens.
 *
 * Usage:
 *   npx tsx new_pipeline/validate/verify-design-tokens.ts [design_tokens.json]
 */

import * as fs from 'fs';
import * as path from 'path';

function die(msg: string): never {
  console.error(`VERIFICATION FAILED: ${msg}`);
  process.exit(1);
}

function isNum(x: any): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function ensureNum(x: any, label: string) {
  if (!isNum(x)) die(`${label} must be a number`);
}

function main() {
  const input = process.argv[2] || 'new_pipeline/extract/design_tokens.json';
  const p = path.resolve(input);
  if (!fs.existsSync(p)) die(`Tokens file not found: ${p}`);

  const t = JSON.parse(fs.readFileSync(p, 'utf8'));

  if (!t.meta) die('meta missing');
  if (!t.page) die('page missing');
  if (!t.marginsAndColumns) die('marginsAndColumns missing');

  ensureNum(t.page.widthMm, 'page.widthMm');
  ensureNum(t.page.heightMm, 'page.heightMm');

  const L = t.marginsAndColumns.left;
  const R = t.marginsAndColumns.right;
  if (!L || !R) die('marginsAndColumns.left/right missing');

  for (const side of ['left', 'right'] as const) {
    const m = t.marginsAndColumns[side];
    for (const k of ['topMm', 'bottomMm', 'leftMm', 'rightMm', 'columnGutterMm'] as const) {
      ensureNum(m[k], `marginsAndColumns.${side}.${k}`);
    }
    ensureNum(m.columnCount, `marginsAndColumns.${side}.columnCount`);
    if (m.columnCount < 1 || m.columnCount > 4) die(`marginsAndColumns.${side}.columnCount out of range: ${m.columnCount}`);
    if (m.columnCount >= 2 && m.columnGutterMm <= 0) die(`marginsAndColumns.${side}.columnGutterMm must be > 0 for multi-column layout`);
  }

  // Baseline grid is optional but recommended
  if (t.baselineGrid) {
    const d = t.baselineGrid.baselineDivisionMm;
    if (d !== null && d !== undefined && !isNum(d)) die('baselineGrid.baselineDivisionMm must be number|null');
  }

  console.log('✅ Design tokens verification passed');
  console.log(`   file: ${p}`);
  console.log(`   page: ${t.page.widthMm}mm x ${t.page.heightMm}mm`);
  console.log(`   columns: ${L.columnCount} (gutter ${L.columnGutterMm}mm)`);
  if (t.meta.layoutMasterSelf || t.meta.layoutMasterName) {
    console.log(`   layout master: ${t.meta.layoutMasterSelf || ''} ${t.meta.layoutMasterName || ''}`.trim());
  }
}

main();
































