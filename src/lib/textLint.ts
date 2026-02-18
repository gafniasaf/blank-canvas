/**
 * textLint.ts
 *
 * Deterministic text-linting utilities ("ESLint for text").
 *
 * Goals:
 * - Only signal issues, never rewrite
 * - Rules are objective/stable and reproducible
 * - Designed for Dutch MBO N3/N4 textbook content
 */

export type TextLintSeverity = 'error' | 'warning';

export interface TextLintIssue {
  rule: string;
  severity: TextLintSeverity;
  paragraph_id: string;
  section: string;
  message: string;
  evidence: string; // exact substring / excerpt that triggered
}

export interface TextLintParagraph {
  paragraph_id?: string;
  chapter?: string;
  paragraph_number?: number;
  subparagraph_number?: number;
  style_name?: string;
  original?: string;
  rewritten?: string;
}

export interface TextLintOptions {
  /**
   * Sentence max words warning threshold. Defaults to 30.
   * (N3 guideline is often ~25; we keep it a warning)
   */
  maxWordsPerSentence?: number;

  /** Minimum length before duplicate-paragraph checks kick in */
  minDuplicateLengthChars?: number;
}

const DEFAULTS: Required<TextLintOptions> = {
  maxWordsPerSentence: 30,
  minDuplicateLengthChars: 60,
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule data
// ─────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_OPENERS = [
  'wat betekent dat',
  'in principe',
  'eigenlijk',
  'zoals je weet',
  'uiteraard',
  'vanzelfsprekend',
  'het is belangrijk om te weten dat',
  'het is goed om te weten dat',
] as const;

const LIST_INTRO_WORDS = [
  'zoals',
  'bijvoorbeeld',
  'namelijk',
  'te weten',
  'onder andere',
  'waaronder',
] as const;

// High-precision dangling phrase checks (avoid separable-verb false positives like "op", "in", "aan").
// Only match when sentence ends with these phrases (and not as a question).
const DANGLING_PHRASE_PATTERNS: { re: RegExp; message: string }[] = [
  { re: /\bzit\s+vast\s+aan\s*[.!]?\s*$/i, message: 'Eindigt op "zit vast aan" zonder object.' },
  { re: /\bvast\s+aan\s*[.!]?\s*$/i, message: 'Eindigt op "vast aan" zonder object.' },
  { re: /\bgebonden\s+aan\s*[.!]?\s*$/i, message: 'Eindigt op "gebonden aan" zonder object.' },
  { re: /\bgekoppeld\s+aan\s*[.!]?\s*$/i, message: 'Eindigt op "gekoppeld aan" zonder object.' },
  { re: /\bbestaat\s+uit\s*[.!]?\s*$/i, message: 'Eindigt op "bestaat uit" zonder opsomming/onderdeel.' },
  { re: /\bheeft\s+te\s+maken\s+met\s*[.!]?\s*$/i, message: 'Eindigt op "heeft te maken met" zonder aanvulling.' },
  { re: /\bhangt\s+af\s+van\s*[.!]?\s*$/i, message: 'Eindigt op "hangt af van" zonder aanvulling.' },
  { re: /\bzorgt\s+voor\s*[.!]?\s*$/i, message: 'Eindigt op "zorgt voor" zonder aanvulling.' },
  { re: /\bleidt\s+tot\s*[.!]?\s*$/i, message: 'Eindigt op "leidt tot" zonder aanvulling.' },
];

