/**
 * lint-rewrites.ts
 *
 * CLI wrapper for deterministic text linting ("ESLint for text").
 *
 * Usage:
 *   npx ts-node scripts/lint-rewrites.ts <input.json> [--chapter N] [--output lint-report.json]
 */

import fs from 'node:fs';
import path from 'node:path';

import { lintParagraphs, type TextLintIssue, type TextLintParagraph } from '../src/lib/textLint';

type LintReport = {
  input_file: string;
  chapter_filter: string | null;
  timestamp: string;
  total_paragraphs: number;
  issues: TextLintIssue[];
  summary: {
    errors: number;
    warnings: number;
    by_rule: Record<string, number>;
  };
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
  const args = process.argv.slice(2);
  const flags = parseArgs(args);

  const inputPath = args.find((a) => !a.startsWith('--')) || '';
  if (!inputPath) {
    console.error('Usage: npx ts-node scripts/lint-rewrites.ts <input.json> [--chapter N] [--output report.json]');
    process.exit(1);
  }

  const chapterFilter = typeof flags.chapter === 'string' ? String(flags.chapter) : null;
  const outputPath = typeof flags.output === 'string' ? String(flags.output) : inputPath.replace(/\.json$/i, '.lint-report.json');

  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw);
  let paragraphs: TextLintParagraph[] = Array.isArray(data.paragraphs) ? data.paragraphs : [];

  if (chapterFilter) {
    paragraphs = paragraphs.filter((p) => String(p.chapter) === chapterFilter);
  }

  console.log(`\n📋 LINTING: ${path.basename(inputPath)}`);
  console.log(`   Paragraphs: ${paragraphs.length}`);
  console.log(`   Chapter filter: ${chapterFilter || 'all'}\n`);

  const issues = lintParagraphs(paragraphs);

  const byRule: Record<string, number> = {};
  for (const it of issues) byRule[it.rule] = (byRule[it.rule] || 0) + 1;

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const report: LintReport = {
    input_file: inputPath,
    chapter_filter: chapterFilter,
    timestamp: new Date().toISOString(),
    total_paragraphs: paragraphs.length,
    issues,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      by_rule: byRule,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('═'.repeat(60));
  console.log('LINT REPORT');
  console.log('═'.repeat(60));
  console.log(`❌ Errors:   ${errors.length}`);
  console.log(`⚠️  Warnings: ${warnings.length}`);
  console.log('');
  console.log('By rule:');
  for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    const sev = issues.find((i) => i.rule === rule)?.severity || '?';
    const icon = sev === 'error' ? '❌' : '⚠️';
    console.log(`  ${icon} ${rule}: ${count}`);
  }
  console.log('');
  console.log(`Report saved to: ${outputPath}`);

  if (errors.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('SAMPLE ERRORS (first 5):');
    console.log('─'.repeat(60));
    for (const e of errors.slice(0, 5)) {
      console.log(`\n[${e.rule}] ${e.section}`);
      console.log(`  ${e.message}`);
      console.log(`  Evidence: "${e.evidence}"`);
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main();






























