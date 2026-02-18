export type RewritesForIndesignParagraph = {
  paragraph_id?: string;
  chapter?: string;
  paragraph_number?: number;
  subparagraph_number?: number | null;
  original?: string;
  rewritten?: string;
  style_name?: string;
};

export type JsonLintResult = {
  errors: string[];
  warnings: string[];
};

export type RewriteLintMode = 'indesign' | 'prince';

export const PR_MARKER = '<<BOLD_START>>In de praktijk:<<BOLD_END>>';
export const VE_MARKER = '<<BOLD_START>>Verdieping:<<BOLD_END>>';

export function isBulletStyleName(styleName: string | null | undefined): boolean {
  const s = String(styleName || '').toLowerCase();
  return s.includes('bullet') || s.includes('_bullets') || s.includes('•bullets');
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

export function isListIntro(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  return !!t && t.endsWith(':');
}

export function hasAnyLayerBlock(text: string | null | undefined): boolean {
  const t = String(text || '');
  return t.includes(PR_MARKER) || t.includes(VE_MARKER);
}

export function lintRewritesForIndesignJsonParagraphs(
  paras: RewritesForIndesignParagraph[],
  opts: { mode?: RewriteLintMode } = {}
): JsonLintResult {
  const mode: RewriteLintMode = (opts.mode === 'prince' || opts.mode === 'indesign' ? opts.mode : 'indesign') as RewriteLintMode;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Cross-paragraph structural rule:
  // list-intro paragraph (ends with ":") MUST NOT contain praktijk/verdieping blocks if followed by bullet run.
  for (let i = 0; i < paras.length - 1; i++) {
    const cur = paras[i] || {};
    const next = paras[i + 1] || {};

    const curOriginal = String(cur.original || '');
    const curRewritten = String(cur.rewritten || '');
    const nextStyle = String(next.style_name || '');

    if (isListIntro(curOriginal) && hasAnyLayerBlock(curRewritten) && isBulletStyleName(nextStyle)) {
      const pid = String(cur.paragraph_id || '');
      const ch = String(cur.chapter || '');
      const pn = cur.paragraph_number ?? '';
      const sp = cur.subparagraph_number ?? '';
      const num = [ch, pn, sp].filter((x) => String(x).length > 0).join('.');
      errors.push(
        `[${pid}] ${num}: list-intro paragraph contains praktijk/verdieping block and is followed by bullets. This will break reading flow (layer lands between intro and list).`
      );
    }

    // Structural rule:
    // If the ORIGINAL is a list-intro (ends with ":") and the NEXT paragraph is bullets,
    // then the rewritten MUST still end with ":" to keep the bullet list anchored in context.
    // Otherwise the first bullet item can look like it “floats” without an intro line.
    if (isListIntro(curOriginal) && isBulletStyleName(nextStyle) && !String(curRewritten || '').trim().endsWith(':')) {
      const pid = String(cur.paragraph_id || '');
      const ch = String(cur.chapter || '');
      const pn = cur.paragraph_number ?? '';
      const sp = cur.subparagraph_number ?? '';
      const num = [ch, pn, sp].filter((x) => String(x).length > 0).join('.');
      if (mode === 'indesign') {
        errors.push(
          `[${pid}] ${num}: list-intro paragraph (followed by bullets) lost the trailing ':' in rewritten; bullets will read out of context.`
        );
      } else {
        // Prince-first: bullets are not a deterministic apply contract, but losing ':' can still harm reading flow.
        // Only warn if the next paragraph still appears to be a multi-item list in the rewritten text.
        const nextRw = String(next.rewritten || '');
        const nextItems = splitSemicolonItems(nextRw);
        if (nextItems.length >= 2) {
          warnings.push(
            `[${pid}] ${num}: list-intro paragraph is followed by a bullet/list paragraph but lost the trailing ':' in rewritten; consider ending with ':' for readability.`
          );
        }
      }
    }
  }

  // Single-paragraph heuristics (warnings only; keep conservative)
  for (const p of paras) {
    const pid = String(p.paragraph_id || '');
    const ch = String(p.chapter || '');
    const pn = p.paragraph_number ?? '';
    const sp = p.subparagraph_number ?? '';
    const num = [ch, pn, sp].filter((x) => String(x).length > 0).join('.');

    const style = String(p.style_name || '');
    const rewritten = String(p.rewritten || '');
    if (isBulletStyleName(style) && hasAnyLayerBlock(rewritten)) {
      warnings.push(`[${pid}] ${num}: bullet-style paragraph contains a layer block; review placement risk.`);
    }

    // InDesign-only hard rule: if a bullet paragraph's ORIGINAL is a semicolon list (>=2 items),
    // the REWRITTEN must preserve semicolon list structure with the same item count.
    if (mode === 'indesign' && isBulletStyleName(style)) {
      const oItems = splitSemicolonItems(String(p.original || ''));
      if (oItems.length >= 2) {
        const wItems = splitSemicolonItems(String(p.rewritten || ''));
        if (wItems.length !== oItems.length) {
          errors.push(
            `[${pid}] ${num}: bullet semicolon-list structure mismatch (original_items=${oItems.length} rewritten_items=${wItems.length}). ` +
              `For bullet paragraphs, rewritten must keep the same number of ';' items to preserve deterministic apply.`
          );
        }
      }
    }
  }

  return { errors, warnings };
}



