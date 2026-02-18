/**
 * Generate per-subparagraph Praktijk/Verdieping box text overrides from a skeleton-first rewrite output.
 *
 * Why:
 * - The skeleton JSON already contains extracted terms/facts per section.
 * - We can use that structured info to draft better "praktijk" (care scenario) and "verdieping" (deeper why/how) boxes.
 * - Boxes are stored in canonical JSON fields (`praktijk` / `verdieping`) and must remain KD-free.
 *
 * Output JSON shape:
 * {
 *   "praktijk": { "1.1.2": "..." },
 *   "verdieping": { "1.1.2": "..." }
 * }
 *
 * Usage:
 *   npx tsx new_pipeline/export/generate-box-overrides-from-skeleton.ts <canonical.json> <skeleton_rewrites.json> \
 *     --out <overrides.json> --chapter 1 --provider anthropic --model claude-sonnet-4-5-20250929
 *
 * Notes:
 * - This script does NOT apply the boxes. It only generates overrides.
 * - Apply with: new_pipeline/export/apply-kd-differentiation-poc.py --box-overrides <overrides.json>
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

type Provider = 'anthropic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Load env in a local-dev friendly order, without overriding existing env vars.
try {
  const repoRoot = path.resolve(__dirname, '../..');
  const candidates = [
    path.resolve(repoRoot, '.env.local'),
    path.resolve(repoRoot, '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
} catch {
  // ignore
}

function stripMarkers(s: string): string {
  return String(s || '')
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function replaceHouseTerms(s: string): string {
  let t = String(s || '');
  // cliënt/client -> zorgvrager (keep capitalization-ish)
  t = t.replace(/(^|[^0-9A-Za-zÀ-ÿ])(cliënten|clienten|cliënt|client|clients)(?![0-9A-Za-zÀ-ÿ])/giu, (_m, pre: string, tok: string) => {
    const low = tok.toLowerCase();
    const plural = low === 'cliënten' || low === 'clienten' || low === 'clients';
    const cap = tok[0] === tok[0]?.toUpperCase();
    const base = cap ? 'Zorgvrager' : 'zorgvrager';
    return `${pre}${base}${plural ? 's' : ''}`;
  });
  // verpleegkundige -> zorgprofessional
  t = t.replace(/(^|[^0-9A-Za-zÀ-ÿ])(verpleegkundigen|verpleegkundige)(?![0-9A-Za-zÀ-ÿ])/giu, (_m, pre: string, tok: string) => {
    const low = tok.toLowerCase();
    const plural = low === 'verpleegkundigen';
    const cap = tok[0] === tok[0]?.toUpperCase();
    const base = cap ? 'Zorgprofessional' : 'zorgprofessional';
    return `${pre}${base}${plural ? 's' : ''}`;
  });
  return t;
}

function startsWithAbbrevToken(s: string): boolean {
  const first = String(s || '').trim().split(/\s+/)[0] || '';
  return /^[A-Z0-9]{2,}$/.test(first);
}

function lowercaseStartIfNeeded(s: string): string {
  const t = String(s || '').trim();
  if (!t) return '';
  if (startsWithAbbrevToken(t)) return t;
  const m = t.match(/^([\s"'“‘(]*)([A-Za-zÀ-ÿ])/u);
  if (!m) return t;
  const pre = m[1] || '';
  const ch = m[2] || '';
  const rest = t.slice(pre.length + ch.length);
  return `${pre}${ch.toLowerCase()}${rest}`;
}

function cleanBoxText(raw: string): string {
  let t = stripMarkers(raw);
  t = replaceHouseTerms(t);
  // Remove accidental labels (renderer adds them)
  t = t.replace(/^(in de praktijk|verdieping)\s*:\s*/iu, '');
  // Remove leading bullet glyphs/dashes
  t = t.replace(/^[-•\u2022]+\s*/u, '');
  // No newlines
  t = t.replace(/\r/g, ' ').replace(/\n/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // Ensure lower-case start (except abbreviation-like tokens)
  t = lowercaseStartIfNeeded(t);
  return t;
}

function normalizeForMatch(s: string): string {
  return stripMarkers(s).toLowerCase();
}

function safeJsonParse<T = any>(raw: string, label: string): T {
  const s = String(raw || '');
  try {
    return JSON.parse(s);
  } catch (e: any) {
    throw new Error(`Failed to parse JSON (${label}): ${String(e?.message || e)}`);
  }
}

async function anthropicMessages(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': opts.apiKey,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${txt}`);
  }
  const data: any = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const texts: string[] = [];
  for (const b of blocks) {
    if (b && typeof b === 'object' && typeof b.text === 'string') texts.push(b.text);
  }
  return texts.join('').trim();
}

