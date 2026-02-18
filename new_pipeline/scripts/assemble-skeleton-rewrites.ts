import fs from 'fs';
import { Skeleton, GenerationUnit } from '../../src/lib/types/skeleton';

interface RewriteOutput {
  metadata: any;
  rewritten_units: Record<string, string>;
}

interface CanonicalBlock {
  id: string;
  type?: string;
  basis?: string;
  items?: string[];
  praktijk?: string;
  verdieping?: string;
  merged?: boolean; // New flag to indicate this block was merged into another
  styleHint?: string;
  [key: string]: any;
}

function isProtectedHeadingStyleHint(styleHint: string | null | undefined): boolean {
  const s0 = String(styleHint || '').toLowerCase();
  const s = s0.replace(/\s+/g, ''); // normalize "Paragraaf kop" -> "paragraafkop"
  // We must preserve numbering + heading titles deterministically.
  // In several books (e.g. Methodisch werken), section headings are stored as paragraph blocks
  // with style hints like "•Paragraafkop" and must NOT be rewritten into generic intro prose.
  if (s.includes('paragraafkop')) return true;
  if (s.includes('subparagraafkop')) return true;
  if (s.includes('hoofdstuk') && (s.includes('kop') || s.includes('titel'))) return true;
  return false;
}

function normalizeForCompare(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingDutchArticle(s: string): { article: string | null; noun: string } {
  const t = String(s || '').trim();
  const m = /^(de|het|een)\s+(.+)$/iu.exec(t);
  if (!m) return { article: null, noun: t };
  return { article: String(m[1] || '').toLowerCase(), noun: String(m[2] || '').trim() };
}

function parseLeadingMicroTitle(s: string): { title: string; rest: string } | null {
  const raw = String(s || '');
  const m = /^\s*<<MICRO_TITLE>>([\s\S]*?)<<MICRO_TITLE_END>>\s*/u.exec(raw);
  if (!m) return null;
  const title = String(m[1] || '').trim();
  const rest = raw.slice(m[0].length);
  return { title, rest };
}

function stripInlineMarkersLite(text: string): string {
  // Remove our inline marker tokens (<<BOLD_START>>, <<MICRO_TITLE>>, etc) for comparisons.
  return String(text || '').replace(/<<[A-Z0-9_]+>>/g, '');
}

function stripTrailingPunct(s: string): string {
  return String(s || '').trim().replace(/[.,;:]+$/u, '').trim();
}

function joinDutchList(items: string[]): string {
  const clean = items.map((x) => String(x || '').trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || '';
  if (clean.length === 2) return `${clean[0]} en ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} en ${clean[clean.length - 1]}`;
}

function splitInlineItems(raw: string): string[] {
  const t = String(raw || '').trim();
  if (!t) return [];
  // Convert "a en b" -> "a, b" for splitting; then split on comma/semicolon.
  const normalized = t.replace(/\s+en\s+/giu, ', ');
  return normalized
    .split(/[;,]/g)
    .map((x) => stripTrailingPunct(x))
    .map((x) => x.trim())
    .filter(Boolean);
}

function mergeColonListInFirstSentence(text: string, extraItems: string[]): { merged: string; didMerge: boolean } {
  const raw = String(text || '');
  const lead = parseLeadingMicroTitle(raw);
  const prefix = lead ? `<<MICRO_TITLE>>${lead.title}<<MICRO_TITLE_END>>` : '';
  const rest = lead ? lead.rest : raw;
  const idx = rest.indexOf(':');
  if (idx < 0) return { merged: raw, didMerge: false };
  const end = rest.indexOf('.', idx);
  if (end < 0) return { merged: raw, didMerge: false };

  const before = rest.slice(0, idx).trim();
  const listRaw = rest.slice(idx + 1, end).trim();
  const after = rest.slice(end + 1);

  const existing = splitInlineItems(listRaw);
  const extra = extraItems.map((x) => stripTrailingPunct(x)).filter(Boolean);

  const seen = new Set<string>();
  const combined: string[] = [];
  for (const it of [...existing, ...extra]) {
    const key = normalizeForCompare(it);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(it);
  }

  if (combined.length === 0) return { merged: raw, didMerge: false };
  const rebuilt = `${before}: ${joinDutchList(combined)}.${after ? ` ${after.trim()}` : ''}`.trim();
  return { merged: prefix ? `${prefix}\n\n${rebuilt}` : rebuilt, didMerge: true };
}

function removeColonListInFirstSentence(text: string): { cleaned: string; didClean: boolean } {
  const raw = String(text || '');
  const lead = parseLeadingMicroTitle(raw);
  const prefix = lead ? `<<MICRO_TITLE>>${lead.title}<<MICRO_TITLE_END>>` : '';
  const rest = lead ? lead.rest : raw;
  const idx = rest.indexOf(':');
  if (idx < 0) return { cleaned: raw, didClean: false };
  const end = rest.indexOf('.', idx);
  if (end < 0) return { cleaned: raw, didClean: false };

  const before = rest.slice(0, idx).trim();
  const after = rest.slice(end + 1);
  const rebuilt = `${before}.` + (after ? ` ${after.trim()}` : '');
  return { cleaned: prefix ? `${prefix}\n\n${rebuilt.trim()}` : rebuilt.trim(), didClean: true };
}

function looksLikeBareItems(facts: string[]): boolean {
  const items = (facts || [])
    .map((x) => stripInlineMarkersLite(String(x || '')))
    .map((x) => x.trim())
    .filter(Boolean);
  if (items.length === 0) return false;
  // Items-only blocks tend to be short noun phrases (<= 6 words) without colons.
  return items.every((it) => {
    if (it.includes(':')) return false;
    const w = it.split(/\s+/g).filter(Boolean).length;
    if (w > 6) return false;
    // Avoid absorbing real sentences.
    if (/[.!?]/.test(it.slice(0, -1))) return false;
    return true;
  });
}

function textIncludesAll(hay: string, needles: string[]): boolean {
  const h = normalizeForCompare(hay);
  return needles.every((n) => {
    const k = normalizeForCompare(n);
    return !!k && h.includes(k);
  });
}

function processAssembly(canonical: any, skeleton: Skeleton, rewrites: RewriteOutput): any {
  const result = JSON.parse(JSON.stringify(canonical)); // Deep copy
  const textMap = rewrites.rewritten_units;
  const suppressedUnitIds = new Set<string>();

  // Flatten canonical blocks for easy access by ID
  const blockMap = new Map<string, CanonicalBlock>();
  const traverse = (blocks: CanonicalBlock[]) => {
    for (const b of blocks) {
      blockMap.set(b.id, b);
      if (b.content) traverse(b.content);
    }
  };

  for (const ch of result.chapters || []) {
    for (const sec of ch.sections || []) {
      traverse(sec.content || []);
    }
  }

  // Map: unit_id -> primary canonical block id (used for box anchoring)
  const unitToPrimaryBlockId = new Map<string, string>();
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const u of sub.units as GenerationUnit[]) {
        const ref = u?.n4_mapping?.[0];
        if (ref?.original_id) unitToPrimaryBlockId.set(u.id, ref.original_id);
      }
    }
  }

  // Iterate Skeleton Units to apply updates
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (let i = 0; i < sub.units.length; i++) {
        const unit = sub.units[i] as GenerationUnit;
        let newText = textMap[unit.id];

        if (!newText) {
          console.warn(`⚠️ No text generated for unit ${unit.id}`);
          continue;
        }

        // If we decided to suppress this unit (but still need to clear canonical list content), set to empty now.
        if (suppressedUnitIds.has(String(unit.id))) {
          newText = '';
        }

        // ---------------------------------------------------------------------
        // Merge split list blocks: intro+items followed by a separate list-only unit.
        // This is common when IDML exports split a single list into multiple list blocks.
        // We merge the extra items into the FIRST unit's text and suppress the trailing list-only units.
        // ---------------------------------------------------------------------
        try {
          if (unit?.type === 'composite_list') {
            const facts = Array.isArray((unit as any)?.content?.facts) ? ((unit as any).content.facts as any[]) : [];
            const intro = facts.length ? String(facts[0] || '').trim() : '';
            const introLooksLikeList = !!intro && (intro.endsWith(':') || /\bnamelijk\b/i.test(intro) || /\bzoals\b/i.test(intro));
            const itemsInThisUnit = facts.slice(1).map((x) => stripTrailingPunct(String(x || ''))).filter(Boolean);

            if (introLooksLikeList) {
              const extraItems: string[] = [];
              let j = i + 1;
              while (j < sub.units.length) {
                const u2 = sub.units[j] as any;
                if (!u2 || u2.type !== 'composite_list') break;
                const f2 = Array.isArray(u2?.content?.facts) ? (u2.content.facts as any[]) : [];
                if (!looksLikeBareItems(f2)) break;
                for (const it of f2) extraItems.push(stripTrailingPunct(String(it || '')));
                suppressedUnitIds.add(String(u2.id));
                j++;
              }

              if (extraItems.length > 0) {
                const allItems = [...itemsInThisUnit, ...extraItems].filter(Boolean);

                // If the previous unit already listed all items (common with purines/pyrimidinen),
                // keep only the statement and drop the redundant enumeration.
                const prevUnit = i > 0 ? (sub.units[i - 1] as any) : null;
                const prevText = prevUnit ? String(textMap[String(prevUnit.id)] || '') : '';
                if (prevText && allItems.length >= 3 && textIncludesAll(prevText, allItems)) {
                  const cleaned = removeColonListInFirstSentence(newText);
                  if (cleaned.didClean) newText = cleaned.cleaned;
                } else {
                  const merged = mergeColonListInFirstSentence(newText, extraItems);
                  if (merged.didMerge) newText = merged.merged;
                }
              }
            }
          }
        } catch {
          // best-effort only; never fail assembly because of this
        }

        // ---------------------------------------------------------------------
        // Micro-title hygiene (skeleton/assembly-level)
        // 1) If the FIRST unit in a subparagraph starts with a micro-title that simply repeats the
        //    subparagraph title (e.g. "De celkern"), drop that micro-title.
        // 2) If a micro-title is "Functies van <noun>" but the subparagraph title contains an
        //    article ("de/het/een"), fix it to "Functies van <article> <noun>" when it matches.
        // ---------------------------------------------------------------------
        try {
          const subTitle = String((sub as any)?.title || '').trim();
          const { article, noun } = stripLeadingDutchArticle(subTitle);
          const lead = parseLeadingMicroTitle(newText);
          if (lead && lead.title) {
            const mtNorm = normalizeForCompare(lead.title);
            const subNorm = normalizeForCompare(subTitle);
            const nounNorm = normalizeForCompare(noun);

            // Fix: "Functies van celkern" -> "Functies van de celkern" (use article from sub title).
            const fun = /^functies van\s+(.+)$/iu.exec(lead.title);
            if (fun && article) {
              const tail = String(fun[1] || '').trim();
              if (tail && normalizeForCompare(tail) === nounNorm && noun) {
                const corrected = `Functies van ${article} ${noun}`; // keep Dutch article lowercase
                // Replace ONLY the leading micro-title marker.
                newText = newText.replace(
                  /^\s*<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>\s*/u,
                  `<<MICRO_TITLE>>${corrected}<<MICRO_TITLE_END>>\n\n`
                );
              }
            }

            // Drop redundant micro-title right under the subparagraph title (first unit only).
            if (i === 0) {
              const repeatsTitle = mtNorm === subNorm || (article && noun && mtNorm === nounNorm);
              if (repeatsTitle) {
                newText = lead.rest.trimStart();
              }
            }
          }
        } catch {
          // best-effort only; never fail assembly because of this
        }

        // ---------------------------------------------------------------------
        // Skeleton-level nested list echo suppression:
        // If we have a "lead" composite_list (single fact like "... zoals:") immediately followed by
        // an "items" composite_list, the two are rewritten independently and often both turn into
        // intro sentences ("Het X kan..." + "Het X maakt..."), which reads like duplicated info
        // (and can split awkwardly across pages/columns).
        //
        // Fix: when the NEXT unit already contains the subject (subsection title), suppress the lead.
        // This keeps a single coherent paragraph and avoids “double info across pages”.
        // ---------------------------------------------------------------------
        try {
          const nextUnit = (i + 1 < sub.units.length ? (sub.units[i + 1] as GenerationUnit) : null) as any;
          if (unit?.type === 'composite_list' && nextUnit?.type === 'composite_list') {
            const facts = Array.isArray((unit as any)?.content?.facts) ? ((unit as any).content.facts as any[]) : [];
            const nextFacts = Array.isArray((nextUnit as any)?.content?.facts)
              ? ((nextUnit as any).content.facts as any[])
              : [];
            const leadFact = facts.length === 1 ? String(facts[0] || '').trim() : '';
            const looksLikeLead = !!leadFact && (leadFact.endsWith(':') || /\bzoals\b/i.test(leadFact));
            const looksLikeItems = nextFacts.length >= 2;

            if (looksLikeLead && looksLikeItems) {
              const nextText = String(textMap[String(nextUnit.id)] || '').trim();
              if (nextText) {
                const subTitle = String((sub as any)?.title || '').trim();
                const { article: subArticle, noun: subNoun } = stripLeadingDutchArticle(subTitle);

                // Only suppress when the LEAD rewrite is a short redundant subject restatement.
                const leadTextNoMicro = String(newText || '')
                  .replace(/<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>\s*/gu, '')
                  .trim();
                const leadWords = leadTextNoMicro ? leadTextNoMicro.split(/\s+/g).filter(Boolean).length : 0;

                const subjectPhrase = normalizeForCompare((subArticle && subNoun) ? `${subArticle} ${subNoun}` : (subNoun || subTitle));
                const leadNorm = normalizeForCompare(leadTextNoMicro);
                const startsWithSubject = !!subjectPhrase && leadNorm.startsWith(subjectPhrase);

                // If the lead doesn't explicitly say the subject (e.g. "Voorbeelden hiervan zijn:"),
                // keep it — it's an important intro to the items.
                if (startsWithSubject && leadWords > 0 && leadWords <= 12) {
                  const needle = normalizeForCompare(subNoun || subTitle);
                  const hay = normalizeForCompare(nextText);
                  // Only suppress when the next unit clearly reintroduces the topic.
                  if (needle && hay.includes(needle)) {
                    newText = ''; // suppress (renderer will skip empty paragraphs)
                  }
                }
              }
            }
          }
        } catch {
          // best-effort only; never fail assembly because of this
        }

        // Box units attach to an explicit host block (preferred), so assembly does not depend on unit ordering.
        if (String(unit.type || '').startsWith('box_')) {
          const placement: any = (unit as any).placement || {};
          const hostBlockId =
            String(placement.host_block_id || '').trim() ||
            (placement.host_unit_id ? String(unitToPrimaryBlockId.get(String(placement.host_unit_id)) || '').trim() : '') ||
            (placement.anchor_id ? String(unitToPrimaryBlockId.get(String(placement.anchor_id)) || '').trim() : '');

          if (!hostBlockId) {
            console.warn(`⚠️ Orphan box unit ${unit.id} (${unit.type}) has no host_block_id/host_unit_id`);
            continue;
          }
          const hostBlock = blockMap.get(hostBlockId);
          if (!hostBlock) {
            console.warn(`⚠️ Orphan box unit ${unit.id} (${unit.type}) host block not found: ${hostBlockId}`);
            continue;
          }

          if (unit.type === 'box_praktijk') hostBlock.praktijk = newText;
          else if (unit.type === 'box_verdieping') hostBlock.verdieping = newText;

          // If this box was selected from existing content (has n4_mapping), hide the original blocks
          // so the content doesn't show twice in the body.
          if (Array.isArray(unit.n4_mapping) && unit.n4_mapping.length > 0) {
            for (const ref of unit.n4_mapping) {
              const b = blockMap.get(ref.original_id);
              if (!b) continue;
              b.merged = true;
              b.basis = '';
              b.items = [];
              // Keep type stable; but if it was a list/steps, demote to paragraph so it can't render stray list structure.
              const t = String((b as any).type ?? '').trim();
              if (t === 'list' || t === 'steps') (b as any).type = 'paragraph';
              const prevHint = String((b as any).styleHint ?? '').trim();
              const tag = `moved-to-${String(unit.type)}`;
              (b as any).styleHint = prevHint ? `${prevHint} ${tag}` : tag;
            }
          }
          continue;
        }

        if (unit.type === 'prose' || unit.type === 'composite_list') {
          // 1. Identify the PRIMARY N4 block (usually the first one, e.g. the list intro)
          const primaryRef = unit.n4_mapping[0];
          if (!primaryRef) continue;

          const primaryBlock = blockMap.get(primaryRef.original_id);
          if (!primaryBlock) {
            console.error(`❌ Could not find N4 block ${primaryRef.original_id} for unit ${unit.id}`);
            continue;
          }

          // Deterministic numbering/title preservation: never overwrite heading blocks
          // (e.g. "2.1 ..." / "10.1 ..." paragraph headings).
          if (isProtectedHeadingStyleHint(primaryBlock.styleHint)) {
            continue;
          }

          // 2. Check for <<VERDIEPING_BOX>> markers and extract verdieping content
          let textToApply = newText;
          const verdiepingMatch = textToApply.match(/<<VERDIEPING_BOX>>([\s\S]*?)<<VERDIEPING_BOX_END>>/);
          if (verdiepingMatch) {
            // Extract verdieping content (without the markers)
            const verdiepingContent = verdiepingMatch[1].trim();
            primaryBlock.verdieping = verdiepingContent;
            // Remove the verdieping markers from the basis text
            textToApply = textToApply.replace(/<<VERDIEPING_BOX>>[\s\S]*?<<VERDIEPING_BOX_END>>/, '').trim();
            // If nothing left after extracting verdieping, don't clear basis
            if (!textToApply) {
              // The entire content was verdieping, so we mark basis as empty and let renderer use verdieping
              textToApply = '';
            }
          }

          // 3. Update text
          if (unit.type === 'composite_list' && textToApply.includes(';')) {
            // For simplicity in this v1: Put everything in 'basis' (content-first; renderer can still render well).
            primaryBlock.basis = textToApply;
            primaryBlock.items = []; // Clear original items
          } else {
            // Prose or merged list-as-prose
            primaryBlock.basis = textToApply;
            primaryBlock.items = []; // Clear items if it was a list
          }

          // IMPORTANT: If we moved content into `basis`, list/steps blocks must be demoted to paragraphs.
          // Otherwise the renderer will treat them as empty lists and drop the content.
          const primaryType = String((primaryBlock as any).type ?? '').trim();
          if (primaryType === 'list' || primaryType === 'steps') {
            (primaryBlock as any).type = 'paragraph';
            const prevHint = String((primaryBlock as any).styleHint ?? '').trim();
            const tag = `demoted-from-${primaryType}`;
            (primaryBlock as any).styleHint = prevHint ? `${prevHint} ${tag}` : tag;
          }

          // 3. Handle Merged Blocks (e.g. original list items that are now part of this unit)
          for (let j = 1; j < unit.n4_mapping.length; j++) {
            const mergedRef = unit.n4_mapping[j];
            const mergedBlock = blockMap.get(mergedRef.original_id);
            if (mergedBlock) {
              mergedBlock.merged = true; // Flag for deletion or hiding
              mergedBlock.basis = '';
              mergedBlock.items = [];
            }
          }
        }
      }
    }
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const canonicalPath = args[0];
  const skeletonPath = args[1];
  const rewritesPath = args[2];
  const outPath = args[3] || 'assembled_chapter.json';

  if (!rewritesPath) {
    console.error(
      'Usage: tsx new_pipeline/scripts/assemble-skeleton-rewrites.ts <canonical.json> <skeleton.json> <rewrites.json> [output.json]'
    );
    process.exit(1);
  }

  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  const rewrites = JSON.parse(fs.readFileSync(rewritesPath, 'utf8'));

  console.log('🔧 Assembling chapter...');
  const result = processAssembly(canonical, skeleton, rewrites);

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`✅ Assembled JSON written to: ${outPath}`);
}

main().catch(console.error);


