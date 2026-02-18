/**
 * Preflight Environment Check
 *
 * Validates all required env vars are set. Fails fast with clear messages.
 * Absolute no-fallback policy: if a required var is missing, the process exits.
 *
 * Usage: npx tsx scripts/preflight-env.ts
 */

import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

const MCP_VARS = [
  "AGENT_TOKEN",
  "MCP_AUTH_TOKEN",
];

function check(vars: string[], label: string): string[] {
  const missing: string[] = [];
  for (const name of vars) {
    const v = process.env[name];
    if (!v || typeof v !== "string" || !v.trim()) {
      missing.push(name);
    }
  }
  return missing;
}

const coreMissing = check(REQUIRED_VARS, "Core");
const mcpMissing = check(MCP_VARS, "MCP");

if (coreMissing.length > 0) {
  console.error("❌ PREFLIGHT FAILED — Missing required environment variables:");
  for (const name of coreMissing) {
    console.error(`   - ${name}`);
  }
  console.error("\nSet these in bookgen/.env (copy from .env.example).");
  process.exit(1);
}

if (mcpMissing.length > 0) {
  console.warn("⚠️  MCP environment variables not set (MCP server will not start):");
  for (const name of mcpMissing) {
    console.warn(`   - ${name}`);
  }
  console.warn("   Set these if you plan to use the MCP server.\n");
}

console.log("✅ Preflight environment check passed.");
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL?.slice(0, 40)}...`);
console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set (" + process.env.OPENAI_API_KEY.length + " chars)" : "MISSING"}`);
console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set (" + process.env.ANTHROPIC_API_KEY.length + " chars)" : "MISSING"}`);

