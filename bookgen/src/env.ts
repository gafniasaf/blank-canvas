import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env files (bookgen root, then repo root as fallback)
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: false });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || typeof v !== "string" || !v.trim()) {
    throw new Error(`BLOCKED: env var ${name} is REQUIRED`);
  }
  return v.trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  if (!v || typeof v !== "string" || !v.trim()) return fallback;
  return v.trim();
}

export function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

