/**
 * Remove leading microheadings that appear immediately under:
 * - a section heading paragraph ("•Paragraafkop"), and
 * - a subparagraph title (subparagraph block heading).
 *
 * Why:
 * The first text under a numbered heading should not start with a microheading.
 * Example (undesired):
 *   "1.7 Wet marktordening gezondheidszorg (Wmg)"
 *   "<<MICRO_TITLE>>De Wet marktordening gezondheidszorg<<MICRO_TITLE_END>> De Wet ..."
 *
 * This script is deterministic and safe:
 * - It does NOT delete section/subparagraph title blocks.
 * - It only strips *leading* <<MICRO_TITLE>>...<<MICRO_TITLE_END>> markers from the first
 *   visible text block under a heading (it keeps microheadings later in the paragraph).
 *
 * Usage:
 *   npx tsx new_pipeline/fix/remove-leading-microtitles-under-headings.ts <in.json> --out <out.json>
 */

import * as fs from 'fs';
import * as path from 'path';

type AnyObj = Record<string, any>;

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

function normHint(h: any): string {
  return String(h || '').toLowerCase().replace(/\s+/g, '');
}

function isParagraafKop(b: any): boolean {
  if (!b || typeof b !== 'object') return false;
  if (String(b.type || '') !== 'paragraph') return false;
  return normHint(b.styleHint).includes('paragraafkop');
}

function isSubparagraafKop(b: any): boolean {
  if (!b || typeof b !== 'object') return false;
  if (String(b.type || '') !== 'paragraph') return false;
  return normHint(b.styleHint).includes('subparagraafkop');
}

function stripLeadingMicroTitles(raw: string): { text: string; removed: string[] } {
  let s = String(raw || '');
  const removed: string[] = [];
  // Remove one or more leading micro title markers.
  for (;;) {
    const m = /^\s*<<MICRO_TITLE>>([\s\S]*?)<<MICRO_TITLE_END>>\s*/u.exec(s);
    if (!m) break;
    const title = String(m[1] || '').trim();
    if (title) removed.push(title);
    s = s.slice(m[0].length);
  }
  return { text: s, removed };
}

function firstNonEmptyListItemIdx(items: any[]): number {
  for (let i = 0; i < items.length; i++) {
    if (String(items[i] ?? '').trim()) return i;
  }
  return -1;
}

type Stats = {
  changedBlocks: number;
  removedMicrotitles: number;
  changedExamples: Array<{ paragraph_id: string; removed: string[] }>;
  processedSections: number;
  processedSubparagraphs: number;
};

function ensureArray(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function stripInFirstTextBlockUnderHeading(blocks: any[], stats: Stats, context: 'section' | 'subparagraph') {
  // Keep the "after heading" state until we hit a *visible* text block.
  let afterHeading = true;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || typeof b !== 'object') continue;

    // Nested subparagraphs: always process recursively; they have their own titles.
    if (String(b.type || '') === 'subparagraph') {
      processSubparagraph(b, stats);
      // A subparagraph title is a heading, not a microheading; consider the parent heading satisfied.
      if (afterHeading) afterHeading = false;
      continue;
    }

    // Skip internal heading paragraphs (do not treat them as "text under heading").
    if (context === 'section' && isParagraafKop(b)) continue;
    if (context === 'subparagraph' && isSubparagraafKop(b)) continue;

    if (!afterHeading) {
      // Still recurse for any nested content arrays we might encounter.
      if (Array.isArray(b.content)) b.content = visitContentArray(b.content, stats);
      continue;
    }

    const type = String(b.type || '');

    // Paragraph: strip leading microtitles from basis (only at the start of the first body block).
    if (type === 'paragraph') {
      const basisRaw = String(b.basis ?? '');
      const { text, removed } = stripLeadingMicroTitles(basisRaw);
      if (removed.length > 0) {
        b.basis = text.replace(/^\s+/, ''); // avoid leading space after deletion
        stats.changedBlocks++;
        stats.removedMicrotitles += removed.length;
        if (stats.changedExamples.length < 20) {
          stats.changedExamples.push({ paragraph_id: String(b.id || ''), removed });
        }
      }
      // Consume the "after heading" slot only when this paragraph has visible body text.
      const hasVisible = String(b.basis || '').trim().length > 0;
      if (hasVisible) afterHeading = false;
      continue;
    }

    // List/steps: remove leading microtitles from the first non-empty item (if any),
    // otherwise from a possible `basis` fallback field.
    if (type === 'list' || type === 'steps') {
      const items = ensureArray(b.items).map((x) => String(x ?? ''));
      const firstIdx = firstNonEmptyListItemIdx(items);
      if (firstIdx >= 0) {
        // Repeatedly strip if the first visible item is purely microtitles.
        let idx = firstIdx;
        while (idx >= 0 && idx < items.length) {
          const { text, removed } = stripLeadingMicroTitles(items[idx]);
          if (removed.length === 0) break;
          items[idx] = text.replace(/^\s+/, '');
          stats.changedBlocks++;
          stats.removedMicrotitles += removed.length;
          if (stats.changedExamples.length < 20) {
            stats.changedExamples.push({ paragraph_id: String(b.id || ''), removed });
          }
          if (!items[idx].trim()) {
            // Remove now-empty item and continue (next item becomes first visible).
            items.splice(idx, 1);
            idx = firstNonEmptyListItemIdx(items);
            continue;
          }
          break;
        }
        b.items = items;
        if (items.some((x) => String(x).trim())) afterHeading = false;
        continue;
      }

      const basisRaw = String((b as any).basis ?? '');
      if (basisRaw.trim()) {
        const { text, removed } = stripLeadingMicroTitles(basisRaw);
        if (removed.length > 0) {
          (b as any).basis = text.replace(/^\s+/, '');
          stats.changedBlocks++;
          stats.removedMicrotitles += removed.length;
          if (stats.changedExamples.length < 20) {
            stats.changedExamples.push({ paragraph_id: String(b.id || ''), removed });
          }
        }
        if (String((b as any).basis || '').trim()) afterHeading = false;
      }
      continue;
    }

    // Non-text blocks (figures/images/tables): keep searching until the first text block.
    if (Array.isArray(b.content)) b.content = visitContentArray(b.content, stats);
  }
}

