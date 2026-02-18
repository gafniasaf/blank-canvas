/**
 * CLI: Enqueue a book generation pipeline.
 *
 * Creates the full DAG of pipeline_jobs for a book.
 *
 * Usage:
 *   npx tsx cli/enqueue.ts --book-id MBO_AF4_2024 --chapters 1,2,3 --model anthropic:claude-sonnet-4-5-20250929
 */

import { adminSupabase } from "../src/supabase.js";
import "../src/env.js"; // load .env

type Step = string;

interface JobSpec {
  step: Step;
  chapter: number | null;
  section: string | null;
  priority: number;
  dependsOnSteps: { step: Step; chapter: number | null }[];
  inputArtifacts: Record<string, string>;
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function parseChapters(csv: string | null): number[] {
  if (!csv) return [];
  return csv.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

async function main() {
  const bookId = getArg("--book-id");
  const chaptersArg = getArg("--chapters");
  const model = getArg("--model") || "anthropic:claude-sonnet-4-5-20250929";
  const versionId = getArg("--version-id") || "v1";
  const microheadingDensity = getArg("--microheading-density") || "medium";

  if (!bookId) {
    console.error("Usage: npx tsx cli/enqueue.ts --book-id <ID> --chapters 1,2,3 [--model provider:model] [--version-id v1]");
    process.exit(1);
  }

  const chapters = parseChapters(chaptersArg);
  if (chapters.length === 0) {
    // Try to load chapters from book_registry
    const { data } = await adminSupabase().from("book_registry").select("chapters").eq("book_id", bookId).single();
    if (data?.chapters?.length) {
      chapters.push(...data.chapters);
    } else {
      console.error("No chapters specified and none found in book_registry.");
      process.exit(1);
    }
  }

  console.log(`Enqueuing pipeline for book=${bookId}, chapters=${chapters.join(",")}, model=${model}`);

  const jobSpecs: JobSpec[] = [];
  const jobIds: Map<string, string> = new Map(); // "step:chapter" -> job UUID

  // Helper to build a job key
  const key = (step: string, ch: number | null) => `${step}:${ch ?? "all"}`;

  // Per-chapter jobs
  for (const ch of chapters) {
    const baseArtifacts = { model, book_version_id: versionId, microheading_density: microheadingDensity };

    jobSpecs.push({
      step: "extract_skeleton",
      chapter: ch,
      section: null,
      priority: 100,
      dependsOnSteps: [],
      inputArtifacts: { ...baseArtifacts, canonical_json: `books/${bookId}/${versionId}/canonical_ch${ch}.json` },
    });

    // For simplicity, generate all sections as a single job (can be split later)
    jobSpecs.push({
      step: "generate_section",
      chapter: ch,
      section: `${ch}.1`, // Will iterate through all sections
      priority: 90,
      dependsOnSteps: [{ step: "extract_skeleton", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, skeleton_json: `books/${bookId}/${versionId}/skeleton_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "assemble_chapter",
      chapter: ch,
      section: null,
      priority: 80,
      dependsOnSteps: [{ step: "generate_section", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, skeleton_json: `books/${bookId}/${versionId}/skeleton_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "generate_chapter_recap",
      chapter: ch,
      section: null,
      priority: 75,
      dependsOnSteps: [{ step: "generate_section", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, skeleton_json: `books/${bookId}/${versionId}/skeleton_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "generate_figures",
      chapter: ch,
      section: null,
      priority: 72,
      dependsOnSteps: [{ step: "assemble_chapter", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, canonical_json: `books/${bookId}/${versionId}/canonical_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "generate_ai_images",
      chapter: ch,
      section: null,
      priority: 71, // After generate_figures, before apply_errata
      dependsOnSteps: [{ step: "generate_figures", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, canonical_json: `books/${bookId}/${versionId}/canonical_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "apply_errata",
      chapter: ch,
      section: null,
      priority: 70,
      dependsOnSteps: [{ step: "generate_ai_images", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, canonical_json: `books/${bookId}/${versionId}/canonical_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "apply_microfix",
      chapter: ch,
      section: null,
      priority: 65,
      dependsOnSteps: [{ step: "apply_errata", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, canonical_json: `books/${bookId}/${versionId}/canonical_ch${ch}.json` },
    });

    jobSpecs.push({
      step: "render_chapter_pdf",
      chapter: ch,
      section: null,
      priority: 60,
      dependsOnSteps: [{ step: "apply_microfix", chapter: ch }],
      inputArtifacts: { ...baseArtifacts, canonical_json: `books/${bookId}/${versionId}/canonical_ch${ch}.json` },
    });
  }

  // Book-level jobs (depend on ALL chapter jobs completing)
  const allChapterRenderDeps = chapters.map((ch) => ({ step: "render_chapter_pdf", chapter: ch }));

  jobSpecs.push({
    step: "assemble_book",
    chapter: null,
    section: null,
    priority: 50,
    dependsOnSteps: allChapterRenderDeps,
    inputArtifacts: { model, book_version_id: versionId },
  });

  jobSpecs.push({
    step: "generate_index",
    chapter: null,
    section: null,
    priority: 40,
    dependsOnSteps: [{ step: "assemble_book", chapter: null }],
    inputArtifacts: { model, book_version_id: versionId, canonical_json: `books/${bookId}/${versionId}/canonical_book.json` },
  });

  jobSpecs.push({
    step: "generate_glossary",
    chapter: null,
    section: null,
    priority: 40,
    dependsOnSteps: [{ step: "assemble_book", chapter: null }],
    inputArtifacts: { model, book_version_id: versionId, canonical_json: `books/${bookId}/${versionId}/canonical_book.json` },
  });

  // Insert jobs in two passes: first without depends_on, then update with resolved UUIDs
  console.log(`Creating ${jobSpecs.length} pipeline jobs...`);

  for (const spec of jobSpecs) {
    const { data, error } = await adminSupabase()
      .from("pipeline_jobs")
      .insert({
        book_id: bookId,
        chapter: spec.chapter,
        section: spec.section,
        step: spec.step,
        status: "pending",
        priority: spec.priority,
        input_artifacts: spec.inputArtifacts,
        depends_on: [], // will update after all inserted
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error(`Failed to insert job ${spec.step} ch${spec.chapter}:`, error?.message);
      process.exit(1);
    }
    jobIds.set(key(spec.step, spec.chapter), data.id);
  }

  // Second pass: resolve depends_on UUIDs
  for (const spec of jobSpecs) {
    if (spec.dependsOnSteps.length === 0) continue;

    const myId = jobIds.get(key(spec.step, spec.chapter));
    const depIds = spec.dependsOnSteps
      .map((d) => jobIds.get(key(d.step, d.chapter)))
      .filter((id): id is string => !!id);

    if (depIds.length > 0 && myId) {
      await adminSupabase()
        .from("pipeline_jobs")
        .update({ depends_on: depIds })
        .eq("id", myId);
    }
  }

  console.log(`\n✅ Enqueued ${jobSpecs.length} jobs for book ${bookId}:`);
  console.log(`   Chapters: ${chapters.join(", ")}`);
  console.log(`   Model: ${model}`);
  console.log(`   Per-chapter steps: extract_skeleton → generate_section → assemble → figures → recap → errata → microfix → render`);
  console.log(`   Book-level steps: assemble_book → generate_index + generate_glossary`);
  console.log(`\n   Workers will pick up jobs automatically.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

