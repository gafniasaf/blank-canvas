/**
 * scan-factual-errata.ts
 *
 * Non-blocking scanner for the factual errata pack. Unlike verify-factual-errata.ts, this:
 * - can scan multiple JSON files
 * - reports counts + affected paragraph_ids for targeted rewrites
 * - does NOT fail fast (unless --fail is set)
 *
 * Usage:
 *   npx tsx new_pipeline/validate/scan-factual-errata.ts <file1.json> [file2.json ...] --errata <errata.json> [--out report.json] [--fail]
 *
 * Notes:
 * - This scans canonical JSONs (chapters or merged book), or rewritten/overlayed canonical JSONs.
 * - It extracts `node.id` when present to report paragraph_id / block_id.
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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
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

type CompiledRule = { rule: Rule; re: RegExp };

type Finding = {
  input_file: string;
  rule_id: string;
  severity: 'error' | 'warn';
  description?: string;
  json_path: string;
  block_id?: string;
  block_type?: string;
  snippet: string;
};

type Report = {
  generated_at: string;
  errata_path: string;
  inputs: string[];
  totals: {
    errors: number;
    warns: number;
    unique_block_ids_with_errors: number;
  };
  by_rule: Record<
    string,
    {
      severity: 'error' | 'warn';
      description?: string;
      count: number;
      unique_block_ids: number;
      block_ids: string[];
    }
  >;
  findings: Finding[];
};

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

function compileRules(pack: ErrataPack): CompiledRule[] {
  const rules = Array.isArray(pack.rules) ? pack.rules : [];
  const compiled: CompiledRule[] = [];
  for (const r of rules) {
    if (!r || !r.id || !r.regex) continue;
    try {
      compiled.push({ rule: r, re: new RegExp(String(r.regex), String(r.flags || 'iu')) });
    } catch (e: any) {
      console.warn(`⚠️ Skipping invalid errata regex for rule ${String(r.id)}: ${String(e?.message || e)}`);
    }
  }
  return compiled;
}

function main() {
  const argv = process.argv.slice(2);
  const inputs: string[] = [];
  // Positional inputs are any non-flag args that are NOT values for known flags.
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '').trim();
    if (!a) continue;
    if (a.startsWith('--')) {
      // Skip value for flags that take a value
      if (a === '--errata' || a === '--out') i++;
      continue;
    }
    inputs.push(a);
  }
  if (!inputs.length) {
    die('Usage: npx tsx new_pipeline/validate/scan-factual-errata.ts <file1.json> [file2.json ...] --errata <errata.json> [--out report.json] [--fail]');
  }

  const errataArg = getArg('--errata') || '';
  const errataPath = errataArg ? path.resolve(errataArg) : resolveDefaultErrataPath();
  if (!errataPath || !fs.existsSync(errataPath)) die('Errata pack not found. Provide --errata <path>.');

  const outArg = getArg('--out');
  const fail = hasFlag('--fail');

  const pack = JSON.parse(fs.readFileSync(errataPath, 'utf8')) as ErrataPack;
  const compiled = compileRules(pack);
  if (!compiled.length) die(`No rules in errata pack: ${errataPath}`);

  const findings: Finding[] = [];

  const scanText = (textRaw: string, ctx: { inputFile: string; p: string; blockId?: string; blockType?: string }) => {
    const txt = stripInlineMarkers(textRaw);
    if (!txt) return;
    for (const { rule, re } of compiled) {
      try {
        if (!re.test(txt)) continue;
      } catch {
        continue;
      }
      findings.push({
        input_file: ctx.inputFile,
        rule_id: rule.id,
        severity: rule.severity,
        description: rule.description,
        json_path: ctx.p,
        block_id: ctx.blockId,
        block_type: ctx.blockType,
        snippet: txt.slice(0, 240),
      });
    }
  };

  const visit = (node: any, p: string, ctx: { inputFile: string; currentBlockId?: string; currentBlockType?: string }) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) visit(node[i], `${p}[${i}]`, ctx);
      return;
    }
    if (!isObject(node)) return;

    // Track current block context (paragraph/list/etc)
    const id = typeof (node as any).id === 'string' ? String((node as any).id).trim() : '';
    const type = typeof (node as any).type === 'string' ? String((node as any).type).trim() : '';
    const nextCtx = {
      ...ctx,
      currentBlockId: id || ctx.currentBlockId,
      currentBlockType: type || ctx.currentBlockType,
    };

    // text fields
    for (const key of ['basis', 'praktijk', 'verdieping'] as const) {
      const v = (node as any)[key];
      if (typeof v === 'string') {
        scanText(v, {
          inputFile: ctx.inputFile,
          p: `${p}.${key}`,
          blockId: nextCtx.currentBlockId,
          blockType: nextCtx.currentBlockType,
        });
      }
    }

    // list/steps items
    const items = (node as any).items;
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        if (typeof items[i] === 'string') {
          scanText(items[i], {
            inputFile: ctx.inputFile,
            p: `${p}.items[${i}]`,
            blockId: nextCtx.currentBlockId,
            blockType: nextCtx.currentBlockType,
          });
        }
      }
    }

    // images alt/caption
    const images = (node as any).images;
    if (Array.isArray(images)) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!isObject(img)) continue;
        for (const key of ['figureNumber', 'alt', 'caption'] as const) {
          const v = (img as any)[key];
          if (typeof v === 'string') {
            scanText(v, {
              inputFile: ctx.inputFile,
              p: `${p}.images[${i}].${key}`,
              blockId: nextCtx.currentBlockId,
              blockType: nextCtx.currentBlockType,
            });
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      visit((node as any)[k], `${p}.${k}`, nextCtx);
    }
  };

  const absInputs = inputs.map((p) => path.resolve(p));
  for (const abs of absInputs) {
    if (!fs.existsSync(abs)) die(`Input file not found: ${abs}`);
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    visit(json, '$', { inputFile: abs });
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  const errorBlockIds = new Set(errors.map((f) => f.block_id).filter(Boolean) as string[]);

  const by_rule: Report['by_rule'] = {};
  for (const f of findings) {
    if (!by_rule[f.rule_id]) {
      by_rule[f.rule_id] = {
        severity: f.severity,
        description: f.description,
        count: 0,
        unique_block_ids: 0,
        block_ids: [],
      };
    }
    by_rule[f.rule_id]!.count++;
    if (f.block_id) by_rule[f.rule_id]!.block_ids.push(f.block_id);
  }
  for (const k of Object.keys(by_rule)) {
    const uniq = Array.from(new Set(by_rule[k]!.block_ids)).filter(Boolean);
    by_rule[k]!.block_ids = uniq;
    by_rule[k]!.unique_block_ids = uniq.length;
  }

  const report: Report = {
    generated_at: new Date().toISOString(),
    errata_path: errataPath,
    inputs: absInputs,
    totals: {
      errors: errors.length,
      warns: warns.length,
      unique_block_ids_with_errors: errorBlockIds.size,
    },
    by_rule,
    findings,
  };

  // Console summary
  const sortedRules = Object.entries(by_rule).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  console.log(`🧾 Errata: ${errataPath}`);
  console.log(`📄 Inputs: ${absInputs.length}`);
  console.log(`❌ Errors: ${report.totals.errors} (unique block ids: ${report.totals.unique_block_ids_with_errors})`);
  console.log(`⚠️ Warns:  ${report.totals.warns}`);
  console.log('');
  console.log('Top rules:');
  for (const [rid, info] of sortedRules.slice(0, 20)) {
    const sev = info.severity.toUpperCase();
    console.log(`- ${sev} ${rid}: ${info.count} hit(s) in ${info.unique_block_ids} block(s)`);
  }

  if (outArg) {
    const absOut = path.resolve(outArg);
    fs.writeFileSync(absOut, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n✅ Wrote report: ${absOut}`);
  }

  if (fail && errors.length) process.exit(1);
  process.exit(0);
}

main();


