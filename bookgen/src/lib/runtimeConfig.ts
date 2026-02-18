/**
 * Runtime configuration — loaded from /app-config.json at startup.
 *
 * This is how Lovable-hosted apps receive Supabase credentials without
 * env vars. The file is served as a static asset from public/.
 */

export type RuntimeConfig = {
  apiMode?: "edge" | "mcp";
  supabase?: {
    url?: string;
    publishableKey?: string;
  };
};

let cached: RuntimeConfig | null = null;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = {};
    return cached;
  }

  try {
    const res = await fetch("/app-config.json", { cache: "no-store" });
    if (!res.ok) {
      cached = {};
      return cached;
    }
    const json = (await res.json()) as RuntimeConfig;
    cached = json ?? {};
    return cached;
  } catch {
    cached = {};
    return cached;
  }
}

export function getRuntimeConfigSync(): RuntimeConfig {
  return cached ?? {};
}

