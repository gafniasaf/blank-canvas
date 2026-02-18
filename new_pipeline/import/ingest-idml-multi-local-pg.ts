/**
 * ingest-idml-multi-local-pg.ts
 *
 * Ingest one or more IDML files into Supabase Postgres (direct DB connection; no Storage).
 *
 * Why:
 * - Some books are delivered as per-chapter INDDs (or INDB bundles). Exporting each chapter to IDML is easy.
 * - We still want ONE `book_uploads` row and ONE upload_id, so downstream tools (`export-canonical-from-db.ts`)
 *   can export chapters consistently via `--chapter`.
 *
 * This script:
 * - creates/updates a book_uploads row (title+level)
 * - deletes existing book_paragraphs for that upload_id (safe rerun)
 * - parses each IDML's main story content deterministically
 * - inserts into book_paragraphs with numbering (chapter/paragraph/subparagraph) extracted from headings
 * - maintains a global `source_seq` across all input IDMLs for stable ordering
 *
 * Usage:
 *   cd new_pipeline
 *   npx tsx import/ingest-idml-multi-local-pg.ts \\
 *     --title "MBO Pathologie nivo 4" --level n4 \\
 *     /abs/path/to/CH01.idml /abs/path/to/CH02.idml ...
 */

import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import AdmZip from 'adm-zip';

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
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

type BookLevel = 'n3' | 'n4';

type ParagraphNumber = {
  chapter: number;
  paragraph: number;
  subparagraph?: number;
};

type ExtractedParagraph = {
  chapter_number: string;
  paragraph_number: number;
  subparagraph_number?: number;
  text_original: string;
  style_name: string;
  content_type: string;
  formatting_metadata?: any;
};

function cleanText(text: string): string {
  return String(text || '')
    .replace(/<\?ACE\s*\d*\s*\?>/gi, '')
    .replace(/\uFFFC/g, '')
    // Normalize control chars that can break numbering detection (e.g. "1.4.6\u0007Enzymen").
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\u00AD/g, '') // soft hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeaderStyle(styleName: string): boolean {
  const headerPatterns = [
    '_Chapter Header',
    '_Subchapter Header',
    // Common MBO book styles
    'paragraafkop',
    'subparagraaf',
    'hoofdstukkop',
    'hoofdstuk kop',
    'kop1',
    'kop2',
    'kop3',
    'heading',
    'h1',
    'h2',
    'h3',
    'title',
    'hoofdstuk',
  ];
  const lower = String(styleName || '').toLowerCase();
  return headerPatterns.some((p) => lower.includes(p.toLowerCase()));
}

function isContentStyle(styleName: string): boolean {
  const lower = String(styleName || '').toLowerCase();
  // exclude TOC/Index/Front matter/Labels/Tables etc.
  const excludedPatterns = ['toc', 'inhoud', 'index', 'register', 'front matter', 'labels', 'table header', 'table body'];
  if (excludedPatterns.some((p) => lower.includes(p))) return false;

  // include core content styles
  const contentPatterns = ['•basis', '_bullets', '_numbered paragraph', 'begrip', 'begrippen', 'basis', 'bullets'];
  return contentPatterns.some((p) => lower.includes(p)) || styleName === '•Basis' || styleName.startsWith('_Bullets');
}

function extractParagraphNumber(text: string): ParagraphNumber | null {
  const t = cleanText(text);
  const subParaMatch = t.match(/^(\d+)\.(\d+)\.(\d+)\b/);
  if (subParaMatch) {
    return {
      chapter: parseInt(subParaMatch[1]!, 10),
      paragraph: parseInt(subParaMatch[2]!, 10),
      subparagraph: parseInt(subParaMatch[3]!, 10),
    };
  }
  const paraMatch = t.match(/^(\d+)\.(\d+)\b/);
  if (paraMatch) {
    return { chapter: parseInt(paraMatch[1]!, 10), paragraph: parseInt(paraMatch[2]!, 10) };
  }
  const chapterMatch = t.match(/^(\d+)\b/);
  if (chapterMatch) {
    return { chapter: parseInt(chapterMatch[1]!, 10), paragraph: 0 };
  }
  return null;
}

