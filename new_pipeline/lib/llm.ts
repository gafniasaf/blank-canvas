import { OpenAI } from 'openai';

export type LlmProvider = 'openai' | 'anthropic';
export type LlmChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableLlmError(e: any): boolean {
  const msg = String(e?.message || e?.toString?.() || '').toLowerCase();
  const name = String(e?.name || e?.constructor?.name || '').toLowerCase();

  // Common timeout spellings
  if (name.includes('timeout')) return true;
  if (msg.includes('timed out')) return true;
  if (msg.includes('etimedout') || msg.includes('timeout')) return true;

  // Transient network failures
  if (msg.includes('connection error')) return true;
  if (msg.includes('fetch failed')) return true;
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('socket hang up')) return true;
  if (msg.includes('enotfound') || msg.includes('eai_again')) return true;

  // HTTP status codes (OpenAI SDK + raw fetch)
  const status = Number(e?.status || e?.statusCode || e?.response?.status);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;

  return false;
}

export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttemptsOrOpts?: number | { maxAttempts?: number }
): Promise<T> {
  const maxAttempts =
    typeof maxAttemptsOrOpts === 'number'
      ? Math.max(1, Math.floor(maxAttemptsOrOpts))
      : Math.max(1, Math.floor(Number(maxAttemptsOrOpts?.maxAttempts ?? 5)));

  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) console.log(`${label}: retry ${attempt}/${maxAttempts}...`);
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryableLlmError(e) || attempt === maxAttempts) throw e;
      // Exponential backoff with small jitter; cap at 30s.
      const base = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 300);
      await sleep(base + jitter);
    }
  }
  throw lastErr;
}

export async function llmChatComplete(opts: {
  provider: LlmProvider;
  model: string;
  temperature: number;
  messages: LlmChatMessage[];
  openai?: OpenAI;
  anthropicApiKey?: string;
  maxTokens?: number;
}): Promise<string> {
  const { provider, model, temperature, messages, openai, anthropicApiKey, maxTokens } = opts;

  if (provider === 'openai') {
    if (!openai) throw new Error('OpenAI client not configured');
    const resp = await openai.chat.completions.create({
      model,
      temperature,
      messages: messages.map((m) => ({ role: m.role as any, content: String(m.content ?? '') })),
      max_tokens: maxTokens,
    });
    return String(resp.choices?.[0]?.message?.content ?? '').trim();
  }

  // Anthropic
  const key = String(anthropicApiKey ?? '').trim();
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY');

  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => String(m.content ?? ''))
    .join('\n')
    .trim();
  const msg = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': key,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens || 4096,
      system: system || undefined,
      messages: msg,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`Anthropic API error (${res.status}): ${t.slice(0, 500)}`);
    // @ts-expect-error attach status for retry decisions
    err.status = res.status;
    throw err;
  }

  const json: any = await res.json();
  const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
  return blocks
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .join('')
    .trim();
}












