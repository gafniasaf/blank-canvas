import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_PATH = path.resolve(__dirname, "../../../src/lib/contracts.ts");

export async function contractsSnapshotHandler(_params: Record<string, unknown>) {
  if (!fs.existsSync(CONTRACTS_PATH)) {
    throw new Error("contracts.ts not found. Run `npx ignite scaffold` first.");
  }
  const content = fs.readFileSync(CONTRACTS_PATH, "utf-8");
  return { path: CONTRACTS_PATH, size: content.length, content };
}

