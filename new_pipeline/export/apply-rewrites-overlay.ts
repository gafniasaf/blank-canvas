/**
 * Deterministically overlay JSON-first rewrites onto a Prince canonical JSON.
 *
 * Why:
 * - Canonical JSON comes from DB export + figure injection (keeps structure + images).
 * - Rewrites JSON (from scripts/build-book-json-first.ts) is a flat paragraph list with `paragraph_id` + `rewritten`.
 * - This script applies the rewritten text onto canonical blocks (paragraph/list/steps) by matching IDs.
 *
 * Usage:
 *   npx tsx new_pipeline/export/apply-rewrites-overlay.ts <canonical.json> <rewrites.json> --out <out.json> [--chapter 1]
 */

import * as fs from 'fs';
import * as path from 'path';

type RewritePara = {
  paragraph_id: string;
  chapter?: string;
  style_name?: string;
  rewritten?: string;
};

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

function normText(s: unknown): string {
  return String(s ?? '').replace(/\r/g, '\n');
}

function splitSemicolonItems(s: string): string[] {
  return s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitBulletOrNumberedLines(s: string): { items: string[]; ordered: boolean } | null {
  const raw = normText(s);
  if (!raw) return null;

  // Fast path: newline-driven lists only.
  if (!raw.includes('\n')) return null;

  const lines = raw
    .split(/\n+/g)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const reBullet = /^([•\u2022]|[-–—*])\s+/;
  const reNum = /^\s*\d+[.)]\s+/;

  let bulletHits = 0;
  let numHits = 0;
  const items: string[] = [];

  for (const line of lines) {
    if (reNum.test(line)) {
      numHits++;
      items.push(line.replace(reNum, '').trim());
      continue;
    }
    if (reBullet.test(line)) {
      bulletHits++;
      items.push(line.replace(reBullet, '').trim());
      continue;
    }
    // Continuation line / hard wrap. Keep as-is (but this reduces our confidence below).
    items.push(line.trim());
  }

  const marked = bulletHits + numHits;
  // Only treat as list if the majority of lines look like list items.
  if (marked < 2) return null;
  if (marked / Math.max(1, lines.length) < 0.6) return null;

  const clean = items.map((x) => x.trim()).filter(Boolean);
  if (clean.length < 2) return null;
  return { items: clean, ordered: numHits > bulletHits };
}

function splitInlineBulletGlyphs(s: string): string[] | null {
  const t = normText(s).trim();
  if (!t) return null;
  // Inline "• item • item" (no newlines) happens when bullet lists get crushed somewhere upstream.
  if (!t.includes('•')) return null;
  const parts = t
    .split('•')
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[-–—*]\s+/, '').trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

function extractListItemsFromRewrittenText(trimmed: string): { items: string[]; ordered: boolean } | null {
  if (!trimmed) return null;
  if (trimmed.includes(';')) return { items: splitSemicolonItems(trimmed), ordered: false };
  const nl = splitBulletOrNumberedLines(trimmed);
  if (nl) return { items: nl.items, ordered: nl.ordered };
  const inline = splitInlineBulletGlyphs(trimmed);
  if (inline) return { items: inline, ordered: false };
  return null;
}

function extractLayerMarkers(raw: string): {
  basis: string;
  praktijk?: string;
  verdieping?: string;
} {
  const s = normText(raw);

  const markers = [
    { key: 'praktijk' as const, label: 'In de praktijk:' },
    { key: 'verdieping' as const, label: 'Verdieping:' },
  ];

  // Find markers of the exact Option-A form:
  // <<BOLD_START>>In de praktijk:<<BOLD_END>> <inline text...>
  const re = /<<BOLD_START>>(In de praktijk:|Verdieping:)<<BOLD_END>>/g;

  const hits: Array<{ label: string; markerStart: number; markerEnd: number }> = [];
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    hits.push({ label: m[1]!, markerStart: m.index, markerEnd: m.index + m[0].length });
  }
  if (hits.length === 0) return { basis: s.trim() };

  let basisParts: string[] = [];
  let cursor = 0;
  const extracted: { praktijk?: string; verdieping?: string } = {};

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const next = hits[i + 1];

    // Keep text before marker in basis
    basisParts.push(s.slice(cursor, h.markerStart));

    // Extract marker body until next marker or end
    const bodyStart = h.markerEnd;
    const bodyEnd = next ? next.markerStart : s.length;
    const bodyRaw = s.slice(bodyStart, bodyEnd);

    const body = bodyRaw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (body) {
      if (h.label === 'In de praktijk:' && !extracted.praktijk) extracted.praktijk = body;
      if (h.label === 'Verdieping:' && !extracted.verdieping) extracted.verdieping = body;
    }

    cursor = bodyEnd;
  }

  // Any tail after last extracted body is already consumed as body; ensure no remaining
  basisParts.push('');

  let basis = basisParts.join('');
  // Clean up leftover blank lines around removed markers
  basis = basis.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
  basis = basis.replace(/[ \t]+\n/g, '\n');
  basis = basis.trim();

  return { basis, ...extracted };
}

