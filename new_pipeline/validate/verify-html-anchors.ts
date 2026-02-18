/**
 * Validate generated Prince HTML for basic anchor integrity:
 * - All href="#id" targets exist as id="id"
 * - No duplicate ids
 *
 * Usage:
 *   npx tsx new_pipeline/validate/verify-html-anchors.ts <htmlPath>
 */

import * as fs from 'fs';
import * as path from 'path';

function die(msg: string): never {
  console.error(`❌ HTML anchor verification failed: ${msg}`);
  process.exit(2);
}

function main() {
  const input = process.argv[2];
  if (!input) die('Usage: npx tsx new_pipeline/validate/verify-html-anchors.ts <htmlPath>');

  const p = path.resolve(input);
  if (!fs.existsSync(p)) die(`HTML not found: ${p}`);

  const html = fs.readFileSync(p, 'utf8');

  const idRe = /\bid\s*=\s*"([^"]+)"/g;
  const hrefRe = /\bhref\s*=\s*"#([^"]+)"/g;

  const idCounts = new Map<string, number>();
  for (;;) {
    const m = idRe.exec(html);
    if (!m) break;
    const id = String(m[1] || '').trim();
    if (!id) continue;
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }

  const duplicateIds = Array.from(idCounts.entries())
    .filter(([, n]) => n > 1)
    .map(([id, n]) => `${id}×${n}`);
  if (duplicateIds.length) {
    die(`Duplicate ids detected (${duplicateIds.length}): ${duplicateIds.slice(0, 20).join(', ')}${duplicateIds.length > 20 ? ' ...' : ''}`);
  }

  const missingTargets: string[] = [];
  const seenHref = new Set<string>();
  for (;;) {
    const m = hrefRe.exec(html);
    if (!m) break;
    const id = String(m[1] || '').trim();
    if (!id) continue;
    if (seenHref.has(id)) continue;
    seenHref.add(id);
    if (!idCounts.has(id)) missingTargets.push(id);
  }

  if (missingTargets.length) {
    die(
      `Missing href targets (${missingTargets.length}): ${missingTargets.slice(0, 30).join(', ')}${
        missingTargets.length > 30 ? ' ...' : ''
      }`
    );
  }

  console.log('✅ HTML anchor verification passed');
  console.log(`   file: ${p}`);
  console.log(`   ids: ${idCounts.size}`);
  console.log(`   href_targets: ${seenHref.size}`);
}

main();
































