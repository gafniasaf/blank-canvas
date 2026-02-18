import {
  PR_MARKER,
  VE_MARKER,
  isBulletStyleName,
  isListIntro,
  hasAnyLayerBlock,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from './rewritesForIndesignJsonLint';

export type ParsedCombined = {
  base: string;
  praktijkLine: string | null;
  verdiepingLine: string | null;
};

export type MoveLayerBlock = {
  from_id: string;
  to_id: string | null;
  reason: string;
  moved: { praktijk: boolean; verdieping: boolean };
};

export function parseCombined(text: string): ParsedCombined {
  const t = String(text || '').replace(/\r/g, '\n');
  const lines = t.split('\n');

  const headStarts = (ln: string) => ln.trim().startsWith(PR_MARKER) || ln.trim().startsWith(VE_MARKER);

  let firstHeadIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headStarts(lines[i] || '')) {
      firstHeadIdx = i;
      break;
    }
  }

  const baseLines = (firstHeadIdx >= 0 ? lines.slice(0, firstHeadIdx) : lines).join('\n').trim();

  let praktijkLine: string | null = null;
  let verdiepingLine: string | null = null;
  for (let i = Math.max(0, firstHeadIdx); i < lines.length; i++) {
    const ln = (lines[i] || '').trim();
    if (!ln) continue;
    if (ln.startsWith(PR_MARKER)) praktijkLine = ln;
    if (ln.startsWith(VE_MARKER)) verdiepingLine = ln;
  }

  return { base: baseLines, praktijkLine, verdiepingLine };
}

export function buildCombined(parts: ParsedCombined): string {
  const out: string[] = [];
  const base = String(parts.base || '').trim();
  if (base) out.push(base);
  if (parts.praktijkLine) {
    out.push('');
    out.push(parts.praktijkLine.trim());
  }
  if (parts.verdiepingLine) {
    out.push('');
    out.push(parts.verdiepingLine.trim());
  }
  return out.join('\n').trim();
}

export function normalizePunctSpacingKeepNewlines(text: string): string {
  let t = String(text || '').replace(/\r/g, '\n');
  // Sentence punctuation: lower + [.?!] + UPPER
  t = t.replace(/([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g, '$1$2 $3');
  // Semicolon/comma between letters
  t = t.replace(/([A-Za-z\u00C0-\u00FF]);([A-Za-z\u00C0-\u00FF])/g, '$1; $2');
  t = t.replace(/([A-Za-z\u00C0-\u00FF]),([A-Za-z\u00C0-\u00FF])/g, '$1, $2');
  // Colon before letter (skip times like 12:30 by requiring non-digit before colon)
  t = t.replace(/(^|[^0-9]):([A-Za-z\u00C0-\u00FF])/g, '$1: $2');
  // Remove spaces before punctuation (keep \n)
  t = t.replace(/[ \t]+([,.;:!?])/g, '$1');
  // Fix common LLM glitch: double punctuation after a semicolon item (e.g. ";.")
  // Keep the semicolon encoding (used for bullet-item splitting) and drop the stray period.
  t = t.replace(/;\s*\.(?=\s|$)/g, ';');
  // Collapse repeated spaces (do not touch \n)
  t = t.replace(/ {2,}/g, ' ');
  return t.trim();
}

function extractListIntroTail(original: string): string | null {
  const o = String(original || '').trim();
  if (!o || !o.endsWith(':')) return null;
  const lastColon = o.lastIndexOf(':');
  if (lastColon <= 0) return null;

  // Find a reasonable boundary before the final ":" so we can recover just the list-intro phrase.
  // Prefer sentence boundaries, but fall back to comma/semicolon for one-sentence intros like "... zoals:"
  const boundaries = ['.', '!', '?', '\n', ';', ','];
  let start = 0;
  for (const b of boundaries) {
    const i = o.lastIndexOf(b, lastColon - 1);
    if (i >= 0 && i + 1 > start) start = i + 1;
  }
  const tail = o.slice(start).trim();
  if (!tail || !tail.endsWith(':')) return null;

  // Safety: if we can't isolate a short tail, don't risk duplicating a whole paragraph.
  if (tail.length > 140) return null;
  return tail;
}

function mergeListIntroTail(rewritten: string, tail: string): string {
  const base0 = String(rewritten || '').trim();
  const tail0 = String(tail || '').trim();
  if (!base0) return tail0;
  if (!tail0) return base0;
  if (base0.endsWith(':')) return base0;

  // If the tail is a connector word (like "zoals:" / "bijvoorbeeld:"), attach it with a comma
  // when the rewritten currently ends a sentence (".", "?", "!"). This prevents "... . zoals:".
  const connectorRe = /^(zoals|bijvoorbeeld|namelijk|onder andere)\b/i;
  if (connectorRe.test(tail0) && /[.!?]$/.test(base0)) {
    const baseNoPunct = base0.replace(/[.!?]\s*$/g, '').trim();
    if (!baseNoPunct) return tail0;
    return `${baseNoPunct}, ${tail0}`.replace(/\s+/g, ' ').trim();
  }

  // Default: treat the tail as its own short sentence/phrase.
  // If base already ends with punctuation (incl. ":"/";"/","), just add a space.
  const joiner = /[,:;]$/.test(base0) ? ' ' : ' ';
  return `${base0}${joiner}${tail0}`.replace(/\s+/g, ' ').trim();
}

function splitSemicolonItems(text: string): string[] {
  const s = String(text ?? '');
  const raw = s.split(';');
  const endsWithSemi = s.trim().endsWith(';');
  const items: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const part = String(raw[i] ?? '').trim();
    if (!part) continue;
    if (i < raw.length - 1) items.push(`${part};`);
    else items.push(endsWithSemi ? `${part};` : part);
  }
  return items;
}

function stripTrailingListPunct(s: string): string {
  let t = String(s ?? '').trim();
  t = t.replace(/^[•\-\u2022]\s*/g, '').trim();
  // Remove trailing semicolons/commas/spaces (keep inner punctuation like hyphens).
  t = t.replace(/[;,\s]+$/g, '').trim();
  // Also remove a single trailing sentence/connector punctuation often used at the end of the last item.
  // Example: "water." → "water"
  t = t.replace(/[.!?:]\s*$/g, '').trim();
  return t;
}

function joinDutchList(items: string[]): string {
  const xs = items.map((x) => stripTrailingListPunct(x)).filter(Boolean);
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0]!;
  if (xs.length === 2) return `${xs[0]} en ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} en ${xs[xs.length - 1]}`;
}

