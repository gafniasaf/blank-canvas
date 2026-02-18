import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PIPELINE_ROOT = path.resolve(__dirname, '..'); // .../new_pipeline
const REPO_ROOT = path.resolve(PIPELINE_ROOT, '..'); // repo root

export function loadEnv(opts?: { envFile?: string }): string | null {
  const candidates = [
    String(opts?.envFile || '').trim() || null,
    String(process.env.ENV_FILE || '').trim() || null,
    path.resolve(REPO_ROOT, '.env.local'),
    path.resolve(REPO_ROOT, '.env'),
    path.resolve(PIPELINE_ROOT, '.env.local'),
    path.resolve(PIPELINE_ROOT, '.env'),
  ].filter((x): x is string => !!x);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: false });
        return p;
      }
    } catch {
      // ignore
    }
  }
  return null;
}