function processSubparagraph(sp: AnyObj, stats: Stats) {
  stats.processedSubparagraphs++;
  const content = ensureArray(sp.content);
  // Under a subparagraph title, the first body text should not start with a microheading.
  stripInFirstTextBlockUnderHeading(content, stats, 'subparagraph');
  // Also recurse deeper (if any nested subparagraphs exist).
  sp.content = visitContentArray(content, stats);
}

function visitContentArray(blocks: any[], stats: Stats): any[] {
  const out: any[] = [];
  for (const b of ensureArray(blocks)) {
    if (!b || typeof b !== 'object') continue;
    if (String(b.type || '') === 'subparagraph') {
      processSubparagraph(b, stats);
      out.push(b);
      continue;
    }
    if (Array.isArray(b.content)) b.content = visitContentArray(b.content, stats);
    out.push(b);
  }
  return out;
}

function processBook(book: AnyObj, stats: Stats) {
  const chapters = ensureArray(book.chapters);
  for (const ch of chapters) {
    const sections = ensureArray(ch?.sections);
    for (const sec of sections) {
      stats.processedSections++;
      const content = ensureArray(sec?.content);

      // If section.title is present, a heading is rendered outside the content array.
      // Still, most of our books also have an explicit Paragraafkop paragraph; both are safe.
      const hasSectionTitle = String(sec?.title || '').trim().length > 0;
      if (hasSectionTitle) {
        stripInFirstTextBlockUnderHeading(content, stats, 'section');
      }

      // Also handle explicit Paragraafkop paragraphs inside the section content.
      for (let i = 0; i < content.length; i++) {
        const b = content[i];
        if (!isParagraafKop(b)) continue;
        // Apply to the blocks after this heading paragraph.
        stripInFirstTextBlockUnderHeading(content.slice(i + 1), stats, 'section');
      }

      // Recurse into subparagraphs in this section.
      sec.content = visitContentArray(content, stats);
    }
  }
}

async function main() {
  const inPathArg = process.argv[2];
  if (!inPathArg) {
    die('Usage: npx tsx new_pipeline/fix/remove-leading-microtitles-under-headings.ts <in.json> --out <out.json>');
  }
  const outArg = getArg('--out');
  if (!outArg) die('Missing required --out <out.json>');

  const inAbs = path.resolve(inPathArg);
  const outAbs = path.resolve(outArg);
  if (!fs.existsSync(inAbs)) die(`Input JSON not found: ${inAbs}`);

  const book = JSON.parse(fs.readFileSync(inAbs, 'utf8')) as AnyObj;
  const stats: Stats = {
    changedBlocks: 0,
    removedMicrotitles: 0,
    changedExamples: [],
    processedSections: 0,
    processedSubparagraphs: 0,
  };

  processBook(book, stats);

  fs.writeFileSync(outAbs, JSON.stringify(book, null, 2), 'utf8');

  const quiet = hasFlag('--quiet');
  if (!quiet) {
    console.log(`✅ Removed leading microtitles under headings`);
    console.log(`   in:  ${inAbs}`);
    console.log(`   out: ${outAbs}`);
    console.log(`   processed sections:      ${stats.processedSections}`);
    console.log(`   processed subparagraphs: ${stats.processedSubparagraphs}`);
    console.log(`   changed blocks:          ${stats.changedBlocks}`);
    console.log(`   removed microtitles:     ${stats.removedMicrotitles}`);
    if (stats.changedExamples.length > 0) {
      console.log(`   examples (first ${stats.changedExamples.length}):`);
      for (const ex of stats.changedExamples) {
        console.log(`     - ${ex.paragraph_id}: ${ex.removed.join(' | ')}`);
      }
    }
  }
}

main().catch((e) => die(String((e as any)?.message || e)));











