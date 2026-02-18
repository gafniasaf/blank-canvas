/**
 * Export a rewrites_for_indesign-style JSON from the DB (Supabase/Postgres).
 *
 * This is the standardized way to generate the “rewrite task list” for CH1..CHN in JSON-first mode,
 * without running InDesign.
 *
 * It exports:
 * - paragraph_id, chapter, paragraph_number, subparagraph_number, style_name
 * - original (from book_paragraphs.text_original)
 * - rewritten (seeded; default: original)
 *
 * Usage:
 *   npx ts-node scripts/export-rewrites-json-from-db.ts <uploadId> --out <jsonPath> [--chapters "1,2,3"] [--seed original|approved]
 *
 * Notes:
 * - We intentionally do NOT touch/normalize `original` (it is used for deterministic apply matching).
 * - `subparagraph_number` is always emitted (even when null) for the numbering gate.
 */

import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { buildCombinedBasisPraktijkVerdieping } from '../src/lib/indesign/rewritesForIndesign';

// Load env in local-dev friendly order:
// - .env (default)
// - .env.local (overrides; not committed)
dotenv.config();
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
} catch {
  // ignore
}

type DbBook = { id: string; title: string; level: string };
type DbRow = {
  id: string;
  chapter_number: string;
  paragraph_number: number | null;
  subparagraph_number: number | null;
  text_original: string;
  style_name: string | null;
  formatting_metadata?: any;
};

type OutParagraph = {
  paragraph_id: string;
  chapter: string;
  paragraph_number: number | null;
  subparagraph_number: number | null;
  style_name: string;
  original: string;
  rewritten: string;
};

