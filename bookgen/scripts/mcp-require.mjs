#!/usr/bin/env node
/**
 * Hard gate: require BookGen MCP server to be running.
 * Blocks dev/scaffold/verify if MCP is unreachable.
 *
 * Set SKIP_MCP_GATE=1 to bypass (for CI or offline work).
 */
if (process.env.SKIP_MCP_GATE === "1") {
  console.log("⚠️  SKIP_MCP_GATE=1 — skipping MCP requirement.");
  process.exit(0);
}

const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:4100";

try {
  const res = await fetch(`${MCP_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) {
    console.log(`✅ MCP gate passed (${MCP_URL})`);
    process.exit(0);
  }
  throw new Error(`MCP returned ${res.status}`);
} catch (e) {
  console.error(`\n❌ BookGen MCP server is NOT running at ${MCP_URL}`);
  console.error(`\n   To start it:`);
  console.error(`     cd bookgen-mcp && npm install && npm run dev`);
  console.error(`\n   Or bypass with: SKIP_MCP_GATE=1 npm run <command>\n`);
  process.exit(1);
}

