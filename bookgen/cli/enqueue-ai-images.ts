/**
 * CLI: Enqueue only generate_ai_images jobs for existing book.
 *
 * Uploads figure manifests to storage, then creates pipeline_jobs.
 *
 * Usage:
 *   npx tsx cli/enqueue-ai-images.ts --book-id test_gezondheid_welzijn_n3 --chapters 1,2,3
 */

import "../src/env.js";
import { adminSupabase } from "../src/supabase.js";
import { uploadJson, artifactPath } from "../src/storage.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const bookId = getArg("--book-id") || "test_gezondheid_welzijn_n3";
  const chaptersArg = getArg("--chapters") || "1,2,3";
  const versionId = getArg("--version-id") || "v1";
  const manifestDir = getArg("--manifest-dir") ||
    path.resolve(__dirname, "../../new_pipeline/assets/figures/gezondheid_en_welzijn_voor_het_mbo");

  const chapters = chaptersArg.split(",").map(Number).filter(n => n > 0);

  console.log(`\n🎨 Enqueuing generate_ai_images for book=${bookId}, chapters=${chapters.join(",")}`);
  console.log(`   Manifest dir: ${manifestDir}\n`);

  // ─── Step 1: Upload manifests to Supabase storage ──────────────────────────
  for (const ch of chapters) {
    const localPath = path.resolve(manifestDir, `figure_manifest_ch${ch}.json`);
    if (!fs.existsSync(localPath)) {
      console.error(`❌ Missing manifest: ${localPath}`);
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(localPath, "utf-8"));
    const storagePath = artifactPath(bookId, versionId, `figure_manifest_ch${ch}.json`);
    await uploadJson(storagePath, manifest);
    console.log(`  ✅ Uploaded manifest ch${ch} → ${storagePath} (${manifest.figures?.length ?? 0} figures)`);
  }

  // ─── Step 2: Enqueue pipeline_jobs ─────────────────────────────────────────
  const jobIds: Map<string, string> = new Map();

  for (const ch of chapters) {
    const { data, error } = await adminSupabase()
      .from("pipeline_jobs")
      .insert({
        book_id: bookId,
        chapter: ch,
        section: null,
        step: "generate_ai_images",
        status: "pending",
        priority: 71,
        input_artifacts: {
          model: "gpt-image-1.5",
          book_version_id: versionId,
          book_title: "Gezondheid en welzijn voor het MBO",
        },
        depends_on: [],
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error(`❌ Failed to insert job ch${ch}:`, error?.message);
      process.exit(1);
    }

    jobIds.set(`ch${ch}`, data.id);
    console.log(`  📋 Job ch${ch}: ${data.id}`);
  }

  console.log(`\n✅ Enqueued ${chapters.length} generate_ai_images jobs.`);
  console.log(`   Job IDs: ${[...jobIds.values()].join(", ")}`);
  console.log(`\n   Start the worker:  npm run dev:worker`);
  console.log(`   Monitor progress in Supabase dashboard or run:`);
  console.log(`   npx tsx cli/monitor-jobs.ts --book-id ${bookId} --step generate_ai_images\n`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});

