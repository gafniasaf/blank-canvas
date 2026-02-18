/**
 * llm-iterate-rewrites-json.ts
 *
 * LLM-first pipeline:
 *   LLM write (optional) → LLM check → LLM repair → deterministic fix-up → repeat until "100%"
 *
 * "100%" definition (default stop condition):
 * - Deterministic preflight passes (0 errors from validateCombinedRewriteText + JSON-level lint)
 * - LLM checker returns score >= targetScore (default 100) and 0 critical issues
 *
 * Safety contract:
 * - Never modify `original`
 * - Never introduce '\r' (only '\n')
 * - Preserve bullet/list structure (list-intro ':' + semicolon bullet item counts)
 *
 * Usage:
 *   npx ts-node scripts/llm-iterate-rewrites-json.ts <inJson> <outJson> \
 *     [--chapter 2] [--model claude-opus-4-5-20251101] [--max-iters 5] [--target-score 100] [--write-missing] \
 *     [--sample-pages 2] [--words-per-page 550] \
 *     [--enforce-bullet-short] [--bullet-max-words 12]
 */

import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { llmChatComplete, withRetries, type LlmProvider, type LlmChatMessage } from '../new_pipeline/lib/llm';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  lintRewritesForIndesignJsonParagraphs,
  PR_MARKER,
  VE_MARKER,
  isBulletStyleName,
  isListIntro,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';
import { applyDeterministicFixesToParagraphs } from '../src/lib/indesign/rewritesForIndesignFixes';

// Load env in local-dev friendly order:
// - .env.local (not committed) FIRST
// - .env (default) SECOND
//
// Rationale:
// - .env.local should override .env defaults/placeholders
// - but neither should override real env vars already set in the shell/CI.
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath });
} catch {
  // ignore
}
dotenv.config();

// ---------------------------
// LLM resilience (shared)
// ---------------------------

function parseProvider(raw: any, fallback: LlmProvider): LlmProvider {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'anthropic') return 'anthropic';
  if (s === 'openai') return 'openai';
  return fallback;
}

function stripMarkdownCodeFences(s: string): string {
  let t = String(s ?? '').trim();
  // Common model behavior: wrap JSON in ```json ... ```
  if (t.startsWith('```')) {
    // Remove opening fence line (``` or ```json)
    t = t.replace(/^```[^\n]*\n/, '').replace(/^```[^\r\n]*\r?\n/, '');
    // Remove closing fence
    t = t.replace(/\n```[\s]*$/, '').replace(/\r?\n```[\s]*$/, '');
    t = t.trim();
  }
  return t;
}

function extractFirstJsonCandidate(s: string): string | null {
  const t = String(s ?? '');
  const idxObj = t.indexOf('{');
  const idxArr = t.indexOf('[');
  let start = -1;
  if (idxObj >= 0 && idxArr >= 0) start = Math.min(idxObj, idxArr);
  else start = idxObj >= 0 ? idxObj : idxArr >= 0 ? idxArr : -1;
  if (start < 0) return null;

  const stack: string[] = [];
  const opener = t[start]!;
  if (opener !== '{' && opener !== '[') return null;
  stack.push(opener);

  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < t.length; i++) {
    const c = t[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{' || c === '[') {
      stack.push(c);
      continue;
    }
    if (c === '}' || c === ']') {
      const top = stack[stack.length - 1];
      if (c === '}' && top === '{') stack.pop();
      else if (c === ']' && top === '[') stack.pop();
      else {
        // mismatch; bail out (better to return null than slice nonsense)
        return null;
      }
      if (stack.length === 0) {
        return t.slice(start, i + 1);
      }
    }
  }
  return null;
}

function removeTrailingCommasOutsideStrings(s: string): string {
  const t = String(s ?? '');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    if (c === ',') {
      // If the next non-whitespace token is a close brace/bracket, this is a trailing comma.
      let j = i + 1;
      while (j < t.length) {
        const n = t[j]!;
        if (n === ' ' || n === '\t' || n === '\n' || n === '\r') {
          j++;
          continue;
        }
        if (n === '}' || n === ']') {
          // skip this comma
          break;
        }
        // normal comma
        out += c;
        break;
      }
      // If we broke because it was a trailing comma, do not append anything.
      if (j < t.length && (t[j] === '}' || t[j] === ']')) continue;
      continue;
    }

    out += c;
  }
  return out;
}

function sanitizeJsonForParseCandidate(s: string): string {
  // Common model failure: return JSON-looking output that contains raw newlines inside string values,
  // or trailing commas. Both break strict JSON.parse().
  const t = String(s ?? '');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        out += c;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        out += c;
        continue;
      }
      if (c === '"') {
        inString = false;
        out += c;
        continue;
      }
      if (c === '\n') {
        out += '\\n';
        continue;
      }
      if (c === '\r') {
        out += '\\r';
        continue;
      }
      if (c === '\t') {
        out += '\\t';
        continue;
      }
      out += c;
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    out += c;
  }

  let fixed = removeTrailingCommasOutsideStrings(out);

  // Common model slip: missing quote/comma between fields, e.g.
  //   {"id":"4,"severity":"warning", ...}
  // which should be:
  //   {"id":"4","severity":"warning", ...}
  //
  // We only apply very narrow repairs to avoid changing real content.
  fixed = fixed.replace(/("id"\s*:\s*")([^"\n\r]{1,64}),\s*("severity"\s*:)/g, '$1$2",$3');

  return fixed;
}

function parseModelJson<T>(raw: string, label: string): T {
  const original = String(raw ?? '');
  let txt = stripMarkdownCodeFences(original);
  if (!txt) throw new Error(`${label}: empty response`);
  try {
    return JSON.parse(txt) as T;
  } catch {
    // Try extracting the first balanced JSON object/array from a noisy response.
    const cand = extractFirstJsonCandidate(txt);
    if (cand) {
      try {
        return JSON.parse(cand) as T;
      } catch {
        // Last chance: sanitize common JSON-ish mistakes (raw newlines in strings, trailing commas).
        try {
          const sanitized = sanitizeJsonForParseCandidate(cand);
          return JSON.parse(sanitized) as T;
        } catch {
          // fall through
        }
      }
    }
  }
  throw new Error(`${label}: did not return valid JSON. Raw:\n${original.trim()}`);
}

type JsonShape = {
  book_title?: string;
  upload_id?: string;
  layer?: string;
  chapter_filter?: string | null;
  generated_at?: string;
  total_paragraphs?: number;
  generation_warnings?: any;
  paragraphs: RewritesForIndesignParagraph[];
  // meta (added by this script)
  llm_iterated_at?: string;
  llm_iterated_by?: string;
  llm_iterated_model?: string; // legacy (single-model)
  llm_iterated_write_provider?: string;
  llm_iterated_write_model?: string;
  llm_iterated_check_provider?: string;
  llm_iterated_check_model?: string;
  llm_iterated_repair_provider?: string;
  llm_iterated_repair_model?: string;
  llm_iterated_max_iters?: number;
  llm_iterated_target_score?: number;
  llm_iterated_iterations?: number;
  llm_iterated_final_score?: number;
  llm_iterated_report?: any;
};

type SectionKey = string; // "ch.pn.sp"

type LlmIssue = {
  id: string;
  severity: 'critical' | 'warning';
  paragraph_id: string | null;
  message: string;
  evidence?: string;
};

type LlmCheckResponse = {
  score: number; // 0..100
  issues: LlmIssue[];
  notes?: string;
};

type LlmPatch = { paragraph_id: string; rewritten: string };
type LlmRepairResponse = { patches: LlmPatch[]; notes?: string };

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
  // Remove trailing semicolons/commas/spaces
  t = t.replace(/[;,\s]+$/g, '').trim();
  return t;
}

function inferLastPunctFromOriginalSemicolonList(original: string): string {
  const oItems = splitSemicolonItems(original);
  const last = String(oItems[oItems.length - 1] ?? '').trim();
  if (/[.!?]$/.test(last)) return last.slice(-1);
  if (/:$/.test(last)) return ':';
  return '.';
}

function joinSemicolonItems(items: string[], lastPunct: string): string {
  const cleaned = items.map((it) => stripTrailingListPunct(it));
  const out: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    let t = cleaned[i] ?? '';
    if (!t) t = '';
    if (i < cleaned.length - 1) {
      out.push(`${t};`);
    } else {
      if (t && !/[.!?]$/.test(t)) t = `${t}${lastPunct || '.'}`;
      out.push(t);
    }
  }
  // Keep tight semicolon style; InDesign bullets are separate paragraphs anyway.
  return out.join('');
}

function countWordsRough(text: string): number {
  const m = String(text ?? '').match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+/g);
  return m ? m.length : 0;
}

function sampleParagraphsByPages(
  paragraphs: RewritesForIndesignParagraph[],
  opts: { samplePages: number; wordsPerPage: number }
): { paragraphs: RewritesForIndesignParagraph[]; sections: number; approxWords: number; budgetWords: number } {
  const samplePages = Math.max(0, Math.floor(Number(opts.samplePages) || 0));
  if (!samplePages) return { paragraphs, sections: 0, approxWords: 0, budgetWords: 0 };
  const wordsPerPage = Math.max(200, Math.floor(Number(opts.wordsPerPage) || 550));
  const budgetWords = samplePages * wordsPerPage;

  const bySection = new Map<SectionKey, RewritesForIndesignParagraph[]>();
  const order: SectionKey[] = [];
  for (const p of paragraphs) {
    const sk = sectionKey(p);
    if (!bySection.has(sk)) {
      bySection.set(sk, []);
      order.push(sk);
    }
    bySection.get(sk)!.push(p);
  }

  const selected = new Set<SectionKey>();
  let approxWords = 0;
  for (const sk of order) {
    if (selected.size > 0 && approxWords >= budgetWords) break;
    selected.add(sk);
    const ps = bySection.get(sk) || [];
    for (const p of ps) approxWords += countWordsRough(String(p.original ?? ''));
  }

  const out: RewritesForIndesignParagraph[] = [];
  for (const p of paragraphs) {
    if (selected.has(sectionKey(p))) out.push(p);
  }
  return { paragraphs: out, sections: selected.size, approxWords, budgetWords };
}

type BulletRepairResponse = {
  items: string[];
  notes?: string;
};

// ---------------------------
// Context Pack (give the checker "our context")
// ---------------------------
// Keep this short and high-signal; it is injected into multiple LLM prompts.
const CONTEXT_PACK_INDESIGN = [
  `PROJECT CONTEXT (InDesign-ready Dutch textbook, basisboek/N3):`,
  `- Output is applied into InDesign paragraphs. Structure matters as much as wording.`,
  `- Never output '\\r' (paragraph breaks). Use '\\n' only.`,
  ``,
  `CRITICAL STRUCTURE RULES (common failure modes we MUST catch):`,
  `1) List-intro → bullets: if ORIGINAL ends with ':' and the NEXT paragraph(s) are bullet styles, then REWRITTEN must still end with ':'`,
  `   Otherwise the first bullet reads like it "floats" out of context (classic example: 'water;' appears under a normal sentence).`,
  `2) Bullet semicolon lists: if ORIGINAL bullet paragraph is a semicolon list (>=2 items), REWRITTEN must stay a semicolon list with the SAME item count.`,
  `   This is required for deterministic apply (one JSON paragraph applies to multiple InDesign bullet paragraphs).`,
  `3) No duplicated intros: don't repeat the list intro sentence inside bullet items.`,
  `4) No truncation: do not end with fragments like 'bijna niet'. Finish the sentence and preserve meaning from ORIGINAL.`,
  ``,
  `TONE: simple Dutch, short sentences, no new facts, keep meaning.`,
].join('\n');

