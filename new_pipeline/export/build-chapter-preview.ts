/**
 * Build a deterministic "chapter preview" JSON for fast human review.
 *
 * What it does:
 * - Slice a canonical Prince JSON down to a single chapter, and optionally up to a section number
 *   (useful for "first half of chapter" previews).
 * - Apply a tiny deterministic "flow polish" pass to improve readability in 2-column layout:
 *   - Split overlong text blocks (by inserting blank lines "\n\n" at sentence boundaries)
 *   - Fix trailing colons that look like list-intros when no list follows (":" -> ".")
 *
 * Usage:
 *   npx tsx new_pipeline/export/build-chapter-preview.ts <input.json> --out <out.json> --chapter 1 --until-section 1.2
 *
 * Optional:
 *   --max-words 80 --target-words 55 --min-words 35
 */

import * as fs from 'fs';
import * as path from 'path';

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function parseNumParts(s: string): number[] {
  const parts = String(s || '')
    .trim()
    .split('.')
    .filter(Boolean)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
  return parts.length ? parts : [Number.NaN];
}

function cmpNumParts(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

const MICRO_ANY_RE = /<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>/gu;
const BOLD_MARKERS_RE = /<<BOLD_START>>|<<BOLD_END>>/g;

function normWhitespace(s: string): string {
  return String(s || '').replace(/\r/g, '\n');
}

function wordCount(s: string): number {
  const t = normWhitespace(s)
    .replace(BOLD_MARKERS_RE, '')
    .replace(MICRO_ANY_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 0;
  return t.split(' ').length;
}

function indexAfterNthWord(s: string, n: number): number {
  // Return a character index that is just after the nth word (0-based n).
  // Fallback: end of string.
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(s)) !== null) {
    count++;
    if (count >= n) return re.lastIndex;
  }
  return s.length;
}

function splitLongTextDeterministically(textRaw: string, opts: { maxWords: number; targetWords: number; minWords: number }): string[] {
  let s = normWhitespace(textRaw).trim();
  if (!s) return [];

  const out: string[] = [];
  const boundaryRe = /([.!?])\s+/g;

  while (wordCount(s) > opts.maxWords) {
    const candidates: Array<{ score: number; idx: number; wc: number }> = [];
    boundaryRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = boundaryRe.exec(s)) !== null) {
      const idx = m.index + String(m[1]).length; // include punctuation, exclude following whitespace
      const before = s.slice(0, idx);
      const wc = wordCount(before);
      if (wc < opts.minWords) continue;
      if (wc > opts.maxWords) continue;
      const score = Math.abs(wc - opts.targetWords) * 10 + (opts.maxWords - wc); // prefer close to target, slightly prefer longer
      candidates.push({ score, idx, wc });
    }

    let cutIdx: number | null = null;
    if (candidates.length) {
      candidates.sort((a, b) => a.score - b.score);
      cutIdx = candidates[0]!.idx;
    } else {
      // Fallback: hard split at maxWords word boundary
      cutIdx = indexAfterNthWord(s, opts.maxWords);
    }

    const before = s.slice(0, cutIdx).trim();
    if (before) out.push(before);
    s = s.slice(cutIdx).trim();
  }

  if (s) out.push(s);
  return out;
}

function flowPolishBasisPreservingMicro(raw: string, opts: { maxWords: number; targetWords: number; minWords: number }): { out: string; splits: number } {
  const s = normWhitespace(raw);
  let last = 0;
  let splits = 0;
  let out = '';

  MICRO_ANY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MICRO_ANY_RE.exec(s)) !== null) {
    const before = s.slice(last, m.index);
    const parts = splitLongTextDeterministically(before, opts);
    if (parts.length > 1) splits += parts.length - 1;
    out += (out ? '\n\n' : '') + parts.join('\n\n').trim();
    // Keep marker as-is
    out += (out.endsWith('\n\n') || !out ? '' : ' ') + m[0];
    last = m.index + m[0].length;
  }

  const tail = s.slice(last);
  const tailParts = splitLongTextDeterministically(tail, opts);
  if (tailParts.length > 1) splits += tailParts.length - 1;
  if (tailParts.length) out += (out ? '\n\n' : '') + tailParts.join('\n\n').trim();

  // Cleanup: avoid excessive blank lines
  out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n').trim();
  return { out, splits };
}

