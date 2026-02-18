/**
 * Fail if the generated Prince HTML contains <br> inside body paragraphs (<p class="p...">).
 * This is a strong guardrail: forced line breaks prevent normal justification and create
 * "one sentence per line" blocks.
 *
 * Usage:
 *   tsx validate/verify-no-hard-linebreaks.ts output/canonical_ch1_with_figures_prince.html
 */

import * as fs from 'fs';
import * as path from 'path';

function usage(): never {
  console.error('Usage: tsx validate/verify-no-hard-linebreaks.ts <htmlFile>');
  process.exit(1);
}

function main() {
  const htmlPathArg = process.argv[2];
  if (!htmlPathArg) usage();

  const htmlPath = path.resolve(htmlPathArg);
  if (!fs.existsSync(htmlPath)) {
    console.error(`❌ HTML file not found: ${htmlPath}`);
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');

  // Find any <p class="p ..."> ... <br> ... </p>
  const re = /<p class="p[^"]*">[\s\S]*?<br>[\s\S]*?<\/p>/g;
  const matches = html.match(re) || [];

  if (matches.length > 0) {
    console.error(`❌ Found ${matches.length} <p class="p..."> paragraph(s) containing <br>.`);
    console.error('   This breaks normal justification and usually indicates hard-wrapped source text.');
    console.error(`   file: ${htmlPath}`);

    const maxExamples = 5;
    for (let i = 0; i < Math.min(maxExamples, matches.length); i++) {
      const m = matches[i]!;
      const oneLine = m.replace(/\s+/g, ' ').trim();
      console.error(`   - example ${i + 1}: ${oneLine.slice(0, 240)}${oneLine.length > 240 ? '…' : ''}`);
    }

    process.exit(1);
  }

  console.log(`✅ No <br> found inside <p class="p..."> paragraphs.`);
  console.log(`   file: ${htmlPath}`);
}

main();
