const CONTEXT_PACK_PRINCE = [
  `PROJECT CONTEXT (Prince-first Dutch textbook PDF, basisboek/N3):`,
  `- Output is rendered to HTML/CSS (Prince). We are NOT applying into InDesign anymore.`,
  `- Bullets are a DIDACTIC choice, not a deterministic apply contract.`,
  `- Never output '\\r' (paragraph breaks). Use '\\n' only.`,
  ``,
  `CRITICAL STRUCTURE RULES (high-signal for layout + reading flow):`,
  `1) List-intro → list: if the text is followed by a real list in the rewritten output, the intro should end with ':' so the list is anchored.`,
  `2) Bullets: use them SPARINGLY. Prefer running text for 1–2 items or sentence-like items.`,
  `   If you keep bullets, limit to 3–4 items max, and keep each item a short parallel phrase (no punctuation, no mini-paragraphs).`,
  `3) Micro-opsommingen (key style target): when the source has a short example list (2–8 short items), write it as running text with commas + "en", NOT semicolons.`,
  `   Example target:`,
  `   BAD:  "Voorbeelden zijn: zuurstof; koolstofdioxide; water."`,
  `   GOOD: "Voorbeelden zijn zuurstof, koolstofdioxide en water."`,
  `   If you do this, the preceding intro should NOT end with ':' (it becomes a normal sentence).`,
  `3) If you KEEP a list, keep items as short phrases (no mini-paragraphs) and do not repeat the intro sentence inside the items.`,
  `4) No truncation: do not end with fragments like 'bijna niet'. Finish the sentence and preserve meaning.`,
  ``,
  `STYLE TARGET (approved):`,
  `- Prefer shorter text blocks. If a •Basis paragraph gets long, split into smaller blocks using a blank line: "\\n\\n".`,
  `- You MAY add micro-titles between blocks to guide the reader. Use this exact marker line:`,
  `  "<<MICRO_TITLE>>Titel<<MICRO_TITLE_END>>"`,
  `  Then add a blank line and continue with the next block.`,
  `- Praktijk/Verdieping: when markers already exist, expand them substantially (≈3× longer), staying concrete and on-topic.`,
  ``,
  `TONE: simple Dutch, short sentences, no new facts, keep meaning.`,
].join('\n');

const FEW_SHOT_EXAMPLES_INDESIGN = [
  `EXAMPLE A (BAD → what to flag):`,
  `- Intro rewritten lost ':' + bullets collapsed:`,
  `  intro.original = "Zweet bestaat vooral uit:"`,
  `  intro.rewritten = "Zweten heet ook transpiratie of perspiratie."   (BAD: no ':')`,
  `  bullets.original = "water;zout;ureum;bepaalde zuren."`,
  `  bullets.rewritten = "Water, zout, ureum en bepaalde zuren."        (BAD: item count changed)`,
  `  => critical issues: list-intro lost ':'; bullet semicolon item-count mismatch`,
  ``,
  `EXAMPLE B (BAD → what to fix):`,
  `- Duplicate intro + missing meaning/truncation inside bullet:`,
  `  prev.rewritten = "We hebben twee soorten zweetklieren, namelijk:"`,
  `  bullets.rewritten = "Je lichaam heeft twee soorten zweetklieren... Ze maken de hele dag zweet, bijna niet" (BAD: repeats intro + ends fragment; missing 'warmte heeft bijna geen invloed')`,
  `  => critical issues: duplicate intro; sentence fragment; meaning loss vs original`,
].join('\n');

const FEW_SHOT_EXAMPLES_PRINCE = [
  `EXAMPLE A (OK in Prince-first):`,
  `- It's OK to turn a short list into running text when it reads better:`,
  `  bullets.original = "water;zout;ureum;bepaalde zuren."`,
  `  bullets.rewritten = "Water, zout, ureum en bepaalde zuren." (OK if the intro is rewritten as normal prose too)`,
  ``,
  `EXAMPLE B (BAD):`,
  `- A list is kept, but the intro doesn't anchor it:`,
  `  intro.rewritten = "Je huid regelt je warmte." (BAD if a real bullet/list follows; prefer ending with ':')`,
  ``,
  `EXAMPLE C (BAD):`,
  `- Praktijk/verdieping marker placed inside a list-intro before bullets: must be moved AFTER the list run.`,
].join('\n');

// ---------------------------
// User-provided N3 style prompt (writer vs validator)
// ---------------------------
// NOTE: Keep the examples verbatim. We intentionally split the self-check into a dedicated validator prompt
// so writing and checking are separate LLM steps.
const USER_N3_WRITER_PROMPT_INDESIGN = `DOEL
Herschrijf leerboektekst voor MBO A&F niveau 3 in jullie N3-leerboekstijl (zie GOED VOORBEELD). Vermijd expliciet alle patronen in de sectie NIET DOEN (met letterlijk voorbeelden uit eerdere output).
GOED VOORBEELD (NORM — KOPIËREN)
Gebruik dit als norm voor zinsbouw, tempo, woordkeuze en uitleg-ritme:
Als een vrouw zwanger is zorgen hormonen dat de melkklieren in haar borsten aan het eind van haar zwangerschap moedermelk gaan maken. Eén van de hormonen die in haar borsten voor de aanmaak van moedermelk zorgt noemen we prolactine. Prolactine komt tijdens de zwangerschap via de moederkoek soms ook in het lichaam van het ongeboren kind, waardoor uit de tepels van een pasgeboren baby soms een soort melk komt die we heksenmelk noemen. ... (etc)

EXTRA GOED VOORBEELD (N3 / doorlopende tekst — STYLE TARGET)
Let niet op de exacte inhoud, maar op het leesritme: doorlopende leerboektekst (je-vorm), lineair uitgelegd, rustig tempo.
Voorbeeld:
Je huid is het grootste orgaan van je lichaam. Je huid ligt als een laag om je hele lichaam heen. Je huid beschermt je organen en helpt je lichaam goed te functioneren.
Een belangrijke functie van je huid is bescherming tegen invloeden van buitenaf. De zichtbare barrière ligt aan de buitenkant van de opperhuid. Deze laag werkt als een muur en houdt veel tegen.
Hard af te leiden stijlregels:
Uitleg is lineair: oorzaak → gevolg → detail → toepassing/voorbeeld.
Termen introduceer je met “… noemen we …” (niet met “wat betekent dat…”).
Zinnen zijn volledig en hebben natuurlijk ritme (niet staccato, niet eindeloos).
Vergelijking mag (zoals waterballon), maar spaarzaam en doelgericht.
DOORLOPENDE TEKST (belangrijk):
- Schrijf als doorlopende leerboekuitleg: 2–4 zinnen per alinea waar dat past.
- Leg termen liefst uit in één zin met “… noemen we …” (geen losse definitielijst).
  Voorbeeld: “Ontvangers op zenuwen noemen we receptoren.”
- Vermijd veel losse mini-zinnen achter elkaar met dezelfde start (“Je huid… Je huid…”). Wissel af met “de huid/deze laag” waar logisch.
NIET DOEN (LETTERLIJK MIJN EERDERE FOUTEN + KLOONPATROON)
1) Niet staccato / kinderlijke “Basistaal” (mijn fout)
FOUT (letterlijk uit mijn output):
“Het grootste orgaan van je lichaam is je huid. Je huid zit om je hele lichaam heen. Je huid heeft belangrijke functies. Je huid beschermt de rest van je lichaam.”
Waarom fout: dit voelt als samenvatting + kleutertoon, niet als N3-leerboekproza.
Dus:
Geen rijtjes van ultrakorte zinnen.
Combineer logisch in lopende leerboekzinnen zoals in het GOED VOORBEELD.
2) Niet “samenvatting-inkt” door agressief inkorten (mijn fout)
FOUT (letterlijk uit mijn output):
“Borstklieren zitten bij meisjes, vrouwen, jongens en mannen. Alleen bij meisjes groeien ze in de puberteit tot borsten. … Prolactine kan bij baby’s kort heksenmelk geven. … Aanraking van tepel en tepelhof laat melk toeschieten.”
Waarom fout: te veel inhoud wordt te compact, waardoor het samenvattend klinkt i.p.v. uitleggend.
Dus:
Houd detailniveau van een leerboek: stap-voor-stap, met verklarende zinnen ertussen.
3) Niet te veel “Onthoud:” (mijn fout)
FOUT (letterlijk uit mijn output):
“Onthoud: zichtbare en niet-zichtbare huidbarrières beschermen je tegen schadelijke invloeden van buitenaf.”
“Onthoud: receptoren vangen prikkels op en zenuwen geven seintjes door.”
“Onthoud: zonlicht helpt je huid vitamine D maken.”
Waarom fout: dit klinkt als flashcards/samenvatting, niet als doorlopende leerboektekst in jullie stijl.
Dus:
Geen “Onthoud:” tenzij jullie bron dat expliciet vraagt (en dan spaarzaam).
4) Niet uitleg proppen in bullets (mijn fout)
FOUT (letterlijk uit mijn output):
“Hoornlaag. Dit is de buitenste laag … Bij zweetklieren kan water wel naar buiten… Dit heet afschilfering (exfoliatie)…; heldere laag…; korrelige laag…; ontkiemende laag…”
Waarom fout: bullets worden een mini-paragraaf per bullet, dat leest rommelig en voelt als “AI-lijst”.
Dus:
Bullets = alleen kernitems of korte frasen.
De uitleg komt in de lopende paragraaf eromheen.
5) Niet de kloon-tic “wat betekent dat …” + eindeloze zinnen (afgekeurd)
FOUT (letterlijk patroon uit kloon-output):
“… wat betekent dat … wat betekent dat …”
En fout:
zinnen die blijven doorrollen met “en … en … en …”, zonder ademruimte.
Dus:
Verboden frase: “wat betekent dat”.
Zinnen mogen lang, maar moeten geleed zijn (met punten/komma’s) en natuurlijk ritme hebben.
STRUCTUUR- EN FORMATREGELS
Behoud paragraaf- en subparagraafnummering exact zoals in input.
Behoud style_name intent:
•Basis = lopende leerboekparagraaf.
_Bullets / levels = echte bulletlijst met korte items.
Voeg geen “In de praktijk” / “Verdieping” toe tenzij:
het in de input al aanwezig is, of
de inputlaag expliciet zegt dat dit moet (dan kort, concreet, niet algemeen).
MICROREGELS VOOR TERMINOLOGIE
Termen introduceren met: “… noemen we …”
Uitleg van termen: één zin, functioneel, niet schools.
Huisstijl (zorg-terminologie):
- Gebruik “zorgvrager” (nooit cliënt/client).
- Gebruik “zorgprofessional” (nooit verpleegkundige).
TAAK
Herschrijf de aangeleverde tekst volledig volgens GOED VOORBEELD en met expliciete vermijding van alle NIET-DOEN patronen hierboven.

AANVULLING (InDesign / praktijk-verdieping details voor onze pipeline):
- InDesign-safety: gebruik nooit '\\r' (alleen '\\n' als het echt nodig is).
- Als er een praktijk/verdieping-block aanwezig is in de input, behoud exact de markers:
  - ${PR_MARKER}
  - ${VE_MARKER}
- Tekst NA de dubbele punt: start lowercase, behalve bij afkortingen (DNA/ATP/etc).
- In de praktijk (inhoud): kort, concreet, zorggericht: signaal → actie → wanneer melden (geen algemene praat).
- Praktijk-situaties moeten realistisch zijn: een zorgvrager vraagt niet naar celonderdelen (zoals het Golgi-systeem). Start vanuit een herkenbare zorgsituatie (klacht/observatie/handeling) en leg eventueel kort uit in begrijpelijke taal.
- Verdieping (inhoud): legt 1 stap dieper het “waarom” uit, maar blijft N3 en blijft bij het begrip uit de alinea (geen onderwerp-sprong).`;

