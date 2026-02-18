export type IndesignHeadingKind = 'praktijk' | 'verdieping';

export type ValidationResult = {
  errors: string[];
  warnings: string[];
};

export function sanitizeSameParagraph(text: string): string {
  // InDesign: \r = new paragraph (forbidden in same-paragraph placement)
  // We normalize to \n and trim outer whitespace, but keep internal \n structure.
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Normalize obvious spacing glitches early (these are structural, not stylistic):
    // - No space before punctuation
    // - Ensure a space after sentence-ending punctuation when followed by a letter (fixes "woord.Zin")
    // Keep \n as-is (do not collapse line structure).
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([.!?])([A-Za-zÀ-ÖØ-öø-ÿ])/g, '$1 $2')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function sanitizeLayerText(text: string): string {
  // Layer texts ("basis"/"praktijk"/"verdieping") should be plain running text.
  // We allow NO embedded line breaks here; line breaks are only inserted by the combiner
  // (blank line before headings via '\n\n', Option A).
  const t = sanitizeSameParagraph(text);
  return t
    .replace(/\n+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function stripEmbeddedLayerLabels(text: string): string {
  // Defensive: upstream rewrites should not contain these labels,
  // but if they do, strip them so we don’t duplicate headings in combined output.
  let t = sanitizeSameParagraph(text);
  // Remove label at line start
  t = t.replace(/(^|\n)\s*(In de praktijk|Verdieping)\s*:\s*/gi, '$1');
  t = t.replace(/(^|\n)\s*(In de praktijk|Verdieping)\s*(\n+|$)/gi, '$1');
  // Collapse accidental extra blank lines created by stripping
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function isUppercaseLetter(ch: string): boolean {
  // Basic Latin + Latin-1 uppercase range (good enough for NL)
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0xc0 && code <= 0xd6) || // À-Ö
    (code >= 0xd8 && code <= 0xde) // Ø-Þ
  );
}

function isLowercaseLetter(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0xdf && code <= 0xf6) || // ß-ö (includes some lowercase Latin-1)
    (code >= 0xf8 && code <= 0xff) // ø-ÿ
  );
}

export function ensureLowercaseAfterColon(text: string): string {
  // Requirement: after the heading colon, the following text should start with a lowercase letter.
  // We lowercase the first *word-initial* letter (after leading punctuation/quotes),
  // but we DO NOT lowercase common abbreviation-like tokens (e.g. "DNA", "AB0") to avoid corrupting meaning.
  let s = String(text ?? '').trim();
  if (!s) return s;

  // Walk from start until we find a letter; if it’s uppercase, lowercase it.
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n') continue;
    // Skip common punctuation/quotes/brackets
    if ('"“”‘’\'([{«„'.includes(ch)) continue;
    if (isUppercaseLetter(ch)) {
      // Detect abbreviation-like starts so we don’t corrupt meaning:
      // - Starts with 2+ uppercase letters (DNA/ATP/AB...)
      // - Starts with single uppercase + '-' (T-cel, X-vorm)
      // - Starts with single uppercase + '.' (E. coli)
      // - Contains any uppercase beyond the first inside the first token (NaCl, HbA1c)
      // - Contains digits in the first token (AB0, C3)
      const next = i + 1 < s.length ? s[i + 1]! : '';
      let j = i;
      while (j < s.length) {
        const cj = s[j]!;
        const code = cj.charCodeAt(0);
        const isDigit = code >= 0x30 && code <= 0x39;
        if (!(isDigit || isUppercaseLetter(cj) || isLowercaseLetter(cj))) break;
        j++;
      }
      const token = s.slice(i, j);
      const tokenUpperBeyondFirst = /[A-ZÀ-ÖØ-Þ]/.test(token.slice(1));
      const tokenHasDigit = /\d/.test(token);
      const startsWith2Upper = /^[A-ZÀ-ÖØ-Þ]{2,}/.test(token);
      const abbreviationLike =
        startsWith2Upper || tokenUpperBeyondFirst || tokenHasDigit || next === '-' || next === '.';

      if (!abbreviationLike) s = s.slice(0, i) + ch.toLowerCase() + s.slice(i + 1);
    }
    break;
  }
  return s;
}

export function headingLabel(kind: IndesignHeadingKind): string {
  return kind === 'praktijk' ? 'In de praktijk:' : 'Verdieping:';
}

export function boldMarkerWrap(text: string): string {
  return `<<BOLD_START>>${text}<<BOLD_END>>`;
}

export type BuildCombinedOptions = {
  includeBoldMarkers?: boolean;
  enforceLowercaseAfterColon?: boolean;
};

export function buildCombinedBasisPraktijkVerdieping(
  basis: string,
  praktijk: string,
  verdieping: string,
  opts: BuildCombinedOptions = {}
): string {
  const includeBoldMarkers = opts.includeBoldMarkers !== false;
  const enforceLower = opts.enforceLowercaseAfterColon !== false;

  const b = sanitizeLayerText(basis);
  const pRaw = stripEmbeddedLayerLabels(praktijk);
  const vRaw = stripEmbeddedLayerLabels(verdieping);

  const pClean = sanitizeLayerText(pRaw);
  const vClean = sanitizeLayerText(vRaw);

  const p = enforceLower ? ensureLowercaseAfterColon(pClean) : pClean;
  const v = enforceLower ? ensureLowercaseAfterColon(vClean) : vClean;

  const lines: string[] = [b];

  if (p) {
    lines.push('');
    const label = headingLabel('praktijk');
    const head = includeBoldMarkers ? boldMarkerWrap(label) : label;
    lines.push(`${head} ${p}`.trim());
  }
  if (v) {
    lines.push('');
    const label = headingLabel('verdieping');
    const head = includeBoldMarkers ? boldMarkerWrap(label) : label;
    lines.push(`${head} ${v}`.trim());
  }

  return lines.join('\n').trim();
}