function isEmptyParagraphBlock(b: any): boolean {
  const basis = String(b?.basis ?? '').trim();
  const hasImages = Array.isArray(b?.images) && b.images.length > 0;
  const hasPraktijk = !!String(b?.praktijk ?? '').trim();
  const hasVerdieping = !!String(b?.verdieping ?? '').trim();
  return !basis && !hasImages && !hasPraktijk && !hasVerdieping;
}

function isEmptyListLikeBlock(b: any): boolean {
  const items = Array.isArray(b?.items) ? b.items.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const hasImages = Array.isArray(b?.images) && b.images.length > 0;
  return items.length === 0 && !hasImages;
}

async function main() {
  const canonicalPath = process.argv[2];
  const rewritesPath = process.argv[3];
  if (!canonicalPath || !rewritesPath) {
    console.error(
      'Usage: npx tsx new_pipeline/export/apply-rewrites-overlay.ts <canonical.json> <rewrites.json> --out <out.json> [--chapter 1]'
    );
    process.exit(1);
  }

  const outArg = getArg('--out');
  if (!outArg) {
    console.error('Missing required --out <out.json>');
    process.exit(1);
  }

  const chapterFilter = getArg('--chapter');
  const overwriteBoxes = hasFlag('--overwrite-boxes');

  const canonicalAbs = path.resolve(canonicalPath);
  const rewritesAbs = path.resolve(rewritesPath);
  const outAbs = path.resolve(outArg);

  const canonical = JSON.parse(fs.readFileSync(canonicalAbs, 'utf8')) as any;
  const rewritesJson = JSON.parse(fs.readFileSync(rewritesAbs, 'utf8')) as any;

  const paras: RewritePara[] = (rewritesJson?.paragraphs || []) as RewritePara[];
  const filtered = chapterFilter ? paras.filter((p) => String(p.chapter || '') === String(chapterFilter)) : paras;

  const byId = new Map<string, RewritePara>();
  for (const p of filtered) {
    const id = String(p.paragraph_id || '').trim();
    if (!id) continue;
    byId.set(id, p);
  }

  const stats = {
    matched: 0,
    updatedParagraphs: 0,
    updatedLists: 0,
    updatedSteps: 0,
    convertedListToParagraph: 0,
    convertedStepsToParagraph: 0,
    extractedPraktijk: 0,
    extractedVerdieping: 0,
    prunedBlocks: 0,
  };

  function visitNode(node: any): any {
    if (Array.isArray(node)) {
      const out: any[] = [];
      for (const item of node) {
        const v = visitNode(item);
        if (v === null || v === undefined) continue;
        out.push(v);
      }
      return out;
    }
    if (!node || typeof node !== 'object') return node;

    // Known containers
    if (Array.isArray((node as any).chapters)) (node as any).chapters = visitNode((node as any).chapters);
    if (Array.isArray((node as any).sections)) (node as any).sections = visitNode((node as any).sections);
    if (Array.isArray((node as any).content)) (node as any).content = visitNode((node as any).content);

    // Apply rewrite by id
    const id = typeof (node as any).id === 'string' ? String((node as any).id) : '';
    if (id && byId.has(id)) {
      stats.matched++;
      const rw = byId.get(id)!;
      const rawRewritten = rw.rewritten;
      // Only apply when rewritten is provided (empty string is meaningful: merged-away content)
      if (rawRewritten !== undefined) {
        const { basis, praktijk, verdieping } = extractLayerMarkers(rawRewritten);

        const t = String((node as any).type || '');
        if (t === 'paragraph') {
          (node as any).basis = basis;
          if (praktijk) {
            const cur = String((node as any).praktijk ?? '').trim();
            if (!cur || overwriteBoxes) {
              (node as any).praktijk = praktijk;
              stats.extractedPraktijk++;
            }
          }
          if (verdieping) {
            const cur = String((node as any).verdieping ?? '').trim();
            if (!cur || overwriteBoxes) {
              (node as any).verdieping = verdieping;
              stats.extractedVerdieping++;
            }
          }
          stats.updatedParagraphs++;
        } else if (t === 'list') {
          const trimmed = basis.trim();
          if (!trimmed) {
            // Convert to an empty paragraph block (lets renderer skip it, but preserves images if any)
            (node as any).type = 'paragraph';
            (node as any).basis = '';
            delete (node as any).items;
            delete (node as any).ordered;
            delete (node as any).level;
            stats.convertedListToParagraph++;
          } else {
            const li = extractListItemsFromRewrittenText(trimmed);
            if (li) {
              // Preserve list structure even when the LLM used newline bullets ("- item\n- item") instead of semicolons.
              (node as any).items = li.items;
              // Keep ordered flag only if it already exists or we can confidently infer it.
              if (typeof (node as any).ordered === 'boolean') {
                // keep existing
              } else if (li.ordered) {
                (node as any).ordered = true;
              }
              stats.updatedLists++;
            } else {
              // Prose list: convert to paragraph, keep the styleHint so renderer can decide
              (node as any).type = 'paragraph';
              (node as any).basis = trimmed;
              delete (node as any).items;
              delete (node as any).ordered;
              delete (node as any).level;
              stats.convertedListToParagraph++;
            }
          }
        } else if (t === 'steps') {
          const trimmed = basis.trim();
          if (!trimmed) {
            (node as any).type = 'paragraph';
            (node as any).basis = '';
            delete (node as any).items;
            stats.convertedStepsToParagraph++;
          } else {
            const li = extractListItemsFromRewrittenText(trimmed);
            if (li) {
              (node as any).items = li.items;
              stats.updatedSteps++;
            } else {
              (node as any).type = 'paragraph';
              (node as any).basis = trimmed;
              delete (node as any).items;
              stats.convertedStepsToParagraph++;
            }
          }
        } else {
          // Unknown block types: best-effort apply basis if present
          if (typeof (node as any).basis === 'string') {
            (node as any).basis = basis;
            stats.updatedParagraphs++;
          }
        }
      }
    }

    // Prune empty blocks after applying rewrites (only within content arrays; visitNode(array) handles this by returning null)
    const type = String((node as any).type || '');
    if (type === 'paragraph' && isEmptyParagraphBlock(node)) {
      stats.prunedBlocks++;
      return null;
    }
    if ((type === 'list' || type === 'steps') && isEmptyListLikeBlock(node)) {
      stats.prunedBlocks++;
      return null;
    }

    return node;
  }

  const outObj = visitNode(canonical);

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(outObj, null, 2), 'utf8');

  console.log('✅ Applied rewrites overlay');
  console.log(`   canonical: ${canonicalAbs}`);
  console.log(`   rewrites:  ${rewritesAbs}`);
  console.log(`   out:       ${outAbs}`);
  if (chapterFilter) console.log(`   chapter:   ${chapterFilter}`);
  console.log(
    `   matched=${stats.matched} paragraphs=${stats.updatedParagraphs} lists=${stats.updatedLists} steps=${stats.updatedSteps} ` +
      `list→p=${stats.convertedListToParagraph} steps→p=${stats.convertedStepsToParagraph} ` +
      `praktijk=${stats.extractedPraktijk} verdieping=${stats.extractedVerdieping} pruned=${stats.prunedBlocks}`
  );
}

main().catch((err) => {
  console.error('❌ apply-rewrites-overlay failed:', err?.message || String(err));
  process.exit(1);
});