const USER_N3_WRITER_PROMPT_PRINCE = USER_N3_WRITER_PROMPT_INDESIGN
  .replace(
    `_Bullets / levels = echte bulletlijst met korte items.`,
    `_Bullets / levels = bullets zijn optioneel: gebruik alleen bij 3–4 korte, parallelle items (max 4); anders herschrijven als lopende tekst (geen ';'-lijst).`
  )
  .replace(
    `AANVULLING (InDesign / praktijk-verdieping details voor onze pipeline):`,
    `AANVULLING (Prince-first / praktijk-verdieping details voor onze pipeline):`
  )
  .replace(
    `- InDesign-safety: gebruik nooit '\\r' (alleen '\\n' als het echt nodig is).`,
    `- Pipeline-safety: gebruik nooit '\\r' (alleen '\\n' als het echt nodig is).`
  )
  .concat(
    `\n\nEXTRA STIJLDOEL (Prince-first, goedgekeurd):\n` +
      `- Breek lange •Basis-tekst op in kleinere blokken. Gebruik hiervoor een lege regel: \"\\\\n\\\\n\".\n` +
      `- Voeg hier en daar micro-titels toe (klein/dun/groen) om de lezer te helpen. Gebruik exact:\n` +
      `  <<MICRO_TITLE>>Titel<<MICRO_TITLE_END>>\n` +
      `  Daarna een lege regel en dan de tekst.\n` +
      `- Praktijk/Verdieping (als aanwezig): maak ze substantieel langer (≈3×), concreet en in zorgcontext.\n`
  );

const USER_N3_VALIDATION_PROMPT_INDESIGN = `KWALITEITSCHECK (MOET JE ZELF DOEN)
Voor je antwoord:
Komt “wat betekent dat” voor? → verwijderen.
Komt “cliënt” of “client” voor? → vervangen door “zorgvrager”.
Komt “verpleegkundige” voor? → vervangen door “zorgprofessional”.
Heb ik 3+ ultrakorte zinnen achter elkaar? → herschrijven naar leerboekritme.
Heb ik “Onthoud:” gebruikt zonder noodzaak? → verwijderen.
Zijn bullets langer dan 12–15 woorden of bevatten ze meerdere zinnen? → verplaatsen naar lopende tekst.

AANVULLING (praktijk/verdieping sanity checks):
- Praktijk/verdieping mag alleen als het relevant is voor het besproken begrip. Anders leeg laten.
- Praktijk: moet concreet zijn (signaal → actie → wanneer melden). Geen algemene tips.
- Verdieping: moet logisch verdiepen (waarom/hoe), zonder nieuwe feiten of onverwachte sprong.
- Labels mogen niet “verstoppen” in de tekst: geen extra 'In de praktijk:' of 'Verdieping:' strings (markers zijn genoeg).`;

// House terminology checks (student-facing)
// - Never use cliënt/client; always zorgvrager
// - Never use verpleegkundige; always zorgprofessional
// (We enforce this deterministically too, but the validator must also flag it.)

const USER_N3_VALIDATION_PROMPT_PRINCE = `${USER_N3_VALIDATION_PROMPT_INDESIGN}

Prince-first bullets:
- Zijn er maar 1–2 bulletitems? → maak er liever lopende tekst van.
- Als je bullets houdt: maak items parallel en kort; geen mini-paragrafen.`;

async function llmRepairBulletSemicolonList(opts: {
  provider: LlmProvider;
  openai?: OpenAI;
  anthropicApiKey?: string;
  model: string;
  section: SectionKey;
  listIntro: string;
  originalItems: string[];
  currentRewritten: string;
}): Promise<BulletRepairResponse> {
  const { provider, openai, anthropicApiKey, model, section, listIntro, originalItems, currentRewritten } = opts;
  const expectedCount = originalItems.length;
  const system = [
    `You are an expert Dutch editor for an educational textbook (basisboek / N3).`,
    `Task: repair ONE bullet-list paragraph so it preserves semicolon-item structure for deterministic publishing.`,
    ``,
    CONTEXT_PACK_INDESIGN,
    ``,
    FEW_SHOT_EXAMPLES_INDESIGN,
    ``,
    `You must output STRICT JSON: { "items": [ ... ] }`,
    `Rules:`,
    `- You MUST output EXACTLY ${expectedCount} items (items.length must be ${expectedCount}).`,
    `- Do NOT merge items. Do NOT drop items. If an item is long, keep it as one item.`,
    `- each item is the rewritten text for that bullet item only`,
    `- do NOT include bullet characters or newlines`,
    `- do NOT repeat the listIntro sentence inside the items`,
    `- keep meaning; simplify language; no new facts`,
  ].join('\n');

  const user = {
    section,
    listIntro: truncate(listIntro, 420),
    originalItems: originalItems.map((x) => truncate(x, 260)),
    currentRewritten: truncate(currentRewritten, 420),
  };

  let lastRaw = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const messages: LlmChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ];
    if (attempt > 1) {
      messages.push({
        role: 'user',
        content:
          `Your previous output was invalid for this reason: wrong items.length.\n` +
          `You MUST return STRICT JSON with items.length=${expectedCount}.\n` +
          `Previous raw output:\n${lastRaw}`,
      });
    }

    const txt = await withRetries(`llm(bullet_repair) ${section}`, () =>
      llmChatComplete({
        provider,
        model,
        temperature: 0.2,
        messages,
        openai,
        anthropicApiKey,
      })
    );
    lastRaw = txt;
    if (!txt) continue;
    let parsed: BulletRepairResponse | null = null;
    try {
      parsed = parseModelJson<BulletRepairResponse>(txt, `llm(bullet_repair) ${section}`) as BulletRepairResponse;
    } catch {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.items)) continue;
    if (parsed.items.length !== expectedCount) continue;
    // Keep empties for validation later (do not filter here)
    return parsed;
  }

  throw new Error(
    `LLM bullet repair failed after 3 attempts for section ${section} (expected items.length=${expectedCount}). Last raw:\n${lastRaw}`
  );
}

function expandTilde(p: string): string {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  return p;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function sectionKey(p: RewritesForIndesignParagraph): SectionKey {
  const ch = String(p.chapter ?? '').trim() || '?';
  const pn = Number.isFinite(p.paragraph_number as any) ? String(p.paragraph_number) : '?';
  const sp =
    p.subparagraph_number === null || p.subparagraph_number === undefined
      ? 'null'
      : Number.isFinite(p.subparagraph_number as any)
        ? String(p.subparagraph_number)
        : String(p.subparagraph_number);
  return `${ch}.${pn}.${sp}`;
}

function truncate(s: string, max: number) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  const marker = '\n...[SNIP]...\n';
  const keep = Math.max(0, max - marker.length);
  // Keep both start and end so validators can judge endings (avoid false “truncation fragment”).
  const headLen = Math.max(0, Math.floor(keep * 0.6));
  const tailLen = Math.max(0, keep - headLen);
  return `${t.slice(0, headLen)}${marker}${t.slice(Math.max(0, t.length - tailLen))}`;
}

function normalizeNewlinesNoCR(s: string): string {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

type DeterministicOpts = {
  mode: RewriteLintMode;
  enforceBulletShort: boolean;
  bulletMaxWords: number;
};

function parsePidFromLintLine(line: string): string | null {
  const m = String(line || '').match(/^\[([^\]]+)\]/);
  return m ? String(m[1]) : null;
}

function countWordsForBulletItem(text: string): number {
  // Treat simple hyphenated and slash-joined tokens as ONE “word”
  // (e.g. "niet-zichtbare", "zweet/talg") so the bullet-length gate isn't artificially strict.
  const m = String(text ?? '').match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-/][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g);
  return m ? m.length : 0;
}

function stripBulletItemDecorations(text: string): string {
  let t = String(text ?? '').trim();
  t = t.replace(/^[•\-\u2022]\s*/g, '').trim();
  t = t.replace(/[;,\s]+$/g, '').trim();
  return t;
}

function detectCloseDuplicateContentWord(sentence: string): { word: string; i: number; j: number } | null {
  // Treat simple hyphenated words as ONE token (e.g. "niet-zichtbare"), otherwise we get false positives
  // where "zichtbare" appears twice due to "niet-zichtbare" being split into "niet" + "zichtbare".
  const toks = (String(sentence || '').match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:-[0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g) || []).map((w) =>
    String(w).toLowerCase()
  );
  if (toks.length < 4) return null;

  // Conservative: only flag repeated non-trivial content words that are close together.
  const stop = new Set([
    'de',
    'het',
    'een',
    'en',
    'of',
    'om',
    'te',
    'in',
    'op',
    'aan',
    'van',
    'voor',
    'met',
    'als',
    'ook',
    'bij',
    'naar',
    'door',
    'uit',
    'over',
    'onder',
    'tussen',
    'tot',
    'dat',
    'die',
    'dit',
    'deze',
    'daar',
    'daarom',
    'doordat',
    'omdat',
    'waardoor',
    'terwijl',
    'maar',
    'niet',
    'wel',
    'dan',
    'er',
    'is',
    'zijn',
    'was',
    'waren',
    'wordt',
    'worden',
    'heb',
    'hebt',
    'heeft',
    'hebben',
    'kan',
    'kun',
    'kunt',
    'kunnen',
    'we',
    'je',
    'jij',
    'hij',
    'zij',
    'ze',
    'wij',
    'jullie',
    'hun',
    'ons',
    'onze',
    'mijn',
    'jouw',
    'uw',
    // common verbs that can legitimately repeat
    'noemen',
    'heet',
    'heten',
  ]);

  const minLen = 7; // avoid flagging common short words like "huid"
  const window = 3; // repeat within 3 tokens is likely a copy/paste glitch; larger windows create false positives
  const last = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]!;
    if (!w || w.length < minLen) continue;
    if (stop.has(w)) continue;
    const prev = last.get(w);
    if (prev !== undefined && i - prev <= window) {
      // Allow a common legit Dutch pattern where a head noun repeats across alternatives:
      //   "<noun> of <adj> <noun>" / "<noun> en <adj> <noun>"
      // Example: "onderhuids weefsel of subcutaan weefsel"
      // Without this, we get false positives on medically-relevant terms like "weefsel".
      if (i - prev === 3) {
        const conj = toks[prev + 1] || '';
        const modifier = toks[prev + 2] || '';
        if ((conj === 'of' || conj === 'en') && modifier && !stop.has(modifier) && modifier.length >= 3) {
          last.set(w, i);
          continue;
        }
      }
      return { word: w, i: prev, j: i };
    }
    last.set(w, i);
  }
  return null;
}