export function validateCombinedRewriteText(text: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const t = String(text ?? '');

  if (t.includes('\r')) errors.push('Contains \\r (paragraph break). Must use \\n only.');

  // Bold marker hygiene
  const boldStarts = (t.match(/<<BOLD_START>>/g) || []).length;
  const boldEnds = (t.match(/<<BOLD_END>>/g) || []).length;
  if (boldStarts !== boldEnds) errors.push(`Unbalanced bold markers: start=${boldStarts} end=${boldEnds}`);

  const allowed = new Set([boldMarkerWrap('In de praktijk:'), boldMarkerWrap('Verdieping:')]);
  const markerSpans = t.match(/<<BOLD_START>>[\s\S]*?<<BOLD_END>>/g) || [];
  for (const span of markerSpans) {
    if (!allowed.has(span)) {
      errors.push(`Unexpected bold marker span: "${span.substring(0, 80)}..."`);
    }
  }

  // Heading rules (Option A + blank line before heading)
  // We REQUIRE Option A (heading + content on the SAME line) and we REQUIRE bold markers in JSON.
  const lines = t.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    const isOptionBPr = /^in de praktijk$/i.test(trimmed);
    const isOptionBVe = /^verdieping$/i.test(trimmed);
    if (isOptionBPr || isOptionBVe) {
      const next = i + 1 < lines.length ? (lines[i + 1] ?? '') : '';
      if (next.trim().length) {
        errors.push(`Heading on line ${i + 1} must be Option A (same line + colon), not a standalone line ("${trimmed}")`);
      }
      continue;
    }

    const isPr = trimmed.startsWith(boldMarkerWrap('In de praktijk:')) || trimmed.startsWith('In de praktijk:');
    const isVe = trimmed.startsWith(boldMarkerWrap('Verdieping:')) || trimmed.startsWith('Verdieping:');
    if (!isPr && !isVe) continue;

    // Must have a blank line before the heading line (i.e., previous line is empty or only whitespace)
    const prev = i > 0 ? (lines[i - 1] ?? '') : '';
    if (prev.trim().length !== 0) errors.push(`Heading on line ${i + 1} must be preceded by a blank line`);

    // Require bold markers in JSON for the heading label
    const requiresMarker =
      (trimmed.startsWith('In de praktijk:') && !trimmed.startsWith(boldMarkerWrap('In de praktijk:'))) ||
      (trimmed.startsWith('Verdieping:') && !trimmed.startsWith(boldMarkerWrap('Verdieping:')));
    if (requiresMarker) errors.push(`Heading on line ${i + 1} must use bold markers (<<BOLD_START>>...<<BOLD_END>>)`);

    // Must have a colon and space, then text begins lowercase (unless abbreviation-like token)
    const afterLabel = trimmed
      .replace(boldMarkerWrap('In de praktijk:'), 'In de praktijk:')
      .replace(boldMarkerWrap('Verdieping:'), 'Verdieping:');

    const parts = afterLabel.split(':');
    if (parts.length < 2) errors.push(`Heading line ${i + 1} missing ":"`);
    const afterColon = afterLabel.split(':').slice(1).join(':'); // keep any extra colons
    if (!afterColon.startsWith(' ')) errors.push(`Heading line ${i + 1} must have a space after ":"`);

    // Check first letter after colon is lowercase (skip whitespace/punct)
    const content = afterColon.trimStart();
    if (content.length > 0) {
      const first = content[0] ?? '';
      if (isUppercaseLetter(first)) {
        // Allow abbreviation-like starts (e.g. "DNA", "AB0-...") to remain uppercase.
        const next = content.length > 1 ? content[1]! : '';
        let j = 0;
        while (j < content.length) {
          const cj = content[j]!;
          const code = cj.charCodeAt(0);
          const isDigit = code >= 0x30 && code <= 0x39;
          if (!(isDigit || isUppercaseLetter(cj) || isLowercaseLetter(cj))) break;
          j++;
        }
        const token = content.slice(0, j);
        const tokenUpperBeyondFirst = /[A-ZÀ-ÖØ-Þ]/.test(token.slice(1));
        const tokenHasDigit = /\d/.test(token);
        const startsWith2Upper = /^[A-ZÀ-ÖØ-Þ]{2,}/.test(token);
        const abbreviationLike =
          startsWith2Upper || tokenUpperBeyondFirst || tokenHasDigit || next === '-' || next === '.';
        if (!abbreviationLike) {
          errors.push(`Heading content on line ${i + 1} must start with lowercase (found "${first}")`);
        }
      }
    }
  }

  // Suspicious glue patterns
  if (/[A-Za-zÀ-ÖØ-öø-ÿ0-9][.!?][a-zà-öø-ÿ]/.test(t)) {
    warnings.push('Suspicious glue pattern found: "[.!?] + lowercase" (e.g., "woord.zin"). Investigate.');
  }
  if (/[A-Za-zÀ-ÖØ-öø-ÿ0-9][.!?][A-ZÀ-ÖØ-Þ]/.test(t)) {
    warnings.push('Suspicious glue pattern found: "[.!?] + UPPERCASE" (e.g., "woord.Zin"). Investigate.');
  }

  return { errors, warnings };
}

