function ensureTerminalPeriod(s: string): string {
  const t = String(s ?? '').trim();
  if (!t) return t;
  if (/[.!?]$/.test(t)) return t;
  return `${t}.`;
}

function isMicroListItem(it: string): boolean {
  const t = stripTrailingListPunct(it);
  if (!t) return false;
  // Avoid accidentally collapsing explanatory bullets into prose.
  if (/[.!?:]/.test(t)) return false;
  if (t.length > 80) return false;
  const toks = t.match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-/][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g) || [];
  // Keep this conservative: micro-opsommingen should be short.
  if (toks.length > 6) return false;
  return true;
}

function collapseBulletSemicolonListToProseList(text: string): string | null {
  const itemsRaw = splitSemicolonItems(text);
  if (itemsRaw.length < 2) return null;
  // Avoid huge lists becoming unreadable prose blobs.
  if (itemsRaw.length > 12) return null;
  const items = itemsRaw.map((x) => stripTrailingListPunct(x)).filter(Boolean);
  if (items.length < 2) return null;
  if (!items.every(isMicroListItem)) return null;
  return ensureTerminalPeriod(joinDutchList(items));
}

function mergeListIntroWithInlineProseList(intro: string, listText: string): string {
  let i = String(intro ?? '').trim();
  let l = String(listText ?? '').trim();
  if (!i) return ensureTerminalPeriod(l);
  if (!l) return ensureTerminalPeriod(i);

  // Remove any bullet glyphs that might have survived upstream.
  l = l.replace(/^[•\-\u2022]\s*/g, '').trim();
  l = ensureTerminalPeriod(l);

  const hadColon = /:\s*$/.test(i);
  // Drop trailing punctuation from the intro; the listText carries the terminal punctuation.
  i = i.replace(/:\s*$/g, '').trim();
  i = i.replace(/[.!?]\s*$/g, '').trim();

  // If the intro already ends with a natural connector, we can join directly.
  const endsWithConnector = /\b(zoals|bijvoorbeeld|namelijk)\s*$/i.test(i);
  // If the intro already reads like an enumeration lead-in ("... zijn", "... bestaat uit"),
  // we can also join directly without adding "zoals" (which would weaken meaning).
  const endsWithDirectLeadIn = /\b(zijn|bestaat uit|bestaan uit)\s*$/i.test(i);

  if (!endsWithConnector && !endsWithDirectLeadIn && hadColon) {
    // Prefer inline prose lists: avoid ':' and add a gentle connector.
    // Example: "Kleine stoffen gaan daar makkelijker doorheen:" + "zuurstof, ..." → "... doorheen, zoals zuurstof, ..."
    const sep = i.endsWith(',') ? ' ' : ', ';
    return `${i}${sep}zoals ${l}`.replace(/\s+/g, ' ').trim();
  }

  return `${i} ${l}`.replace(/\s+/g, ' ').trim();
}

