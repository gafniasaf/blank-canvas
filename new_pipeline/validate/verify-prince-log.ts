/**
 * Verify Prince log for missing images and critical warnings.
 *
 * Usage:
 *   npx tsx new_pipeline/validate/verify-prince-log.ts <prince.log>
 */

import * as fs from 'fs';
import * as path from 'path';

function die(msg: string): never {
  console.error(`VERIFICATION FAILED: ${msg}`);
  process.exit(1);
}

function main() {
  const input = process.argv[2];
  if (!input) die('Usage: npx tsx new_pipeline/validate/verify-prince-log.ts <prince.log>');

  const p = path.resolve(input);
  if (!fs.existsSync(p)) die(`Log file not found: ${p}`);

  const log = fs.readFileSync(p, 'utf8');

  const badPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /can't open input file/i, label: "missing file (can't open input file)" },
    { re: /no such file or directory/i, label: 'missing file (no such file or directory)' },
    { re: /\bCSS error\b/i, label: 'CSS error' },
    { re: /\bfatal\b/i, label: 'fatal error' },
  ];

  const hits: string[] = [];
  for (const ptn of badPatterns) {
    if (ptn.re.test(log)) hits.push(ptn.label);
  }

  if (hits.length) {
    // Print context (first 40 lines) to help debugging
    const lines = log.split('\n').slice(0, 40).join('\n');
    die(`Prince log contains critical issues: ${Array.from(new Set(hits)).join(', ')}\n--- log head ---\n${lines}`);
  }

  console.log('✅ Prince log verification passed');
  console.log(`   file: ${p}`);
}

main();
































