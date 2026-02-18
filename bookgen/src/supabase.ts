import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.js";

let _admin: SupabaseClient | null = null;

/**
 * Returns a Supabase admin client (service role).
 * Lazy-initialized, cached for the process lifetime.
 */
export function adminSupabase(): SupabaseClient {
  if (!_admin) {
    const url = requireEnv("SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    _admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