function looksLikeInlineProseList(listText: string): boolean {
  const t0 = String(listText ?? '').trim();
  if (!t0) return false;
  // Semicolons means it's still encoded as a list; we only merge when it became prose.
  if (t0.includes(';')) return false;
  if (t0.includes('\n') || t0.includes('\r')) return false;
  // Needs at least one list join signal.
  if (!t0.includes(',') && !/\s+en\s+/i.test(t0)) return false;

  // Must be a single sentence-like inline list: allow ONE terminal .!? only at the end.
  const t = t0.replace(/\s+/g, ' ').trim();
  const tNoEnd = t.replace(/[.!?]\s*$/g, '').trim();
  if (/[.!?]/.test(tNoEnd)) return false;
  if (/:/.test(tNoEnd)) return false;

  // Keep conservative: long prose paragraphs should not be merged.
  const words = tNoEnd.match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-/][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g) || [];
  if (words.length > 22) return false;
  if (t.length > 240) return false;
  return true;
}

function lowercaseFirstLetterUnlessAbbrev(s: string): string {
  const t = String(s ?? '').trim();
  if (!t) return t;
  const idx = t.search(/\p{L}/u);
  if (idx < 0) return t;
  const tail = t.slice(idx);
  const token = (tail.match(/^[\p{L}\p{N}]+/u) || [])[0] || '';
  const isAbbrev =
    !!token &&
    ((token.length <= 4 && token === token.toUpperCase()) ||
      /[0-9]/.test(token) ||
      // Common Dutch abbreviations start with capital and contain a dot, but we don't want to lowercase them.
      /^[A-Z]{1,4}$/.test(token));
  if (isAbbrev) return t;
  return (t.slice(0, idx) + t[idx]!.toLowerCase() + t.slice(idx + 1)).trim();
}

function extractListIntroTailForPrince(original: string): string {
  let t = normalizePunctSpacingKeepNewlines(String(original ?? ''))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  t = t.replace(/:\s*$/, '').trim();
  if (!t) return '';
  // Take the last sentence/clause after the last .!? to avoid duplicating earlier content.
  const lastDot = t.lastIndexOf('.');
  const lastEx = t.lastIndexOf('!');
  const lastQ = t.lastIndexOf('?');
  const cut = Math.max(lastDot, lastEx, lastQ);
  if (cut >= 0 && cut + 1 < t.length) {
    const tail = t.slice(cut + 1).trim();
    if (tail) return tail;
  }
  return t;
}