function splitSentencesConservative(text: string): string[] {
  const t = String(text ?? '')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return [];
  // Conservative split; keep it simple/deterministic.
  return t
    .split(/[.!?]+\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasStaccatoRun(text: string, opts: { minRun: number; maxWords: number }): boolean {
  const minRun = Math.max(2, Math.floor(Number(opts.minRun) || 3));
  const maxWords = Math.max(3, Math.floor(Number(opts.maxWords) || 6));
  const sents = splitSentencesConservative(text);
  let run = 0;
  for (const s of sents) {
    const wc = countWordsForBulletItem(s);
    if (wc > 0 && wc <= maxWords) run++;
    else run = 0;
    if (run >= minRun) return true;
  }
  return false;
}

function hasNoemenWeDieWeNoemen(sentence: string): boolean {
  const s = String(sentence ?? '').toLowerCase();
  if (!s) return false;
  if (s.indexOf('noemen we') === -1) return false;
  // Catch the common glitch pattern:
  // "Die X noemen we Y die we Z noemen" (redundant double naming; often ungrammatical).
  return /noemen we [^.!?]{0,160}\b(die|dat)\b [^.!?]{0,160}\bnoemen\b/.test(s);
}

function applyLocalDeterministicTextFixes(paras: RewritesForIndesignParagraph[]) {
  for (const p of paras) {
    const rw = String(p.rewritten ?? '');
    if (!rw) continue;
    let next = rw;

    // Fix a frequent LLM glitch that causes ugly/incorrect redundancy:
    // "huidbarrières die we barrières noemen" / "barrières die we barrières noemen" → "barrières"
    // Example result: "Die hindernissen noemen we barrières:"
    next = next.replace(/\bhuidbarrières\s+die\s+we\s+barrières\s+noemen\b/gi, 'barrières');
    next = next.replace(/\bbarrières\s+die\s+we\s+barrières\s+noemen\b/gi, 'barrières');

    // House terminology (student-facing):
    // - Use "zorgvrager" (never cliënt/client)
    // - Use "zorgprofessional" (never verpleegkundige)
    // Preserve capitalization and plural.
    next = next.replace(
      /(^|[^\p{L}\p{N}])(cliënten|clienten|cliënt|client|clients)(?![\p{L}\p{N}])/giu,
      (_m, pre: string, tok: string) => {
        const t = String(tok || '');
        const low = t.toLowerCase();
        const plural = low === 'cliënten' || low === 'clienten' || low === 'clients';
        const cap = t.slice(0, 1) === t.slice(0, 1).toUpperCase();
        const base = cap ? 'Zorgvrager' : 'zorgvrager';
        return `${String(pre || '')}${base}${plural ? 's' : ''}`;
      }
    );
    next = next.replace(
      /(^|[^\p{L}\p{N}])(verpleegkundigen|verpleegkundige)(?![\p{L}\p{N}])/giu,
      (_m, pre: string, tok: string) => {
        const t = String(tok || '');
        const low = t.toLowerCase();
        const plural = low === 'verpleegkundigen';
        const cap = t.slice(0, 1) === t.slice(0, 1).toUpperCase();
        const base = cap ? 'Zorgprofessional' : 'zorgprofessional';
        return `${String(pre || '')}${base}${plural ? 's' : ''}`;
      }
    );

    if (next !== rw) p.rewritten = next;
  }
}

function deterministicErrors(paras: RewritesForIndesignParagraph[], opts: DeterministicOpts) {
  const errors: Array<{ paragraph_id: string | null; message: string }> = [];

  for (const p of paras) {
    const pid = String(p.paragraph_id ?? '').trim() || null;
    const v = validateCombinedRewriteText(String(p.rewritten ?? ''));
    for (const e of v.errors) errors.push({ paragraph_id: pid, message: e });
    if (String(p.rewritten ?? '').includes('\r')) errors.push({ paragraph_id: pid, message: 'Contains \\r (forbidden).' });
  }

  const cross = lintRewritesForIndesignJsonParagraphs(paras, { mode: opts.mode });
  for (const e of cross.errors) {
    errors.push({ paragraph_id: parsePidFromLintLine(e), message: e });
  }

  // Prompt-driven bullet quality gate (for N3 house style):
  // Bullets must be short phrases. Explanation belongs in surrounding •Basis paragraphs.
  if (opts.enforceBulletShort) {
    const maxWords = Math.max(5, Math.floor(Number(opts.bulletMaxWords) || 12));
    for (const p of paras) {
      const pid = String(p.paragraph_id ?? '').trim() || null;
      const style = String(p.style_name ?? '');
      if (!isBulletStyleName(style)) continue;

      const rw = String(p.rewritten ?? '').trim();
      if (!rw) continue;

      const items = (() => {
        const semis = splitSemicolonItems(rw);
        // Prince-first: allow bullet-style paragraphs to become running text by removing semicolons.
        // Only enforce "short bullet items" when the paragraph is actually written as a list (2+ items).
        if (opts.mode === 'prince' && semis.length < 2) return [];
        if (semis.length >= 2) return semis;
        return [rw];
      })();

      if (items.length === 0) continue;
      for (let i = 0; i < items.length; i++) {
        const it = stripBulletItemDecorations(items[i] ?? '');
        if (!it) continue;
        const wc = countWordsForBulletItem(it);
        const punct = (it.match(/[.!?]/g) || []).length;
        const endsWithPunct = /[.!?]$/.test(it);
        const hasMidSentencePunct = /[.!?].+/.test(it) && !endsWithPunct;
        const looksLikeMultiSentence = punct >= 2 || hasMidSentencePunct;
        if (wc > maxWords || looksLikeMultiSentence) {
          errors.push({
            paragraph_id: pid,
            message:
              `Bullet quality (prompt): bullet items must be short phrases (<=${maxWords} words) and not multi-sentence explanations. ` +
              `Move explanation into surrounding •Basis paragraphs within the SAME section. ` +
              `Offending item(${i + 1}/${items.length}) words=${wc} punct=${punct}: "${truncate(it, 140)}"`,
          });
          // One error per paragraph is enough to trigger repair for the section
          break;
        }
      }
    }
  }

  // Always-on: detect obvious copy/paste duplication inside a sentence in non-bullet paragraphs.
  // This is a high-trust requirement (users immediately notice these).
  for (const p of paras) {
    const pid = String(p.paragraph_id ?? '').trim() || null;
    const style = String(p.style_name ?? '');
    if (isBulletStyleName(style)) continue;
    const rw = String(p.rewritten ?? '').replace(/\r/g, '\n').trim();
    if (!rw) continue;

    const text = rw.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const sentences = text.split(/[.!?]+/g).map((s) => s.trim()).filter(Boolean);
    if (!sentences.length) continue;

    for (const s of sentences) {
      const hit = detectCloseDuplicateContentWord(s);
      if (!hit) continue;
      errors.push({
        paragraph_id: pid,
        message:
          `Duplicate wording (prompt): repeated content word "${hit.word}" very close together inside a sentence (likely copy/paste glitch). ` +
          `Rewrite the sentence to be fluent and remove duplication. Sentence: "${truncate(s, 180)}"`,
      });
      break;
    }
  }

  // Always-on: avoid staccato (3+ ultra-short sentences in a row) in normal body text.
  for (const p of paras) {
    const pid = String(p.paragraph_id ?? '').trim() || null;
    const style = String(p.style_name ?? '');
    if (isBulletStyleName(style)) continue;
    const rw = String(p.rewritten ?? '').trim();
    if (!rw) continue;
    if (hasStaccatoRun(rw, { minRun: 3, maxWords: 6 })) {
      errors.push({
        paragraph_id: pid,
        message:
          `Staccato (prompt): detected 3+ ultra-short sentences in a row. ` +
          `Combine logically into natural textbook rhythm (cause → effect → detail).`,
      });
    }
  }

  // Always-on: forbid the redundant "noemen we ... die/dat we ... noemen" pattern (common LLM glitch).
  for (const p of paras) {
    const pid = String(p.paragraph_id ?? '').trim() || null;
    const rw = String(p.rewritten ?? '').trim();
    if (!rw) continue;
    const sentences = splitSentencesConservative(rw);
    for (const s of sentences) {
      if (!hasNoemenWeDieWeNoemen(s)) continue;
      errors.push({
        paragraph_id: pid,
        message:
          `Redundant naming (prompt): detected "noemen we … die/dat we … noemen" in one sentence. ` +
          `Rewrite to a single clean naming. Example fix: "Die hindernissen noemen we barrières:" (keep any required trailing colon if this paragraph introduces bullets).`,
      });
      break;
    }
  }
  return errors;
}

async function llmCheckSection(opts: {
  provider: LlmProvider;
  openai?: OpenAI;
  anthropicApiKey?: string;
  model: string;
  mode: RewriteLintMode;
  section: SectionKey;
  paragraphs: Array<{
    paragraph_id: string;
    style_name: string;
    original: string;
    rewritten: string;
  }>;
}): Promise<LlmCheckResponse> {
  const { provider, openai, anthropicApiKey, model, mode, section, paragraphs } = opts;

  function computeScoreFromIssues(issues: LlmIssue[]): number {
    let score = 100;
    for (const it of issues || []) {
      const sev = String(it.severity || '').toLowerCase();
      if (sev === 'critical') score -= 30;
      else if (sev === 'warning') score -= 5;
    }
    score = Math.max(0, Math.min(100, score));
    return score;
  }

  function isPrinceColonAnchoringIssue(it: { id?: string; message?: string } | null | undefined): boolean {
    const id = String((it as any)?.id || '');
    const msg = String((it as any)?.message || '');
    const s = `${id} ${msg}`.toLowerCase();
    // These are readability preferences in Prince mode; they should not block approval.
    return (
      s.includes('list-intro') ||
      s.includes('listintro') ||
      s.includes('microlist') ||
      s.includes('micro-list') ||
      s.includes('colon') ||
      s.includes('dubbele punt') ||
      s.includes('dubbelepunt') ||
      s.includes('opsomming') ||
      s.includes('ank') // anker / anchoring
    );
  }

  const ctx = mode === 'indesign' ? CONTEXT_PACK_INDESIGN : CONTEXT_PACK_PRINCE;
  const examples = mode === 'indesign' ? FEW_SHOT_EXAMPLES_INDESIGN : FEW_SHOT_EXAMPLES_PRINCE;
  const selfCheck = mode === 'indesign' ? USER_N3_VALIDATION_PROMPT_INDESIGN : USER_N3_VALIDATION_PROMPT_PRINCE;

  const hardStructure =
    mode === 'indesign'
      ? [
          `Hard structural expectations (InDesign apply):`,
          `- If a paragraph introduces a list (original ends with ':' and next paragraph(s) are bullets), rewritten must still end with ':'.`,
          `- Bullet paragraphs that are semicolon lists in original must stay semicolon lists with the SAME item count in rewritten.`,
          `- IMPORTANT: you must judge MEANING at the SECTION level, not per single paragraph.`,
          `  - It is allowed to shorten bullet items (keep them as short phrases) and move the removed explanation into nearby •Basis paragraphs within the SAME section.`,
          `  - Therefore, do NOT flag "meaning loss" just because a bullet item became shorter, if the missing claims are present elsewhere in the SAME section (e.g., in the next •Basis paragraph).`,
          `  - Only mark meaning loss as critical if a distinct claim from the ORIGINAL section is missing from the REWRITTEN section as a whole.`,
          `- It is also allowed that bullets give a short summary and the next •Basis paragraph elaborates. This is not duplication by itself.`,
          `  - Only flag duplication if the same content is repeated near-verbatim (the reader would feel it's pasted twice).`,
          `- Avoid duplicated intro sentences across consecutive paragraphs (e.g., "Er zijn twee soorten..." repeated).`,
          `- Finish sentences (no trailing fragments like "bijna niet").`,
          `- Compare ORIGINAL vs REWRITTEN for meaning loss: if a distinct claim in ORIGINAL disappears, that is critical.`,
          `- Do not introduce '\\r'.`,
        ]
      : [
          `Hard structural expectations (Prince-first):`,
          `- Bullets are optional: bullet/list paragraphs may be rewritten into running text (no semicolon list) when that reads better.`,
          `- List-intro ':' anchoring is a readability preference in Prince-first mode.`,
          `  - If you see a dangling ':' or a missing ':', flag it as WARNING (not critical).`,
          `  - Only mark as critical if it clearly breaks meaning or creates a broken/truncated sentence.`,
          `- Still judge MEANING at the SECTION level (no new facts, no lost distinct claims).`,
          `- Avoid duplicated intro sentences across consecutive paragraphs.`,
          `- Finish sentences (no trailing fragments like "bijna niet").`,
          `- Do not introduce '\\r'.`,
        ];

  const system = [
    `You are a strict human QA reviewer for a Dutch educational textbook (basisboek / N3).`,
    `Your job is to detect structural + reading-flow issues that would make the output look "messed up" in the final layout.`,
    ``,
    ctx,
    ``,
    examples,
    ``,
    selfCheck,
    ``,
    `Score rules (0-100):`,
    `- Compute score deterministically from issues: start at 100`,
    `  - subtract 30 for each critical issue`,
    `  - subtract 5 for each warning`,
    `  - clamp to [0,100]`,
    `- If there are 0 issues, score MUST be 100.`,
    ``,
    ...hardStructure,
    ``,
    `Evidence policy (to reduce hallucinations):`,
    `- Every issue MUST include an 'evidence' field that is an exact quote copied from the provided ORIGINAL or REWRITTEN text.`,
    `- The evidence MUST be a literal substring of the provided text. If you cannot quote it, DO NOT add the issue.`,
    `- paragraph_id MUST be one of the paragraph_id values provided in the input (do not invent ids). If truly cross-paragraph, set paragraph_id=null.`,
    ``,
    `Output STRICT JSON (no markdown):`,
    `{ "score": 0, "issues": [ { "id":"...", "severity":"critical|warning", "paragraph_id":"..."|null, "message":"...", "evidence":"..." } ], "notes":"..." }`,
  ].join('\n');

  const user = {
    section,
    paragraphs: paragraphs.map((p, i) => ({
      i,
      paragraph_id: p.paragraph_id,
      style_name: p.style_name,
      // Use larger windows so the checker can detect missing tail clauses (meaning loss).
      original: (() => {
        const o = String(p.original ?? '');
        const r = String(p.rewritten ?? '');
        const oItems = splitSemicolonItems(o);
        const rItems = splitSemicolonItems(r);
        const keepFull = (oItems.length >= 2 || rItems.length >= 2) && o.length <= 6000;
        return keepFull ? o : truncate(o, 1100);
      })(),
      rewritten: (() => {
        const o = String(p.original ?? '');
        const r = String(p.rewritten ?? '');
        const oItems = splitSemicolonItems(o);
        const rItems = splitSemicolonItems(r);
        const keepFull = (oItems.length >= 2 || rItems.length >= 2) && r.length <= 6000;
        return keepFull ? r : truncate(r, 1100);
      })(),
    })),
  };

  let txt = await withRetries(`llm(check) ${section}`, () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      openai,
      anthropicApiKey,
    })
  );
  if (!txt) throw new Error(`LLM check returned empty response for section ${section}`);
  try {
    // Some providers occasionally emit JSON-looking output with tiny syntax errors.
    // We attempt to parse, and if parsing fails we retry the same request with stricter formatting instructions.
    let parsed: LlmCheckResponse | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        parsed = parseModelJson<LlmCheckResponse>(txt, `llm(check) ${section}`);
        break;
      } catch (e: any) {
        if (attempt >= 3) throw e;
        const retrySystem = [
          system,
          ``,
          `IMPORTANT: Your previous response could not be parsed as strict JSON.`,
          `Return ONLY valid JSON matching the exact schema. No markdown, no commentary.`,
          `Double-check quotes, commas, braces/brackets, and ensure every string is properly closed.`,
        ].join('\n');
        txt = await withRetries(`llm(check) ${section} json-retry-${attempt}`, () =>
          llmChatComplete({
            provider,
            model,
            temperature: 0,
            maxTokens: 2500,
            messages: [
              { role: 'system', content: retrySystem },
              { role: 'user', content: JSON.stringify(user) },
            ],
            openai,
            anthropicApiKey,
          })
        );
        if (!txt) throw new Error(`LLM check returned empty response for section ${section} (json-retry-${attempt})`);
      }
    }
    if (!parsed) throw new Error(`llm(check) ${section}: empty parsed object`);
    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];

    const byId = new Map<string, { original: string; rewritten: string }>();
    const allowed = new Set<string>();
    for (const p of paragraphs) {
      const pid = String(p.paragraph_id || '').trim();
      if (!pid) continue;
      allowed.add(pid);
      byId.set(pid, { original: String(p.original || ''), rewritten: String(p.rewritten || '') });
    }
    const sectionText = paragraphs.map((p) => `${p.paragraph_id}\nORIGINAL:\n${p.original}\nREWRITTEN:\n${p.rewritten}`).join('\n\n');

    const cleaned: LlmIssue[] = [];
    for (const it of rawIssues) {
      let sev = String((it as any).severity || '').toLowerCase();
      if (sev !== 'critical' && sev !== 'warning') continue;
      const pidRaw = (it as any).paragraph_id === null || (it as any).paragraph_id === undefined ? null : String((it as any).paragraph_id || '').trim();
      const pid = pidRaw && allowed.has(pidRaw) ? pidRaw : pidRaw ? null : null;

      const msg = String((it as any).message || '').trim();
      const id = String((it as any).id || '').trim() || `issue:${cleaned.length}`;
      const evidence = String((it as any).evidence || '').trim();
      if (!evidence) continue; // require evidence (no silent hallucinations)

      // Evidence must be grounded in the provided rewritten text.
      // Only allow ORIGINAL-only evidence for explicit meaning-loss issues.
      const allowOriginalEvidence = /meaning|verlies|missing|weggevallen|lost/i.test(`${id} ${msg}`);
      if (pid) {
        const pr = byId.get(pid);
        const oTxt = String(pr?.original || '');
        const rTxt = String(pr?.rewritten || '');
        const ok = rTxt.includes(evidence) || (allowOriginalEvidence && oTxt.includes(evidence));
        if (!ok) continue;
      } else {
        if (!sectionText.includes(evidence)) continue;
      }

      // Deterministically validate common structural claims to avoid false positives.
      // Prince-first: semicolon item parity is NOT a contract, so we ignore these claims entirely.
      if (pid && /semicolon|itemcount|count[_ -]?mismatch|puntkomma/i.test(`${id} ${msg}`)) {
        if (mode === 'prince') continue;
        const pr = byId.get(pid);
        if (pr) {
          const oN = splitSemicolonItems(String(pr.original || '')).length;
          const rN = splitSemicolonItems(String(pr.rewritten || '')).length;
          if (oN === rN) continue; // claim is false; ignore
        }
      }

      // Prince-first: colon/list-intro anchoring is a readability preference, not a gate.
      // Downgrade to warning so it doesn't block the iterate loop.
      if (mode === 'prince' && sev === 'critical' && isPrinceColonAnchoringIssue({ id, message: msg })) {
        sev = 'warning';
      }

      cleaned.push({ id, severity: sev as any, paragraph_id: pid, message: msg, evidence });
    }

    const score = computeScoreFromIssues(cleaned);
    return { score, issues: cleaned, notes: (parsed as any).notes };
  } catch (e) {
    throw new Error(String((e as any)?.message || e || `LLM check failed for section ${section}`));
  }
}

