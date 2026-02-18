#!/usr/bin/env node
/**
 * BookGen Ignite CLI
 *
 * Commands:
 *   npx ignite verify   — Run full system verification (all gates)
 *   npx ignite scaffold — Regenerate contracts + registry from manifest
 *   npx ignite test     — Run tests
 *   npx ignite deploy   — Deploy worker to Fly.io
 */

import { spawnSync } from "node:child_process";
import { verifySystem } from "./lib/verify-system.js";
import { scaffoldManifest } from "./lib/scaffold-system.js";

const COMMANDS: Record<string, string> = {
  verify: "Run full system verification (all gates)",
  scaffold: "Regenerate contracts + registry from manifest",
  test: "Run tests",
  deploy: "Deploy worker to Fly.io",
};

function run(cmd: string, args: string[]) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help") {
    console.log("\n🔥 BookGen Ignite CLI\n");
    Object.entries(COMMANDS).forEach(([c, d]) => console.log(`  ${c.padEnd(12)} ${d}`));
    return;
  }

  try {
    if (command === "verify") {
      await verifySystem();
    } else if (command === "scaffold") {
      await scaffoldManifest();
    } else if (command === "test") {
      run("npx", ["tsc", "-p", "tsconfig.worker.json", "--noEmit"]);
    } else if (command === "deploy") {
      run("fly", ["deploy"]);
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Command failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