function escapeRegex(s: string): string {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyDeterministicFixesToParagraphs(
  paras: RewritesForIndesignParagraph[],
  opts: { mode?: RewriteLintMode } = {}
): {
  moves: MoveLayerBlock[];
  punctuation_changed: number;
  list_intro_restored: number;
  heading_spacing_normalized: number;
} {
  const mode: RewriteLintMode = opts.mode === 'prince' ? 'prince' : 'indesign';
  const moves: MoveLayerBlock[] = [];

  // First pass: punctuation spacing normalization in rewritten only
  let punctuation_changed = 0;
  for (const p of paras) {
    const before = String(p.rewritten || '');
    // If an LLM inserted an explicit "remove" marker, never let it leak into student-facing output.
    // Treat it as a merged-away paragraph (content was moved into a base paragraph elsewhere).
    const beforeTrim = before.trim();
    if (/^<<VERWIJDERD_NAAR_BASIS>>[.!?]?$/.test(beforeTrim)) {
      if (mode === 'indesign') {
        // InDesign apply cannot safely "merge away" whole paragraphs without breaking deterministic
        // paragraph structure (bullets, intros, etc). Treat this as invalid for indesign-mode and
        // conservatively fall back to ORIGINAL to preserve layout + item-count parity.
        let restored = normalizePunctSpacingKeepNewlines(String(p.original || ''));
        // If this is a bullet paragraph, ensure we don't inject literal bullet characters and keep
        // semicolon encoding tight.
        if (isBulletStyleName(String(p.style_name || ''))) {
          restored = restored.replace(/^[•\-\u2022]\s*/g, '');
          restored = restored.replace(/;\s+/g, ';');
        }
        p.rewritten = restored;
        punctuation_changed++;
      } else {
        (p as any)._merged_away = true;
        if (before !== '') {
          p.rewritten = '';
          punctuation_changed++;
        }
      }
      continue;
    }
    let after = normalizePunctSpacingKeepNewlines(before);

    // IMPORTANT (InDesign-only): semicolons inside bullet-style paragraphs are an *encoding*
    // for multiple bullet items (later split into separate paragraphs). For deterministic apply + stable
    // styling, we keep this encoding tight (no spaces after ';').
    if (mode === 'indesign') {
      try {
        if (isBulletStyleName(String(p.style_name || ''))) {
          after = after.replace(/;\s+/g, ';');

          // InDesign-only: if the ORIGINAL bullet paragraph is a semicolon-encoded multi-item list,
          // the REWRITTEN must preserve the same number of ';' items (deterministic apply contract).
          //
          // Many Prince-first runs intentionally collapse/merge these bullets into prose and leave the
          // bullet paragraph empty. That is fine for Prince, but it MUST be reversed for InDesign apply.
          const oItems = splitSemicolonItems(String(p.original || ''));
          if (oItems.length >= 2) {
            const wItems = splitSemicolonItems(String(after || ''));
            if (wItems.length !== oItems.length) {
              // Conservative, layout-safe fallback: keep the original bullet items (structure + count),
              // rather than attempting a lossy re-splitting of prose.
              let restored = normalizePunctSpacingKeepNewlines(String(p.original || ''));
              // Avoid inserting literal bullet characters into the content; bullets should come from paragraph style.
              restored = restored.replace(/^[•\-\u2022]\s*/g, '');
              // Keep semicolon encoding tight (no spaces after ';').
              restored = restored.replace(/;\s+/g, ';');
              after = restored;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Prince-first: if a bullet-style paragraph is just a short semicolon item list,
    // rewrite it as a running micro-opsomming (commas + "en") so it reads like prose:
    // "zuurstof; koolstofdioxide; water." → "zuurstof, koolstofdioxide en water."
    if (mode === 'prince') {
      try {
        if (isBulletStyleName(String(p.style_name || ''))) {
          const collapsed = collapseBulletSemicolonListToProseList(after);
          if (collapsed) after = collapsed;
        }
      } catch {
        // ignore
      }

      // Prince-first: remove hard line breaks inside a paragraph.
      // We keep '\n\n' semantics only for combined paragraphs (praktijk/verdieping markers),
      // but normal body/bullet text should not contain '\n' because it can render as hard breaks.
      try {
        if (after.includes('\n')) {
          if (hasAnyLayerBlock(after)) {
            const parsed = parseCombined(after);
            parsed.base = String(parsed.base || '')
              .replace(/\s*\n+\s*/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (parsed.praktijkLine) {
              parsed.praktijkLine = String(parsed.praktijkLine || '')
                .replace(/\s*\n+\s*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            }
            if (parsed.verdiepingLine) {
              parsed.verdiepingLine = String(parsed.verdiepingLine || '')
                .replace(/\s*\n+\s*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            }
            after = buildCombined(parsed);
          } else {
            after = after
              .replace(/\s*\n+\s*/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
        }
      } catch {
        // ignore
      }
    }
    if (after !== before) {
      p.rewritten = after;
      punctuation_changed++;
    }
  }

  // Pass 1b: normalize combined heading spacing inside a paragraph.
  // If a paragraph contains layer blocks (praktijk/verdieping), ensure they are preceded by a blank line.
  // This fixes cases where an LLM outputs "\n<<BOLD_START>>..." instead of "\n\n<<BOLD_START>>...".
  let heading_spacing_normalized = 0;
  for (const p of paras) {
    const before = String(p.rewritten || '');
    if (!hasAnyLayerBlock(before)) continue;
    const parsed = parseCombined(before);
    const rebuilt = buildCombined(parsed);
    if (rebuilt !== before) {
      p.rewritten = rebuilt;
      heading_spacing_normalized++;
    }
  }

  // Second pass: move layer blocks out of list-intro paragraphs before bullet runs
  for (let i = 0; i < paras.length - 1; i++) {
    const cur = paras[i]!;
    const next = paras[i + 1]!;

    if (!isListIntro(String(cur.original || ''))) continue;
    if (!hasAnyLayerBlock(String(cur.rewritten || ''))) continue;
    if (!isBulletStyleName(String(next.style_name || ''))) continue;

    const before = String(cur.rewritten || '');
    const parsed = parseCombined(before);
    if (!parsed.praktijkLine && !parsed.verdiepingLine) continue;

    // Remove blocks from list-intro paragraph
    cur.rewritten = buildCombined({ base: parsed.base, praktijkLine: null, verdiepingLine: null });

    // Find target after the bullet run
    let j = i + 1;
    while (j < paras.length && isBulletStyleName(String(paras[j]!.style_name || ''))) j++;
    const target = j < paras.length ? paras[j]! : null;

    if (!target) {
      moves.push({
        from_id: String(cur.paragraph_id || ''),
        to_id: null,
        reason: 'List-intro before bullets; no non-bullet target found to move layer blocks into',
        moved: { praktijk: !!parsed.praktijkLine, verdieping: !!parsed.verdiepingLine },
      });
      continue;
    }

    const tgtParsed = parseCombined(String(target.rewritten || ''));
    if (parsed.praktijkLine && !tgtParsed.praktijkLine) tgtParsed.praktijkLine = parsed.praktijkLine;
    if (parsed.verdiepingLine && !tgtParsed.verdiepingLine) tgtParsed.verdiepingLine = parsed.verdiepingLine;
    target.rewritten = buildCombined(tgtParsed);

    moves.push({
      from_id: String(cur.paragraph_id || ''),
      to_id: String(target.paragraph_id || ''),
      reason: 'Moved layer block(s) out of list-intro paragraph (followed by bullet run)',
      moved: { praktijk: !!parsed.praktijkLine, verdieping: !!parsed.verdiepingLine },
    });
  }

  // Third pass: preserve list-intro context when followed by bullet runs.
  // If the original ends with ":" and the next paragraph is a bullet, then the rewritten should
  // also end with ":" (otherwise the bullet list reads like it starts "floating" without intro).
  //
  // InDesign mode: restore a short tail phrase from the original (or fall back to original),
  // because apply is deterministic and intros often contain connector words like "namelijk de:".
  //
  // Prince-first mode: only keep ':' if a REAL list remains (semicolon items).
  let list_intro_restored = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    const cur = paras[i]!;
    const next = paras[i + 1]!;

    if (!isListIntro(String(cur.original || ''))) continue;
    if (!isBulletStyleName(String(next.style_name || ''))) continue;

    const rw = String(cur.rewritten || '').trim();
    if (mode === 'prince') {
      const nextRw = String(next.rewritten || '').trim();
      const nextOriginalWasSemicolonList = splitSemicolonItems(String(next.original || '')).length >= 2;
      const nextRewrittenIsSemicolonList = splitSemicolonItems(nextRw).length >= 2;

      // Prince-first: if the next bullet paragraph was a semicolon-encoded multi-item list in the ORIGINAL,
      // but is now written as inline prose (commas + "en") in REWRITTEN, MERGE it back into the intro line.
      // This avoids ugly fragments like:
      //   "Voorbeelden van organellen zijn." + "de celkern, mitochondriën ..."
      // and produces:
      //   "Voorbeelden van organellen zijn de celkern, mitochondriën ..."
      if (nextOriginalWasSemicolonList && !nextRewrittenIsSemicolonList && nextRw && looksLikeInlineProseList(nextRw)) {
        const listCore = String(nextRw).replace(/[.!?]\s*$/g, '').trim();
        const listLower = lowercaseFirstLetterUnlessAbbrev(listCore);

        const curStyle = String(cur.style_name || '');
        const curIsBullet = isBulletStyleName(curStyle);

        if (curIsBullet) {
          // Nested list under a bullet item: keep prose natural by adding a short examples sentence.
          const base = ensureTerminalPeriod(String(cur.rewritten || '').trim().replace(/:\s*$/g, '').trim());
          cur.rewritten = `${base} Voorbeelden hiervan zijn ${listLower}.`.replace(/\s+/g, ' ').trim();
        } else if (String(cur.rewritten || '').trim().endsWith(':')) {
          // The rewritten itself is a dangling intro with ":" — merge directly into that sentence.
          cur.rewritten = mergeListIntroWithInlineProseList(String(cur.rewritten || ''), listLower);
        } else {
          // Append a clean list-intro tail as a NEW sentence, derived from the original list-intro.
          const tailIntro = extractListIntroTailForPrince(String(cur.original || ''));
          const sentenceIntro = tailIntro || 'Voorbeelden zijn';
          // Avoid duplicated fragments like "Voorbeelden ... zijn. Voorbeelden ... zijn <list>".
          let baseRaw = String(cur.rewritten || '').trim().replace(/:\s*$/g, '').trim();
          try {
            const dupRe = new RegExp(`${escapeRegex(sentenceIntro)}\\s*[.!?]?\\s*$`, 'i');
            if (dupRe.test(baseRaw)) baseRaw = baseRaw.replace(dupRe, '').trim();
          } catch {
            // ignore
          }
          const base = ensureTerminalPeriod(baseRaw);
          const mergedSentence = mergeListIntroWithInlineProseList(`${sentenceIntro}:`, listLower);
          cur.rewritten = `${base ? base + ' ' : ''}${mergedSentence}`.replace(/\s+/g, ' ').trim();
        }
        // Mark the next paragraph as intentionally merged away (Prince-first prose list merge).
        // We keep rewritten empty so downstream renderers can omit it, but we must also ensure
        // safety passes don't "restore" it (which would reintroduce duplication).
        (next as any)._merged_away = true;
        next.rewritten = '';
        list_intro_restored++;
        continue;
      }

      // Prince-first: keep ':' ONLY if the next paragraph still looks like a semicolon-encoded list.
      // This avoids dangling ':' when bullet-style paragraphs are actually just running text in the rewrite.
      // Prince-first policy:
      // - If the bullet run was collapsed/emptied (rewritten empty), do NOT keep ':'.
      // - If the NEXT bullet paragraph was originally a semicolon-encoded multi-item list, we allow converting it to prose.
      //   In that case, keep ':' only if the rewritten still looks like a semicolon list.
      // - Otherwise (true bullet paragraphs), keep ':' so the list is anchored.
      let j = i + 1;
      let anyNonEmptyBullet = false;
      while (j < paras.length && isBulletStyleName(String(paras[j]!.style_name || ''))) {
        if (String(paras[j]!.rewritten || '').trim()) anyNonEmptyBullet = true;
        j++;
      }
      // Prince-first: if a bullet run exists (non-empty), keep the ':' so the list stays anchored.
      // Even when a semicolon-encoded list was rewritten into full sentences, it's still a list in DTP terms,
      // and dropping ':' creates broken intros like "Dit gebeurt bij.".
      const shouldHaveColon = anyNonEmptyBullet;

      // Special-case: a bullet paragraph that ended with "tot:" in the ORIGINAL sometimes loses the list tail
      // and becomes an unfinished sentence like "Deze loopt van het bekken tot." while its following list items
      // were merged away. In that case, recover the tail deterministically from the next paragraph's ORIGINAL list.
      if (
        !shouldHaveColon &&
        /\btot\s*:\s*$/i.test(String(cur.original || '').trim()) &&
        /\btot[.:]?\s*$/i.test(rw)
      ) {
        const nextWasMergedAway = (next as any)?._merged_away === true || !String(next.rewritten || '').trim();
        const nextOrigItems = splitSemicolonItems(String(next.original || ''));
        if (nextWasMergedAway && nextOrigItems.length >= 2) {
          const tail = joinDutchList(nextOrigItems);
          if (tail) {
            cur.rewritten = rw
              .replace(/\btot[.:]?\s*$/i, `tot ${tail}.`)
              .replace(/\s+/g, ' ')
              .trim();
            list_intro_restored++;
            continue;
          }
        }
      }

      if (!rw) {
        // If we have no rewrite, fall back to original, but drop trailing ':' when no list remains.
        let base = normalizePunctSpacingKeepNewlines(String(cur.original || ''));
        if (!shouldHaveColon) base = base.replace(/:\s*$/, '').trim();
        cur.rewritten = base;
        if (base !== String(cur.original || '')) list_intro_restored++;
        continue;
      }

      // If the next paragraph no longer looks like a list, we should NOT force ':'.
      // Also strip a trailing ':' if it exists, otherwise the sentence reads unfinished.
      if (!shouldHaveColon) {
        if (rw.endsWith(':')) {
          // Convert a dangling list-intro ":" into a normal sentence ending.
          // Prefer '.' over just stripping, because bare "... zijn" reads unfinished.
          let base = rw.replace(/[.!?]\s*:\s*$/, '.').replace(/:\s*$/, '').trim();
          if (base && !/[.!?]$/.test(base)) base = `${base}.`;
          cur.rewritten = base;
          list_intro_restored++;
        }
        continue;
      }

      // Next still looks like a list (semicolon items): keep ':' for readability.
      if (rw.endsWith(':')) {
        // Avoid the ugly ".:" ending if it happens
        const cleaned = rw.replace(/[.!?]\s*:\s*$/, ':');
        if (cleaned !== rw) {
          cur.rewritten = cleaned;
          list_intro_restored++;
        }
        continue;
      }
      // Soft fix: replace a final sentence punct with ":" or append ":".
      const fixed = rw.replace(/[.!?]\s*$/, '').trim();
      cur.rewritten = `${fixed}:`.trim();
      list_intro_restored++;
      continue;
    }

    // mode === 'indesign'
    const tail = extractListIntroTail(String(cur.original || ''));
    // If rewritten already ends with ":" we still may need to restore the short tail phrase
    // (e.g. original ends with "namelijk de:" but rewritten ends with just ".:").
    if (rw.endsWith(':')) {
      if (tail && tail.length > 2) {
        const tailCore = tail.replace(/:\s*$/, '').trim().toLowerCase();
        if (tailCore && !rw.toLowerCase().includes(tailCore)) {
          const rwNoColon = rw.replace(/:\s*$/, '').trim();
          cur.rewritten = mergeListIntroTail(rwNoColon, tail);
          list_intro_restored++;
        }
      } else {
        // If we can't recover a meaningful tail, at least avoid the ugly ".:" ending.
        cur.rewritten = rw.replace(/[.!?]\s*:\s*$/, ':');
      }
      continue;
    }

    if (tail) {
      cur.rewritten = mergeListIntroTail(rw, tail);
    } else {
      cur.rewritten = normalizePunctSpacingKeepNewlines(String(cur.original || ''));
    }
    list_intro_restored++;
  }

  // Prince-first: avoid leaving a paragraph ending with "namelijk" (dangling list-intro word).
  // If it does not introduce a real list, remove "namelijk" and finish the sentence.
  if (mode === 'prince') {
    for (let i = 0; i < paras.length; i++) {
      const cur = paras[i]!;
      const rw = String(cur.rewritten || '').trim();
      if (!rw) continue;
      // Only handle the most common broken form: paragraph ends with the bare word "namelijk".
      if (!/\bnamelijk\s*$/i.test(rw)) continue;
      if (rw.endsWith(':')) continue; // already "namelijk:" or similar

      // Determine whether a real list follows (same heuristic as above).
      let shouldHaveColon = false;
      if (i + 1 < paras.length && isBulletStyleName(String(paras[i + 1]!.style_name || ''))) {
        let j = i + 1;
        const bulletRun: RewritesForIndesignParagraph[] = [];
        while (j < paras.length && isBulletStyleName(String(paras[j]!.style_name || ''))) {
          bulletRun.push(paras[j]!);
          j++;
        }
        const nonEmpty = bulletRun.filter((p) => String(p.rewritten || '').trim().length > 0);
        const hasSemicolonList = nonEmpty.some((p) => splitSemicolonItems(String(p.rewritten || '')).length >= 2);
        shouldHaveColon = hasSemicolonList || nonEmpty.length >= 2;
      }

      if (shouldHaveColon) {
        const fixed = rw.replace(/\bnamelijk\s*$/i, 'namelijk:').trim();
        if (fixed !== rw) {
          cur.rewritten = fixed;
          punctuation_changed++;
        }
      } else {
        let base = rw.replace(/(?:,\s*)?namelijk\s*$/i, '').trim();
        if (!base) continue;
        if (!/[.!?:]$/.test(base)) base = `${base}.`;
        if (base !== rw) {
          cur.rewritten = base;
          punctuation_changed++;
        }
      }
    }
  }

  // Prince-first: avoid leaving a paragraph ending with a dangling connector like "zoals" or "bijvoorbeeld".
  // If it does not introduce a real list, remove the connector and finish the sentence.
  if (mode === 'prince') {
    for (let i = 0; i < paras.length; i++) {
      const cur = paras[i]!;
      const rw0 = String(cur.rewritten || '').trim();
      if (!rw0) continue;

      const m = rw0.match(/\b(zoals|bijvoorbeeld)\b[.:,]?\s*$/i);
      if (!m) continue;

      // Determine whether a list follows (semicolon list or inline micro-list).
      let listFollows = false;
      if (i + 1 < paras.length && isBulletStyleName(String(paras[i + 1]!.style_name || ''))) {
        const nxt = String(paras[i + 1]!.rewritten || '').trim();
        const hasSemi = splitSemicolonItems(nxt).length >= 2;
        const hasInline = looksLikeInlineProseList(nxt);
        listFollows = hasSemi || hasInline;
      }

      if (listFollows) continue; // keep as-is; writer/repair can improve wording later

      let base = rw0.replace(/\b(zoals|bijvoorbeeld)\b[.:,]?\s*$/i, '').trim();
      base = base.replace(/[,:;]\s*$/g, '').trim();
      if (!base) continue;
      if (!/[.!?]$/.test(base)) base = `${base}.`;
      if (base !== rw0) {
        cur.rewritten = base;
        punctuation_changed++;
      }
    }
  }

  // Prince-first: ensure body-like paragraphs don't end as a bare fragment with no terminal punctuation.
  // (This helps prevent validator churn on simple "missing dot" endings.)
  if (mode === 'prince') {
    for (const p of paras) {
      const styleRaw = String(p.style_name || '');
      const style = styleRaw.toLowerCase();
      // Skip headings/titles
      if (style.includes('header') || style.includes('title')) continue;
      const isBullet = isBulletStyleName(styleRaw);
      let rw = String(p.rewritten || '').trim();
      if (!rw) continue;

      const fixTerminal = (s: string) => {
        const t = String(s || '').trim();
        if (!t) return t;
        if (/[.!?:…]$/.test(t)) return t;
        // Avoid creating ";." on semicolon-encoded bullet items. In Prince-first, trailing semicolons
        // are often an internal list encoding (later split/demoted by the renderer), not intended punctuation.
        if (/;\s*$/.test(t)) {
          return isBullet ? t : t.replace(/;\s*$/g, '.');
        }
        return `${t}.`;
      };

      if (hasAnyLayerBlock(rw)) {
        const parsed = parseCombined(rw);
        const fixedBase = fixTerminal(String(parsed.base || ''));
        if (fixedBase !== String(parsed.base || '')) {
          parsed.base = fixedBase;
          p.rewritten = buildCombined(parsed);
          punctuation_changed++;
        }
      } else {
        const fixed = fixTerminal(rw);
        if (fixed !== rw) {
          p.rewritten = fixed;
          punctuation_changed++;
        }
      }
    }
  }

  // Final pass (InDesign-only): enforce semicolon bullet item-count parity AFTER all other transforms.
  // Some earlier passes (e.g. list-intro restoration for nested bullet runs) can accidentally append
  // non-item tails after a semicolon, which increases splitSemicolonItems() count and breaks deterministic apply.
  if (mode === 'indesign') {
    for (const p of paras) {
      const style = String(p.style_name || '');
      if (!isBulletStyleName(style)) continue;
      const oItems = splitSemicolonItems(String(p.original || ''));
      if (oItems.length < 2) continue;
      const wItems = splitSemicolonItems(String(p.rewritten || ''));
      if (wItems.length === oItems.length) continue;

      // Conservative fallback: keep original semicolon encoding exactly reminds the list structure.
      let restored = normalizePunctSpacingKeepNewlines(String(p.original || ''));
      restored = restored.replace(/^[•\-\u2022]\s*/g, '');
      restored = restored.replace(/;\s+/g, ';');
      p.rewritten = restored;
      punctuation_changed++;
    }
  }

  // Prince-first safety: never leave a non-empty ORIGINAL paragraph with an empty REWRITTEN.
  // Empty rewrites create content loss (or confusing gaps) in the Prince output and can break
  // list continuity. If an LLM mistakenly returns "", fall back to a safe deterministic rewrite.
  if (mode === 'prince') {
    const normalizeForContains = (s: string): string => {
      // Lowercase, remove markers, normalize punctuation/spaces so we can do conservative substring checks.
      return String(s || '')
        .replace(/\r/g, '\n')
        .replace(/<<BOLD_START>>|<<BOLD_END>>/g, '')
        .replace(/[\u00AD]/g, '') // soft hyphen
        .toLowerCase()
        .replace(/[^0-9a-z\u00E0-\u00FF]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const requiredItemMatches = (nItems: number): number => {
      if (nItems <= 2) return 2;
      if (nItems === 3) return 3;
      // For longer lists, require a majority, but at least 3.
      return Math.max(3, Math.ceil(nItems * 0.6));
    };

    for (let i = 0; i < paras.length; i++) {
      const p = paras[i]!;
      const o = String(p.original || '').trim();
      const r = String(p.rewritten || '').trim();
      if (!o || r) continue;

      // If the paragraph was intentionally merged away (e.g., list intro + inline micro-list),
      // keep it empty. Restoring it would reintroduce duplication.
      if ((p as any)._merged_away === true) continue;

      // Back-compat heuristic: older runs may have intentionally emptied bullet paragraphs
      // after collapsing a semicolon list into prose in the *previous* paragraph, but without
      // recording `_merged_away`. Detect that case to avoid reintroducing duplicate bullets.
      const style = String(p.style_name || '');
      if (isBulletStyleName(style)) {
        const items = splitSemicolonItems(o).map((x) => stripTrailingListPunct(x)).filter(Boolean);
        if (items.length >= 2 && i > 0) {
          const prev = paras[i - 1]!;
          const prevRw0 = String(prev.rewritten || '').trim();
          if (prevRw0) {
            const prevBase = hasAnyLayerBlock(prevRw0) ? parseCombined(prevRw0).base : prevRw0;
            const prevNorm = normalizeForContains(prevBase);
            const want = requiredItemMatches(items.length);
            let hits = 0;
            for (const it of items) {
              const itNorm = normalizeForContains(it);
              if (!itNorm) continue;
              if (prevNorm.includes(itNorm)) hits++;
            }
            const prevLooksLikeIntro = isListIntro(String(prev.original || ''));
            if (hits >= want && (prevLooksLikeIntro || hits >= Math.max(3, want))) {
              (p as any)._merged_away = true;
              continue;
            }
          }
        }
      }

      let fallback = o;
      try {
        if (isBulletStyleName(style)) {
          // Prefer prose lists for short semicolon lists (Prince-first).
          const collapsed = collapseBulletSemicolonListToProseList(o);
          if (collapsed) fallback = collapsed;
        }
      } catch {
        // ignore
      }

      p.rewritten = fallback;
      punctuation_changed++;
    }
  }

  return { moves, punctuation_changed, list_intro_restored, heading_spacing_normalized };
}



