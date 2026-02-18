#!/usr/bin/env node
/**
 * Check if the BookGen MCP server is running.
 * Exit 0 = healthy, Exit 1 = unreachable.
 */
const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:4100";

try {
  const res = await fetch(`${MCP_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) {
    const data = await res.json();
    console.log(`✅ BookGen MCP is running at ${MCP_URL}`);
    console.log(`   Methods: ${data.methods?.length ?? "?"}`);
    process.exit(0);
  } else {
    console.error(`❌ MCP returned ${res.status}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`❌ BookGen MCP is NOT running at ${MCP_URL}`);
  console.error(`   Start it with: cd bookgen-mcp && npm run dev`);
  process.exit(1);
}

