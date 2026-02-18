import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: false });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

export const config = {
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  agentToken: process.env.AGENT_TOKEN || "dev-local-secret",
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || "dev-local-secret",
  port: Number(process.env.MCP_PORT || 4100),
  host: process.env.MCP_HOST || "127.0.0.1",
};

