/**
 * Temp: Prepare A&F N4 book for pipeline.
 *
 * 1. Reads the existing full canonical JSON
 * 2. Splits into per-chapter JSONs
 * 3. Uploads each to Supabase storage at books/MBO_AF4_2024/v1/canonical_ch{N}.json
 * 4. Uploads the existing figure manifest
 * 5. Cleans up stale jobs
 */
import "../src/env.js";
import { uploadJson, artifactPath } from "../src/storage.js";
import { adminSupabase } from "../src/supabase.js";
import * as fs from "fs";
import * as path from "path";

const BOOK_ID = "MBO_AF4_2024";
const VERSION_ID = "v1";

const repoRoot = path.resolve(
  new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  "../.."
);

async function main() {
  // ─── 1. Load the existing canonical JSON ─────────────────────────────
  const canonicalPath = path.resolve(
    repoRoot,
    "new_pipeline/output/_canonical_jsons_all/MBO_AF4_2024_COMMON_CORE__canonical_book_with_figures.json"
  );
  console.log(`📖 Loading canonical: ${canonicalPath}`);
  const book = JSON.parse(fs.readFileSync(canonicalPath, "utf-8"));
  const chapters = book.chapters || [];
  console.log(`   Title: ${book.meta?.title}`);
  console.log(`   Chapters: ${chapters.length}`);

  // ─── 2. Split into per-chapter JSONs and upload ──────────────────────
  for (const ch of chapters) {
    const chNum = ch.number || ch.chapterNumber;
    if (!chNum) {
      console.warn(`   ⚠️ Skipping chapter with no number:`, ch.title);
      continue;
    }

    // Wrap as a single-chapter canonical book (same format extract_skeleton expects)
    const perChapterCanonical = {
      meta: book.meta,
      chapters: [ch],
      export: book.export,
    };

    const storagePath = artifactPath(BOOK_ID, VERSION_ID, `canonical_ch${chNum}.json`);
    await uploadJson(storagePath, perChapterCanonical);
    const sectionCount = ch.sections?.length || 0;
    console.log(`   ✅ Ch ${chNum} → ${storagePath} (${sectionCount} sections)`);
  }

  // ─── 3. Upload existing figure manifest ──────────────────────────────
  const manifestPath = path.resolve(repoRoot, "new_pipeline/extract/af4_figure_manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const figManifestStorage = artifactPath(BOOK_ID, VERSION_ID, "af4_figure_manifest.json");
  await uploadJson(figManifestStorage, manifest);
  console.log(`\n   ✅ Figure manifest → ${figManifestStorage} (${manifest.figures?.length || 0} figures)`);

  // ─── 4. Clean up stale jobs ──────────────────────────────────────────
  const { data: staleJobs, error: staleErr } = await adminSupabase()
    .from("pipeline_jobs")
    .select("id, step, chapter, status")
    .eq("book_id", BOOK_ID);

  if (staleErr) {
    console.error("Failed to query stale jobs:", staleErr.message);
  } else if (staleJobs && staleJobs.length > 0) {
    console.log(`\n🧹 Found ${staleJobs.length} existing jobs for ${BOOK_ID}:`);
    for (const j of staleJobs) {
      console.log(`   ch${j.chapter} ${j.step} [${j.status}] → deleting`);
    }
    const ids = staleJobs.map((j: any) => j.id);
    const { error: delErr } = await adminSupabase()
      .from("pipeline_jobs")
      .delete()
      .in("id", ids);
    if (delErr) {
      console.error("   ❌ Delete failed:", delErr.message);
    } else {
      console.log(`   ✅ Deleted ${ids.length} stale jobs`);
    }
  } else {
    console.log("\n   ✅ No stale jobs to clean up");
  }

  console.log("\n✅ Preparation complete. Ready to enqueue pipeline.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

