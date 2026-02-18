/**
 * Preflight for rewrites_for_indesign*.json BEFORE running any InDesign apply scripts.
 *
 * This is a guardrail: it fails fast on known structural mistakes that would
 * otherwise show up as “kapotte opbouw” in the INDD output.
 *
 * Usage:
 *   ts-node scripts/preflight-rewrites-json.ts [pathToJson]
 *
 * Default:
 *   ~/Desktop/rewrites_for_indesign.json
 */
import fs from 'node:fs';
import path from 'node:path';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  lintRewritesForIndesignJsonParagraphs,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';

type JsonShape = {
  paragraphs?: RewritesForIndesignParagraph[];
};

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
  const home = process.env.HOME || '';
  const inPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(home, 'Desktop', 'rewrites_for_indesign.json');
  const modeRaw = typeof args.mode === 'string' ? String(args.mode).trim().toLowerCase() : '';
  const mode: RewriteLintMode = modeRaw === 'indesign' ? 'indesign' : 'prince';

  if (!fs.existsSync(inPath)) {
    console.error(`❌ Not found: ${inPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  let data: JsonShape | null = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`❌ Invalid JSON: ${inPath}`);
    process.exit(1);
  }

  const paras = data?.paragraphs || [];
  if (!Array.isArray(paras) || paras.length === 0) {
    console.error('❌ Invalid shape: expected { paragraphs: [...] }');
    process.exit(1);
  }

  let errCount = 0;
  let warnCount = 0;

  for (const p of paras) {
    const pid = String(p.paragraph_id || '');
    const ch = String(p.chapter || '');
    const pn = String(p.paragraph_number ?? '');
    const sp = p.subparagraph_number !== undefined ? String(p.subparagraph_number ?? '') : '';
    const num = [ch, pn, sp].filter(Boolean).join('.');

    const v = validateCombinedRewriteText(String(p.rewritten || ''));
    if (v.errors.length) {
      errCount++;
      console.error(`❌ [${pid}] ${num}: ${v.errors.join(' | ')}`);
    }
    if (v.warnings.length) warnCount += v.warnings.length;
  }

  const cross = lintRewritesForIndesignJsonParagraphs(paras, { mode });
  for (const e of cross.errors) {
    errCount++;
    console.error(`❌ ${e}`);
  }
  warnCount += cross.warnings.length;

  if (warnCount) console.log(`⚠️ Warnings: ${warnCount}`);
  if (errCount) {
    console.error(`❌ PRE-FLIGHT FAILED: errors=${errCount}`);
    process.exit(1);
  }

  console.log(`✅ PRE-FLIGHT OK: paragraphs=${paras.length} warnings=${warnCount}`);
}

main();



