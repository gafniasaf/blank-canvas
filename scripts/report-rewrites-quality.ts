/**
 * Generate a quick quality report for a rewrites_for_indesign*.json file.
 *
 * Why:
 * - During whole-book runs we want a deterministic snapshot of “is this safe / how far are we?”
 * - This is NOT a stylistic reviewer; it reports structural hygiene, empties, and lint signals.
 *
 * Usage:
 *   ts-node scripts/report-rewrites-quality.ts [inJson] --out <outJson> [--mode prince|indesign] [--md <outMd>]
 *
 * Defaults:
 *   in:  ~/Desktop/rewrites_for_indesign.json
 *   out: <in>.quality.json
 */
import fs from 'node:fs';
import path from 'node:path';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  PR_MARKER,
  VE_MARKER,
  isBulletStyleName,
  lintRewritesForIndesignJsonParagraphs,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';

type JsonShape = {
  book_title?: string;
  upload_id?: string;
  generated_at?: string;
  fixed_at?: string;
  paragraphs: RewritesForIndesignParagraph[];
};

type ChapterStats = {
  chapter: string;
  paragraphs: number;
  empty_rewrites: number;
  merged_away: number;
  unchanged: number;
  changed: number;
  bullet_style_paras: number;
  bullet_to_prose_estimate: number;
  with_praktijk: number;
  with_verdieping: number;
  per_paragraph_validation_errors: number;
  per_paragraph_validation_warnings: number;
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

function normForCompare(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function formatNum(p: RewritesForIndesignParagraph): string {
  const ch = String(p.chapter || '');
  const pn = p.paragraph_number ?? '';
  const sp = p.subparagraph_number !== undefined ? String(p.subparagraph_number ?? '') : '';
  return [ch, pn, sp].filter((x) => String(x).length > 0).join('.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = process.env.HOME || '';

  const inPath = process.argv[2] && !process.argv[2].startsWith('--')
    ? path.resolve(process.argv[2])
    : typeof args.in === 'string'
      ? path.resolve(String(args.in))
      : path.join(home, 'Desktop', 'rewrites_for_indesign.json');

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

  const outPath = typeof args.out === 'string'
    ? path.resolve(String(args.out))
    : inPath.endsWith('.json')
      ? inPath.replace(/\.json$/i, '.quality.json')
      : `${inPath}.quality.json`;

  const mdPath = typeof args.md === 'string' ? path.resolve(String(args.md)) : '';

  const byChapter = new Map<string, ChapterStats>();
  const emptySamples: Array<{ paragraph_id: string; num: string; style: string }> = [];
  const validationErrSamples: Array<{ paragraph_id: string; num: string; errors: string[] }> = [];

  for (const p of data.paragraphs) {
    const ch = String(p.chapter || '').trim() || 'UNKNOWN';
    if (!byChapter.has(ch)) {
      byChapter.set(ch, {
        chapter: ch,
        paragraphs: 0,
        empty_rewrites: 0,
        merged_away: 0,
        unchanged: 0,
        changed: 0,
        bullet_style_paras: 0,
        bullet_to_prose_estimate: 0,
        with_praktijk: 0,
        with_verdieping: 0,
        per_paragraph_validation_errors: 0,
        per_paragraph_validation_warnings: 0,
      });
    }
    const s = byChapter.get(ch)!;
    s.paragraphs++;

    const pid = String(p.paragraph_id || '').trim();
    const style = String(p.style_name || '');
    const o = String(p.original || '');
    const r = String(p.rewritten || '');

    const mergedAway = (p as any)?._merged_away === true;
    if (mergedAway) s.merged_away++;

    const oTrim = o.trim();
    const rTrim = r.trim();
    const emptyRewrite = !!oTrim && !rTrim && !mergedAway;
    if (emptyRewrite) {
      s.empty_rewrites++;
      if (pid && emptySamples.length < 25) emptySamples.push({ paragraph_id: pid, num: formatNum(p), style });
    }

    const unchanged = normForCompare(o) === normForCompare(r);
    if (unchanged) s.unchanged++;
    else s.changed++;

    const hasPr = r.includes(PR_MARKER);
    const hasVe = r.includes(VE_MARKER);
    if (hasPr) s.with_praktijk++;
    if (hasVe) s.with_verdieping++;

    if (isBulletStyleName(style)) {
      s.bullet_style_paras++;
      const oHasSemi = o.includes(';');
      const rHasSemi = r.includes(';');
      if (oHasSemi && !rHasSemi && rTrim.length > 0) s.bullet_to_prose_estimate++;
    }

    const v = validateCombinedRewriteText(r);
    if (v.errors.length) {
      s.per_paragraph_validation_errors += v.errors.length;
      if (pid && validationErrSamples.length < 25) validationErrSamples.push({ paragraph_id: pid, num: formatNum(p), errors: v.errors });
    }
    if (v.warnings.length) s.per_paragraph_validation_warnings += v.warnings.length;
  }

  // Cross-paragraph lint (contract-ish)
  const cross = lintRewritesForIndesignJsonParagraphs(data.paragraphs, { mode });

  const chapters = Array.from(byChapter.values()).sort((a, b) => Number(a.chapter) - Number(b.chapter));
  const totals = chapters.reduce(
    (acc, c) => {
      acc.paragraphs += c.paragraphs;
      acc.empty_rewrites += c.empty_rewrites;
      acc.merged_away += c.merged_away;
      acc.unchanged += c.unchanged;
      acc.changed += c.changed;
      acc.bullet_style_paras += c.bullet_style_paras;
      acc.bullet_to_prose_estimate += c.bullet_to_prose_estimate;
      acc.with_praktijk += c.with_praktijk;
      acc.with_verdieping += c.with_verdieping;
      acc.per_paragraph_validation_errors += c.per_paragraph_validation_errors;
      acc.per_paragraph_validation_warnings += c.per_paragraph_validation_warnings;
      return acc;
    },
    {
      paragraphs: 0,
      empty_rewrites: 0,
      merged_away: 0,
      unchanged: 0,
      changed: 0,
      bullet_style_paras: 0,
      bullet_to_prose_estimate: 0,
      with_praktijk: 0,
      with_verdieping: 0,
      per_paragraph_validation_errors: 0,
      per_paragraph_validation_warnings: 0,
    }
  );

  const report = {
    in_path: inPath,
    mode,
    book_title: data.book_title || '',
    upload_id: data.upload_id || '',
    generated_at: data.generated_at || '',
    fixed_at: data.fixed_at || '',
    totals: {
      ...totals,
      cross_lint_errors: cross.errors.length,
      cross_lint_warnings: cross.warnings.length,
    },
    by_chapter: chapters,
    samples: {
      empty_rewrites: emptySamples,
      per_paragraph_validation_errors: validationErrSamples,
      cross_lint_errors: cross.errors.slice(0, 25),
      cross_lint_warnings: cross.warnings.slice(0, 25),
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`✅ Wrote rewrites quality report: ${outPath}`);
  console.log(
    `   totals: paragraphs=${totals.paragraphs} empty_rewrites=${totals.empty_rewrites} merged_away=${totals.merged_away} ` +
      `cross_errors=${cross.errors.length} cross_warnings=${cross.warnings.length}`
  );

  if (mdPath) {
    const lines: string[] = [];
    lines.push(`# Rewrites quality report`);
    lines.push('');
    lines.push(`- **input**: \`${inPath}\``);
    lines.push(`- **mode**: \`${mode}\``);
    if (data.generated_at) lines.push(`- **generated_at**: \`${data.generated_at}\``);
    if (data.fixed_at) lines.push(`- **fixed_at**: \`${data.fixed_at}\``);
    lines.push('');
    lines.push(`## Totals`);
    lines.push('');
    lines.push(`- **paragraphs**: ${totals.paragraphs}`);
    lines.push(`- **empty_rewrites**: ${totals.empty_rewrites}`);
    lines.push(`- **merged_away**: ${totals.merged_away}`);
    lines.push(`- **cross_lint**: errors=${cross.errors.length} warnings=${cross.warnings.length}`);
    lines.push('');
    lines.push(`## By chapter`);
    lines.push('');
    lines.push(`| ch | paras | empty | merged_away | unchanged | changed | bullets | bullets→prose* | pr | ve | vErr | vWarn |`);
    lines.push(`|---:|------:|------:|-----------:|----------:|--------:|-------:|-------------:|---:|---:|-----:|------:|`);
    for (const c of chapters) {
      lines.push(
        `| ${c.chapter} | ${c.paragraphs} | ${c.empty_rewrites} | ${c.merged_away} | ${c.unchanged} | ${c.changed} | ${c.bullet_style_paras} | ${c.bullet_to_prose_estimate} | ${c.with_praktijk} | ${c.with_verdieping} | ${c.per_paragraph_validation_errors} | ${c.per_paragraph_validation_warnings} |`
      );
    }
    lines.push('');
    lines.push(`\\* bullets→prose is a heuristic estimate (bullet-style + semicolon-list → non-semicolon rewrite).`);
    lines.push('');
    if (cross.errors.length) {
      lines.push(`## Cross-lint errors (first 25)`);
      lines.push('');
      for (const e of cross.errors.slice(0, 25)) lines.push(`- ${e}`);
      lines.push('');
    }
    if (cross.warnings.length) {
      lines.push(`## Cross-lint warnings (first 25)`);
      lines.push('');
      for (const w of cross.warnings.slice(0, 25)) lines.push(`- ${w}`);
      lines.push('');
    }
    fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
    console.log(`✅ Wrote markdown report: ${mdPath}`);
  }
}

main();
































