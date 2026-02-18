// AUTO-GENERATED stub by scaffold-system.ts
// Replace with a hand-written implementation in src/strategies/extract_tokens.ts
import type { JobContext, JobExecutor, StrategyResult } from "./types.js";

export class GeneratedExtractTokens implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    console.log(`[extract_tokens] Stub execution for job ${job.id}`);
    // TODO: Implement extract_tokens strategy
    return { ok: true, stub: true, step: "extract_tokens" };
  }
}

export default GeneratedExtractTokens;