async function llmRepairSection(opts: {
  provider: LlmProvider;
  openai?: OpenAI;
  anthropicApiKey?: string;
  model: string;
  mode: RewriteLintMode;
  section: SectionKey;
  paragraphs: Array<{
    paragraph_id: string;
    style_name: string;
    original: string;
    rewritten: string;
  }>;
  issues: LlmIssue[];
}): Promise<LlmRepairResponse> {
  const { provider, openai, anthropicApiKey, model, mode, section, paragraphs, issues } = opts;

  const ctx = mode === 'indesign' ? CONTEXT_PACK_INDESIGN : CONTEXT_PACK_PRINCE;
  const examples = mode === 'indesign' ? FEW_SHOT_EXAMPLES_INDESIGN : FEW_SHOT_EXAMPLES_PRINCE;
  const writerPrompt = mode === 'indesign' ? USER_N3_WRITER_PROMPT_INDESIGN : USER_N3_WRITER_PROMPT_PRINCE;

  const modeRules =
    mode === 'indesign'
      ? [
          `- If a list-intro must end with ':', rewrite it naturally and end with ':'.`,
          `- For bullet semicolon lists: rewritten MUST be a semicolon list with the SAME item count as original.`,
          `- Bullet quality (from user prompt): bullet items must be short phrases (no mini-paragraphs).`,
          `  If you shorten bullets, you MUST MOVE the removed explanation into nearby •Basis paragraphs within the SAME section, so meaning is preserved.`,
          `  - If the list-intro paragraph must still end with ':' (because bullets follow), you may add explanation BEFORE the final ':' but keep ':' as the last character.`,
          `  - Prefer putting longer explanations AFTER the bullet run in the next •Basis paragraph in the same section.`,
        ]
      : [
          `- Bullets are optional in Prince-first mode.`,
          `  - If a bullet/list paragraph reads better as running text, you MAY remove semicolons and write prose.`,
          `  - If you KEEP a semicolon list (2+ items), keep items short phrases and do NOT repeat the intro sentence inside items.`,
          `- If a real list remains after an intro, prefer ending the intro with ':' so the list is anchored.`,
        ];

  const system = [
    mode === 'indesign'
      ? `You are a senior Dutch editor + InDesign-aware fixer.`
      : `You are a senior Dutch editor + layout-aware fixer (Prince-first).`,
    `You will be given one section and a list of issues found by QA.`,
    `Return patches to fix them.`,
    ``,
    ctx,
    ``,
    examples,
    ``,
    writerPrompt,
    ``,
    `Rules:`,
    `- Output STRICT JSON: { "patches": [ { "paragraph_id":"...", "rewritten":"..." } ], "notes":"..." }`,
    `- Only patch paragraphs that need changes (minimal diffs).`,
    `- Never modify 'original'. Never add '\\r' (use '\\n' only).`,
    ...modeRules,
    `- Remove duplicated intro sentences across consecutive paragraphs.`,
    `- Finish truncated sentences.`,
    `- Preserve existing praktijk/verdieping markers exactly if present.`,
  ].join('\n');

  const user = {
    section,
    issues,
    paragraphs: paragraphs.map((p, i) => ({
      i,
      paragraph_id: p.paragraph_id,
      style_name: p.style_name,
      original: (() => {
        const o = String(p.original ?? '');
        const r = String(p.rewritten ?? '');
        const oItems = splitSemicolonItems(o);
        const rItems = splitSemicolonItems(r);
        const keepFull = (oItems.length >= 2 || rItems.length >= 2) && o.length <= 6000;
        return keepFull ? o : truncate(o, 1300);
      })(),
      rewritten: (() => {
        const o = String(p.original ?? '');
        const r = String(p.rewritten ?? '');
        const oItems = splitSemicolonItems(o);
        const rItems = splitSemicolonItems(r);
        const keepFull = (oItems.length >= 2 || rItems.length >= 2) && r.length <= 6000;
        return keepFull ? r : truncate(r, 1300);
      })(),
    })),
  };

  const txt = await withRetries(`llm(repair) ${section}`, () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      openai,
      anthropicApiKey,
    })
  );
  if (!txt) throw new Error(`LLM repair returned empty response for section ${section}`);
  try {
    const parsed = parseModelJson<LlmRepairResponse>(txt, `llm(repair) ${section}`);
    const patches = Array.isArray(parsed.patches) ? parsed.patches : [];
    return { patches, notes: parsed.notes };
  } catch {
    throw new Error(`LLM repair did not return valid JSON for section ${section}. Raw:\n${txt}`);
  }
}