type OutJson = {
  book_title?: string;
  upload_id: string;
  layer: 'combined_basis_praktijk_verdieping';
  chapter_filter: string | null;
  generated_at: string;
  total_paragraphs: number;
  generation_warnings?: any;
  paragraphs: OutParagraph[];
};

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function parseChapters(s: string): string[] {
  return String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function expandTilde(p: string): string {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  return p;
}

function mustSupabaseConfig(): { url: string; serviceRoleKey: string } {
  const read = () => {
    const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    return { url, key };
  };

  let { url, key } = read();

  // Some environments may predefine these keys as empty strings.
  // Dotenv won't overwrite existing keys unless override=true, so we retry with override
  // only when config appears missing.
  if (!url || !key) {
    try {
      dotenv.config({ override: true });
    } catch {
      // ignore
    }
    try {
      const localPath = path.resolve(process.cwd(), '.env.local');
      if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
    } catch {
      // ignore
    }
    ({ url, key } = read());
  }

  if (!url) throw new Error('❌ Missing VITE_SUPABASE_URL/SUPABASE_URL (expected a Supabase REST endpoint).');
  if (!key) throw new Error('❌ Missing SUPABASE_SERVICE_ROLE_KEY (required for server-side export).');
  return { url, serviceRoleKey: key };
}

async function supaFetch<T>(opts: { baseUrl: string; key: string; pathAndQuery: string }): Promise<T> {
  const { baseUrl, key, pathAndQuery } = opts;
  const fullUrl = `${baseUrl}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
  const res = await fetch(fullUrl, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`❌ Supabase REST failed (${res.status}) for ${pathAndQuery}: ${txt.slice(0, 500)}`);
  }
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`❌ Supabase REST returned non-JSON for ${pathAndQuery}: ${txt.slice(0, 500)}`);
  }
}

async function supaFetchAll<T>(opts: {
  baseUrl: string;
  key: string;
  table: string;
  select: string;
  filters: string[];
  pageSize?: number;
}): Promise<T[]> {
  const { baseUrl, key, table, select, filters, pageSize = 1000 } = opts;
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const qp = new URLSearchParams();
    qp.set('select', select);
    qp.set('limit', String(pageSize));
    qp.set('offset', String(offset));
    // filters already include "col=eq.x" etc
    for (const f of filters) {
      const [k, v] = f.split('=', 2);
      if (!k || v === undefined) continue;
      qp.append(k, v);
    }
    const page = await supaFetch<T[]>({ baseUrl, key, pathAndQuery: `/rest/v1/${table}?${qp.toString()}` });
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

type DbRewrite = {
  paragraph_id: string;
  layer_tag: 'basis' | 'praktijk' | 'verdieping' | string;
  text_rewritten: string;
  status: string;
  created_at: string;
};

function seedRewritten(opts: {
  seed: 'original' | 'approved';
  original: string;
  approved: { basis?: string | null; praktijk?: string | null; verdieping?: string | null };
}) {
  const { seed, original, approved } = opts;
  if (seed === 'original') return String(original ?? '');
  const b = String((approved.basis && approved.basis.trim()) ? approved.basis : original);
  const p = String(approved.praktijk || '');
  const v = String(approved.verdieping || '');
  return buildCombinedBasisPraktijkVerdieping(b, p, v, { includeBoldMarkers: true, enforceLowercaseAfterColon: true });
}

async function main() {
  const uploadId = process.argv[2] && !process.argv[2]!.startsWith('--') ? String(process.argv[2]).trim() : '';
  if (!uploadId) {
    console.error(
      'Usage: npx ts-node scripts/export-rewrites-json-from-db.ts <uploadId> --out <jsonPath> [--chapters "1,2,3"] [--seed original|approved]'
    );
    process.exit(1);
  }

  const outArg = getArg('--out');
  if (!outArg) throw new Error('❌ Missing --out <jsonPath>');
  const outPath = path.resolve(expandTilde(outArg));

  const seed = (String(getArg('--seed') || 'original').trim().toLowerCase() === 'approved' ? 'approved' : 'original') as
    | 'original'
    | 'approved';

  const chaptersArg = getArg('--chapters');
  const chapters = chaptersArg ? parseChapters(chaptersArg) : [];

  const { url: supabaseUrl, serviceRoleKey } = mustSupabaseConfig();

  const bookRows = await supaFetch<DbBook[]>({
    baseUrl: supabaseUrl,
    key: serviceRoleKey,
    pathAndQuery: `/rest/v1/book_uploads?id=eq.${encodeURIComponent(uploadId)}&select=id,title,level`,
  });
  const book = bookRows[0];
  if (!book) throw new Error(`❌ Upload not found in Supabase: ${uploadId}`);

  const filters: string[] = [`upload_id=eq.${encodeURIComponent(uploadId)}`];
  if (chapters.length) {
    const inside = chapters.map((c) => String(c).trim()).filter(Boolean).join(',');
    filters.push(`chapter_number=in.(${inside})`);
  }

  const rows = await supaFetchAll<DbRow>({
    baseUrl: supabaseUrl,
    key: serviceRoleKey,
    table: 'book_paragraphs',
    select: 'id,chapter_number,paragraph_number,subparagraph_number,text_original,style_name,formatting_metadata',
    filters,
  });
  if (!rows.length) throw new Error(`❌ No paragraphs found for upload ${uploadId} (chapters=${chaptersArg || 'ALL'})`);

  // Optional: load latest approved layer rewrites (only if seed=approved)
  const latestApproved: Record<string, { basis?: string; praktijk?: string; verdieping?: string }> = {};
  if (seed === 'approved') {
    const allIds = rows.map((r: any) => String(r.id || '')).filter(Boolean);
    // Avoid PostgREST "URI too long" by fetching in chunks.
    const chunkSize = 200;
    const rewrites: DbRewrite[] = [];
    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      const rwFilters: string[] = [
        `status=eq.approved`,
        `layer_tag=in.(basis,praktijk,verdieping)`,
        `paragraph_id=in.(${chunk.join(',')})`,
      ];
      const part = await supaFetchAll<DbRewrite>({
        baseUrl: supabaseUrl,
        key: serviceRoleKey,
        table: 'book_rewrites',
        select: 'paragraph_id,layer_tag,text_rewritten,status,created_at',
        filters: rwFilters,
        pageSize: 2000,
      });
      rewrites.push(...part);
    }
    // pick latest per (paragraph_id, layer_tag)
    const best = new Map<string, DbRewrite>();
    for (const r of rewrites) {
      const pid = String((r as any).paragraph_id || '');
      const tag = String((r as any).layer_tag || '');
      if (!pid || !tag) continue;
      const key = `${pid}::${tag}`;
      const prev = best.get(key);
      if (!prev || String(r.created_at) > String(prev.created_at)) best.set(key, r);
    }
    for (const [k, r] of best.entries()) {
      const [pid, tag] = k.split('::');
      if (!pid || !tag) continue;
      latestApproved[pid] ||= {};
      if (tag === 'basis') latestApproved[pid]!.basis = String(r.text_rewritten || '');
      if (tag === 'praktijk') latestApproved[pid]!.praktijk = String(r.text_rewritten || '');
      if (tag === 'verdieping') latestApproved[pid]!.verdieping = String(r.text_rewritten || '');
    }
  }

  // IMPORTANT: Numbering gate requires that JSON keys are monotonic in numeric order.
  // Therefore we sort STRICTLY by (chapter, paragraph_number, subparagraph_number),
  // with subparagraph=null sorted before subparagraph=1.
  const toInt = (v: any, fallback: number) => {
    const n = Number(String(v ?? '').trim());
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  };
  const getFm = (r: any): any => {
    const fm = (r as any)?.formatting_metadata;
    return fm && typeof fm === 'object' ? fm : {};
  };
  const getFmInt = (r: any, key: string, fallback: number) => {
    const fm = getFm(r);
    return toInt((fm as any)?.[key], fallback);
  };
  rows.sort((a: any, b: any) => {
    const ach = toInt(a.chapter_number, 999999);
    const bch = toInt(b.chapter_number, 999999);
    if (ach !== bch) return ach - bch;
    const apn = toInt(a.paragraph_number, 999999);
    const bpn = toInt(b.paragraph_number, 999999);
    if (apn !== bpn) return apn - bpn;
    const asp = a.subparagraph_number === null || a.subparagraph_number === undefined ? -1 : toInt(a.subparagraph_number, -1);
    const bsp = b.subparagraph_number === null || b.subparagraph_number === undefined ? -1 : toInt(b.subparagraph_number, -1);
    if (asp !== bsp) return asp - bsp;
    // Within the same (chapter, paragraph, subparagraph) key we must preserve the canonical story order
    // (otherwise headings/lists drift and the output reads like "fragments"). We use the extractor-provided
    // ordering metadata from InDesign/IDML:
    // - story_rank: global story ordering across the document
    // - source_seq: paragraph sequence within that story
    const ar = getFmInt(a, 'story_rank', 999999999);
    const br = getFmInt(b, 'story_rank', 999999999);
    if (ar !== br) return ar - br;
    const as = getFmInt(a, 'source_seq', 999999999);
    const bs = getFmInt(b, 'source_seq', 999999999);
    if (as !== bs) return as - bs;
    // stable fallback
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const paragraphs: OutParagraph[] = rows.map((r: any) => ({
    paragraph_id: String(r.id ?? ''),
    chapter: String(r.chapter_number ?? '').trim(),
    paragraph_number: r.paragraph_number ?? null,
    subparagraph_number: r.subparagraph_number ?? null,
    style_name: String(r.style_name ?? ''),
    original: String(r.text_original ?? ''),
    rewritten: seedRewritten({
      seed,
      original: String(r.text_original ?? ''),
      approved: latestApproved[String(r.id ?? '')] || {},
    }),
  }));

  const out: OutJson = {
    book_title: book.title,
    upload_id: uploadId,
    layer: 'combined_basis_praktijk_verdieping',
    chapter_filter: chapters.length === 1 ? chapters[0]! : null,
    generated_at: new Date().toISOString(),
    total_paragraphs: paragraphs.length,
    generation_warnings: {
      seed,
      chapters: chapters.length ? chapters : null,
      note: seed === 'original' ? 'rewritten seeded from original' : 'rewritten seeded from latest approved basis/praktijk/verdieping (when present)',
    },
    paragraphs,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✅ Exported rewrites JSON (Supabase REST)`);
  console.log(`   out: ${outPath}`);
  console.log(`   upload: ${uploadId}`);
  console.log(`   paragraphs: ${paragraphs.length}`);
  console.log(`   chapters: ${chapters.length ? chapters.join(',') : 'ALL'}`);
  console.log(`   seed: ${seed}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});


