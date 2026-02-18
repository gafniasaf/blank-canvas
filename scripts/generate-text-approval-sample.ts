/**
 * generate-text-approval-sample.ts
 *
 * Goal:
 * - Produce a deterministic, human-readable markdown "approval sample" for student-facing text quality.
 * - This does NOT modify content; it only samples + reports.
 *
 * Why:
 * - "Final" must mean: layout validated + text approved after reading a sufficient sample.
 * - This script creates a repeatable sample artifact to review, rather than relying on vague impressions.
 *
 * Usage:
 *   npx ts-node scripts/generate-text-approval-sample.ts \
 *     --rewrites <rewrites_for_indesign*.json> \
 *     --out <approval_sample.md> \
 *     [--lint <lint-report.json>] \
 *     [--seed 0] \
 *     [--per-chapter-body 3] \
 *     [--per-chapter-bullet 3] \
 *     [--min-body-chars 120] \
 *     [--min-bullet-chars 40] \
 *     [--hotspot-per-rule 3] \
 *     [--hotspot-max-rules 6]
 */

import fs from 'node:fs';
import path from 'node:path';

import { isBulletStyle, type TextLintIssue } from '../src/lib/textLint';

type RewritesParagraph = {
  paragraph_id?: string;
  chapter?: string;
  paragraph_number?: number;
  subparagraph_number?: number | null;
  style_name?: string;
  original?: string;
  rewritten?: string;
  _merged_away?: boolean;
};

type RewritesJson = {
  book_title?: string;
  upload_id?: string;
  generated_at?: string;
  fixed_at?: string;
  paragraphs: RewritesParagraph[];
};

type LintReport = {
  input_file: string;
  chapter_filter: string | null;
  timestamp: string;
  total_paragraphs: number;
  issues: TextLintIssue[];
  summary: {
    errors: number;
    warnings: number;
    by_rule: Record<string, number>;
  };
};

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

