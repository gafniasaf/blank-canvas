import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeConfigSync } from "./runtimeConfig";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const meta = import.meta as any;

/**
 * Frontend Supabase client — lazy-initialized.
 *
 * Credentials come from either:
 * 1. Vite env vars (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
 * 2. Runtime config (public/app-config.json — used by Lovable)
 *
 * The client is created lazily on first access so that
 * loadRuntimeConfig() in main.tsx has time to populate the cache.
 *
 * Ignite Zero: no mock fallback. Returns null if no credentials found.
 */

let _client: SupabaseClient | null | undefined = undefined;

function resolveCredentials(): { url: string; key: string } | null {
  const rc = getRuntimeConfigSync();
  const url =
    meta.env?.VITE_SUPABASE_URL ||
    rc?.supabase?.url;
  const key =
    meta.env?.VITE_SUPABASE_ANON_KEY ||
    meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    rc?.supabase?.publishableKey;
  if (url && key) return { url, key };
  return null;
}

function getClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const creds = resolveCredentials();
  if (!creds) {
    _client = null;
    return null;
  }
  _client = createClient(creds.url, creds.key);
  return _client;
}

/** Proxy object that lazily initializes the Supabase client. */
export const supabase: SupabaseClient | null = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    if (!client) return undefined;
    const val = (client as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(client) : val;
  },
});

export function isSupabaseConnected(): boolean {
  return !!resolveCredentials();
}
