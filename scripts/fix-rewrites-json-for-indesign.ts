/**
 * Deterministic fix-ups for rewrites_for_indesign*.json BEFORE InDesign.
 *
 * IMPORTANT:
 * - Never modify `original` (used for matching).
 * - Never introduce '\\r' (paragraph breaks). Keep '\\n' only.
 *
 * Usage:
 *   ts-node scripts/fix-rewrites-json-for-indesign.ts [inJsonPath] [outJsonPath]
 *
 * Defaults:
 *   in:  ~/Desktop/rewrites_for_indesign.json
 *   out: ~/Desktop/rewrites_for_indesign.FIXED_DRAFT.json
 */
import fs from 'node:fs';
import path from 'node:path';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  lintRewritesForIndesignJsonParagraphs,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';
import { applyDeterministicFixesToParagraphs } from '../src/lib/indesign/rewritesForIndesignFixes';

type JsonShape = {
  book_title?: string;
  upload_id?: string;
  layer?: string;
  chapter_filter?: string | null;
  generated_at?: string;
  total_paragraphs?: number;
  generation_warnings?: any;
  paragraphs: RewritesForIndesignParagraph[];
  fixed_at?: string;
  fixed_by?: string;
  fix_warnings?: any;
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
  const inPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(home, 'Desktop', 'rewrites_for_indesign.json');
  const outPath = process.argv[3] && !process.argv[3].startsWith('--')
    ? path.resolve(process.argv[3])
    : path.join(home, 'Desktop', 'rewrites_for_indesign.FIXED_DRAFT.json');

  const modeRaw = typeof args.mode === 'string' ? String(args.mode).trim().toLowerCase() : '';
  const mode: RewriteLintMode = modeRaw === 'indesign' ? 'indesign' : 'prince';

  if (!fs.existsSync(inPath)) {
    console.error(`❌ Not found: ${inPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  const data = JSON.parse(raw) as JsonShape;
  if (!data || !Array.isArray(data.paragraphs)) {
    console.error('❌ Invalid JSON: expected { paragraphs: [...] }');
    process.exit(1);
  }

  const paras = data.paragraphs;
  const { moves, punctuation_changed, list_intro_restored, heading_spacing_normalized } = applyDeterministicFixesToParagraphs(paras, { mode });

  // Validate per paragraph
  for (const p of paras) {
    const v = validateCombinedRewriteText(String(p.rewritten || ''));
    if (v.errors.length) {
      throw new Error(`Fix output failed validation for paragraph ${String(p.paragraph_id || '')}: ${v.errors.join(' | ')}`);
    }
    if (String(p.rewritten || '').includes('\r')) {
      throw new Error(`Fix output contains \\r for paragraph ${String(p.paragraph_id || '')}`);
    }
  }

  // Validate cross-paragraph structure
  const cross = lintRewritesForIndesignJsonParagraphs(paras, { mode });
  if (cross.errors.length) {
    throw new Error(`Fix output failed JSON-level lint: ${cross.errors[0]}`);
  }

  const out: JsonShape = {
    ...data,
    fixed_at: new Date().toISOString(),
    fixed_by: 'scripts/fix-rewrites-json-for-indesign.ts',
    fix_warnings: {
      moved_layer_blocks_count: moves.length,
      moved_layer_blocks: moves,
      punctuation_changed,
      list_intro_restored,
      heading_spacing_normalized,
    },
    paragraphs: paras,
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✅ Wrote fixed draft: ${outPath}`);
  console.log(`   moved_layer_blocks=${moves.length} punctuation_changed=${punctuation_changed}`);
}

main();



