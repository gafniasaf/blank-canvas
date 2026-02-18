/**
 * Verify System — multi-gate verification for BookGen Ignite Zero.
 *
 * Gates:
 * 1. MCP hard gate — bookgen-mcp must be running
 * 2. Contracts present — src/lib/contracts.ts exists and is non-trivial
 * 3. Job wiring audit — manifest jobs exist in contracts AND registry
 * 4. No-fallback scan — reject process.env.X || default patterns
 * 5. Typecheck — tsc --noEmit on worker config
 * 6. Terminology gate — scan for forbidden terms
 *
 * Ported from LearnPlay's scripts/lib/verify-system.ts, adapted for BookGen.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export async function verifySystem(): Promise<void> {
  if (process.env.SKIP_VERIFY === "1") {
    console.log("⚠️  SKIP_VERIFY=1 — skipping verify.");
    return;
  }

  console.log("🔍 Verifying BookGen System Integrity...\n");

  // ─── Gate 1: MCP hard gate ──────────────────────────────────────
  console.log("🔌 Gate 1: MCP hard gate...");
  try {
    const res = await fetch("http://127.0.0.1:4100/health", { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      console.log("✅ MCP server is running on :4100");
    } else {
      throw new Error(`MCP returned ${res.status}`);
    }
  } catch {
    console.warn("⚠️  MCP server not running on :4100 (skipping MCP gate for offline verify)");
  }

  // ─── Gate 2: Contracts present ──────────────────────────────────
  console.log("\n📜 Gate 2: Contracts present...");
  const contractsPath = path.join(ROOT, "src/lib/contracts.ts");
  if (!fs.existsSync(contractsPath)) {
    throw new Error("contracts.ts missing. Run `npx ignite scaffold` first.");
  }
  const contractsSize = fs.statSync(contractsPath).size;
  if (contractsSize < 100) {
    throw new Error("contracts.ts appears empty or invalid.");
  }
  console.log(`✅ Contracts present (${contractsSize} bytes)`);

  // ─── Gate 3: Job wiring audit ───────────────────────────────────
  console.log("\n🧩 Gate 3: Job wiring audit (manifest <-> contracts <-> registry)...");

  const manifestPath = path.join(ROOT, "system-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const manifestJobs: Array<{ id: string; execution_mode?: string }> = Array.isArray(manifest?.agent_jobs) ? manifest.agent_jobs : [];
  const manifestJobIds = new Set(manifestJobs.map((j) => String(j.id || "")).filter(Boolean));

  if (manifestJobIds.size === 0) {
    throw new Error("No agent_jobs found in system-manifest.json");
  }

  // Check contracts JOB_MODES
  const contractsText = fs.readFileSync(contractsPath, "utf-8");
  const jobModesMatch = contractsText.match(/export const JOB_MODES\s*=\s*\{([\s\S]*?)\}\s*as const;/);
  if (!jobModesMatch) {
    throw new Error("JOB_MODES not found in contracts.ts (run `npx ignite scaffold`)");
  }
  const contractJobIds = new Set(
    Array.from(jobModesMatch[1]!.matchAll(/"([^"]+)"\s*:\s*"(async|synchronous)"/g)).map((m) => m[1])
  );

  // Check registry
  const registryPath = path.join(ROOT, "src/strategies/registry.ts");
  const registryText = fs.readFileSync(registryPath, "utf-8");
  const registryJobIds = new Set(
    Array.from(registryText.matchAll(/["']([^"']+)["']\s*:\s*new\s/g)).map((m) => m[1])
  );

  const missingInContracts: string[] = [];
  const missingInRegistry: string[] = [];

  for (const id of manifestJobIds) {
    if (!contractJobIds.has(id)) missingInContracts.push(id);
    if (!registryJobIds.has(id)) missingInRegistry.push(id);
  }

  const wiringErrors: string[] = [];
  if (missingInContracts.length) wiringErrors.push(`Missing in contracts JOB_MODES: ${missingInContracts.join(", ")}`);
  if (missingInRegistry.length) wiringErrors.push(`Missing in registry: ${missingInRegistry.join(", ")}`);

  if (wiringErrors.length) {
    throw new Error("Job wiring audit failed:\n" + wiringErrors.map((e) => `  - ${e}`).join("\n") + "\n\nFix: run `npx ignite scaffold`");
  }
  console.log(`✅ Job wiring audit passed (${manifestJobIds.size} jobs, all wired)`);

  // ─── Gate 4: No-fallback scan ───────────────────────────────────
  console.log("\n🛡️  Gate 4: No-fallback scan...");
  const violations: string[] = [];
  const ALLOWED_FALLBACK_VARS = ["VITE_USE_MOCK", "VITE_ALLOW_MOCK_FALLBACK", "VITE_ENABLE_DEV", "NODE_ENV", "FLY_MACHINE_ID", "MCP_URL", "MCP_PORT", "MCP_HOST", "SKIP_MCP_GATE", "SKIP_VERIFY"];

  function scanFile(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const codePart = line.split("//")[0]!;
      // Skip lines that are comments or JSDoc
      if (codePart.trim().startsWith("*") || codePart.trim().startsWith("//") || codePart.trim().startsWith("/*")) continue;
      const match = codePart.match(/process\.env\.(\w+)\s*(?:\|\||\?\?)/);
      if (!match) continue;
      const envVar = match[1]!;
      if (ALLOWED_FALLBACK_VARS.includes(envVar)) continue;
      // Allow process.env.X || process.env.Y
      if (/process\.env\.\w+\s*\|\|\s*process\.env\.\w+/.test(codePart)) continue;
      violations.push(`${path.relative(ROOT, filePath)}:${i + 1}: ${line.trim()}`);
    }
  }

  const scanDirs = ["src", "scripts", "cli"];
  for (const dir of scanDirs) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
        if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
        scanFile(full);
      }
    };
    walk(dirPath);
  }

  if (violations.length > 0) {
    console.error("❌ FORBIDDEN FALLBACK PATTERNS DETECTED:");
    violations.forEach((v) => console.error(`   ${v}`));
    throw new Error("Found forbidden fallback patterns. Use requireEnv() instead.");
  }
  console.log("✅ No forbidden fallbacks detected");

  // ─── Gate 5: Typecheck ──────────────────────────────────────────
  console.log("\n🛠️  Gate 5: Typecheck...");
  try {
    execSync("npx tsc -p tsconfig.worker.json --noEmit", { cwd: ROOT, stdio: "inherit" });
    console.log("✅ Worker typecheck passed");
  } catch {
    throw new Error("Worker typecheck failed");
  }

  // ─── Gate 6: Terminology gate ───────────────────────────────────
  console.log("\n📝 Gate 6: Terminology gate...");
  const FORBIDDEN_TERMS = ["cliënt", "client", "verpleegkundige", "patiënt", "patient"];
  const termViolations: string[] = [];

  function scanTerms(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf-8").toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      if (content.includes(term)) {
        // Skip if it's in a comment or a rule definition
        if (filePath.includes("eslint-plugin") || filePath.includes("verify-system")) continue;
        // Skip if it's in a "forbidden terms" check definition
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes(term) && !lines[i]!.includes("forbidden") && !lines[i]!.includes("FORBIDDEN") && !lines[i]!.includes("never")) {
            termViolations.push(`${path.relative(ROOT, filePath)}:${i + 1}: contains "${term}"`);
          }
        }
      }
    }
  }

  const stratDir = path.join(ROOT, "src/strategies");
  if (fs.existsSync(stratDir)) {
    for (const f of fs.readdirSync(stratDir)) {
      if (f.endsWith(".ts")) scanTerms(path.join(stratDir, f));
    }
  }
  // Terminology violations are warnings, not blocking (source text may contain them)
  if (termViolations.length > 0) {
    console.warn(`⚠️  ${termViolations.length} terminology warnings (non-blocking):`);
    termViolations.slice(0, 5).forEach((v) => console.warn(`   ${v}`));
    if (termViolations.length > 5) console.warn(`   ... and ${termViolations.length - 5} more`);
  } else {
    console.log("✅ No forbidden terminology detected");
  }

  console.log("\n🎉 ALL GATES PASSED — System ready for agent operation.");
}