function isLikelySemicolonListParagraph(p: any): boolean {
  const hint = String(p?.styleHint || '').toLowerCase();
  if (!hint.includes('bullets') && !hint.includes('numbered')) return false;
  const raw = String(p?.basis || '');
  if (!raw.includes(';')) return false;
  const items = raw
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  return items.length >= 2;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      'Usage: npx tsx new_pipeline/export/build-chapter-preview.ts <input.json> --out <out.json> --chapter 1 --until-section 1.2'
    );
    process.exit(1);
  }

  const outArg = getArg('--out');
  if (!outArg) {
    console.error('Missing required --out <out.json>');
    process.exit(1);
  }

  const chapter = String(getArg('--chapter') || '').trim();
  if (!chapter) {
    console.error('Missing required --chapter <number>');
    process.exit(1);
  }

  const untilSection = String(getArg('--until-section') || '').trim();
  const untilParts = untilSection ? parseNumParts(untilSection) : null;

  const maxWords = Math.max(30, parseInt(String(getArg('--max-words') || '80'), 10) || 80);
  const targetWords = Math.max(20, parseInt(String(getArg('--target-words') || '55'), 10) || 55);
  const minWords = Math.max(15, parseInt(String(getArg('--min-words') || '35'), 10) || 35);

  const inAbs = path.resolve(inputPath);
  const outAbs = path.resolve(outArg);
  const book = JSON.parse(fs.readFileSync(inAbs, 'utf8')) as any;

  const ch = (book?.chapters || []).find((c: any) => String(c?.number || '') === chapter);
  if (!ch) {
    console.error(`❌ Chapter not found: ${chapter}`);
    process.exit(1);
  }

  const chOut = JSON.parse(JSON.stringify(ch)) as any;
  if (untilParts) {
    chOut.sections = (chOut.sections || []).filter((s: any) => {
      const sNum = String(s?.number || '').trim();
      if (!sNum) return false;
      return cmpNumParts(parseNumParts(sNum), untilParts) <= 0;
    });
  }

  // Flow polish: iterate subparagraph blocks in-order.
  let stats = { paragraphsTouched: 0, splitsInserted: 0, trailingColonsFixed: 0 };

  for (const sec of chOut.sections || []) {
    for (const sp of sec.content || []) {
      if (sp?.type !== 'subparagraph') continue;
      const content = Array.isArray(sp.content) ? sp.content : [];

      for (let i = 0; i < content.length; i++) {
        const b = content[i];
        if (!b || b.type !== 'paragraph') continue;

        let basis = String(b.basis ?? '');
        if (!basis.trim()) continue;

        // Fix trailing colon when no list follows.
        const trimmed = basis.trim();
        if (trimmed.endsWith(':')) {
          const next = content[i + 1];
          const nextIsList = next && (next.type === 'list' || next.type === 'steps' || isLikelySemicolonListParagraph(next));
          if (!nextIsList) {
            basis = trimmed.replace(/:\s*$/, '.') + '\n';
            stats.trailingColonsFixed++;
          }
        }

        // Split overlong blocks, preserving micro-title markers.
        const { out, splits } = flowPolishBasisPreservingMicro(basis, { maxWords, targetWords, minWords });
        if (splits > 0) {
          stats.splitsInserted += splits;
        }
        if (out !== basis) stats.paragraphsTouched++;
        b.basis = out;
      }
    }
  }

  const outBook = { ...book, chapters: [chOut] };
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(outBook, null, 2), 'utf8');

  console.log('✅ Built chapter preview');
  console.log(`   in:     ${inAbs}`);
  console.log(`   out:    ${outAbs}`);
  console.log(`   chapter:${chapter}`);
  if (untilSection) console.log(`   until:  ${untilSection}`);
  console.log(`   flow:   maxWords=${maxWords} target=${targetWords} min=${minWords}`);
  console.log(
    `   stats:  paragraphsTouched=${stats.paragraphsTouched} splitsInserted=${stats.splitsInserted} trailingColonsFixed=${stats.trailingColonsFixed}`
  );
}

main().catch((err) => {
  console.error('❌ build-chapter-preview failed:', err?.message || String(err));
  process.exit(1);
});
