// Safer end-words (avoid particles like op/in/aan/uit).
const DANGLING_END_WORDS = [
  'de',
  'het',
  'een',
  'van',
  'voor',
  'met',
  'door',
  'naar',
  'tot',
  'bij',
  'tegen',
  'zonder',
  'over',
  'onder',
  'boven',
  'tussen',
  'achter',
  'naast',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getSection(p: TextLintParagraph): string {
  const ch = p.chapter || '?';
  const pn = p.paragraph_number;
  const spn = p.subparagraph_number;
  if (spn != null) return `${ch}.${pn}.${spn}`;
  if (pn != null) return `${ch}.${pn}`;
  return String(ch);
}

export function isBulletStyle(styleName: string): boolean {
  const s = (styleName || '').toLowerCase();
  return s.includes('bullet') || s.includes('numbered') || s.includes('opsomming') || s.startsWith('_bullets');
}

function normalizeForDuplicateCompare(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function countSentences(text: string): number {
  // Heuristic: count ., !, ? but ignore common abbreviations.
  const cleaned = text.replace(/\b(bijv|etc|evt|m\.b\.t|o\.a|d\.w\.z|t\.o\.v|i\.p\.v|b\.v|n\.b)\./gi, 'ABBR');
  return (cleaned.match(/[.!?]+/g) || []).length;
}

function nextIsList(nextP: TextLintParagraph | undefined): boolean {
  if (!nextP) return false;
  const nextStyle = String(nextP.style_name || '').toLowerCase();
  const nextTxt = String(nextP.rewritten || '').trim();
  return isBulletStyle(nextStyle) || /^[•\-\d]+[.)]?\s/.test(nextTxt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Linting
// ─────────────────────────────────────────────────────────────────────────────

export function lintParagraphs(paragraphs: TextLintParagraph[], opts: TextLintOptions = {}): TextLintIssue[] {
  const o = { ...DEFAULTS, ...opts };
  const issues: TextLintIssue[] = [];

  let prevNorm = '';
  let prevPid = '';

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    const txt = String(p.rewritten || '').trim();
    if (!txt) continue;

    const pid = String(p.paragraph_id || `idx_${i}`);
    const section = getSection(p);
    const style = String(p.style_name || '');
    const nextP = paragraphs[i + 1];
    const prevP = paragraphs[i - 1];

    // ───────────────────────────────────────────────────────────────────
    // LIST_INTRO_NO_FOLLOWUP (error)
    // ───────────────────────────────────────────────────────────────────
    for (const word of LIST_INTRO_WORDS) {
      const pattern = new RegExp(`\\b${word}\\s*[.:]?\\s*$`, 'i');
      if (pattern.test(txt)) {
        if (!nextIsList(nextP)) {
          issues.push({
            rule: 'LIST_INTRO_NO_FOLLOWUP',
            severity: 'error',
            paragraph_id: pid,
            section,
            message: `Zin eindigt op "${word}" maar wordt niet gevolgd door een opsomming.`,
            evidence: txt.slice(-80),
          });
        }
        break;
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // COLON_WITHOUT_LIST (error)
    // ───────────────────────────────────────────────────────────────────
    if (txt.endsWith(':')) {
      const hasInlineList = txt.includes(';') && txt.split(';').length >= 2;
      if (!hasInlineList && !nextIsList(nextP)) {
        issues.push({
          rule: 'COLON_WITHOUT_LIST',
          severity: 'error',
          paragraph_id: pid,
          section,
          message: 'Paragraaf eindigt op ":" maar wordt niet gevolgd door een lijst.',
          evidence: txt.slice(-60),
        });
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // PRAKTIJK / VERDIEPING marker format (error)
    // ───────────────────────────────────────────────────────────────────
    if (txt.includes('<<BOLD')) {
      const hasPr = /praktijk/i.test(txt);
      const hasVe = /verdieping/i.test(txt);
      if (hasPr && !/<<BOLD_START>>In de praktijk:<<BOLD_END>>/.test(txt)) {
        issues.push({
          rule: 'PRAKTIJK_MARKER_MALFORMED',
          severity: 'error',
          paragraph_id: pid,
          section,
          message: 'Praktijk-marker is verkeerd geformatteerd. Moet zijn: <<BOLD_START>>In de praktijk:<<BOLD_END>>',
          evidence: txt.slice(0, 140),
        });
      }
      if (hasVe && !/<<BOLD_START>>Verdieping:<<BOLD_END>>/.test(txt)) {
        issues.push({
          rule: 'VERDIEPING_MARKER_MALFORMED',
          severity: 'error',
          paragraph_id: pid,
          section,
          message: 'Verdieping-marker is verkeerd geformatteerd. Moet zijn: <<BOLD_START>>Verdieping:<<BOLD_END>>',
          evidence: txt.slice(0, 140),
        });
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // BROKEN_PUNCTUATION (error)
    // ───────────────────────────────────────────────────────────────────
    // Avoid flagging ellipsis.
    if (!txt.includes('...') && (/[;.]{2,}|[,.]{2,}|[;,]{2,}/.test(txt) || txt.includes(';.') || txt.includes('.,') || txt.includes(',.') || txt.includes('.;'))) {
      const m = txt.match(/[;.,]{2,}/)?.[0] || (txt.includes(';.') ? ';.' : txt.includes('.,') ? '.,' : txt.includes(',.') ? ',.' : txt.includes('.;') ? '.;' : txt.slice(-40));
      issues.push({
        rule: 'BROKEN_PUNCTUATION',
        severity: 'error',
        paragraph_id: pid,
        section,
        message: 'Bevat dubbele of kapotte interpunctie.',
        evidence: m,
      });
    }

    // ───────────────────────────────────────────────────────────────────
    // UNFINISHED_SENTENCE (error) - high precision only
    // ───────────────────────────────────────────────────────────────────
    // 1) Known dangling phrases
    if (!txt.endsWith('?')) {
      for (const pat of DANGLING_PHRASE_PATTERNS) {
        if (pat.re.test(txt)) {
          issues.push({
            rule: 'UNFINISHED_SENTENCE',
            severity: 'warning',
            paragraph_id: pid,
            section,
            message: pat.message,
            evidence: txt.slice(-80),
          });
          break;
        }
      }

      // 2) Safer end words
      for (const w of DANGLING_END_WORDS) {
        const re = new RegExp(`\\b${w}\\s*[.!]?\\s*$`, 'i');
        if (re.test(txt)) {
          issues.push({
            rule: 'UNFINISHED_SENTENCE',
            severity: 'warning',
            paragraph_id: pid,
            section,
            message: `Zin eindigt abrupt op "${w}".`,
            evidence: txt.slice(-70),
          });
          break;
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // HARD_LINEBREAK_IN_PARA (warning)
    // ───────────────────────────────────────────────────────────────────
    // Prince-first nuance: we allow intentional block splitting via blank lines ("\n\n")
    // and micro-title markers ("<<MICRO_TITLE>>...<<MICRO_TITLE_END>>").
    // We still warn on SINGLE hard breaks within a block (these often come from copy/paste).
    if (!isBulletStyle(style) && txt.includes('\n') && !txt.includes('<<BOLD')) {
      const withoutMarkers = txt.replace(/<<MICRO_TITLE>>|<<MICRO_TITLE_END>>/g, '');
      const blocks = withoutMarkers.split(/\n{2,}/g);
      const hasSingleBreakInsideBlock = blocks.some((b) => b.includes('\n'));
      if (hasSingleBreakInsideBlock) {
        const lines = withoutMarkers.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length > 1) {
          issues.push({
            rule: 'HARD_LINEBREAK_IN_PARA',
            severity: 'warning',
            paragraph_id: pid,
            section,
            message: `Paragraaf bevat ${lines.length} regels met harde breaks.`,
            evidence: txt.slice(0, 80),
          });
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // ORPHAN_CONTINUATION (warning)
    // ───────────────────────────────────────────────────────────────────
    if (txt.length < 80 && txt.length > 5) {
      const firstChar = txt[0] || '';
      const startsLower = firstChar === firstChar.toLowerCase() && /[a-z]/.test(firstChar);
      const prevEndsOpen = Boolean(prevP) && /[,;:]$/.test(String(prevP?.rewritten || '').trim());
      if (startsLower || prevEndsOpen) {
        const words = txt.split(/\s+/);
        const hasVerb = /\b(is|zijn|wordt|worden|heeft|hebben|kan|kunnen|mag|mogen|moet|moeten|zal|zullen|gaat|gaan)\b/i.test(txt);
        if (!hasVerb && words.length < 10) {
          issues.push({
            rule: 'ORPHAN_CONTINUATION',
            severity: 'warning',
            paragraph_id: pid,
            section,
            message: 'Korte alinea lijkt grammaticaal af te hangen van de vorige.',
            evidence: txt,
          });
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // MULTI_SENTENCE_BULLET (warning)
    // ───────────────────────────────────────────────────────────────────
    if (isBulletStyle(style)) {
      const n = countSentences(txt);
      if (n > 2) {
        issues.push({
          rule: 'MULTI_SENTENCE_BULLET',
          severity: 'warning',
          paragraph_id: pid,
          section,
          message: `Bullet bevat ${n} zinnen.`,
          evidence: txt.slice(0, 120),
        });
      }

      // BULLET_RUNNING_TEXT (warning): bullet paragraph very long
      const wc = countWords(txt);
      if (wc > 40) {
        issues.push({
          rule: 'BULLET_RUNNING_TEXT',
          severity: 'warning',
          paragraph_id: pid,
          section,
          message: `Bullet is erg lang (${wc} woorden).`,
          evidence: txt.slice(0, 120),
        });
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // SENTENCE_TOO_LONG (warning)
    // ───────────────────────────────────────────────────────────────────
    const sentenceChunks = txt.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    for (const sent of sentenceChunks) {
      const wc = countWords(sent);
      if (wc > o.maxWordsPerSentence) {
        issues.push({
          rule: 'SENTENCE_TOO_LONG',
          severity: 'warning',
          paragraph_id: pid,
          section,
          message: `Zin heeft ${wc} woorden (>${o.maxWordsPerSentence}).`,
          evidence: sent.trim().slice(0, 120) + '...',
        });
        break;
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // FORBIDDEN_OPENER (warning)
    // ───────────────────────────────────────────────────────────────────
    const txtLower = txt.toLowerCase();
    for (const opener of FORBIDDEN_OPENERS) {
      if (txtLower.startsWith(opener) || txtLower.includes('. ' + opener)) {
        issues.push({
          rule: 'FORBIDDEN_OPENER',
          severity: 'warning',
          paragraph_id: pid,
          section,
          message: `Bevat verboden opener/filler: "${opener}"`,
          evidence: txt.slice(0, 120),
        });
        break;
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // DUPLICATE_PARAGRAPH (warning): consecutive near-identical paragraphs
    // ───────────────────────────────────────────────────────────────────
    const norm = normalizeForDuplicateCompare(txt);
    if (norm.length >= o.minDuplicateLengthChars) {
      if (prevNorm && norm === prevNorm) {
        issues.push({
          rule: 'DUPLICATE_PARAGRAPH',
          severity: 'warning',
          paragraph_id: pid,
          section,
          message: `Paragraaf is identiek aan vorige (pid=${prevPid}).`,
          evidence: txt.slice(0, 140),
        });
      }
      prevNorm = norm;
      prevPid = pid;
    } else {
      prevNorm = '';
      prevPid = '';
    }
  }

  return issues;
}