function parseJsonObjectFromModel(raw: string): any {
  let s = String(raw || '').trim();
  // Strip markdown fences
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*/g, '').replace(/\s*```$/g, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j >= 0 && j > i) s = s.slice(i, j + 1);
  return JSON.parse(s);
}

type SkeletonTerm = { term: string; definition: string };
type SkeletonSection = { terms?: SkeletonTerm[]; facts?: string[]; flow?: string[] };

function getSectionSkeleton(skeletonJson: any, sectionNumber: string): SkeletonSection | null {
  const sk = skeletonJson?.skeleton;
  if (!sk) return null;
  // combined: true -> sections map
  if (sk.combined && sk.sections && typeof sk.sections === 'object') {
    const sec = sk.sections[sectionNumber];
    return sec && typeof sec === 'object' ? (sec as SkeletonSection) : null;
  }
  // single section case (best-effort)
  return sk && typeof sk === 'object' ? (sk as SkeletonSection) : null;
}

function extractSubparagraphs(book: any, chapter: number): Array<{ number: string; title: string; basisContext: string }> {
  const out: Array<{ number: string; title: string; basisContext: string }> = [];
  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
  const ch = chapters.find((c: any) => String(c?.number || '') === String(chapter));
  if (!ch) return out;

  const sections = Array.isArray(ch?.sections) ? ch.sections : [];
  for (const sec of sections) {
    const items = Array.isArray(sec?.content) ? sec.content : [];
    for (const sp of items) {
      if (!sp || typeof sp !== 'object' || String(sp.type || '') !== 'subparagraph') continue;
      const num = String(sp.number || '').trim();
      if (!num) continue;
      const title = String(sp.title || '').trim();
      const content = Array.isArray(sp.content) ? sp.content : [];
      const paras = content.filter((b: any) => b && typeof b === 'object' && String(b.type || '') === 'paragraph');
      const basisAll = paras
        .map((p: any) => stripMarkers(String(p.basis || '')).trim())
        .filter(Boolean)
        .join(' ');
      const words = basisAll.split(/\s+/).filter(Boolean);
      const basisContext = words.length > 220 ? `${words.slice(0, 220).join(' ')} …` : basisAll;
      out.push({ number: num, title, basisContext });
    }
  }
  return out;
}

function pickRelevantTerms(sec: SkeletonSection | null, title: string, basisContext: string): SkeletonTerm[] {
  const terms = Array.isArray(sec?.terms) ? (sec!.terms as SkeletonTerm[]) : [];
  if (!terms.length) return [];
  const hay = normalizeForMatch(`${title} ${basisContext}`);
  const hits: SkeletonTerm[] = [];
  for (const t of terms) {
    const term = String(t?.term || '').trim();
    const def = String(t?.definition || '').trim();
    if (!term || !def) continue;
    const needle = normalizeForMatch(term);
    if (!needle) continue;
    // crude contains; OK for Dutch textbook terms
    if (hay.includes(needle)) hits.push({ term, definition: def });
    if (hits.length >= 8) break;
  }
  return hits;
}

function pickRelevantFacts(sec: SkeletonSection | null, terms: SkeletonTerm[]): string[] {
  const facts = Array.isArray(sec?.facts) ? (sec!.facts as string[]) : [];
  if (!facts.length) return [];
  const needles = terms.map((t) => normalizeForMatch(t.term)).filter(Boolean);
  const out: string[] = [];
  for (const f of facts) {
    const ff = String(f || '').trim();
    if (!ff) continue;
    const low = ff.toLowerCase();
    const ok = needles.length ? needles.some((n) => low.includes(n)) : true;
    if (ok) out.push(ff);
    if (out.length >= 10) break;
  }
  return out;
}

async function main() {
  const canonicalPath = process.argv[2];
  const skeletonPath = process.argv[3];
  if (!canonicalPath || !skeletonPath) {
    die(
      'Usage: npx tsx new_pipeline/export/generate-box-overrides-from-skeleton.ts <canonical.json> <skeleton_rewrites.json> --out <overrides.json> --chapter 1 --provider anthropic --model <MODEL>'
    );
  }

  const outPath = getArg('--out');
  if (!outPath) die('Missing --out <overrides.json>');

  const chapterStr = getArg('--chapter');
  const chapter = Number(chapterStr || '');
  if (!Number.isFinite(chapter) || chapter <= 0) die('Missing/invalid --chapter <N>');

  const providerRaw = String(getArg('--provider') || 'anthropic').trim().toLowerCase();
  const provider: Provider = providerRaw === 'anthropic' ? 'anthropic' : die(`Unsupported --provider: ${providerRaw}`);
  const model = String(getArg('--model') || '').trim();
  if (!model) die('Missing --model <MODEL>');

  const onlySubsRaw = String(getArg('--only-subparagraphs') || '').trim();
  const onlySet = new Set(
    onlySubsRaw
      ? onlySubsRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : []
  );
  const overwrite = hasFlag('--overwrite');

  const maxTokens = Math.max(256, Math.min(2048, Number(getArg('--max-tokens') || '900')));
  const temperature = Math.max(0, Math.min(1, Number(getArg('--temperature') || '0.2')));

  const canonicalAbs = path.resolve(canonicalPath);
  const skeletonAbs = path.resolve(skeletonPath);
  const outAbs = path.resolve(outPath);

  if (!fs.existsSync(canonicalAbs)) die(`Canonical JSON not found: ${canonicalAbs}`);
  if (!fs.existsSync(skeletonAbs)) die(`Skeleton JSON not found: ${skeletonAbs}`);

  const book = safeJsonParse<any>(fs.readFileSync(canonicalAbs, 'utf8'), canonicalAbs);
  const skeletonJson = safeJsonParse<any>(fs.readFileSync(skeletonAbs, 'utf8'), skeletonAbs);

  let out: { praktijk: Record<string, string>; verdieping: Record<string, string> } = { praktijk: {}, verdieping: {} };
  if (!overwrite && fs.existsSync(outAbs)) {
    try {
      const prev = safeJsonParse<any>(fs.readFileSync(outAbs, 'utf8'), outAbs);
      out = {
        praktijk: (prev?.praktijk && typeof prev.praktijk === 'object' ? prev.praktijk : {}) as Record<string, string>,
        verdieping: (prev?.verdieping && typeof prev.verdieping === 'object' ? prev.verdieping : {}) as Record<string, string>,
      };
    } catch {
      // ignore; overwrite structure below
      out = { praktijk: {}, verdieping: {} };
    }
  }

  const subs = extractSubparagraphs(book, chapter);
  if (!subs.length) die(`No subparagraphs found for chapter ${chapter} in ${canonicalAbs}`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) die('Missing ANTHROPIC_API_KEY (required for --provider anthropic)');

  const system = [
    'Je bent redacteur voor een Nederlands MBO-zorgboek (studentvriendelijk, N3-route).',
    'Je schrijft tekst voor twee kaders (zonder labels):',
    '- praktijk: herkenbare zorgsituatie + wat de student praktisch doet/let op/zegt (signaal → actie → wanneer melden).',
    '- verdieping: extra uitleg die één stap dieper het waarom/hoe uitlegt (maar blijft eenvoudig en op-topic).',
    '',
    'Strikte regels:',
    "- Nooit 'KD', werkprocescodes of beleidstaal noemen.",
    "- Gebruik altijd 'zorgvrager' (nooit cliënt/client).",
    "- Gebruik altijd 'zorgprofessional' (nooit verpleegkundige).",
    "- Schrijf GEEN label zoals 'In de praktijk:' of 'Verdieping:' (die staat al in de layout).",
    '- Geen opsommingen of bullets; één vloeiende alinea per veld.',
    '- Start met een kleine letter (behalve afkortingen zoals DNA/ATP/AB0).',
  ].join('\n');

  const total = onlySet.size ? subs.filter((s) => onlySet.has(s.number)).length : subs.length;
  let done = 0;

  for (const sp of subs) {
    if (onlySet.size && !onlySet.has(sp.number)) continue;
    // Skip if already present and not overwriting
    if (!overwrite && out.praktijk[sp.number] && out.verdieping[sp.number]) {
      done++;
      continue;
    }

    const secNum = sp.number.split('.').slice(0, 2).join('.');
    const secSk = getSectionSkeleton(skeletonJson, secNum);
    const relTerms = pickRelevantTerms(secSk, sp.title, sp.basisContext);
    const relFacts = pickRelevantFacts(secSk, relTerms);

    const user = [
      `Subparagraaf: ${sp.number}${sp.title ? ` — ${sp.title}` : ''}`,
      '',
      'Context (basis, fragment):',
      sp.basisContext,
      '',
      relTerms.length ? `Relevante termen:\n${relTerms.map((t) => `- ${t.term}: ${t.definition}`).join('\n')}` : 'Relevante termen: (geen)',
      '',
      relFacts.length ? `Relevante feiten:\n${relFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : 'Relevante feiten: (geen)',
      '',
      'Taak:',
      '- Schrijf een PRAKTIJK-tekst (2–4 zinnen, ~35–70 woorden).',
      '- Schrijf een VERDIEPING-tekst (4–7 zinnen, ~70–140 woorden).',
      '',
      'Output: STRICT JSON met precies deze keys: praktijk, verdieping.',
      'Voorbeeld: {"praktijk":"...","verdieping":"..."}',
    ].join('\n');

    console.log(`[${done + 1}/${total}] Generating boxes for ${sp.number}...`);
    const resp = await anthropicMessages({
      apiKey,
      model,
      system,
      user,
      maxTokens,
      temperature,
    });

    const obj = parseJsonObjectFromModel(resp);
    const prRaw = String(obj?.praktijk ?? '');
    const vdRaw = String(obj?.verdieping ?? '');

    const pr = cleanBoxText(prRaw);
    const vd = cleanBoxText(vdRaw);

    if (pr) out.praktijk[sp.number] = pr;
    if (vd) out.verdieping[sp.number] = vd;

    done++;

    // Save progressively (important for long runs)
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, JSON.stringify(out, null, 2) + '\n', 'utf8');
  }

  console.log(`✅ Wrote box overrides: ${outAbs}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


