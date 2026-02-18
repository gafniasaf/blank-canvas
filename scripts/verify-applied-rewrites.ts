/**
 * verify-applied-rewrites.ts
 *
 * Goal:
 * - Prove that the rewrite engine actually applied the intended JSON `rewritten` content
 *   by comparing fingerprints in `rewrite_v5_safe_replaced_detailed.tsv` against the JSON.
 *
 * Usage:
 *   npx ts-node scripts/verify-applied-rewrites.ts <path_to_replaced_detailed_tsv> <path_to_rewrites_json>
 *
 * Notes:
 * - This expects the TSV to include the columns: paragraph_id, after_key.
 * - `after_key` must be computed by the InDesign script using the same normalization as here.
 */

import fs from 'node:fs';
import path from 'node:path';

type RewritesJson = {
  paragraphs?: Array<{
    paragraph_id?: string;
    rewritten?: string;
  }>;
};

function trimmed(s: string): string {
  return String(s ?? '').trim();
}

function splitSemicolonItems(text: string): string[] {
  const s = String(text ?? '');
  const raw = s.split(';');
  const endsWithSemi = s.endsWith(';');
  const items: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const part = String(raw[i] ?? '').trim();
    if (!part) continue;
    if (i < raw.length - 1) items.push(`${part};`);
    else items.push(endsWithSemi ? `${part};` : part);
  }
  return items;
}

function splitLayerBlocks(text: string): { base: string; tail: string } {
  const s = String(text ?? '');
  const markers = [
    '<<BOLD_START>>In de praktijk:<<BOLD_END>>',
    '<<BOLD_START>>Verdieping:<<BOLD_END>>',
    '<<BOLD_START>>Achtergrond:<<BOLD_END>>',
  ];
  let idx = -1;
  for (const m of markers) {
    const i = s.indexOf(m);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return { base: s, tail: '' };
  let cut = idx;
  // Mirror ExtendScript behavior: if marker is preceded by \n\n, keep those newlines with the tail.
  if (cut >= 2 && s[cut - 1] === '\n' && s[cut - 2] === '\n') cut -= 2;
  return { base: s.slice(0, cut), tail: s.slice(cut) };
}

function mergeTwoRewrites(primary: string, secondary: string): string {
  // Mirror the Osmose+Solution merge order in scripts/rewrite-from-original-safe-v5.jsx:
  // primary.base + secondary.base + secondary.tail + primary.tail
  const p = splitLayerBlocks(primary);
  const s = splitLayerBlocks(secondary);
  let merged = trimmed(p.base);
  const sBase = trimmed(s.base);
  if (sBase) merged = merged ? `${merged}\n\n${sBase}` : sBase;
  const sTail = trimmed(s.tail);
  if (sTail) merged = merged ? `${merged}\n\n${sTail}` : sTail;
  const pTail = trimmed(p.tail);
  if (pTail) merged = merged ? `${merged}\n\n${pTail}` : pTail;
  return merged;
}

function cleanText(text: string): string {
  let s = String(text ?? '');
  // Match ExtendScript cleanText() behavior (scripts/rewrite-from-original-safe-v5.jsx)
  s = s.replace(/<\?ACE\s*\d*\s*\?>/gi, '');
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  s = s.replace(/\u00AD/g, '');
  s = s.replace(/<<BOLD_START>>/g, '');
  s = s.replace(/<<BOLD_END>>/g, '');
  s = s.replace(/\uFFFC/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function normalizeFull(text: string): string {
  if (!text) return '';
  let s = String(text).toLowerCase();
  s = s.replace(/[\r\n\t]/g, ' ');
  // Fold common diacritics (match the ExtendScript implementation)
  s = s.replace(/[àáâãäå]/g, 'a');
  s = s.replace(/æ/g, 'ae');
  s = s.replace(/ç/g, 'c');
  s = s.replace(/[èéêë]/g, 'e');
  s = s.replace(/[ìíîï]/g, 'i');
  s = s.replace(/ñ/g, 'n');
  s = s.replace(/[òóôõöø]/g, 'o');
  s = s.replace(/œ/g, 'oe');
  s = s.replace(/[ùúûü]/g, 'u');
  s = s.replace(/[ýÿ]/g, 'y');
  s = s.replace(/ß/g, 'ss');
  // Replace punctuation with spaces to keep word boundaries stable
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (32-bit overflow)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const hex = (h >>> 0).toString(16);
  return ('00000000' + hex).slice(-8);
}

function buildKey(text: string): string {
  const n = normalizeFull(cleanText(text));
  if (!n) return '';
  return `${n.length}:${fnv1a32(n)}`;
}

function parseTsv(tsvPath: string): { header: string[]; rows: Array<Record<string, string>> } {
  const raw = fs.readFileSync(tsvPath, 'latin1'); // ExtendScript output isn't always UTF-8
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { header: [], rows: [] };

  const header = lines[0]!.split('\t');
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split('\t');
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]!] = cols[j] ?? '';
    rows.push(row);
  }
  return { header, rows };
}

