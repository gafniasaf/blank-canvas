// verify-json-coverage.ts
//
// Usage: npx tsx scripts/verify-json-coverage.ts <path_to_coverage_tsv> [optional: path_to_rewrites_json]
//
// Goals:
// 1. Read the JSON coverage TSV produced by the rewrite pipeline.
// 2. Calculate coverage stats per section (paragraph_number).
// 3. HARD FAIL if critical sections (like 1.4) have 0% coverage.
// 4. Warn if total coverage is below threshold (e.g. 90%).

import * as fs from 'fs';
import * as path from 'path';

interface CoverageRow {
  paragraph_id: string;
  chapter: string;
  paragraph_number: string;
  style_name: string;
  used_count: number;
  original_snippet: string;
  rewritten_snippet: string;
}

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

function parseTsv(content: string): CoverageRow[] {
  // Normalize line endings to \n
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0]!.split('\t').map(h => h.trim());
  const rows: CoverageRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const cols = line.split('\t');
    const row: any = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] || '';
    });
    // Type conversion
    row.used_count = parseInt(row.used_count || '0', 10);
    rows.push(row as CoverageRow);
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const coveragePath = process.argv[2];
  if (!coveragePath || !fs.existsSync(coveragePath)) {
    console.error("Usage: verify-json-coverage.ts <path_to_coverage_tsv>");
    process.exit(1);
  }

  console.log(`Verifying coverage: ${coveragePath}`);
  const content = fs.readFileSync(coveragePath, 'latin1'); // Use latin1 as ExtendScript output isn't always UTF-8
  const rows = parseTsv(content);

  const chapterArg = typeof args.chapter === 'string' ? String(args.chapter).trim() : '';
  const targetChapter = chapterArg;

  // If the caller specifies a target chapter, ensure we didn't accidentally apply rewrites outside it.
  if (targetChapter) {
    const otherUsed = rows.filter((r) => r.used_count > 0 && String(r.chapter || '').trim() !== targetChapter);
    if (otherUsed.length) {
      console.error(`❌ CRITICAL FAILURE: rewrites applied outside requested chapter=${targetChapter}. count=${otherUsed.length}`);
      console.error(`❌ VERIFICATION FAILED: Chapter scoping leaked.`);
      process.exit(1);
    }
  }

  const scopedRows = targetChapter ? rows.filter((r) => String(r.chapter || '').trim() === targetChapter) : rows;

  if (targetChapter) {
    console.log(`Target chapter: ${targetChapter}`);
    console.log(`Rows in target chapter: ${scopedRows.length}`);
  }

  const total = scopedRows.length;
  const used = scopedRows.filter((r) => r.used_count > 0).length;
  const coveragePct = total > 0 ? (used / total) * 100 : 0;

  console.log(`Total paragraphs: ${total}`);
  console.log(`Used paragraphs:  ${used}`);
  console.log(`Coverage:         ${coveragePct.toFixed(1)}%`);

  // Group by chapter.paragraph_number (Section key)
  const bySection: Record<string, { total: number; used: number }> = {};
  scopedRows.forEach((r) => {
    const ch = String(r.chapter || '').trim();
    const pn = String(r.paragraph_number || '').trim();
    const sec = ch && pn ? `${ch}.${pn}` : pn || ch || 'unknown';
    if (!bySection[sec]) bySection[sec] = { total: 0, used: 0 };
    bySection[sec]!.total++;
    if (r.used_count > 0) bySection[sec]!.used++;
  });

  let failed = false;
  const MIN_SECTION_COVERAGE_PCT = 10; // at least 10% of a section must match to be considered "present"

  console.log("\n--- Section Coverage ---");
  for (const [sec, stats] of Object.entries(bySection)) {
    const pct = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;
    const status = pct >= MIN_SECTION_COVERAGE_PCT ? "OK" : "FAIL";
    console.log(`Section ${sec}: ${stats.used}/${stats.total} (${pct.toFixed(1)}%) - ${status}`);

    if (pct < MIN_SECTION_COVERAGE_PCT) {
      console.error(`❌ CRITICAL FAILURE: Section ${sec} has critically low coverage (<${MIN_SECTION_COVERAGE_PCT}%).`);
      failed = true;
    }
  }

  // Check strict basis style coverage (usually main body text)
  const basisRows = scopedRows.filter((r) => String(r.style_name || '').includes('Basis'));
  if (basisRows.length > 0) {
    const basisUsed = basisRows.filter((r) => r.used_count > 0).length;
    const basisPct = (basisUsed / basisRows.length) * 100;
    console.log(`\nBasis Style Coverage: ${basisUsed}/${basisRows.length} (${basisPct.toFixed(1)}%)`);
    if (basisPct < 50) {
       console.error(`❌ CRITICAL FAILURE: 'Basis' style coverage is too low (<50%).`);
       failed = true;
    }
  }

  if (failed) {
    console.error("\n❌ VERIFICATION FAILED: Some sections are missing or not matching.");
    process.exit(1);
  } else {
    console.log("\n✅ VERIFICATION PASSED: All sections have acceptable coverage.");
    process.exit(0);
  }
}

main();

