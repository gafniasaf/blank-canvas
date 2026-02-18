import { config } from "./config.js";

export async function supabaseRest(
  table: string,
  opts: { method?: string; query?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<unknown> {
  const method = opts.method || "GET";
  const url = `${config.supabaseUrl}/rest/v1/${table}${opts.query ? `?${opts.query}` : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

export async function supabaseRpc(fnName: string, params: Record<string, unknown>): Promise<unknown> {
  const url = `${config.supabaseUrl}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase RPC ${fnName} ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