function safeInt(v: any, fallback: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sectionOf(p: RewritesParagraph): string {
  const ch = String(p.chapter ?? '?').trim() || '?';
  const pn = Number.isFinite(p.paragraph_number as any) ? String(p.paragraph_number) : '?';
  const sp = p.subparagraph_number;
  if (sp === null || sp === undefined) return `${ch}.${pn}`;
  return `${ch}.${pn}.${String(sp)}`;
}

function isHeadingishStyle(styleName: string): boolean {
  const s = String(styleName || '').toLowerCase();
  return s.includes('header') || s.includes('title') || s.includes('kop') || s.includes('heading');
}

function normalizeForReport(raw: string): string {
  let t = String(raw ?? '');
  // Render micro-titles as bold in the report for readability
  t = t.replace(/<<MICRO_TITLE>>(.*?)<<MICRO_TITLE_END>>/gs, '**$1**');
  // Render praktijk/verdieping markers more human-friendly (report-only)
  t = t.replace(/<<BOLD_START>>In de praktijk:<<BOLD_END>>/g, '**In de praktijk:**');
  t = t.replace(/<<BOLD_START>>Verdieping:<<BOLD_END>>/g, '**Verdieping:**');
  // Generic bold markers (report-only)
  t = t.replace(/<<BOLD_START>>/g, '**');
  t = t.replace(/<<BOLD_END>>/g, '**');
  // Collapse whitespace but keep intentional paragraph breaks (blank line)
  t = t.replace(/\r/g, '');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  // Within a block, collapse remaining newlines to spaces for compact display
  t = t
    .split('\n\n')
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return t.trim();
}

function pickStratified<T>(arr: T[], n: number, rnd: () => number): T[] {
  const out: T[] = [];
  const want = Math.max(0, Math.floor(n));
  if (!want || arr.length === 0) return out;
  if (arr.length <= want) return [...arr];
  for (let i = 0; i < want; i++) {
    const start = Math.floor((i * arr.length) / want);
    const end = Math.floor(((i + 1) * arr.length) / want);
    const span = Math.max(1, end - start);
    const idx = start + Math.floor(rnd() * span);
    out.push(arr[Math.min(arr.length - 1, Math.max(0, idx))]!);
  }
  // De-dupe while preserving order
  const seen = new Set<any>();
  return out.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

function issueScore(issue: TextLintIssue): number {
  const sev = issue.severity === 'error' ? 10_000 : 0;
  const msg = String(issue.message || '');
  // Pull the main numeric signal for some rules (bigger = worse)
  const m = msg.match(/(\d+)/);
  const n = m ? Number(m[1]) : 1;
  return sev + (Number.isFinite(n) ? n : 1);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  const rewritesPath = typeof flags.rewrites === 'string' ? path.resolve(String(flags.rewrites)) : '';
  const outPath = typeof flags.out === 'string' ? path.resolve(String(flags.out)) : '';
  const lintPath = typeof flags.lint === 'string' ? path.resolve(String(flags.lint)) : '';

  if (!rewritesPath || !outPath) {
    console.error(
      'Usage: npx ts-node scripts/generate-text-approval-sample.ts --rewrites <rewrites.json> --out <approval_sample.md> [--lint <lint.json>]'
    );
    process.exit(1);
  }
  if (!fs.existsSync(rewritesPath)) throw new Error(`❌ Rewrites JSON not found: ${rewritesPath}`);
  if (lintPath && !fs.existsSync(lintPath)) throw new Error(`❌ Lint report not found: ${lintPath}`);

  const seed = safeInt(flags.seed, 0);
  const perChapterBody = Math.max(0, safeInt(flags['per-chapter-body'], 3));
  const perChapterBullet = Math.max(0, safeInt(flags['per-chapter-bullet'], 3));
  const minBodyChars = Math.max(0, safeInt(flags['min-body-chars'], 120));
  const minBulletChars = Math.max(0, safeInt(flags['min-bullet-chars'], 40));
  const hotspotPerRule = Math.max(0, safeInt(flags['hotspot-per-rule'], 3));
  const hotspotMaxRules = Math.max(0, safeInt(flags['hotspot-max-rules'], 6));

  const rewritesRaw = fs.readFileSync(rewritesPath, 'utf8');
  const rewrites = JSON.parse(rewritesRaw) as RewritesJson;
  const paras: RewritesParagraph[] = Array.isArray(rewrites?.paragraphs) ? rewrites.paragraphs : [];

  const byId = new Map<string, RewritesParagraph>();
  for (const p of paras) {
    const pid = String(p?.paragraph_id ?? '').trim();
    if (pid) byId.set(pid, p);
  }

  const chapters = new Map<string, RewritesParagraph[]>();
  for (const p of paras) {
    const ch = String(p?.chapter ?? '').trim() || 'UNKNOWN';
    const arr = chapters.get(ch) ?? [];
    arr.push(p);
    chapters.set(ch, arr);
  }

  const chapterKeys = Array.from(chapters.keys()).sort((a, b) => Number(a) - Number(b));
  const rnd = mulberry32(seed);

  // Optional lint report
  const lint: LintReport | null = lintPath ? (JSON.parse(fs.readFileSync(lintPath, 'utf8')) as LintReport) : null;
  const issuesByPid = new Map<string, TextLintIssue[]>();
  if (lint) {
    for (const it of lint.issues || []) {
      const pid = String((it as any).paragraph_id ?? '').trim();
      if (!pid) continue;
      const arr = issuesByPid.get(pid) ?? [];
      arr.push(it);
      issuesByPid.set(pid, arr);
    }
  }

  // Terminology spot-checks (student-facing)
  const forbiddenTerms: Array<{ label: string; re: RegExp }> = [
    { label: 'cliënt/client', re: /\bcliënt\b|\bclient\b/gi },
    { label: 'verpleegkundige', re: /\bverpleegkundige\b/gi },
    { label: 'KD mention', re: /\bKD\b/gi },
  ];
  const termHits: Record<string, Array<{ pid: string; section: string; match: string }>> = {};
  for (const t of forbiddenTerms) termHits[t.label] = [];
  for (const p of paras) {
    if ((p as any)?._merged_away === true) continue;
    const pid = String(p.paragraph_id ?? '').trim();
    const txt = String(p.rewritten ?? '');
    if (!pid || !txt) continue;
    for (const t of forbiddenTerms) {
      const m = txt.match(t.re);
      if (m && m.length) {
        const sample = String(m[0] ?? '').trim();
        if (sample) termHits[t.label]!.push({ pid, section: sectionOf(p), match: sample });
      }
    }
  }

  // Selection buckets
  const selected = new Map<string, { why: string[] }>();
  const add = (pid: string, why: string) => {
    if (!pid) return;
    const cur = selected.get(pid) ?? { why: [] };
    if (!cur.why.includes(why)) cur.why.push(why);
    selected.set(pid, cur);
  };

  // 1) Balanced per-chapter sampling
  for (const ch of chapterKeys) {
    const arr = chapters.get(ch) ?? [];
    const bodyEligible = arr.filter((p) => {
      if ((p as any)?._merged_away === true) return false;
      const txt = String(p.rewritten ?? '').trim();
      if (txt.length < minBodyChars) return false;
      const style = String(p.style_name ?? '');
      if (isHeadingishStyle(style)) return false;
      if (isBulletStyle(style)) return false;
      return true;
    });
    const bulletEligible = arr.filter((p) => {
      if ((p as any)?._merged_away === true) return false;
      const txt = String(p.rewritten ?? '').trim();
      if (txt.length < minBulletChars) return false;
      const style = String(p.style_name ?? '');
      if (!isBulletStyle(style)) return false;
      return true;
    });

    for (const p of pickStratified(bodyEligible, perChapterBody, rnd)) add(String(p.paragraph_id ?? ''), `balanced:ch${ch}:body`);
    for (const p of pickStratified(bulletEligible, perChapterBullet, rnd))
      add(String(p.paragraph_id ?? ''), `balanced:ch${ch}:bullet`);
  }

  // 2) Always include layer blocks (praktijk/verdieping) if any
  for (const p of paras) {
    if ((p as any)?._merged_away === true) continue;
    const pid = String(p.paragraph_id ?? '').trim();
    const txt = String(p.rewritten ?? '');
    if (!pid || !txt) continue;
    if (txt.includes('<<BOLD_START>>In de praktijk:<<BOLD_END>>') || txt.includes('<<BOLD_START>>Verdieping:<<BOLD_END>>')) {
      add(pid, 'contains:praktijk/verdieping');
    }
  }

  // 3) Lint hotspots (worst examples per top rules)
  if (lint && hotspotPerRule > 0 && hotspotMaxRules > 0) {
    const counts = lint.summary?.by_rule || {};
    const topRules = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, hotspotMaxRules)
      .map(([r]) => r);

    // Always include any errors (regardless of hotspotMaxRules)
    const errorIssues = (lint.issues || []).filter((i) => i.severity === 'error');
    for (const it of errorIssues.slice(0, 40)) {
      add(String(it.paragraph_id), `lint:error:${it.rule}`);
    }

    for (const rule of topRules) {
      const its = (lint.issues || []).filter((i) => i.rule === rule);
      its.sort((a, b) => issueScore(b) - issueScore(a));
      for (const it of its.slice(0, hotspotPerRule)) {
        add(String(it.paragraph_id), `lint:hotspot:${rule}`);
      }
    }
  }

  // Build report
  const now = new Date().toISOString();

  const lines: string[] = [];
  lines.push(`# Text approval sample`);
  lines.push('');
  lines.push(`- **generated_at**: \`${now}\``);
  lines.push(`- **rewrites_json**: \`${rewritesPath}\``);
  if (lint) lines.push(`- **lint_report**: \`${lintPath}\``);
  if (rewrites.book_title) lines.push(`- **book_title**: ${rewrites.book_title}`);
  if (rewrites.upload_id) lines.push(`- **upload_id**: \`${rewrites.upload_id}\``);
  lines.push('');
  lines.push(`## Sampling config`);
  lines.push('');
  lines.push(`- **seed**: ${seed}`);
  lines.push(`- **per_chapter_body**: ${perChapterBody} (min_chars=${minBodyChars})`);
  lines.push(`- **per_chapter_bullet**: ${perChapterBullet} (min_chars=${minBulletChars})`);
  if (lint) {
    lines.push(`- **hotspot_per_rule**: ${hotspotPerRule}`);
    lines.push(`- **hotspot_max_rules**: ${hotspotMaxRules}`);
  }
  lines.push('');

  if (lint) {
    lines.push(`## Lint summary`);
    lines.push('');
    lines.push(`- **errors**: ${lint.summary?.errors ?? 0}`);
    lines.push(`- **warnings**: ${lint.summary?.warnings ?? 0}`);
    const top = Object.entries(lint.summary?.by_rule || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    if (top.length) {
      lines.push('');
      lines.push(`### Top warning rules`);
      lines.push('');
      for (const [r, c] of top) lines.push(`- **${r}**: ${c}`);
    }
    lines.push('');
  }

  lines.push(`## Terminology spot-checks (student-facing)`);
  lines.push('');
  for (const t of forbiddenTerms) {
    const hits = termHits[t.label] || [];
    lines.push(`- **${t.label}**: ${hits.length} hit(s)`);
  }
  const anyHits = forbiddenTerms.some((t) => (termHits[t.label] || []).length > 0);
  if (anyHits) {
    lines.push('');
    lines.push(`### First hits (max 20)`);
    lines.push('');
    for (const t of forbiddenTerms) {
      const hits = termHits[t.label] || [];
      if (!hits.length) continue;
      lines.push(`#### ${t.label}`);
      lines.push('');
      for (const h of hits.slice(0, 20)) lines.push(`- **${h.section}** (pid=${h.pid}): \`${h.match}\``);
      lines.push('');
    }
  }
  lines.push('');

  lines.push(`## Sample paragraphs`);
  lines.push('');
  lines.push(`Read these as if you are a student. Mark anything that feels: awkward, too long, too abstract, list-y, or unclear.`);
  lines.push('');

  // Group selected by chapter for readability
  const selectedPids = Array.from(selected.keys());
  const byChapterSel = new Map<string, string[]>();
  for (const pid of selectedPids) {
    const p = byId.get(pid);
    const ch = p ? String(p.chapter ?? '').trim() || 'UNKNOWN' : 'UNKNOWN';
    const arr = byChapterSel.get(ch) ?? [];
    arr.push(pid);
    byChapterSel.set(ch, arr);
  }

  const selChapterKeys = Array.from(byChapterSel.keys()).sort((a, b) => Number(a) - Number(b));
  for (const ch of selChapterKeys) {
    lines.push(`### Chapter ${ch}`);
    lines.push('');
    const pids = byChapterSel.get(ch) ?? [];
    // stable order by section (best-effort)
    pids.sort((a, b) => {
      const pa = byId.get(a);
      const pb = byId.get(b);
      return sectionOf(pa || {}).localeCompare(sectionOf(pb || {}), undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const pid of pids) {
      const p = byId.get(pid);
      if (!p) continue;
      if ((p as any)?._merged_away === true) continue;
      const sec = sectionOf(p);
      const style = String(p.style_name ?? '');
      const txt = normalizeForReport(String(p.rewritten ?? '').trim());
      if (!txt) continue;
      const why = selected.get(pid)?.why || [];
      const its = issuesByPid.get(pid) || [];
      const ruleList = its.length ? Array.from(new Set(its.map((x) => x.rule))).join(', ') : '';

      lines.push(`- **${sec}** (${style || 'no-style'}; pid=${pid})`);
      if (ruleList) lines.push(`  - **lint**: ${ruleList}`);
      if (why.length) lines.push(`  - **selected_because**: ${why.join(', ')}`);
      lines.push(`  - **text**: ${txt}`);
      lines.push('');
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`✅ Wrote text approval sample: ${outPath}`);
  console.log(`   selected_paragraphs=${selected.size}`);
}

main();































