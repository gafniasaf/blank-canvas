/**
 * Job Registry — maps pipeline step names to strategy executors.
 *
 * Strategies are lazy-loaded to keep startup fast.
 */

import type { JobExecutor, PipelineStep } from "./strategies/types.js";

export class JobRegistry {
  private strategies: Map<string, JobExecutor> = new Map();

  constructor() {
    // Strategies are registered lazily when first requested.
    // This avoids importing all strategy modules at startup.
  }

  async loadStrategy(step: PipelineStep): Promise<JobExecutor | null> {
    try {
      // Dynamic import based on step name
      const mod = await import(`./strategies/${step}.js`);
      const ExecutorClass = mod.default ?? mod[Object.keys(mod)[0]!];
      if (typeof ExecutorClass === "function") {
        return new ExecutorClass();
      }
      if (ExecutorClass && typeof ExecutorClass.execute === "function") {
        return ExecutorClass as JobExecutor;
      }
      console.warn(`[registry] Strategy ${step} has no valid executor export.`);
      return null;
    } catch (e) {
      console.warn(`[registry] Failed to load strategy for step "${step}":`, e);
      return null;
    }
  }

  async get(step: string): Promise<JobExecutor | null> {
    const cached = this.strategies.get(step);
    if (cached) return cached;

    const executor = await this.loadStrategy(step as PipelineStep);
    if (executor) {
      this.strategies.set(step, executor);
    }
    return executor;
  }
}