async function llmWriteSection(opts: {
  provider: LlmProvider;
  openai?: OpenAI;
  anthropicApiKey?: string;
  model: string;
  mode: RewriteLintMode;
  section: SectionKey;
  paragraphs: Array<{
    paragraph_id: string;
    style_name: string;
    original: string;
    rewritten: string;
  }>;
  mustRewriteIds: string[];
}): Promise<LlmRepairResponse> {
  const { provider, openai, anthropicApiKey, model, mode, section, paragraphs, mustRewriteIds } = opts;

  const ctx = mode === 'indesign' ? CONTEXT_PACK_INDESIGN : CONTEXT_PACK_PRINCE;
  const examples = mode === 'indesign' ? FEW_SHOT_EXAMPLES_INDESIGN : FEW_SHOT_EXAMPLES_PRINCE;
  const writerPrompt = mode === 'indesign' ? USER_N3_WRITER_PROMPT_INDESIGN : USER_N3_WRITER_PROMPT_PRINCE;

  const bulletRoleRules =
    mode === 'indesign'
      ? [
          `  - Bullet paragraphs (_Bullets*):`,
          `    - if original is a semicolon list with >=2 items, rewritten MUST be semicolon list with SAME item count.`,
          `    - bullet items must be SHORT PHRASES (no multi-sentence explanation).`,
          `    - if original bullet items contain explanation, MOVE that explanation into nearby •Basis paragraphs within the SAME section (do not lose meaning).`,
        ]
      : [
          `  - Bullet/list paragraphs (_Bullets*):`,
          `    - bullets are optional: you MAY rewrite as running text (no semicolons) if that reads better.`,
          `    - if you KEEP a semicolon list (2+ items), keep items as SHORT PHRASES and avoid mini-paragraphs.`,
          `    - do not repeat the list-intro sentence inside items.`,
        ];

  const listIntroRule =
    mode === 'indesign'
      ? `  - List-intro paragraphs (original ends with ':' and bullets follow): rewritten must still end with ':'.`
      : `  - List-intro paragraphs: if a real list follows in rewritten (semicolon list), prefer ending the intro with ':'.`;

  const system = [
    mode === 'indesign'
      ? `You are writing Dutch textbook content (basisboek / N3), producing InDesign-safe rewrites.`
      : `You are writing Dutch textbook content (basisboek / N3), producing Prince-first rewrites (no InDesign apply).`,
    ``,
    ctx,
    ``,
    examples,
    ``,
    writerPrompt,
    ``,
    `Goal: rewrite the requested paragraph(s) in the given section.`,
    `Constraints (hard):`,
    `- Output STRICT JSON: { "patches": [ { "paragraph_id":"...", "rewritten":"..." } ] }`,
    `- Only output patches for paragraph_ids listed in mustRewriteIds.`,
    `- Never modify 'original'. Never output '\\r' (use '\\n' only).`,
    `- Keep paragraph roles consistent with style_name:`,
    ...bulletRoleRules,
    listIntroRule,
    `- Prefer clear, simple sentences. No new facts. Finish sentences.`,
    `- Preserve any existing praktijk/verdieping markers exactly if present in the paragraph's rewritten text.`,
  ].join('\n');

  const user = {
    section,
    mustRewriteIds,
    paragraphs: paragraphs.map((p, i) => ({
      i,
      paragraph_id: p.paragraph_id,
      style_name: p.style_name,
      original: (() => {
        const o = String(p.original ?? '');
        const r = String(p.rewritten ?? '');
        const oItems = splitSemicolonItems(o);
        const rItems = splitSemicolonItems(r);
        const keepFull = (oItems.length >= 2 || rItems.length >= 2) && o.length <= 6000;
        return keepFull ? o : truncate(o, 1300);
      })(),
      rewritten: (() => {
        const o = String(p.original ?? '');
        const r = String(p.rewritten ?? '');
        const oItems = splitSemicolonItems(o);
        const rItems = splitSemicolonItems(r);
        const keepFull = (oItems.length >= 2 || rItems.length >= 2) && r.length <= 6000;
        return keepFull ? r : truncate(r, 1300);
      })(),
    })),
  };

  const txt = await withRetries(`llm(write) ${section}`, () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      openai,
      anthropicApiKey,
    })
  );
  if (!txt) throw new Error(`LLM write returned empty response for section ${section}`);
  try {
    const parsed = parseModelJson<LlmRepairResponse>(txt, `llm(write) ${section}`);
    const patches = Array.isArray(parsed.patches) ? parsed.patches : [];
    return { patches, notes: parsed.notes };
  } catch {
    throw new Error(`LLM write did not return valid JSON for section ${section}. Raw:\n${txt}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = process.argv[2] && !process.argv[2]!.startsWith('--') ? path.resolve(expandTilde(process.argv[2]!)) : '';
  const outPath =
    process.argv[3] && !process.argv[3]!.startsWith('--')
      ? path.resolve(expandTilde(process.argv[3]!))
      : path.join(process.env.HOME || '', 'Desktop', 'rewrites_for_indesign.LLM_ITERATED.json');

  if (!inPath) {
    console.error(
      'Usage: npx ts-node scripts/llm-iterate-rewrites-json.ts <inJson> <outJson> ' +
        '[--mode prince|indesign] [--chapter N] ' +
        '[--provider openai|anthropic] [--model claude-opus-4-5-20251101] ' +
        '[--write-provider openai|anthropic] [--write-model ...] ' +
        '[--check-provider openai|anthropic] [--check-model ...] ' +
        '[--repair-provider openai|anthropic] [--repair-model ...] ' +
        '[--max-iters 5] [--target-score 100] [--write-missing] ' +
        '[--sample-pages 2] [--words-per-page 550] ' +
        '[--enforce-bullet-short] [--bullet-max-words 12]'
    );
    process.exit(1);
  }
  if (!fs.existsSync(inPath)) throw new Error(`❌ Not found: ${inPath}`);

  const modeRaw = typeof args.mode === 'string' ? String(args.mode).trim().toLowerCase() : '';
  const mode: RewriteLintMode = modeRaw === 'indesign' ? 'indesign' : 'prince';

  const defaultModel = typeof args.model === 'string' ? String(args.model).trim() : 'claude-opus-4-5-20251101';
  const globalProvider = parseProvider(args.provider, 'openai');
  const writeProvider = parseProvider(args['write-provider'], globalProvider);
  const checkProvider = parseProvider(args['check-provider'], globalProvider);
  const repairProvider = parseProvider(args['repair-provider'], writeProvider);

  const writeModel = typeof args['write-model'] === 'string' ? String(args['write-model']).trim() : defaultModel;
  const checkModel = typeof args['check-model'] === 'string' ? String(args['check-model']).trim() : defaultModel;
  const repairModel = typeof args['repair-model'] === 'string' ? String(args['repair-model']).trim() : writeModel;

  const openaiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  const needsOpenai = writeProvider === 'openai' || checkProvider === 'openai' || repairProvider === 'openai';
  const needsAnthropic = writeProvider === 'anthropic' || checkProvider === 'anthropic' || repairProvider === 'anthropic';
  if (needsOpenai && !openaiKey) throw new Error('❌ Missing OPENAI_API_KEY');
  if (needsAnthropic && !anthropicKey) throw new Error('❌ Missing ANTHROPIC_API_KEY');

  const chapterFilter = typeof args.chapter === 'string' ? String(args.chapter).trim() : '';
  const maxIters = typeof args['max-iters'] === 'string' ? Math.max(1, parseInt(String(args['max-iters']), 10) || 5) : 5;
  const targetScore = typeof args['target-score'] === 'string' ? Math.max(0, Math.min(100, parseInt(String(args['target-score']), 10) || 100)) : 100;
  const writeMissing = args['write-missing'] === true;
  const writeAll = args['write-all'] === true;
  const writeIfUnchanged = args['write-if-unchanged'] === true;
  // Coherence / flow hardening:
  // When we rewrite only SOME paragraphs inside a subparagraph (SectionKey), we often create “choppy” flow:
  // - intro paragraph rewritten to integrate list content, but the list paragraph remains unchanged
  // - dangling “there are three types:” intros without the list being updated (or vice versa)
  //
  // To prevent this, optionally rewrite the WHOLE section whenever we touch any paragraph inside it.
  // Default: ON for Prince mode when write is selective (write-if-unchanged / write-missing).
  const writeWholeSection =
    args['write-whole-section'] === true ||
    args['whole-section-write'] === true ||
    (mode === 'prince' && !writeAll && (writeIfUnchanged || writeMissing));
  const strictScore = args['strict-score'] === true; // old behavior: repair warnings + require score target
  const samplePages = typeof args['sample-pages'] === 'string' ? Math.max(0, parseInt(String(args['sample-pages']), 10) || 0) : 0;
  const wordsPerPage = typeof args['words-per-page'] === 'string' ? Math.max(200, parseInt(String(args['words-per-page']), 10) || 550) : 550;
  const enforceBulletShort = args['enforce-bullet-short'] === true;
  const bulletMaxWords = typeof args['bullet-max-words'] === 'string' ? Math.max(5, parseInt(String(args['bullet-max-words']), 10) || 12) : 12;

  // Streamlined pipeline options
  const checkpointBest = args['checkpoint-best'] !== false; // default ON: never regress to worse scores
  const earlyStopIters = typeof args['early-stop-iters'] === 'string' 
    ? Math.max(1, parseInt(String(args['early-stop-iters']), 10) || 3) 
    : 3; // stop if no improvement after N consecutive iterations
  const earlyStopScore = typeof args['early-stop-score'] === 'string'
    ? Math.max(0, Math.min(100, parseInt(String(args['early-stop-score']), 10) || 70))
    : 70; // stop early if min score reaches this threshold

  const raw = fs.readFileSync(inPath, 'utf8');
  const data = JSON.parse(raw) as JsonShape;
  if (!data || !Array.isArray(data.paragraphs)) throw new Error('Invalid JSON shape: expected { paragraphs: [...] }');

  // Work on a deep copy
  const paras: RewritesForIndesignParagraph[] = JSON.parse(JSON.stringify(data.paragraphs));

  // Optional write step (only fill missing rewritten)
  if (writeMissing) {
    for (const p of paras) {
      const rw = String(p.rewritten ?? '').trim();
      if (!rw) p.rewritten = String(p.original ?? '');
    }
  }

  // Build indices
  const byId = new Map<string, RewritesForIndesignParagraph>();
  for (const p of paras) {
    const pid = String(p.paragraph_id ?? '').trim();
    if (pid) byId.set(pid, p);
  }

  // OpenAI SDK default timeout is 10 minutes; pass2 chapters can have large sections,
  // so allow overriding via env and increase default slightly for stability.
  const openaiTimeoutEnv = Number(String(process.env.OPENAI_TIMEOUT_MS ?? '').trim());
  const openaiTimeoutMs =
    Number.isFinite(openaiTimeoutEnv) && openaiTimeoutEnv > 0 ? Math.floor(openaiTimeoutEnv) : 12 * 60_000;

  const openai = needsOpenai ? new OpenAI({ apiKey: openaiKey, timeout: openaiTimeoutMs, maxRetries: 0 }) : undefined;

  const report: any = {
    inPath,
    outPath,
    // legacy single-model field (keep for dashboards); use checker by default
    model: checkModel,
    write_provider: writeProvider,
    write_model: writeModel,
    check_provider: checkProvider,
    check_model: checkModel,
    repair_provider: repairProvider,
    repair_model: repairModel,
    chapter: chapterFilter || null,
    maxIters,
    targetScore,
    sample_pages: samplePages || null,
    sample_words_per_page: samplePages ? wordsPerPage : null,
    enforce_bullet_short: enforceBulletShort || null,
    bullet_max_words: enforceBulletShort ? bulletMaxWords : null,
    checkpoint_best: checkpointBest,
    early_stop_iters: earlyStopIters,
    early_stop_score: earlyStopScore,
    started_at: new Date().toISOString(),
    iterations: [] as any[],
  };

  // Checkpoint best: store the best version of each section's paragraphs
  type SectionCheckpoint = {
    score: number;
    criticalIssues: number;
    paragraphs: Map<string, string>; // paragraph_id -> rewritten
  };
  const bestCheckpoints = new Map<SectionKey, SectionCheckpoint>();
  let lastBestMinScore = 0;
  let itersWithoutImprovement = 0;

  const run = async () => {
    let finished = false;
    for (let iter = 1; iter <= maxIters; iter++) {
      // Scope paragraphs by chapter if requested
      const scopedAll = chapterFilter ? paras.filter((p) => String(p.chapter ?? '') === chapterFilter) : paras;
      const sampled = sampleParagraphsByPages(scopedAll, { samplePages, wordsPerPage });
      const scoped = sampled.paragraphs;
      if (iter === 1 && samplePages) {
        console.log(
          `sample_pages=${samplePages} words_per_page=${wordsPerPage} budget_words=${sampled.budgetWords} ` +
            `selected_sections=${sampled.sections} selected_paragraphs=${scoped.length} approx_words=${sampled.approxWords}`
        );
      }

      // Deterministic fix-up before checking (keeps invariants stable for the checker)
      applyDeterministicFixesToParagraphs(scoped, { mode });
      applyLocalDeterministicTextFixes(scoped);

      // LLM write step (optional): only on first iteration.
      // This is the "writer" part of write→check→repair.
      if (iter === 1 && (writeAll || writeMissing || writeIfUnchanged)) {
        const idsToWrite = new Set<string>();
        for (const p of scoped) {
          const pid = String(p.paragraph_id ?? '').trim();
          if (!pid) continue;
          if (writeAll) {
            idsToWrite.add(pid);
            continue;
          }
          const rw = String(p.rewritten ?? '').trim();
          const o = String(p.original ?? '').trim();
          if (writeMissing && !rw) idsToWrite.add(pid);
          if (writeIfUnchanged && rw && o && rw === o) idsToWrite.add(pid);
        }

        if (idsToWrite.size > 0) {
          // Group by section and rewrite only those ids
          const sections = new Map<SectionKey, RewritesForIndesignParagraph[]>();
          for (const p of scoped) {
            const key = sectionKey(p);
            const arr = sections.get(key) ?? [];
            arr.push(p);
            sections.set(key, arr);
          }

          for (const [sk, ps] of sections.entries()) {
            const mustRewriteIds = ps
              .map((p) => String(p.paragraph_id ?? '').trim())
              .filter((pid) => pid && idsToWrite.has(pid));
            if (!mustRewriteIds.length) continue;

            const sectionAllIds = ps.map((p) => String(p.paragraph_id ?? '').trim()).filter(Boolean);
            const effectiveMustRewriteIds = writeWholeSection ? Array.from(new Set(sectionAllIds)) : mustRewriteIds;
            const mustRewriteSet = new Set(effectiveMustRewriteIds);

            const payload = ps
              .filter((p) => String(p.paragraph_id ?? '').trim().length > 0)
              .map((p) => ({
                paragraph_id: String(p.paragraph_id ?? ''),
                style_name: String(p.style_name ?? ''),
                original: normalizeNewlinesNoCR(String(p.original ?? '')),
                rewritten: normalizeNewlinesNoCR(String(p.rewritten ?? '')),
              }));
            if (!payload.length) continue;

            console.log(
              `iter=${iter} stage=write section=${sk} paragraph_ids=${effectiveMustRewriteIds.length} payload_paragraphs=${payload.length}`
            );

            const wr = await llmWriteSection({
              provider: writeProvider,
              openai,
              anthropicApiKey: anthropicKey,
              model: writeModel,
              mode,
              section: sk,
              paragraphs: payload,
              mustRewriteIds: effectiveMustRewriteIds,
            });
            for (const patch of wr.patches ?? []) {
              const pid = String(patch.paragraph_id ?? '').trim();
              if (!pid || !mustRewriteSet.has(pid)) continue;
              const target = byId.get(pid);
              if (!target) continue;
              const next = normalizeNewlinesNoCR(String(patch.rewritten ?? ''));
              if (next.includes('\r')) throw new Error(`LLM write produced \\r for paragraph ${pid}`);
              target.rewritten = next;
            }
          }

          // Normalize again after writing
          applyDeterministicFixesToParagraphs(scoped, { mode });
          applyLocalDeterministicTextFixes(scoped);
        }
      }

      const detErrs = deterministicErrors(scoped, { mode, enforceBulletShort, bulletMaxWords });
      const detPids = new Set(detErrs.map((e) => e.paragraph_id).filter(Boolean) as string[]);

      // Group by section
      const sections = new Map<SectionKey, RewritesForIndesignParagraph[]>();
      for (const p of scoped) {
        const key = sectionKey(p);
        const arr = sections.get(key) ?? [];
        arr.push(p);
        sections.set(key, arr);
      }

      // LLM check (section-by-section)
      let minScore = 100;
      const sectionIssues = new Map<SectionKey, LlmIssue[]>(); // all issues (critical + warning)
      const sectionCriticalIssues = new Map<SectionKey, LlmIssue[]>(); // critical only
      let criticalIssueCount = 0; // total critical issues (not sections)
      const checkSummaries: Array<{
        section: SectionKey;
        score: number;
        critical: number;
        warning: number;
        sample: Array<{ severity: string; paragraph_id: string | null; id: string; message: string }>;
      }> = [];
      const sectionEntries = Array.from(sections.entries());
      let sectionIdx = 0;
      for (const [sk, ps] of sectionEntries) {
        sectionIdx++;
        const payload = ps
          .filter((p) => String(p.paragraph_id ?? '').trim().length > 0)
          .map((p) => ({
            paragraph_id: String(p.paragraph_id ?? ''),
            style_name: String(p.style_name ?? ''),
            original: normalizeNewlinesNoCR(String(p.original ?? '')),
            rewritten: normalizeNewlinesNoCR(String(p.rewritten ?? '')),
          }));
        if (!payload.length) continue;

        console.log(`iter=${iter} stage=check progress=${sectionIdx}/${sectionEntries.length} section=${sk} paragraphs=${payload.length}`);

        const chk = await llmCheckSection({
          provider: checkProvider,
          openai,
          anthropicApiKey: anthropicKey,
          model: checkModel,
          mode,
          section: sk,
          paragraphs: payload,
        });
        minScore = Math.min(minScore, Math.max(0, Math.min(100, Number(chk.score) || 0)));
        const all = Array.isArray(chk.issues) ? chk.issues : [];
        const crit = all.filter((x) => String(x.severity || '').toLowerCase() === 'critical');
        const warn = all.filter((x) => String(x.severity || '').toLowerCase() === 'warning');
        if (all.length) sectionIssues.set(sk, all);
        if (crit.length) sectionCriticalIssues.set(sk, crit);
        criticalIssueCount += crit.length;
        checkSummaries.push({
          section: sk,
          score: Math.max(0, Math.min(100, Number(chk.score) || 0)),
          critical: crit.length,
          warning: warn.length,
          sample: all.slice(0, 4).map((i) => ({
            severity: String(i.severity || ''),
            paragraph_id: i.paragraph_id ?? null,
            id: String(i.id || ''),
            message: String(i.message || ''),
          })),
        });
      }

      checkSummaries.sort((a, b) => a.score - b.score);

      // Checkpoint best: update best versions for sections that improved
      if (checkpointBest) {
        for (const summary of checkSummaries) {
          const sk = summary.section;
          const currentScore = summary.score;
          const currentCritical = summary.critical;
          const existing = bestCheckpoints.get(sk);
          
          // Update checkpoint if: no existing, or better score, or same score but fewer critical issues
          const isBetter = !existing || 
            currentScore > existing.score || 
            (currentScore === existing.score && currentCritical < existing.criticalIssues);
          
          if (isBetter) {
            const ps = sections.get(sk) ?? [];
            const checkpoint: SectionCheckpoint = {
              score: currentScore,
              criticalIssues: currentCritical,
              paragraphs: new Map(),
            };
            for (const p of ps) {
              const pid = String(p.paragraph_id ?? '').trim();
              if (pid) checkpoint.paragraphs.set(pid, String(p.rewritten ?? ''));
            }
            bestCheckpoints.set(sk, checkpoint);
          }
        }
      }

      // Early stop: check if we're making progress
      if (minScore > lastBestMinScore) {
        lastBestMinScore = minScore;
        itersWithoutImprovement = 0;
      } else {
        itersWithoutImprovement++;
      }

      const iterLog: any = {
        iter,
        deterministic_errors: detErrs.length,
        llm_min_score: minScore,
        sections_with_issues: sectionIssues.size,
        sections_with_critical_issues: sectionCriticalIssues.size,
        critical_issues_total: criticalIssueCount,
        sample_det_errors: detErrs.slice(0, 8),
        lowest_score_sections: checkSummaries.slice(0, 6),
        best_min_score: lastBestMinScore,
        iters_without_improvement: itersWithoutImprovement,
      };
      report.iterations.push(iterLog);

      const done = detErrs.length === 0 && (strictScore ? sectionIssues.size === 0 && minScore >= targetScore : criticalIssueCount === 0);
      
      // Early stop conditions
      const earlyStopReached = minScore >= earlyStopScore && detErrs.length === 0;
      const noProgressStop = itersWithoutImprovement >= earlyStopIters && iter >= 2;
      
      console.log(
        `iter=${iter} det_errors=${detErrs.length} llm_min_score=${minScore} best=${lastBestMinScore} no_improve=${itersWithoutImprovement} issue_sections=${sectionIssues.size} critical_sections=${sectionCriticalIssues.size} done=${done ? '1' : '0'}`
      );
      
      if (done) {
        report.finished_at = new Date().toISOString();
        report.final = { iter, det_errors: 0, llm_min_score: minScore, early_stop: false };
        finished = true;
        break;
      }
      
      if (earlyStopReached) {
        console.log(`Early stop: score ${minScore} >= ${earlyStopScore} threshold`);
        report.finished_at = new Date().toISOString();
        report.final = { iter, det_errors: detErrs.length, llm_min_score: minScore, early_stop: 'score_threshold' };
        finished = true;
        break;
      }
      
      if (noProgressStop) {
        console.log(`Early stop: no improvement for ${itersWithoutImprovement} iterations`);
        report.finished_at = new Date().toISOString();
        report.final = { iter, det_errors: detErrs.length, llm_min_score: minScore, early_stop: 'no_progress' };
        finished = true;
        break;
      }

      // Repair: focus on sections that have deterministic errors or LLM critical issues
      const sectionsToRepair = new Set<SectionKey>();
      if (detPids.size > 0) {
        for (const p of scoped) {
          const pid = String(p.paragraph_id ?? '').trim();
          if (pid && detPids.has(pid)) sectionsToRepair.add(sectionKey(p));
        }
      }
      // Avoid thrash: only repair warnings when strict-score is enabled.
      if (strictScore) {
        for (const sk of sectionIssues.keys()) sectionsToRepair.add(sk);
      } else {
        for (const sk of sectionCriticalIssues.keys()) sectionsToRepair.add(sk);
      }

      const repairList = Array.from(sectionsToRepair);
      let repairIdx = 0;
      for (const sk of repairList) {
        repairIdx++;
        const ps = sections.get(sk) ?? [];
        const payload = ps
          .filter((p) => String(p.paragraph_id ?? '').trim().length > 0)
          .map((p) => ({
            paragraph_id: String(p.paragraph_id ?? ''),
            style_name: String(p.style_name ?? ''),
            original: normalizeNewlinesNoCR(String(p.original ?? '')),
            rewritten: normalizeNewlinesNoCR(String(p.rewritten ?? '')),
          }));
        if (!payload.length) continue;

        console.log(
          `iter=${iter} stage=repair progress=${repairIdx}/${repairList.length} section=${sk} paragraphs=${payload.length}`
        );

        // Build issue list for this section (deterministic + LLM)
        const issues: LlmIssue[] = [];
        for (const e of detErrs) {
          if (!e.paragraph_id) continue;
          const para = byId.get(e.paragraph_id);
          if (!para) continue;
          if (sectionKey(para) !== sk) continue;
          issues.push({
            id: `det:${e.paragraph_id}:${issues.length}`,
            severity: 'critical',
            paragraph_id: e.paragraph_id,
            message: e.message,
          });
        }
        if (strictScore) {
          for (const e of sectionIssues.get(sk) ?? []) issues.push(e);
        } else {
          for (const e of sectionCriticalIssues.get(sk) ?? []) issues.push(e);
        }

        const rep = await llmRepairSection({
          provider: repairProvider,
          openai,
          anthropicApiKey: anthropicKey,
          model: repairModel,
          mode,
          section: sk,
          paragraphs: payload,
          issues,
        });
        const patches = Array.isArray(rep.patches) ? rep.patches : [];
        for (const patch of patches) {
          const pid = String(patch.paragraph_id ?? '').trim();
          if (!pid) continue;
          const target = byId.get(pid);
          if (!target) continue;
          const next = normalizeNewlinesNoCR(String(patch.rewritten ?? ''));
          if (next.includes('\r')) throw new Error(`LLM repair produced \\r for paragraph ${pid}`);
          // Preserve list-intro ':' when original is list-intro and next is bullet (defense-in-depth)
          try {
            const idx = scoped.findIndex((x) => String(x.paragraph_id ?? '') === pid);
            const nxt = idx >= 0 && idx + 1 < scoped.length ? scoped[idx + 1] : null;
            if (isListIntro(String(target.original ?? '')) && nxt && isBulletStyleName(String(nxt.style_name ?? ''))) {
              if (!next.trim().endsWith(':')) {
                // Soft enforce: append ":" (LLM should do this; this is safety only)
                target.rewritten = `${next.trim()}:`;
                continue;
              }
            }
          } catch {}
          target.rewritten = next;
        }
      }

      // Targeted bullet repair (LLM) is InDesign-only: it restores semicolon item parity for deterministic apply.
      if (mode === 'indesign') {
        // This is the most common root cause of "water;" looking un-rewritten / floating in INDD output.
        let bulletFixed = 0;
        for (let i = 0; i < scoped.length; i++) {
          const p = scoped[i]!;
          const style = String(p.style_name ?? '');
          if (!isBulletStyleName(style)) continue;
          const oItems = splitSemicolonItems(String(p.original ?? ''));
          if (oItems.length < 2) continue;
          const wItems = splitSemicolonItems(String(p.rewritten ?? ''));
          if (wItems.length === oItems.length) continue;

          // Find a nearby intro line within the same section (scan backwards to first non-bullet)
          let intro = '';
          try {
            for (let j = i - 1; j >= 0; j--) {
              const prev = scoped[j]!;
              if (!prev) continue;
              if (sectionKey(prev) !== sectionKey(p)) break;
              if (isBulletStyleName(String(prev.style_name ?? ''))) continue;
              intro = String(prev.rewritten ?? prev.original ?? '').trim();
              break;
            }
          } catch {}

          const repaired = await llmRepairBulletSemicolonList({
            provider: repairProvider,
            openai,
            anthropicApiKey: anthropicKey,
            model: repairModel,
            section: sectionKey(p),
            listIntro: intro,
            originalItems: oItems,
            currentRewritten: String(p.rewritten ?? ''),
          });

          const items = Array.isArray(repaired.items) ? repaired.items.map((x) => String(x ?? '').trim()) : [];
          if (items.length !== oItems.length || items.some((x) => !x)) {
            throw new Error(
              `LLM bullet repair produced invalid items for paragraph ${String(p.paragraph_id ?? '')} (expected ${oItems.length} non-empty items, got ${items.length})`
            );
          }

          const lastPunct = inferLastPunctFromOriginalSemicolonList(String(p.original ?? ''));
          p.rewritten = joinSemicolonItems(items, lastPunct);
          bulletFixed++;
        }
        if (bulletFixed > 0) console.log(`iter=${iter} bullet_semicolon_repairs=${bulletFixed}`);
      }
    }

    // If we hit maxIters, the loop may have applied a final repair but never re-checked.
    // Run ONE post-repair check so the "final" status reflects the output we actually wrote.
    if (!finished) {
      // Scope paragraphs by chapter if requested
      const scopedAll = chapterFilter ? paras.filter((p) => String(p.chapter ?? '') === chapterFilter) : paras;
      const sampled = sampleParagraphsByPages(scopedAll, { samplePages, wordsPerPage });
      const scoped = sampled.paragraphs;

      applyDeterministicFixesToParagraphs(scoped, { mode });
      applyLocalDeterministicTextFixes(scoped);

      const detErrs = deterministicErrors(scoped, { mode, enforceBulletShort, bulletMaxWords });

      // Group by section
      const sections = new Map<SectionKey, RewritesForIndesignParagraph[]>();
      for (const p of scoped) {
        const key = sectionKey(p);
        const arr = sections.get(key) ?? [];
        arr.push(p);
        sections.set(key, arr);
      }

      let minScore = 100;
      const sectionIssues = new Map<SectionKey, LlmIssue[]>();
      const sectionCriticalIssues = new Map<SectionKey, LlmIssue[]>();
      let criticalIssueCount = 0;
      const checkSummaries: Array<{
        section: SectionKey;
        score: number;
        critical: number;
        warning: number;
        sample: Array<{ severity: string; paragraph_id: string | null; id: string; message: string }>;
      }> = [];
      const postEntries = Array.from(sections.entries());
      let postIdx = 0;
      for (const [sk, ps] of postEntries) {
        postIdx++;
        const payload = ps
          .filter((p) => String(p.paragraph_id ?? '').trim().length > 0)
          .map((p) => ({
            paragraph_id: String(p.paragraph_id ?? ''),
            style_name: String(p.style_name ?? ''),
            original: normalizeNewlinesNoCR(String(p.original ?? '')),
            rewritten: normalizeNewlinesNoCR(String(p.rewritten ?? '')),
          }));
        if (!payload.length) continue;

        console.log(`post_check progress=${postIdx}/${postEntries.length} section=${sk} paragraphs=${payload.length}`);

        const chk = await llmCheckSection({
          provider: checkProvider,
          openai,
          anthropicApiKey: anthropicKey,
          model: checkModel,
          mode,
          section: sk,
          paragraphs: payload,
        });
        minScore = Math.min(minScore, Math.max(0, Math.min(100, Number(chk.score) || 0)));
        const all = Array.isArray(chk.issues) ? chk.issues : [];
        const crit = all.filter((x) => String(x.severity || '').toLowerCase() === 'critical');
        const warn = all.filter((x) => String(x.severity || '').toLowerCase() === 'warning');
        if (all.length) sectionIssues.set(sk, all);
        if (crit.length) sectionCriticalIssues.set(sk, crit);
        criticalIssueCount += crit.length;
        checkSummaries.push({
          section: sk,
          score: Math.max(0, Math.min(100, Number(chk.score) || 0)),
          critical: crit.length,
          warning: warn.length,
          sample: all.slice(0, 4).map((i) => ({
            severity: String(i.severity || ''),
            paragraph_id: i.paragraph_id ?? null,
            id: String(i.id || ''),
            message: String(i.message || ''),
          })),
        });
      }

      checkSummaries.sort((a, b) => a.score - b.score);
      report.post_repair_check = {
        deterministic_errors: detErrs.length,
        llm_min_score: minScore,
        sections_with_issues: sectionIssues.size,
        sections_with_critical_issues: sectionCriticalIssues.size,
        critical_issues_total: criticalIssueCount,
        sample_det_errors: detErrs.slice(0, 8),
        lowest_score_sections: checkSummaries.slice(0, 6),
      };

      const doneAfter = detErrs.length === 0 && (strictScore ? sectionIssues.size === 0 && minScore >= targetScore : criticalIssueCount === 0);
      console.log(
        `post_check det_errors=${detErrs.length} llm_min_score=${minScore} issue_sections=${sectionIssues.size} critical_sections=${sectionCriticalIssues.size} done=${doneAfter ? '1' : '0'}`
      );

      report.finished_at = new Date().toISOString();
      report.final = { iter: maxIters, det_errors: detErrs.length, llm_min_score: minScore, post_repair_check: true };
      report.ended_due_to_max_iters = true;
    }

    // Checkpoint best: restore best versions for any sections that regressed
    if (checkpointBest && bestCheckpoints.size > 0) {
      let restoredCount = 0;
      for (const [sk, checkpoint] of bestCheckpoints.entries()) {
        for (const [pid, bestRewritten] of checkpoint.paragraphs.entries()) {
          const para = byId.get(pid);
          if (para && String(para.rewritten ?? '') !== bestRewritten) {
            para.rewritten = bestRewritten;
            restoredCount++;
          }
        }
      }
      if (restoredCount > 0) {
        console.log(`Checkpoint restore: restored ${restoredCount} paragraph(s) to best versions`);
        report.checkpoint_restored = restoredCount;
      }
      
      // Compute best score from checkpoints
      let bestMinScore = 100;
      for (const checkpoint of bestCheckpoints.values()) {
        bestMinScore = Math.min(bestMinScore, checkpoint.score);
      }
      report.checkpoint_best_min_score = bestMinScore;
    }

    const out: JsonShape = {
      ...data,
      paragraphs: paras,
      llm_iterated_at: new Date().toISOString(),
      llm_iterated_by: 'scripts/llm-iterate-rewrites-json.ts',
      // legacy (single-model) field: store checker model for dashboards
      llm_iterated_model: checkModel,
      llm_iterated_write_provider: writeProvider,
      llm_iterated_write_model: writeModel,
      llm_iterated_check_provider: checkProvider,
      llm_iterated_check_model: checkModel,
      llm_iterated_repair_provider: repairProvider,
      llm_iterated_repair_model: repairModel,
      llm_iterated_max_iters: maxIters,
      llm_iterated_target_score: targetScore,
      llm_iterated_iterations: report.iterations.length,
      llm_iterated_final_score: report.checkpoint_best_min_score ?? report.final?.llm_min_score ?? (report.iterations.length ? report.iterations[report.iterations.length - 1]?.llm_min_score : undefined),
      llm_iterated_report: report,
    };

    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`✅ Wrote iterated JSON: ${outPath}`);
  };

  run().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
  });
}

main();


