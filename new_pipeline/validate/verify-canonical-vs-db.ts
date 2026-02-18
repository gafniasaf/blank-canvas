/**
 * Verify canonical JSON matches DB paragraph coverage and (optionally) ordering.
 *
 * Usage:
 *   npx tsx new_pipeline/validate/verify-canonical-vs-db.ts <canonical.json> [--upload <uuid>] [--chapter 1]
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

type AnyObj = Record<string, any>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment from book-insight-craft-main
const envPath = '/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/.env';
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function getArgInt(flag: string): number | null {
  const v = getArg(flag);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function die(msg: string): never {
  console.error(`VERIFICATION FAILED: ${msg}`);
  process.exit(1);
}

function getDbUrl(): string {
  return (
    process.env.DATABASE_URL ||
    `postgres://${encodeURIComponent(process.env.DB_USER || 'postgres')}:${encodeURIComponent(
      process.env.DB_PASSWORD || 'postgres'
    )}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '54322'}/${process.env.DB_NAME || 'postgres'}`
  );
}

function isHeaderStyle(styleName: string | null): boolean {
  const s = String(styleName || '').toLowerCase();
  return s.includes('header') || s.includes('hoofdstuk') || s.includes('titel');
}

function collectBlockIds(chapter: AnyObj): string[] {
  const ids: string[] = [];
  for (const section of chapter.sections || []) {
    for (const block of section.content || []) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'paragraph' || block.type === 'list' || block.type === 'steps') {
        if (block.id) ids.push(String(block.id));
      } else if (block.type === 'subparagraph') {
        for (const inner of block.content || []) {
          if (!inner || typeof inner !== 'object') continue;
          if (inner.type === 'paragraph' || inner.type === 'list' || inner.type === 'steps') {
            if (inner.id) ids.push(String(inner.id));
          }
        }
      }
    }
  }
  return ids;
}

function scanTextHygiene(obj: any, pathStr = 'root', errors: string[] = []) {
  if (obj === null || obj === undefined) return errors;
  if (typeof obj === 'string') {
    if (obj.includes('\u00AD')) errors.push(`Soft hyphen found at ${pathStr}`);
    // Control chars except \n and \t
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(obj)) errors.push(`Control chars found at ${pathStr}`);
    return errors;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) scanTextHygiene(obj[i], `${pathStr}[${i}]`, errors);
    return errors;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) scanTextHygiene(obj[k], `${pathStr}.${k}`, errors);
  }
  return errors;
}

async function main() {
  const input = process.argv[2];
  if (!input) die('Usage: npx tsx new_pipeline/validate/verify-canonical-vs-db.ts <canonical.json> [--upload <uuid>] [--chapter 1]');

  const jsonPath = path.resolve(input);
  if (!fs.existsSync(jsonPath)) die(`Canonical JSON not found: ${jsonPath}`);

  const book = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as AnyObj;
  if (!book.meta || !book.chapters) die('Invalid canonical JSON: missing meta/chapters');

  const uploadId = getArg('--upload') || String(book.meta.id || '');
  if (!uploadId) die('Missing upload id (use --upload or ensure book.meta.id exists)');

  const chapterArg = getArgInt('--chapter');
  const chapter = chapterArg
    ? (book.chapters || []).find((c: AnyObj) => String(c.number) === String(chapterArg))
    : (book.chapters || []).length === 1
      ? book.chapters[0]
      : null;

  if (!chapter) die('Cannot determine chapter to validate (use --chapter, or provide a single-chapter canonical JSON)');

  // Basic title presence checks
  for (const sec of chapter.sections || []) {
    if (!sec.title || !String(sec.title).trim()) die(`Missing section title for ${sec.number}`);
  }
  for (const sec of chapter.sections || []) {
    for (const block of sec.content || []) {
      if (block.type === 'subparagraph') {
        if (!block.title || !String(block.title).trim()) die(`Missing subparagraph title for ${block.number}`);
      }
    }
  }

  // Text hygiene scan
  const hygieneErrors = scanTextHygiene(book);
  if (hygieneErrors.length) {
    die(`Text hygiene failed:\n- ${hygieneErrors.slice(0, 25).join('\n- ')}${hygieneErrors.length > 25 ? `\n...and ${hygieneErrors.length - 25} more` : ''}`);
  }

  const ids = collectBlockIds(chapter);
  if (ids.length === 0) die('No content block ids found in canonical chapter');

  const dup: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.push(id);
    else seen.add(id);
  }
  if (dup.length) die(`Duplicate block ids in canonical JSON (first 10): ${dup.slice(0, 10).join(', ')}`);

  // Fetch expected DB ids
  const { Pool } = pg;
  const pool = new Pool({ connectionString: getDbUrl(), max: 3, idleTimeoutMillis: 10_000 });
  try {
    const chNum = String(chapter.number);
    const res = await pool.query<{
      id: string;
      style_name: string | null;
    }>(
      `
      SELECT
        p.id,
        p.style_name
      FROM public.book_paragraphs p
      WHERE p.upload_id = $1
        AND p.chapter_number = $2
      ORDER BY
        NULLIF((p.formatting_metadata->>'source_seq'), '')::INT ASC NULLS LAST,
        p.paragraph_number ASC NULLS LAST,
        p.subparagraph_number ASC NULLS LAST
      `,
      [uploadId, chNum]
    );

    const expected = res.rows.filter((r) => !isHeaderStyle(r.style_name)).map((r) => r.id);
    const expectedSet = new Set(expected);
    const actualSet = new Set(ids);

    const missing = expected.filter((id) => !actualSet.has(id));
    const extra = ids.filter((id) => !expectedSet.has(id));

    if (missing.length) {
      die(`Missing ${missing.length} DB paragraph(s) in canonical JSON (first 20):\n- ${missing.slice(0, 20).join('\n- ')}`);
    }
    if (extra.length) {
      die(`Extra ${extra.length} paragraph id(s) in canonical JSON not in DB chapter (first 20):\n- ${extra.slice(0, 20).join('\n- ')}`);
    }

    // Order check (strict)
    if (expected.length !== ids.length) {
      die(`Coverage mismatch after filtering: expected ${expected.length}, actual ${ids.length}`);
    }
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== ids[i]) {
        die(`Ordering mismatch at index ${i}: expected ${expected[i]} but got ${ids[i]}`);
      }
    }

    console.log('✅ Canonical-vs-DB verification passed');
    console.log(`   upload: ${uploadId}`);
    console.log(`   chapter: ${chapter.number}`);
    console.log(`   blocks: ${ids.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => die(e?.message || String(e)));
