function extractTextFromXml(
  xml: string,
  opts: { story_file: string; story_rank: number; seq_start: number; input_basename: string }
): { paragraphs: ExtractedParagraph[]; seq_end: number } {
  const paragraphs: ExtractedParagraph[] = [];
  let currentParaNum: ParagraphNumber | null = null;
  let seq = Math.max(1, opts.seq_start || 1);

  const paraRangeRegex =
    /<ParagraphStyleRange[^>]*AppliedParagraphStyle="([^"]*)"[^>]*>([\s\S]*?)<\/ParagraphStyleRange>/gi;

  let match: RegExpExecArray | null;
  while ((match = paraRangeRegex.exec(xml)) !== null) {
    const rawStyle = match[1] || '';
    const styleName = rawStyle.replace('ParagraphStyle/', '').replace(/%20/g, ' ');
    const innerContent = match[2] || '';

    let text = '';
    const contentRegex = /<Content>([\s\S]*?)<\/Content>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = contentRegex.exec(innerContent)) !== null) {
      text += cm[1] || '';
    }
    text = cleanText(text);
    if (!text || text.length < 2) continue;

    if (isHeaderStyle(styleName)) {
      const paraNum = extractParagraphNumber(text);
      if (paraNum) {
        currentParaNum = paraNum;
        // Keep header row for ordering/context/debug (exporter will skip it as content).
        paragraphs.push({
          chapter_number: currentParaNum.chapter.toString(),
          paragraph_number: currentParaNum.paragraph,
          subparagraph_number: currentParaNum.subparagraph,
          text_original: text,
          style_name: styleName,
          content_type: 'text',
          formatting_metadata: {
            source_seq: seq++,
            story_file: opts.story_file,
            story_rank: opts.story_rank,
            kind: 'header',
            input: opts.input_basename,
          },
        });
      }
      continue;
    }

    if (!isContentStyle(styleName)) continue;
    if (!currentParaNum) continue;

    paragraphs.push({
      chapter_number: currentParaNum.chapter.toString(),
      paragraph_number: currentParaNum.paragraph,
      subparagraph_number: currentParaNum.subparagraph,
      text_original: text,
      style_name: styleName,
      content_type: 'text',
      formatting_metadata: {
        source_seq: seq++,
        story_file: opts.story_file,
        story_rank: opts.story_rank,
        kind: 'content',
        input: opts.input_basename,
      },
    });
  }

  return { paragraphs, seq_end: seq };
}

function approxTextLen(xml: string): number {
  return String(xml || '').replace(/<[^>]+>/g, '').length;
}

async function parseIdmlMainParagraphs(idmlPath: string, seqStart: number): Promise<{ paragraphs: ExtractedParagraph[]; seqEnd: number }> {
  const zip = new AdmZip(idmlPath);
  const entries = zip.getEntries();
  const storyEntries = entries.filter((e) => e.entryName.startsWith('Stories/') && e.entryName.endsWith('.xml'));
  if (!storyEntries.length) return { paragraphs: [], seqEnd: seqStart };

  // Rank stories by approx text size; only process main stories.
  const storySizes: Array<{ file: string; size: number }> = [];
  for (const e of storyEntries) {
    const content = e.getData().toString('utf8');
    storySizes.push({ file: e.entryName, size: approxTextLen(content) });
  }
  storySizes.sort((a, b) => b.size - a.size);
  const largestSize = storySizes[0]?.size || 0;
  const storiesToProcess = storySizes.filter((s) => s.size > 5000 || (largestSize > 0 && s.size > largestSize * 0.05));

  const all: ExtractedParagraph[] = [];
  let seq = Math.max(1, seqStart || 1);
  const base = path.basename(idmlPath);
  for (const story of storiesToProcess) {
    const entry = zip.getEntry(story.file);
    if (!entry) continue;
    const content = entry.getData().toString('utf8');
    const res = extractTextFromXml(content, { story_file: story.file, story_rank: story.size, seq_start: seq, input_basename: base });
    all.push(...res.paragraphs);
    seq = res.seq_end;
  }
  return { paragraphs: all, seqEnd: seq };
}

async function ensureUpload(opts: { title: string; level: BookLevel; seriesId: string; storagePath: string; uploadId?: string }): Promise<string> {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: getDbUrl(), max: 3, idleTimeoutMillis: 10_000 });
  try {
    if (opts.uploadId) {
      await pool.query(`update public.book_uploads set title=$1, level=$2, storage_path=$3, series_id=$4 where id=$5`, [
        opts.title,
        opts.level,
        opts.storagePath,
        opts.seriesId,
        opts.uploadId,
      ]);
      return opts.uploadId;
    }

    const existing = await pool.query(
      `select id from public.book_uploads where title = $1 and level = $2 order by created_at desc nulls last limit 1`,
      [opts.title, opts.level]
    );
    if (existing.rows?.[0]?.id) {
      const id = String(existing.rows[0].id);
      await pool.query(`update public.book_uploads set storage_path=$1, series_id=$2 where id=$3`, [opts.storagePath, opts.seriesId, id]);
      return id;
    }

    const inserted = await pool.query(
      `insert into public.book_uploads (title, level, series_id, storage_path, status)\n       values ($1, $2, $3, $4, $5)\n       returning id`,
      [opts.title, opts.level, opts.seriesId, opts.storagePath, 'uploaded']
    );
    return String(inserted.rows[0].id);
  } finally {
    await pool.end();
  }
}

