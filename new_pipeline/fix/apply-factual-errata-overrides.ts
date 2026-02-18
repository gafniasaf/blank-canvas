/**
 * Apply deterministic, whitelisted factual errata overrides to a canonical JSON BEFORE rendering.
 *
 * Purpose:
 * - Some critical issues live outside paragraph rewrites (e.g., figure captions).
 * - Keep fixes narrow and deterministic (no LLM here).
 *
 * Usage:
 *   npx tsx new_pipeline/fix/apply-factual-errata-overrides.ts <in.json> --out <out.json> [--errata <errata.json>]
 */

import * as fs from 'fs';
import * as path from 'path';

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

type FigureOverride = {
  match: { figureNumber?: string; src?: string };
  updates: { caption?: string; alt?: string; figureNumber?: string };
};

type ErrataPack = {
  version?: number;
  figure_caption_overrides?: FigureOverride[];
};

function resolveDefaultErrataPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'validate/factual_errata.json'),
    path.resolve(process.cwd(), 'new_pipeline/validate/factual_errata.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function main() {
  const inPath = process.argv[2];
  if (!inPath) die('Usage: npx tsx new_pipeline/fix/apply-factual-errata-overrides.ts <in.json> --out <out.json> [--errata <errata.json>]');
  const outArg = getArg('--out');
  if (!outArg) die('Missing required --out <out.json>');

  const errataArg = getArg('--errata');
  const errataPath = errataArg ? path.resolve(errataArg) : resolveDefaultErrataPath();
  if (!errataPath) die('Errata pack not found. Provide --errata <path> or ensure validate/factual_errata.json exists.');

  const absIn = path.resolve(inPath);
  const absOut = path.resolve(outArg);

  const book = JSON.parse(fs.readFileSync(absIn, 'utf8')) as any;
  const errata = JSON.parse(fs.readFileSync(errataPath, 'utf8')) as ErrataPack;

  const overrides = Array.isArray(errata.figure_caption_overrides) ? errata.figure_caption_overrides : [];
  if (overrides.length === 0) {
    fs.writeFileSync(absOut, JSON.stringify(book, null, 2), 'utf8');
    console.log(`✅ No overrides in errata pack; wrote unchanged JSON: ${absOut}`);
    return;
  }

  let applied = 0;

  const visit = (node: any) => {
    if (Array.isArray(node)) {
      for (const it of node) visit(it);
      return;
    }
    if (!isObject(node)) return;

    // Images can appear inside blocks (paragraph/list/etc) as `images: [{...}]`.
    const imgs = (node as any).images;
    if (Array.isArray(imgs)) {
      for (const img of imgs) {
        if (!isObject(img)) continue;
        const figNum = String((img as any).figureNumber || '').trim();
        const src = String((img as any).src || '').trim();
        const caption = (img as any).caption;
        const alt = (img as any).alt;

        for (const ov of overrides) {
          const m = ov?.match || {};
          const matchFig = m.figureNumber ? figNum === String(m.figureNumber).trim() : false;
          const matchSrc = m.src ? src === String(m.src).trim() : false;
          if (!(matchFig || matchSrc)) continue;

          const up = ov.updates || {};
          if (typeof up.caption === 'string') (img as any).caption = up.caption;
          if (typeof up.alt === 'string') (img as any).alt = up.alt;
          if (typeof up.figureNumber === 'string') (img as any).figureNumber = up.figureNumber;

          // If alt is missing but caption changed, keep them consistent in a simple way.
          if (typeof up.caption === 'string' && (alt === undefined || alt === null || String(alt).trim() === '')) {
            (img as any).alt = up.caption;
          }

          applied++;
          break;
        }

        // Keep eslint/ts happy about unused reads
        void caption;
      }
    }

    for (const k of Object.keys(node)) {
      visit((node as any)[k]);
    }
  };

  visit(book);

  fs.writeFileSync(absOut, JSON.stringify(book, null, 2), 'utf8');
  console.log(`✅ Applied ${applied} override(s) from errata pack`);
  console.log(`✅ Wrote: ${absOut}`);
}

main();





























