/**
 * Generate a deterministic "fixture book" Canonical JSON for Prince rendering tests.
 *
 * Goals:
 * - Exercise the renderer + CSS without needing DB access.
 * - Include representative blocks: headings, paragraphs, lists (kept + demoted), steps, figures, boxes.
 * - Use placeholder SVG assets committed to repo.
 *
 * Usage:
 *   npx tsx new_pipeline/fixtures/generate-fixture-book.ts --out new_pipeline/output/fixture_book.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import type { CanonicalBook, CanonicalImage, ContentBlock, ParagraphBlock, ListBlock, StepsBlock, SubparagraphBlock } from '../schema/canonical-schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
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

function fillParagraph(topic: string, sentences: number): string {
  const base = [
    `Dit is een testparagraaf over ${topic}.`,
    `We gebruiken deze tekst om de Prince-layout te testen met dezelfde typografie als het echte boek.`,
    `De bedoeling is dat zinnen netjes doorlopen, zonder harde regeleindes of vreemde witruimtes.`,
    `We controleren ook of afbrekingen, opsommingen en afbeeldingen stabiel renderen.`,
    `Belangrijk: dit is fixture-inhoud; de betekenis hoeft niet perfect te zijn, maar de structuur wel.`,
  ];
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) out.push(base[i % base.length]!);
  return out.join(' ');
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

  // Convert deterministically using macOS sips (available on this repo's dev environment).
  const r = spawnSync('/usr/bin/sips', ['-s', 'format', 'png', svgAbs, '--out', pngAbs], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`sips failed converting ${opts.svgRel} -> ${opts.pngRel}`);
  if (!fs.existsSync(pngAbs)) throw new Error(`Expected PNG not created: ${opts.pngRel} (${pngAbs})`);
}

function main() {
  const outArg = getArg('--out');
  const outAbs = outArg ? path.resolve(REPO_ROOT, outArg) : path.resolve(REPO_ROOT, 'new_pipeline/output/fixture_book.json');
  ensureDir(path.dirname(outAbs));

  const wideSvg = 'new_pipeline/fixtures/assets/placeholder_wide.svg';
  const tallSvg = 'new_pipeline/fixtures/assets/placeholder_tall.svg';
  const squareSvg = 'new_pipeline/fixtures/assets/placeholder_square.svg';

  const outAssetsDir = 'new_pipeline/output/fixture_assets';
  const wide = `${outAssetsDir}/placeholder_wide.png`;
  const tall = `${outAssetsDir}/placeholder_tall.png`;
  const square = `${outAssetsDir}/placeholder_square.png`;

  // Convert SVG sources into raster PNGs so PDF layout validators (PyMuPDF) can count figures as images.
  convertSvgToPng({ svgRel: wideSvg, pngRel: wide });
  convertSvgToPng({ svgRel: tallSvg, pngRel: tall });
  convertSvgToPng({ svgRel: squareSvg, pngRel: square });

  const book: CanonicalBook = {
    meta: {
      id: 'fixture-book',
      title: 'Fixture boek (Prince layout test)',
      level: 'n3',
      edition: 'fixture',
    },
    export: {
      exportedAt: new Date().toISOString(),
      source: 'manual',
      schemaVersion: '1.0',
    },
    chapters: [
      {
        number: '1',
        title: 'Lorem hoofdstuk',
        images: [mkPlaceholder(wide, { caption: 'Opener placeholder', width: '210mm', placement: 'full-width' }) as any],
        sections: [
          {
            number: '1.1',
            title: 'Intro en flow',
            content: [
              para({
                id: 'p-1.1-001',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('de lay-out (intro)', 8),
              }),
              para({
                id: 'p-1.1-002',
                role: 'body',
                styleHint: '•Basis',
                basis:
                  fillParagraph('lopende tekst met vet', 6) +
                  ' ' +
                  'Hier staat een <<BOLD_START>>vet fragment<<BOLD_END>> midden in de zin, zodat we inline formatting testen.',
              }),
              // A full-width figure float test
              para({
                id: 'p-1.1-003',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('een full-width afbeelding (float: bottom)', 5),
                images: [
                  mkPlaceholder(wide, {
                    fig: 'Afbeelding 1.1:',
                    caption: 'Brede placeholder met caption; test full-width float + caption wrapping.',
                    width: '140mm',
                    placement: 'full-width',
                  }) as any,
                ],
              }),
              // Bullets kept (>=3 short items)
              list({
                id: 'l-1.1-001',
                level: 1,
                role: 'bullet_lvl1',
                items: ['korte term', 'tweede term', 'derde term', 'vierde term'],
              }),
              para({
                id: 'p-1.1-004',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('tekst na bullets', 6),
              }),
              // Bullets demoted (only 2 items)
              list({
                id: 'l-1.1-002',
                level: 1,
                role: 'bullet_lvl1',
                items: ['twee items is meestal geen echte lijst', 'dus dit moet als lopende tekst demoted worden'],
              }),
              para({
                id: 'p-1.1-005',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('herstel van ritme na demotion', 5),
              }),
              // Steps
              steps({
                id: 's-1.1-001',
                role: 'numbered_steps',
                items: ['Stap één: doe dit.', 'Stap twee: doe dat.', 'Stap drie: controleer het resultaat.'],
              }),
              para({
                id: 'p-1.1-006',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('na stappen', 4),
              }),
            ],
          },
          {
            number: '1.2',
            title: 'Subparagrafen + boxes',
            content: [
              sub({
                id: 'sub-1.2.1',
                number: '1.2.1',
                title: 'Subtitel',
                content: [
                  para({
                    id: 'p-1.2-001',
                    role: 'body',
                    styleHint: '•Basis',
                    basis: fillParagraph('subparagraaf content', 8),
                    praktijk: 'Bij een testscenario let je op consistente marges en nette uitlijning.',
                    verdieping:
                      'Deze verdieping is een langere zin met weinig woorden in het begin, zodat we justification-gaps kunnen detecteren.',
                  }),
                  // Bullet-style paragraph rendered as bullets (semicolon encoding)
                  para({
                    id: 'p-1.2-002',
                    role: 'bullet_lvl1',
                    styleHint: '_Bullets',
                    basis: 'ademhaling;spijsvertering;bloedsomloop;zenuwstelsel.',
                  }),
                  // Bullet-style paragraph rendered as normal paragraph (no semicolons)
                  para({
                    id: 'p-1.2-003',
                    role: 'bullet_lvl1',
                    styleHint: '_Bullets',
                    basis:
                      'Dit is eigenlijk geen opsomming maar gewone lopende tekst zonder puntkomma’s. De renderer moet dit als een normale paragraaf tonen.',
                  }),
                  // Inline figure (single-column)
                  para({
                    id: 'p-1.2-004',
                    role: 'body',
                    styleHint: '•Basis',
                    basis: fillParagraph('een inline afbeelding', 4),
                    images: [
                      mkPlaceholder(square, {
                        fig: 'Afbeelding 1.2:',
                        caption: 'Vierkante placeholder; test inline figuur in de kolom.',
                        width: '100%',
                        placement: 'inline',
                      }) as any,
                    ],
                  }),
                ],
              }),
            ],
          },
        ],
      },
      {
        number: '2',
        title: 'Tweede hoofdstuk (stress test)',
        sections: [
          {
            number: '2.1',
            title: 'Veel tekst om pagina’s te vullen',
            content: [
              para({
                id: 'p-2.1-001',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('lange doorlopende tekst', 16),
              }),
              para({
                id: 'p-2.1-002',
                role: 'body',
                styleHint: '•Basis',
                // include embedded newlines to ensure they get normalized away (no <br>)
                basis:
                  'Deze zin bevat een harde regeleinde\nmaar moet in Prince als lopende tekst doorlopen.\n\nEn dit moet ook goed gaan.',
              }),
              // Nested lists: lvl1 with lvl2 children
              list({
                id: 'l-2.1-001',
                level: 1,
                role: 'bullet_lvl1',
                items: ['bovenliggende term A', 'bovenliggende term B', 'bovenliggende term C'],
              }),
              list({
                id: 'l-2.1-002',
                level: 2,
                role: 'bullet_lvl2',
                items: ['detail bij A', 'nog een detail bij A', 'derde detail bij A'],
              }),
              // An intentionally long list item block to force demotion
              list({
                id: 'l-2.1-003',
                level: 1,
                role: 'bullet_lvl1',
                items: [
                  'Dit item is expres te lang en leest als een zin; daardoor moet het demoted worden naar een normale paragraaf in plaats van een bullet.',
                  'Ook dit tweede item is lang en staccato; de demotion logica moet hier consistent blijven.',
                ],
              }),
              para({
                id: 'p-2.1-003',
                role: 'body',
                styleHint: '•Basis',
                basis: fillParagraph('na nested/demotion', 10),
                images: [
                  mkPlaceholder(tall, {
                    fig: 'Afbeelding 2.1:',
                    caption: 'Hoge placeholder; test caption wrapping en page-fill samen met tekst.',
                    width: '75%',
                    placement: 'inline',
                  }) as any,
                ],
              }),
            ],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(outAbs, JSON.stringify(book, null, 2), 'utf8');
  console.log(`✅ Wrote fixture book JSON: ${outAbs}`);
}

main();


