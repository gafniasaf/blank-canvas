/**
 * llm-check-repair-merged.ts
 *
 * PROOF OF CONCEPT: Merged Check+Repair in 1 LLM call
 *
 * Instead of:
 *   Check → Issues → Repair → Patches (2 calls)
 *
 * We do:
 *   CheckAndRepair → Issues + Patches (1 call)
 *
 * Expected benefits:
 *   - ~20-25% fewer LLM calls
 *   - Faster iteration loops
 *
 * Risks:
 *   - LLM might be less thorough when doing two tasks at once
 *   - Patches might not address all issues
 *
 * Usage:
 *   npx ts-node scripts/llm-check-repair-merged.ts <inJson> <outJson> \
 *     [--chapter 2] [--model claude-opus-4-5-20251101] [--max-iters 6]
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Load env
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath });
} catch {}
dotenv.config();

// Types
type RewritesForIndesignParagraph = {
  paragraph_id: string;
  chapter?: number | string;
  chapter_number?: number | string;
  paragraph_number: number | string;
  subparagraph_number: number | string | null;
  style_name: string;
  original: string;
  rewritten: string;
};

type LlmIssue = {
  id: string;
  severity: 'critical' | 'warning';
  paragraph_id: string | null;
  message: string;
  evidence?: string;
};

type LlmPatch = {
  paragraph_id: string;
  rewritten: string;
};

type CheckAndRepairResponse = {
  score: number;
  issues: LlmIssue[];
  patches: LlmPatch[];
  notes?: string;
};

// Helpers
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getChapter(p: RewritesForIndesignParagraph): string {
  return String(p.chapter ?? p.chapter_number ?? '').trim();
}

function sectionKey(p: RewritesForIndesignParagraph): string {
  const ch = getChapter(p);
  const pn = String(p.paragraph_number ?? '').trim();
  const sp = String(p.subparagraph_number ?? '').trim() || '_';
  return `${ch}.${pn}.${sp}`;
}

function normalizeNewlines(s: string): string {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripMarkdownFences(s: string): string {
  let t = String(s ?? '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '').trim();
  }
  return t;
}

// The merged prompt
const MERGED_SYSTEM_PROMPT = `You are a strict QA reviewer AND repair agent for a Dutch educational textbook (basisboek / N3).

YOUR DUAL TASK:
1. DETECT issues in the rewritten text (compared to original)
2. PROVIDE patches to fix critical issues

PROJECT CONTEXT (Prince-first Dutch textbook PDF):
- Output is rendered to HTML/CSS (Prince). Bullets are a didactic choice.
- Never output '\\r' (only '\\n' if needed).

CRITICAL RULES TO CHECK:
1. No truncation: sentences must be complete (no fragments like "bijna niet")
2. No meaning loss: distinct claims in ORIGINAL must appear in REWRITTEN
3. No duplicate intros: don't repeat the same intro sentence across paragraphs
4. List-intro anchoring: if text introduces a list, it should end with ':'
5. Bullets should be short phrases, not mini-paragraphs

SCORING (deterministic):
- Start at 100
- Subtract 30 for each critical issue
- Subtract 5 for each warning
- Clamp to [0, 100]

EVIDENCE POLICY:
- Every issue MUST include 'evidence': an exact quote from the provided text
- If you cannot quote it literally, DO NOT add the issue

PATCH POLICY:
- Only provide patches for paragraphs with CRITICAL issues
- Each patch must fix the issue while preserving meaning
- Keep the same style/tone as surrounding text

OUTPUT FORMAT (strict JSON, no markdown):
{
  "score": 70,
  "issues": [
    {
      "id": "truncation-1",
      "severity": "critical",
      "paragraph_id": "abc-123",
      "message": "Sentence ends with fragment",
      "evidence": "bijna niet"
    }
  ],
  "patches": [
    {
      "paragraph_id": "abc-123",
      "rewritten": "De volledige gecorrigeerde tekst hier..."
    }
  ],
  "notes": "Optional notes"
}`;

async function llmCheckAndRepair(opts: {
  anthropicApiKey: string;
  model: string;
  section: string;
  paragraphs: Array<{
    paragraph_id: string;
    style_name: string;
    original: string;
    rewritten: string;
  }>;
}): Promise<CheckAndRepairResponse> {
  const { anthropicApiKey, model, section, paragraphs } = opts;

  const userContent = JSON.stringify({
    section,
    paragraphs: paragraphs.map((p, i) => ({
      i,
      paragraph_id: p.paragraph_id,
      style_name: p.style_name,
      original: p.original.slice(0, 1500),
      rewritten: p.rewritten.slice(0, 1500),
    })),
  });

  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: MERGED_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errText.slice(0, 300)}`);
      }

      const json = await response.json() as any;
      const txt = json.content?.[0]?.text || '';
      const cleaned = stripMarkdownFences(txt);

      try {
        const parsed = JSON.parse(cleaned) as CheckAndRepairResponse;
        
        // Validate and clean issues
        const validIssues: LlmIssue[] = [];
        for (const issue of parsed.issues || []) {
          if (!issue.evidence) continue;
          if (!['critical', 'warning'].includes(issue.severity)) continue;
          validIssues.push(issue);
        }

        // Validate patches
        const validPatches: LlmPatch[] = [];
        const allowedIds = new Set(paragraphs.map(p => p.paragraph_id));
        for (const patch of parsed.patches || []) {
          if (!patch.paragraph_id || !allowedIds.has(patch.paragraph_id)) continue;
          if (!patch.rewritten || patch.rewritten.includes('\r')) continue;
          validPatches.push(patch);
        }

        // Compute score from issues
        let score = 100;
        for (const issue of validIssues) {
          if (issue.severity === 'critical') score -= 30;
          else if (issue.severity === 'warning') score -= 5;
        }
        score = Math.max(0, Math.min(100, score));

        return {
          score,
          issues: validIssues,
          patches: validPatches,
          notes: parsed.notes,
        };
      } catch (parseErr) {
        console.error(`JSON parse error for section ${section}, attempt ${attempts}`);
        if (attempts === maxAttempts) throw parseErr;
        await sleep(1000);
      }
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      const isRetryable = msg.includes('rate') || msg.includes('timeout') || msg.includes('overloaded');
      if (!isRetryable || attempts === maxAttempts) throw err;
      console.log(`Retrying section ${section} (attempt ${attempts})...`);
      await sleep(2000 * attempts);
    }
  }

  throw new Error(`Failed after ${maxAttempts} attempts`);
}

async function main() {
  const args = process.argv.slice(2);
  const inPath = args[0];
  const outPath = args[1];

  if (!inPath || !outPath) {
    console.error('Usage: npx ts-node scripts/llm-check-repair-merged.ts <inJson> <outJson> [--chapter N] [--max-iters N]');
    process.exit(1);
  }

  // Parse args
  let chapterFilter: number | null = null;
  let maxIters = 6;
  let model = 'claude-opus-4-5-20251101';

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--chapter' && args[i + 1]) {
      chapterFilter = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--max-iters' && args[i + 1]) {
      maxIters = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    }
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  // Load input
  const raw = fs.readFileSync(inPath, 'utf-8');
  const data = JSON.parse(raw) as { paragraphs: RewritesForIndesignParagraph[] };

  // Filter by chapter
  let paragraphs = data.paragraphs;
  if (chapterFilter !== null) {
    paragraphs = paragraphs.filter(p => Number(getChapter(p)) === chapterFilter);
  }

  console.log(`\n=== MERGED CHECK+REPAIR POC ===`);
  console.log(`Input: ${inPath}`);
  console.log(`Chapter: ${chapterFilter ?? 'all'}`);
  console.log(`Model: ${model}`);
  console.log(`Max iters: ${maxIters}`);
  console.log(`Paragraphs: ${paragraphs.length}`);

  // Group by section
  const sections = new Map<string, RewritesForIndesignParagraph[]>();
  for (const p of paragraphs) {
    const sk = sectionKey(p);
    if (!sections.has(sk)) sections.set(sk, []);
    sections.get(sk)!.push(p);
  }
  console.log(`Sections: ${sections.size}`);

  // Build lookup
  const byId = new Map<string, RewritesForIndesignParagraph>();
  for (const p of paragraphs) byId.set(p.paragraph_id, p);

  // Iteration loop
  const startTime = Date.now();
  let totalCalls = 0;

  for (let iter = 1; iter <= maxIters; iter++) {
    let minScore = 100;
    let totalIssues = 0;
    let totalPatches = 0;

    for (const [sk, ps] of sections.entries()) {
      const payload = ps.map(p => ({
        paragraph_id: p.paragraph_id,
        style_name: p.style_name,
        original: normalizeNewlines(p.original),
        rewritten: normalizeNewlines(p.rewritten),
      }));

      totalCalls++;
      const result = await llmCheckAndRepair({
        anthropicApiKey: anthropicKey,
        model,
        section: sk,
        paragraphs: payload,
      });

      minScore = Math.min(minScore, result.score);
      totalIssues += result.issues.length;

      // Apply patches
      for (const patch of result.patches) {
        const target = byId.get(patch.paragraph_id);
        if (target) {
          target.rewritten = normalizeNewlines(patch.rewritten);
          totalPatches++;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`iter=${iter} min_score=${minScore} issues=${totalIssues} patches=${totalPatches} calls=${totalCalls} elapsed=${elapsed}s`);

    // Done if no critical issues
    const criticalIssues = totalIssues; // simplified
    if (minScore >= 70 && criticalIssues === 0) {
      console.log(`\n✅ Converged at iter ${iter}`);
      break;
    }
  }

  // Save output
  data.paragraphs = chapterFilter !== null
    ? [...data.paragraphs.filter(p => Number(getChapter(p)) !== chapterFilter), ...paragraphs]
    : paragraphs;

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\n✅ Wrote: ${outPath}`);
  console.log(`Total LLM calls: ${totalCalls}`);
  console.log(`Elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

