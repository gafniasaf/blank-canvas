/**
 * Promote a reviewed + preflighted rewrites JSON to ~/Desktop/rewrites_for_indesign.json (with backup).
 *
 * Usage:
 *   ts-node scripts/promote-rewrites-for-indesign.ts <jsonPath>
 *
 * This is the explicit “human approved” gate before running InDesign scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  lintRewritesForIndesignJsonParagraphs,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';

type JsonShape = { paragraphs?: RewritesForIndesignParagraph[] };

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
  if (!inPath) {
    console.error('Usage: ts-node scripts/promote-rewrites-for-indesign.ts <jsonPath> [--mode prince|indesign]');
    process.exit(1);
  }
  if (!fs.existsSync(inPath)) {
    console.error(`❌ Not found: ${inPath}`);
    process.exit(1);
  }

  const modeRaw = typeof args.mode === 'string' ? String(args.mode).trim().toLowerCase() : '';
  const mode: RewriteLintMode = modeRaw === 'indesign' ? 'indesign' : 'prince';

  // Strong guardrail: run the full preflight (unit tests + JSON lint) before promotion.
  // This keeps promotion as the explicit "green gate" step before any InDesign apply runs.
  {
    const r = spawnSync('npm', ['run', 'preflight:json', '--', inPath, '--mode', mode], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  let data: JsonShape | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`❌ Invalid JSON: ${inPath}`);
    process.exit(1);
  }

  const paras = data?.paragraphs || [];
  if (!Array.isArray(paras) || paras.length === 0) {
    console.error('❌ Invalid shape: expected { paragraphs: [...] }');
    process.exit(1);
  }

  // Preflight checks (hard-stop)
  for (const p of paras) {
    const v = validateCombinedRewriteText(String(p.rewritten || ''));
    if (v.errors.length) {
      console.error(`❌ Preflight failed for paragraph ${String(p.paragraph_id || '')}: ${v.errors.join(' | ')}`);
      process.exit(1);
    }
  }
  const cross = lintRewritesForIndesignJsonParagraphs(paras, { mode });
  if (cross.errors.length) {
    console.error(`❌ Preflight failed: ${cross.errors[0]}`);
    process.exit(1);
  }

  const home = process.env.HOME || '';
  const outPath = path.join(home, 'Desktop', 'rewrites_for_indesign.json');
  const backup = path.join(home, 'Desktop', `rewrites_for_indesign.backup_${Date.now()}.json`);

  if (fs.existsSync(outPath)) fs.copyFileSync(outPath, backup);
  fs.copyFileSync(inPath, outPath);

  console.log(`✅ Promoted to: ${outPath}`);
  if (fs.existsSync(backup)) console.log(`   Backup: ${backup}`);
  console.log(`   Source: ${inPath}`);
  console.log(`   Paragraphs: ${paras.length}`);
}

main();



