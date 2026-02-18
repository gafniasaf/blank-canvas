/**
 * End-to-end fixture test for the Prince pipeline (no DB required).
 *
 * Generates a deterministic fixture canonical JSON, renders a PDF with Prince,
 * and runs the key validations we rely on for real books.
 *
 * Usage (from repo root):
 *   cd new_pipeline
 *   npm run test:fixture
 */

import { spawnSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

function run(cmd: string, args: string[]) {
  const shown = `${cmd} ${args.join(' ')}`;
  const res = spawnSync(cmd, args, { cwd: PIPELINE_ROOT, stdio: 'inherit', env: process.env });
  if (res.status !== 0) die(`Command failed: ${shown}`);
}

function main() {
  const outJson = 'output/fixture_book.json';
  const outPdf = 'output/fixture_book.pdf';
  const outLog = 'output/fixture_book_prince.log';
  const outHtml = 'output/fixture_book_prince.html';

  // 1) Generate fixture JSON
  run('tsx', ['fixtures/generate-fixture-book.ts', '--out', path.join('new_pipeline', outJson)]);

  // 2) Render PDF
  run('tsx', ['renderer/render-prince-pdf.ts', outJson, '--out', outPdf, '--log', outLog]);

  // 3) Validate Prince log + HTML structure
  run('tsx', ['validate/verify-prince-log.ts', outLog]);
  run('tsx', ['validate/verify-no-hard-linebreaks.ts', outHtml]);
  run('tsx', ['validate/verify-html-anchors.ts', outHtml]);
  run('python3', ['validate/verify-no-heading-hyphenation.py', outPdf]);
  run('python3', ['validate/verify-bullet-orphan-split.py', outPdf, '--ignore-first', '0', '--ignore-last', '1']);
  run('python3', ['validate/verify-justify-gaps.py', outPdf, '--ignore-first', '0', '--ignore-last', '1']);

  // 4) Layout gates (use the same policy knobs as whole-book runs)
  run('python3', [
    'validate/verify-page-fill.py',
    outPdf,
    '--min-used',
    '0.50',
    '--ignore-first',
    '0',
    '--ignore-last',
    '1',
    '--ignore-before-level1',
    '--ignore-before-first-chapter',
  ]);
  run('python3', [
    'validate/verify-column-balance.py',
    outPdf,
    '--ignore-first',
    '0',
    '--ignore-last',
    '1',
    '--ignore-before-level1',
    '--ignore-before-first-chapter',
  ]);
  run('python3', ['validate/verify-box-justify-gaps.py', outPdf, '--max-gap-pt', '12', '--ignore-first', '0']);

  console.log('✅ Fixture pipeline test passed');
  console.log(`   pdf: ${path.resolve(PIPELINE_ROOT, outPdf)}`);
}

main();