async function ingest() {
  const title = String(getArg('--title') || '').trim();
  const level = String(getArg('--level') || '').trim().toLowerCase() as BookLevel;
  const seriesId = String(getArg('--series') || 'healthcare-2024').trim();
  const uploadIdArg = String(getArg('--upload-id') || '').trim();
  const keep = hasFlag('--keep'); // do not delete existing paragraphs (advanced)

  const idmlInputs = process.argv.slice(2).filter((a) => a && !a.startsWith('--') && a !== title && a !== level);
  // Better: positional detection (reuse scan-factual-errata style)
  const argv = process.argv.slice(2);
  const idmls: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '').trim();
    if (!a) continue;
    if (a.startsWith('--')) {
      if (a === '--title' || a === '--level' || a === '--series' || a === '--upload-id') i++;
      continue;
    }
    idmls.push(path.resolve(a));
  }

  if (!title) die('Missing --title');
  if (level !== 'n3' && level !== 'n4') die('Missing/invalid --level (n3|n4)');
  if (!idmls.length) die('Provide one or more IDML files as positional args.');
  for (const p of idmls) if (!fs.existsSync(p)) die(`IDML not found: ${p}`);

  const storagePath = idmls[0]!;
  const uploadId = await ensureUpload({
    title,
    level,
    seriesId,
    storagePath,
    uploadId: uploadIdArg || undefined,
  });

  console.log(`\n📥 Ingesting IDMLs into DB`);
  console.log(`   title=${title}`);
  console.log(`   level=${level}`);
  console.log(`   upload_id=${uploadId}`);
  console.log(`   files=${idmls.length}`);
  console.log(`   keep_existing=${keep ? 'true' : 'false'}`);

  const { Pool } = pg;
  const pool = new Pool({ connectionString: getDbUrl(), max: 3, idleTimeoutMillis: 10_000 });
  try {
    await pool.query(`update public.book_uploads set status=$1 where id=$2`, ['extracting', uploadId]);
    if (!keep) {
      await pool.query(`delete from public.book_paragraphs where upload_id = $1`, [uploadId]);
    }

    let seq = 1;
    // If keep=true, start seq after current max to avoid collisions.
    if (keep) {
      const r = await pool.query(
        `select max((formatting_metadata->>'source_seq')::int) as max_seq from public.book_paragraphs where upload_id=$1`,
        [uploadId]
      );
      const v = Number(r.rows?.[0]?.max_seq);
      if (Number.isFinite(v) && v > 0) seq = Math.floor(v) + 1;
    }

    const batchSize = 200;
    let total = 0;

    for (const idml of idmls) {
      const { paragraphs, seqEnd } = await parseIdmlMainParagraphs(idml, seq);
      seq = seqEnd;
      console.log(`   parsed ${path.basename(idml)} paragraphs=${paragraphs.length}`);

      for (let i = 0; i < paragraphs.length; i += batchSize) {
        const batch = paragraphs.slice(i, i + batchSize);
        const values: string[] = [];
        const params: any[] = [];
        let pIdx = 1;
        for (const row of batch) {
          values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}::jsonb)`);
          params.push(
            uploadId,
            row.chapter_number,
            row.paragraph_number,
            row.subparagraph_number ?? null,
            1,
            row.text_original,
            row.style_name,
            row.content_type,
            JSON.stringify(row.formatting_metadata || {})
          );
        }
        await pool.query(
          `insert into public.book_paragraphs\n            (upload_id, chapter_number, paragraph_number, subparagraph_number, page_number, text_original, style_name, content_type, formatting_metadata)\n           values ${values.join(',')}`,
          params
        );
        total += batch.length;
      }
    }

    await pool.query(`update public.book_uploads set status=$1 where id=$2`, ['extracted', uploadId]);
    console.log(`✅ Ingest complete: inserted=${total}`);
    console.log(`✅ upload_id=${uploadId}`);
  } finally {
    await pool.end();
  }
}

ingest().catch((e) => {
  console.error('❌ ingest-idml-multi-local-pg failed:', e?.message || String(e));
  process.exit(1);
});






























