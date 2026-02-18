import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

export async function verifyHandler(_params: Record<string, unknown>) {
  try {
    const output = execSync("npx tsx scripts/ignite.ts verify", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    });
    return { ok: true, output };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? "", error: err.message ?? String(e) };
  }
}

