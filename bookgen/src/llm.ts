/**
 * Unified LLM abstraction — supports OpenAI and Anthropic.
 *
 * Merged from:
 * - TestRun:   new_pipeline/lib/llm.ts  (retry logic, dual-provider chat)
 * - LearnPlay: queue-pump/src/ai.ts     (tool_use support, JSON extraction)
 *
 * All LLM calls in the bookgen pipeline go through this module.
 */

import { requireEnv } from "./env.js";

// =============================================================================
// Types
// =============================================================================

export type LlmProvider = "openai" | "anthropic";
export type LlmChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AnthropicToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmChatOptions {
  provider: LlmProvider;
  model: string;
  temperature: number;
  messages: LlmChatMessage[];
  maxTokens?: number;
  /** Anthropic tool_use for structured JSON output */
  tools?: AnthropicToolSpec[];
  toolChoice?: { type: "tool"; name: string } | { type: "auto" };
  /** OpenAI JSON mode */
  jsonMode?: boolean;
  /** Timeout in ms (default: 300s) */
  timeoutMs?: number;
}

// =============================================================================
// Retry logic
// =============================================================================

function isRetryableError(e: unknown): boolean {
  const msg = String((e as Error)?.message || e || "").toLowerCase();
  const name = String((e as Error)?.name || "").toLowerCase();

  if (name.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) return true;
  if (msg.includes("connection error") || msg.includes("fetch failed")) return true;
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("socket hang up")) return true;
  if (msg.includes("enotfound") || msg.includes("eai_again")) return true;

  const status = Number((e as Record<string, unknown>)?.status ?? (e as Record<string, unknown>)?.statusCode ?? 0);
  if (status === 429 || (status >= 500 && status <= 599)) return true;

  return false;
}

export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) console.log(`[llm] ${label}: retry ${attempt}/${maxAttempts}...`);
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableError(e) || attempt === maxAttempts) throw e;
      const base = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
  throw lastErr;
}

// =============================================================================
// Chat completion
// =============================================================================

export async function llmChatComplete(opts: LlmChatOptions): Promise<string> {
  const { provider, model, temperature, messages, maxTokens, timeoutMs } = opts;
  const timeout = timeoutMs ?? 300_000;

  if (provider === "openai") {
    return callOpenAI({ ...opts, timeoutMs: timeout });
  }
  return callAnthropic({ ...opts, timeoutMs: timeout });
}

async function callOpenAI(opts: LlmChatOptions & { timeoutMs: number }): Promise<string> {
  const key = requireEnv("OPENAI_API_KEY");
  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });

  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`OpenAI API error (${resp.status}): ${text.slice(0, 500)}`);
    (err as unknown as Record<string, unknown>).status = resp.status;
    throw err;
  }

  const data = JSON.parse(text);
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

async function callAnthropic(opts: LlmChatOptions & { timeoutMs: number }): Promise<string> {
  const key = requireEnv("ANTHROPIC_API_KEY");

  const system = opts.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n")
    .trim();
  const userMessages = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens || 4096,
    messages: userMessages,
  };
  if (system) body.system = system;
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });

  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`Anthropic API error (${resp.status}): ${text.slice(0, 500)}`);
    (err as unknown as Record<string, unknown>).status = resp.status;
    throw err;
  }

  const data = JSON.parse(text);
  const content: unknown[] = Array.isArray(data?.content) ? data.content : [];

  // If tool_use was requested, extract tool input
  if (opts.tools?.length) {
    const toolUse = content.find(
      (b: unknown) =>
        (b as Record<string, unknown>)?.type === "tool_use" &&
        (b as Record<string, unknown>)?.input &&
        typeof (b as Record<string, unknown>).input === "object"
    ) as Record<string, unknown> | undefined;
    if (toolUse?.input) {
      return JSON.stringify(toolUse.input);
    }
  }

  // Otherwise concatenate text blocks
  return content
    .filter((b: unknown) => (b as Record<string, unknown>)?.type === "text")
    .map((b: unknown) => String((b as Record<string, unknown>)?.text ?? ""))
    .join("")
    .trim();
}

// =============================================================================
// JSON extraction helper
// =============================================================================

export function extractJsonFromText(raw: string): unknown {
  const s = raw.trim();

  // Try direct parse first
  try {
    return JSON.parse(s);
  } catch {
    // continue
  }

  // Try to extract from markdown code block (complete)
  const mdMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (mdMatch?.[1]) {
    try {
      return JSON.parse(mdMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Try to extract from markdown code block (truncated — no closing ```)
  const mdOpenMatch = s.match(/```(?:json)?\s*\n([\s\S]+)/);
  if (mdOpenMatch?.[1]) {
    const inner = mdOpenMatch[1].trim();
    try {
      return JSON.parse(inner);
    } catch {
      // Try to repair truncated JSON by closing open brackets/braces
      const repaired = repairTruncatedJson(inner);
      if (repaired) {
        try { return JSON.parse(repaired); } catch { /* continue */ }
      }
    }
  }

  // Try to find first { ... } or [ ... ]
  const braceStart = s.indexOf("{");
  const bracketStart = s.indexOf("[");
  const start = braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)
    ? braceStart
    : bracketStart;

  if (start >= 0) {
    const sub = s.slice(start);
    try {
      return JSON.parse(sub);
    } catch {
      // Try to repair truncated JSON
      const repaired = repairTruncatedJson(sub);
      if (repaired) {
        try { return JSON.parse(repaired); } catch { /* continue */ }
      }
    }
  }

  throw new Error("Failed to extract JSON from LLM response");
}

/**
 * Attempt to repair truncated JSON by closing open brackets/braces and strings.
 * Returns null if repair seems infeasible.
 */
function repairTruncatedJson(s: string): string | null {
  // Strip trailing comma + whitespace
  let trimmed = s.replace(/,\s*$/, "");

  // Close any open string
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    if (escaped) { escaped = false; continue; }
    if (trimmed[i] === "\\") { escaped = true; continue; }
    if (trimmed[i] === '"') inString = !inString;
  }
  if (inString) trimmed += '"';

  // Count open brackets/braces
  const stack: string[] = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    if (escaped) { escaped = false; continue; }
    if (trimmed[i] === "\\") { escaped = true; continue; }
    if (trimmed[i] === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (trimmed[i] === "{" || trimmed[i] === "[") stack.push(trimmed[i]);
    if (trimmed[i] === "}" || trimmed[i] === "]") stack.pop();
  }

  if (stack.length === 0) return trimmed;
  if (stack.length > 20) return null; // too deeply nested, bail

  // Close in reverse order
  const closers = stack.reverse().map((c) => (c === "{" ? "}" : "]"));
  return trimmed + closers.join("");
}

// =============================================================================
// Model spec parser (e.g. "anthropic:claude-sonnet-4-5-20250929")
// =============================================================================

export function parseModelSpec(raw: string): { provider: LlmProvider; model: string } {
  const s = raw.trim();
  const parts = s.split(":").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`BLOCKED: model spec must be provider-prefixed (e.g. 'anthropic:claude-sonnet-4-5-20250929'), got: ${raw}`);
  }
  const provider = parts[0] as LlmProvider;
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error(`BLOCKED: model provider must be 'openai' or 'anthropic', got: ${provider}`);
  }
  const model = parts.slice(1).join(":").trim();
  if (!model) throw new Error("BLOCKED: model name is missing");
  return { provider, model };
}

