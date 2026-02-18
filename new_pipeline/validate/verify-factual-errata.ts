/**
 * verify-factual-errata.ts
 *
 * Hard gate for known factual blockers + student-policy leaks (KD mentions/codes).
 * This is intentionally narrow and deterministic: it only checks whitelisted patterns.
 *
 * Usage:
 *   npx tsx new_pipeline/validate/verify-factual-errata.ts <render.json> [--errata <errata.json>]
 *
 * Exit codes:
 * - 0: no ERROR findings
 * - 1: at least one ERROR finding
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

type Rule = {
  id: string;
  severity: 'error' | 'warn';
  description?: string;
  regex: string;
  flags?: string;
};

type ErrataPack = {
  version?: number;
  rules?: Rule[];
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

function stripInlineMarkers(s: string): string {
  return String(s || '')
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

type Finding = {
  rule_id: string;
  severity: 'error' | 'warn';
  path: string;
  snippet: string;
  description?: string;
};

function main() {
  const inPath = process.argv[2];
  if (!inPath) die('Usage: npx tsx new_pipeline/validate/verify-factual-errata.ts <render.json> [--errata <errata.json>]');

  const errataArg = getArg('--errata');
  const errataPath = errataArg ? path.resolve(errataArg) : resolveDefaultErrataPath();
  if (!errataPath) die('Errata pack not found. Provide --errata <path> or ensure validate/factual_errata.json exists.');

  const absIn = path.resolve(inPath);
  const book = JSON.parse(fs.readFileSync(absIn, 'utf8')) as any;
  const errata = JSON.parse(fs.readFileSync(errataPath, 'utf8')) as ErrataPack;

  const rules: Rule[] = Array.isArray(errata.rules) ? errata.rules : [];
  if (!rules.length) {
    console.log(`✅ No rules in errata pack: ${errataPath}`);
    process.exit(0);
  }

  const compiled = rules.map((r) => {
    let re: RegExp;
    try {
      re = new RegExp(r.regex, String(r.flags || 'iu'));
    } catch (e: any) {
      throw new Error(`Invalid regex for rule ${r.id}: ${r.regex} (${String(e?.message || e)})`);
    }
    return { rule: r, re };
  });

  const findings: Finding[] = [];

  const checkText = (textRaw: string, p: string) => {
    const text = stripInlineMarkers(textRaw);
    if (!text) return;
    for (const { rule, re } of compiled) {
      if (re.test(text)) {
        findings.push({
          rule_id: rule.id,
          severity: rule.severity,
          description: rule.description,
          path: p,
          snippet: text.slice(0, 240),
        });
      }
    }
  };

  const visit = (node: any, p: string) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) visit(node[i], `${p}[${i}]`);
      return;
    }
    if (!isObject(node)) return;

    // Canonical known text fields
    const basis = (node as any).basis;
    const praktijk = (node as any).praktijk;
    const verdieping = (node as any).verdieping;
    if (typeof basis === 'string') checkText(basis, `${p}.basis`);
    if (typeof praktijk === 'string') checkText(praktijk, `${p}.praktijk`);
    if (typeof verdieping === 'string') checkText(verdieping, `${p}.verdieping`);

    // list/steps items
    const items = (node as any).items;
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        if (typeof items[i] === 'string') checkText(items[i], `${p}.items[${i}]`);
      }
    }

    // images alt/caption
    const images = (node as any).images;
    if (Array.isArray(images)) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!isObject(img)) continue;
        const alt = (img as any).alt;
        const caption = (img as any).caption;
        const figNum = (img as any).figureNumber;
        if (typeof figNum === 'string') checkText(figNum, `${p}.images[${i}].figureNumber`);
        if (typeof alt === 'string') checkText(alt, `${p}.images[${i}].alt`);
        if (typeof caption === 'string') checkText(caption, `${p}.images[${i}].caption`);
      }
    }

    // Recurse
    for (const k of Object.keys(node)) {
      visit((node as any)[k], `${p}.${k}`);
    }
  };

  visit(book, '$');

  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');

  if (warns.length) {
    console.warn(`⚠️ Factual errata warnings: ${warns.length}`);
    for (const w of warns.slice(0, 20)) {
      console.warn(`- [${w.rule_id}] ${w.description || ''}`.trim());
      console.warn(`  at ${w.path}`);
      console.warn(`  "${w.snippet}"`);
    }
    if (warns.length > 20) console.warn(`  ... ${warns.length - 20} more warnings`);
  }

  if (errors.length) {
    console.error(`❌ Factual errata gate failed: ${errors.length} error(s)`);
    for (const e of errors.slice(0, 25)) {
      console.error(`- [${e.rule_id}] ${e.description || ''}`.trim());
      console.error(`  at ${e.path}`);
      console.error(`  "${e.snippet}"`);
    }
    if (errors.length > 25) console.error(`  ... ${errors.length - 25} more errors`);
    process.exit(1);
  }

  console.log(`✅ Factual errata gate passed (${rules.length} rule(s) checked)`);
  process.exit(0);
}

main();