function main() {
  const tsvPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const jsonPath = process.argv[3] ? path.resolve(process.argv[3]) : '';
  if (!tsvPath || !jsonPath) {
    console.error('Usage: npx ts-node scripts/verify-applied-rewrites.ts <replaced_detailed.tsv> <rewrites_for_indesign.json>');
    process.exit(1);
  }
  if (!fs.existsSync(tsvPath)) {
    console.error(`❌ Not found: ${tsvPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ Not found: ${jsonPath}`);
    process.exit(1);
  }

  const { header, rows } = parseTsv(tsvPath);
  const requiredCols = ['paragraph_id', 'after_key', 'matchType'];
  for (const c of requiredCols) {
    if (!header.includes(c)) {
      console.error(`❌ TSV missing required column '${c}'. Re-run rewrite engine with updated scripts/rewrite-from-original-safe-v5.jsx`);
      process.exit(1);
    }
  }

  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as RewritesJson;
  const paras = json.paragraphs ?? [];
  const byId = new Map<string, string>();
  for (const p of paras) {
    const id = String(p.paragraph_id ?? '').trim();
    if (!id) continue;
    byId.set(id, String(p.rewritten ?? ''));
  }

  // Group TSV rows by paragraph_id (some JSON entries intentionally apply to multiple InDesign paragraphs,
  // e.g. semicolon-separated bullet lists are split into individual bullet paragraphs).
  const tsvById = new Map<string, Array<Record<string, string>>>();
  for (const r of rows) {
    const pid = String(r.paragraph_id ?? '').trim();
    const afterKey = String(r.after_key ?? '').trim();
    if (!pid) continue;
    if (!afterKey) continue;
    const arr = tsvById.get(pid) ?? [];
    arr.push(r);
    tsvById.set(pid, arr);
  }

  let checked = 0;
  let missingInJson = 0;
  let mismatches = 0;
  let fuzzyMatches = 0;
  const mismatchSamples: string[] = [];

  for (const [pid, group] of tsvById.entries()) {
    // Hard gate: fuzzy matches are not allowed.
    // They are a last-resort heuristic and have caused silent misplacements (wrong paragraph gets rewritten)
    // even while after_key-based verification passes. With the two-pass rewrite engine, fuzzy should be 0.
    for (const r of group) {
      const mt = String(r.matchType ?? '').trim();
      if (mt === 'fuzzy') {
        fuzzyMatches++;
        if (mismatchSamples.length < 10) {
          const page = String(r.page ?? '').trim();
          const storyIndex = String(r.storyIndex ?? '').trim();
          const paraIndex = String(r.paraIndex ?? '').trim();
          mismatchSamples.push(`pid=${pid} matchType=fuzzy page=${page} storyIndex=${storyIndex} paraIndex=${paraIndex}`);
        }
      }
    }

    const rewritten = byId.get(pid);
    if (rewritten === undefined) {
      missingInJson++;
      if (mismatchSamples.length < 10) mismatchSamples.push(`missing_json_id=${pid}`);
      continue;
    }

    const afterKeys = group.map((r) => String(r.after_key ?? '').trim()).filter(Boolean);
    if (afterKeys.length === 0) continue;

    // Multi-apply case: the JSON rewritten text is semicolon-separated, but InDesign has one paragraph per item.
    if (afterKeys.length > 1) {
      const items = splitSemicolonItems(rewritten);
      if (items.length !== afterKeys.length) {
        mismatches++;
        if (mismatchSamples.length < 10) {
          mismatchSamples.push(
            `pid=${pid} multi_apply_count=${afterKeys.length} expected_items=${items.length} (semicolon split mismatch)`
          );
        }
        continue;
      }

      // Multiset compare of expected item keys vs observed after_keys.
      const expectedCounts = new Map<string, number>();
      for (const it of items) {
        const k = buildKey(it);
        expectedCounts.set(k, (expectedCounts.get(k) ?? 0) + 1);
      }

      let ok = true;
      for (const ak of afterKeys) {
        const n = expectedCounts.get(ak) ?? 0;
        if (n <= 0) { ok = false; break; }
        expectedCounts.set(ak, n - 1);
      }

      checked += afterKeys.length;
      if (!ok) {
        mismatches++;
        if (mismatchSamples.length < 10) {
          mismatchSamples.push(`pid=${pid} multi_apply_expected_items_do_not_match_observed_keys`);
        }
      }
      continue;
    }

    // Single-apply case: fingerprint must match the whole rewritten paragraph.
    const expectedKey = buildKey(rewritten);
    const afterKey = afterKeys[0]!;
    checked++;
    if (expectedKey !== afterKey) {
      // Merge case: some baseline paragraphs combine multiple JSON paragraphs into one InDesign paragraph.
      // The rewrite engine may merge the rewrite text and log the primary paragraph_id plus an also_used_paragraph_id.
      const also = String(group[0]?.also_used_paragraph_id ?? '').trim();
      if (also) {
        const secondary = byId.get(also);
        if (secondary !== undefined) {
          const merged = mergeTwoRewrites(rewritten, secondary);
          const expectedMergedKey = buildKey(merged);
          if (expectedMergedKey === afterKey) continue;
        }
      }
      mismatches++;
      if (mismatchSamples.length < 10) {
        mismatchSamples.push(`pid=${pid} expected_key=${expectedKey} after_key=${afterKey}`);
      }
    }
  }

  console.log(`Verify applied rewrites:`);
  console.log(`TSV:   ${tsvPath}`);
  console.log(`JSON:  ${jsonPath}`);
  console.log(`Rows:  ${rows.length}`);
  console.log(`Checked rows (have paragraph_id + after_key): ${checked}`);
  console.log(`Fuzzy matches (hard-fail): ${fuzzyMatches}`);
  console.log(`Missing paragraph_id in JSON: ${missingInJson}`);
  console.log(`Mismatches: ${mismatches}`);
  if (mismatchSamples.length) {
    console.log('');
    console.log('Samples:');
    for (const s of mismatchSamples) console.log(`- ${s}`);
  }

  if (fuzzyMatches || missingInJson || mismatches) {
    console.error('❌ VERIFY FAILED');
    process.exit(1);
  }
  console.log('✅ VERIFY PASSED');
}

main();


