/**
 * Generate a large, realistic-ish "demo chapter" Canonical JSON for Prince rendering.
 *
 * Goal:
 * - Stress the renderer/CSS with roughly "real chapter" volume:
 *   lots of paragraphs + many figure placeholders + lists/steps + praktijk/verdieping boxes.
 * - No DB required.
 *
 * Usage:
 *   cd new_pipeline
 *   npx tsx fixtures/generate-demo-chapter.ts --out output/demo_chapter.json --paras 180 --figures 28
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import type {
  CanonicalBook,
  CanonicalImage,
  ContentBlock,
  ParagraphBlock,
  ListBlock,
  StepsBlock,
  SubparagraphBlock,
} from '../schema/canonical-schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function toInt(v: string | null, def: number): number {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function para(opts: {
  id: string;
  basis: string;
  styleHint?: string;
  role?: any;
  praktijk?: string;
  verdieping?: string;
  images?: Array<any>;
}): ParagraphBlock {
  return {
    type: 'paragraph',
    id: opts.id,
    basis: opts.basis,
    styleHint: opts.styleHint,
    role: opts.role,
    praktijk: opts.praktijk,
    verdieping: opts.verdieping,
    images: opts.images as any,
  };
}

function list(opts: { id: string; level: 1 | 2 | 3; items: string[]; role?: any; ordered?: boolean }): ListBlock {
  return {
    type: 'list',
    id: opts.id,
    ordered: !!opts.ordered,
    level: opts.level,
    items: opts.items,
    role: opts.role,
  };
}

function steps(opts: { id: string; items: string[]; role?: any }): StepsBlock {
  return {
    type: 'steps',
    id: opts.id,
    items: opts.items,
    role: opts.role,
  };
}

function sub(opts: { id: string; number: string; title?: string; content: ContentBlock[] }): SubparagraphBlock {
  return {
    type: 'subparagraph',
    id: opts.id,
    number: opts.number,
    title: opts.title,
    content: opts.content,
  };
}

function mkPlaceholder(srcRel: string, opts: { fig?: string; caption?: string; width?: string; placement?: string } = {}): CanonicalImage {
  const img: any = {
    src: srcRel,
    alt: `Placeholder ${path.basename(srcRel)}`,
  };
  if (opts.fig) img.figureNumber = opts.fig;
  if (opts.caption) img.caption = opts.caption;
  if (opts.width) img.width = opts.width;
  if (opts.placement) img.placement = opts.placement;
  return img as CanonicalImage;
}

function convertSvgToPng(opts: { svgRel: string; pngRel: string }) {
  const svgAbs = path.resolve(REPO_ROOT, opts.svgRel);
  const pngAbs = path.resolve(REPO_ROOT, opts.pngRel);
  ensureDir(path.dirname(pngAbs));
  if (!fs.existsSync(svgAbs)) throw new Error(`Missing SVG fixture asset: ${opts.svgRel} (${svgAbs})`);
  const r = spawnSync('/usr/bin/sips', ['-s', 'format', 'png', svgAbs, '--out', pngAbs], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`sips failed converting ${opts.svgRel} -> ${opts.pngRel}`);
  if (!fs.existsSync(pngAbs)) throw new Error(`Expected PNG not created: ${opts.pngRel} (${pngAbs})`);
}

function sentencePack(topic: string, variant: number): string[] {
  // Deterministic set of short N3-ish sentences (je-vorm where appropriate).
  const v = variant % 3;

  if (v === 0) {
    return [
      `Je ziet ${topic} vaak terug in de zorgpraktijk.`,
      `Het helpt als je eerst het grote plaatje begrijpt en daarna de details.`,
      `In dit hoofdstuk houden we de uitleg stap voor stap.`,
      `Let op: we gebruiken dezelfde opmaakregels als in de echte hoofdstukken.`,
    ];
  }

  if (v === 1) {
    return [
      `${topic} gaat over samenhang: onderdelen werken samen als één systeem.`,
      `Als één stap niet goed gaat, merk je dat in het volgende deel van het proces.`,
      `Daarom is het handig om begrippen meteen te koppelen aan een voorbeeld.`,
      `Zo blijft de tekst leesbaar en praktisch.`,
    ];
  }

  // v === 2: include long-word coverage but avoid the distracting repeating line
  // "Sommige woorden zijn ..." which can dominate the demo visually.
  const longWords = [
    'arbeidsongeschiktheidsverzekering',
    'aansprakelijkheidswaardevaststellingsveranderingen',
    'kindercarnavalsoptochtvoorbereidingswerkzaamhedenplan',
    'gezondheidszorginstellingsbeleid',
    'lichaamsfunctiestoornissen',
    'weefselherstelprocessen',
  ];
  const lw = longWords[variant % longWords.length]!;
  const intro =
    variant % 2 === 0
      ? `In het Nederlands kom je soms lange samenstellingen tegen, zoals ${lw}.`
      : `Soms kom je lange samenstellingen tegen, bijvoorbeeld ${lw}.`;

  return [
    intro,
    `We testen hiermee ook woordafbreking en hyphenation-exceptions.`,
    `De laatste regel van een alinea moet links blijven, net als in InDesign.`,
    `Daarom gebruiken we justified tekst met een linkse laatste regel.`,
  ];
}

function makeParagraphText(opts: { idx: number; topic: string; sentences: number; includeBold?: boolean }): string {
  const { idx, topic, sentences, includeBold } = opts;
  const base = sentencePack(topic, idx);
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) out.push(base[i % base.length]!);
  let text = out.join(' ');
  if (includeBold) {
    text += ` We markeren één term als <<BOLD_START>>belangrijk<<BOLD_END>> om inline vet te testen.`;
  }
  return text;
}

function makeShortNounList(idx: number): string[] {
  const sets: string[][] = [
    ['celkern', 'mitochondriën', 'ribosomen', 'Golgi-systeem'],
    ['water', 'zouten', 'glucose', 'zuurstof'],
    ['prikkel', 'reactie', 'feedback', 'evenwicht'],
    ['anabolisme', 'katabolisme', 'energie', 'ATP'],
  ];
  return sets[idx % sets.length]!.slice();
}

function makeLongItems(idx: number): string[] {
  const sets: string[][] = [
    [
      'Dit item is expres lang en leest als een zin; hiermee testen we de demotion-logica van bullets in de Prince output.',
      'Ook dit item is lang en bevat meerdere komma’s zodat het niet als korte parallelle opsomming wordt gezien.',
    ],
    [
      'We plaatsen hier een uitlegzin die eigenlijk beter past als normale alinea, niet als bullet, zodat de layout rustig blijft.',
      'Nog een lange uitlegzin: let op dat de uitlijning en de marge na de lijst automatisch klopt.',
    ],
  ];
  return sets[idx % sets.length]!.slice();
}

function main() {
  const outArg = getArg('--out');
  const outAbs = outArg ? path.resolve(REPO_ROOT, outArg) : path.resolve(REPO_ROOT, 'new_pipeline/output/demo_chapter.json');
  ensureDir(path.dirname(outAbs));

  const parasTarget = toInt(getArg('--paras'), 180);
  const figuresTarget = toInt(getArg('--figures'), 28);

  // Placeholder assets (rasterized)
  const wideSvg = 'new_pipeline/fixtures/assets/placeholder_wide.svg';
  const tallSvg = 'new_pipeline/fixtures/assets/placeholder_tall.svg';
  const squareSvg = 'new_pipeline/fixtures/assets/placeholder_square.svg';

  const outAssetsDir = 'new_pipeline/output/demo_assets';
  const wide = `${outAssetsDir}/placeholder_wide.png`;
  const tall = `${outAssetsDir}/placeholder_tall.png`;
  const square = `${outAssetsDir}/placeholder_square.png`;

  convertSvgToPng({ svgRel: wideSvg, pngRel: wide });
  convertSvgToPng({ svgRel: tallSvg, pngRel: tall });
  convertSvgToPng({ svgRel: squareSvg, pngRel: square });

  // Build 1 chapter with multiple sections/subparagraphs.
  let pCounter = 0;
  let figCounter = 0;
  let listCounter = 0;
  let stepCounter = 0;
  let subCounter = 0;

  function nextPid() {
    pCounter++;
    return `demo-p-${String(pCounter).padStart(4, '0')}`;
  }
  function nextLid() {
    listCounter++;
    return `demo-l-${String(listCounter).padStart(4, '0')}`;
  }
  function nextSid() {
    stepCounter++;
    return `demo-s-${String(stepCounter).padStart(4, '0')}`;
  }
  function nextSubId() {
    subCounter++;
    return `demo-sub-${String(subCounter).padStart(3, '0')}`;
  }

  function nextFigure(opts: { kind: 'wide' | 'tall' | 'square'; placement: 'inline' | 'full-width' }): CanonicalImage {
    figCounter++;
    const srcRel = opts.kind === 'wide' ? wide : opts.kind === 'tall' ? tall : square;
    // For this demo chapter we intentionally bias towards the current book style:
    // images should generally span the page width (user preference + reduces empty-column pages).
    const isFull = true;
    const width = '100%';
    return mkPlaceholder(srcRel, {
      fig: `Afbeelding 1.${figCounter}:`,
      caption: isFull
        ? 'Brede placeholder (full-width) om pagina-vulling en caption-wrapping te testen.'
        : 'Inline placeholder in de kolom om uitlijning en caption-wrapping te testen.',
      width,
      placement: 'full-width',
    });
  }

  function maybeAttachFigure(): Array<any> | undefined {
    if (figCounter >= figuresTarget) return undefined;
    // Roughly: attach a figure every ~6 paragraphs until we hit figuresTarget.
    if (pCounter === 0) return undefined;
    const every = Math.max(4, Math.floor(parasTarget / Math.max(8, figuresTarget)));
    if (pCounter % every !== 0) return undefined;

    const kind = figCounter % 3 === 0 ? 'wide' : figCounter % 3 === 1 ? 'square' : 'tall';
    const img = nextFigure({ kind, placement: 'full-width' });
    return [img as any];
  }

  function maybeBoxText(idx: number): { praktijk?: string; verdieping?: string } {
    // Add some boxes, but not on every paragraph.
    if (idx % 12 !== 0) return {};
    return {
      praktijk:
        'Bij een zorgvrager let je op signalen en veranderingen. Koppel wat je ziet aan een duidelijke uitleg in je eigen woorden.',
      verdieping:
      'soms helpt het om één stap extra uit te leggen. Zo voorkom je dat je alleen woorden leert zonder het proces te begrijpen.',
    };
  }

  function makeSection(secNumber: string, title: string, baseTopic: string): { number: string; title: string; content: ContentBlock[] } {
    const content: ContentBlock[] = [];

    // Section intro
    for (let i = 0; i < 6; i++) {
      const pid = nextPid();
      const topic = `${baseTopic}`;
      const sentences = 6 + ((pCounter + i) % 4);
      const bold = (pCounter + i) % 9 === 0;
      const images = maybeAttachFigure();
      // Layout realism: avoid stacking a figure + two boxes directly after the same paragraph,
      // as the cluster is large and tends to get pushed, creating empty-column pages.
      const boxes = images && images.length ? {} : maybeBoxText(pCounter);
      content.push(
        para({
          id: pid,
          role: 'body',
          styleHint: '•Basis',
          basis: makeParagraphText({ idx: pCounter, topic, sentences, includeBold: bold }),
          images,
          praktijk: boxes.praktijk,
          verdieping: boxes.verdieping,
        })
      );
    }

    // A kept bullet list (>=3 short items)
    content.push(
      list({
        id: nextLid(),
        level: 1,
        role: 'bullet_lvl1',
        items: makeShortNounList(listCounter),
      })
    );

    // A demoted bullet list (2 long items)
    content.push(
      list({
        id: nextLid(),
        level: 1,
        role: 'bullet_lvl1',
        items: makeLongItems(listCounter),
      })
    );

    // Steps
    content.push(
      steps({
        id: nextSid(),
        role: 'numbered_steps',
        items: [
          'Lees de kernzin en bepaal het onderwerp.',
          'Zoek het voorbeeld dat erbij hoort.',
          'Vat het proces in één zin samen.',
          'Controleer of je uitleg logisch doorloopt.',
        ],
      })
    );

    // Two subparagraphs (h3)
    for (let sp = 1; sp <= 2; sp++) {
      const spNo = `${secNumber}.${sp}`;
      const spTitle = sp === 1 ? 'Kernbegrippen' : 'Toepassing';
      const blocks: ContentBlock[] = [];

      // Subparagraph text blocks
      for (let i = 0; i < 10; i++) {
        const pid = nextPid();
        const topic = sp === 1 ? `${baseTopic} (kern)` : `${baseTopic} (toepassing)`;
        const sentences = 6 + ((pCounter + i) % 5);
        const bold = (pCounter + i) % 11 === 0;
        const images = maybeAttachFigure();
        const boxes = images && images.length ? {} : maybeBoxText(pCounter);
        blocks.push(
          para({
            id: pid,
            role: 'body',
            styleHint: '•Basis',
            basis: makeParagraphText({ idx: pCounter, topic, sentences, includeBold: bold }),
            images,
            praktijk: boxes.praktijk,
            verdieping: boxes.verdieping,
          })
        );
      }

      // Bullet-style paragraph (semicolon list encoding) to exercise renderer's bullets-from-paragraph logic
      blocks.push(
        para({
          id: nextPid(),
          role: 'bullet_lvl1',
          styleHint: '_Bullets',
          basis: 'celkern;mitochondriën;ribosomen;het Golgi-systeem;lysosomen.',
          images: maybeAttachFigure(),
        })
      );

      // Bullet-style paragraph rewritten as prose (no semicolons) to ensure it stays a normal paragraph
      blocks.push(
        para({
          id: nextPid(),
          role: 'bullet_lvl1',
          styleHint: '_Bullets',
          basis:
            'Dit is gewone lopende tekst in een bullet-stijl alinea. De renderer moet dit als een normale paragraaf tonen zonder bullet-indents.',
          images: maybeAttachFigure(),
        })
      );

      // IMPORTANT (layout realism):
      // Don't end a subparagraph immediately after a list/bullet run. In real content,
      // a short follow-up paragraph often "closes" the thought and helps column fill.
      // This also avoids accidental underfilled right-column pages caused by keep rules
      // when the next h3 is pushed to the next page.
      for (let k = 0; k < 4; k++) {
        blocks.push(
          para({
            id: nextPid(),
            role: 'body',
            styleHint: '•Basis',
            basis: makeParagraphText({
              idx: pCounter,
              topic: `${baseTopic} (vervolg)`,
              sentences: 6 + (k % 3),
              includeBold: k === 2,
            }),
            images: maybeAttachFigure(),
          })
        );
      }

      content.push(
        sub({
          id: nextSubId(),
          number: spNo,
          title: spTitle,
          content: blocks,
        })
      );
    }

    // Section outro
    for (let i = 0; i < 6; i++) {
      const pid = nextPid();
      const topic = `${baseTopic} (samenvatting)`;
      const sentences = 6 + ((pCounter + i) % 4);
      const bold = (pCounter + i) % 13 === 0;
      const images = maybeAttachFigure();
      const boxes = images && images.length ? {} : maybeBoxText(pCounter);
      content.push(
        para({
          id: pid,
          role: 'body',
          styleHint: '•Basis',
          basis: makeParagraphText({ idx: pCounter, topic, sentences, includeBold: bold }),
          images,
          praktijk: boxes.praktijk,
          verdieping: boxes.verdieping,
        })
      );
    }

    return { number: secNumber, title, content };
  }

  const sections = [
    makeSection('1.1', 'Wat je gaat leren', 'basisbegrippen in dit hoofdstuk'),
    makeSection('1.2', 'De cel als bouwsteen', 'cellen en onderdelen'),
    makeSection('1.3', 'Transport en energie', 'transport door membranen'),
    makeSection('1.4', 'Communicatie en prikkels', 'signalen en reacties'),
    makeSection('1.5', 'Groei en herstel', 'celcyclus en herstel'),
    makeSection('1.6', 'Samenvatting', 'samenvatten en toepassen'),
  ];

  // If we undershot target paragraphs, append extra body paragraphs at end of last section.
  const missing = Math.max(0, parasTarget - pCounter);
  if (missing) {
    const extra: ContentBlock[] = [];
    for (let i = 0; i < missing; i++) {
      const pid = nextPid();
      extra.push(
        para({
          id: pid,
          role: 'body',
          styleHint: '•Basis',
          basis: makeParagraphText({ idx: pCounter, topic: 'extra testtekst', sentences: 7 + (i % 4), includeBold: i % 10 === 0 }),
          images: maybeAttachFigure(),
        })
      );
    }
    sections[sections.length - 1]!.content.push(...extra);
  }

  // If we undershot target figures (because paragraph cadence didn't hit enough), attach remaining as a final gallery paragraph.
  if (figCounter < figuresTarget) {
    const remaining: any[] = [];
    while (figCounter < figuresTarget) {
      const kind = figCounter % 3 === 0 ? 'wide' : figCounter % 3 === 1 ? 'square' : 'tall';
      remaining.push(nextFigure({ kind, placement: 'full-width' }) as any);
    }
    sections[sections.length - 1]!.content.push(
      para({
        id: nextPid(),
        role: 'body',
        styleHint: '•Basis',
        basis: 'Hieronder staan extra placeholder-afbeeldingen om het aantal figuren van een echt hoofdstuk te benaderen.',
        images: remaining,
      })
    );
  }

  const book: CanonicalBook = {
    meta: {
      id: 'demo-chapter',
      title: 'Demo hoofdstuk (placeholder) – Prince stress test',
      level: 'n3',
      edition: 'demo',
    },
    export: {
      exportedAt: new Date().toISOString(),
      source: 'manual',
      schemaVersion: '1.0',
    },
    chapters: [
      {
        number: '1',
        title: 'Demo: Cellen en processen (placeholder)',
        images: [mkPlaceholder(wide, { caption: 'Opener placeholder', width: '210mm', placement: 'full-width' }) as any],
        sections: sections as any,
      },
    ],
  };

  fs.writeFileSync(outAbs, JSON.stringify(book, null, 2), 'utf8');
  console.log(`✅ Wrote demo chapter JSON: ${outAbs}`);
  console.log(`   paragraphs=${pCounter} figures=${figCounter} lists=${listCounter} steps=${stepCounter} subparagraphs=${subCounter}`);
}

main();


