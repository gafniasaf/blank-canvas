/**
 * CLI: Enqueue the full A&F N4 book pipeline.
 *
 * Uses inject_existing_figures instead of generate_figures + generate_ai_images,
 * since the A&F book already has 258 extracted InDesign figures.
 *
 * Usage:
 *   npx tsx cli/_enqueue-af4.ts [--model anthropic:claude-sonnet-4-5-20250929]
 */
import { adminSupabase } from "../src/supabase.js";
import "../src/env.js";

const BOOK_ID = "MBO_AF4_2024";
const VERSION_ID = "v1";
const CHAPTERS = Array.from({ length: 14 }, (_, i) => i + 1); // 1..14

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

async function main() {
  const model = getArg("--model") || "anthropic:claude-sonnet-4-5-20250929";
  const microheadingDensity = getArg("--microheading-density") || "medium";

  console.log(`\n📚 Enqueuing A&F N4 pipeline`);
  console.log(`   Book: ${BOOK_ID}`);
  console.log(`   Chapters: ${CHAPTERS.join(", ")}`);
  console.log(`   Model: ${model}`);
  console.log(`   Mode: inject_existing_figures (keep InDesign images)\n`);

  const jobSpecs: JobSpec[] = [];
  const jobIds = new Map<string, string>();
  const key = (step: string, ch: number | null) => `${step}:${ch ?? "all"}`;

  // ─── Per-chapter jobs ────────────────────────────────────────────────
  for (const ch of CHAPTERS) {
    const base = {
      model,
      book_version_id: VERSION_ID,
      microheading_density: microheadingDensity,
      book_slug: "af4",
    };

    // 1. extract_skeleton
    jobSpecs.push({
      step: "extract_skeleton",
      chapter: ch,
      section: null,
      priority: 100,
      dependsOnSteps: [],
      inputArtifacts: {
        ...base,
        canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_ch${ch}.json`,
      },
    });

    // 2. generate_section
    jobSpecs.push({
      step: "generate_section",
      chapter: ch,
      section: `${ch}.1`,
      priority: 90,
      dependsOnSteps: [{ step: "extract_skeleton", chapter: ch }],
      inputArtifacts: {
        ...base,
        skeleton_json: `books/${BOOK_ID}/${VERSION_ID}/skeleton_ch${ch}.json`,
      },
    });

    // 3. assemble_chapter
    jobSpecs.push({
      step: "assemble_chapter",
      chapter: ch,
      section: null,
      priority: 80,
      dependsOnSteps: [{ step: "generate_section", chapter: ch }],
      inputArtifacts: {
        ...base,
        skeleton_json: `books/${BOOK_ID}/${VERSION_ID}/skeleton_ch${ch}.json`,
      },
    });

    // 4. inject_existing_figures (replaces generate_figures + generate_ai_images)
    jobSpecs.push({
      step: "inject_existing_figures",
      chapter: ch,
      section: null,
      priority: 75,
      dependsOnSteps: [{ step: "assemble_chapter", chapter: ch }],
      inputArtifacts: {
        ...base,
        canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_ch${ch}.json`,
        figure_manifest: `books/${BOOK_ID}/${VERSION_ID}/af4_figure_manifest.json`,
      },
    });

    // 5. generate_chapter_recap
    jobSpecs.push({
      step: "generate_chapter_recap",
      chapter: ch,
      section: null,
      priority: 73,
      dependsOnSteps: [{ step: "generate_section", chapter: ch }],
      inputArtifacts: {
        ...base,
        skeleton_json: `books/${BOOK_ID}/${VERSION_ID}/skeleton_ch${ch}.json`,
      },
    });

    // 6. apply_errata (depends on both inject_existing_figures and generate_chapter_recap)
    jobSpecs.push({
      step: "apply_errata",
      chapter: ch,
      section: null,
      priority: 70,
      dependsOnSteps: [
        { step: "inject_existing_figures", chapter: ch },
        { step: "generate_chapter_recap", chapter: ch },
      ],
      inputArtifacts: {
        ...base,
        canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_ch${ch}.json`,
      },
    });

    // 7. apply_microfix
    jobSpecs.push({
      step: "apply_microfix",
      chapter: ch,
      section: null,
      priority: 65,
      dependsOnSteps: [{ step: "apply_errata", chapter: ch }],
      inputArtifacts: {
        ...base,
        canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_ch${ch}.json`,
      },
    });

    // 8. render_chapter_pdf
    jobSpecs.push({
      step: "render_chapter_pdf",
      chapter: ch,
      section: null,
      priority: 60,
      dependsOnSteps: [{ step: "apply_microfix", chapter: ch }],
      inputArtifacts: {
        ...base,
        canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_ch${ch}.json`,
      },
    });
  }

  // ─── Book-level jobs ─────────────────────────────────────────────────
  const allRenderDeps = CHAPTERS.map((ch) => ({
    step: "render_chapter_pdf",
    chapter: ch,
  }));

  jobSpecs.push({
    step: "assemble_book",
    chapter: null,
    section: null,
    priority: 50,
    dependsOnSteps: allRenderDeps,
    inputArtifacts: { model, book_version_id: VERSION_ID },
  });

  jobSpecs.push({
    step: "generate_index",
    chapter: null,
    section: null,
    priority: 40,
    dependsOnSteps: [{ step: "assemble_book", chapter: null }],
    inputArtifacts: {
      model,
      book_version_id: VERSION_ID,
      canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_book.json`,
    },
  });

  jobSpecs.push({
    step: "generate_glossary",
    chapter: null,
    section: null,
    priority: 40,
    dependsOnSteps: [{ step: "assemble_book", chapter: null }],
    inputArtifacts: {
      model,
      book_version_id: VERSION_ID,
      canonical_json: `books/${BOOK_ID}/${VERSION_ID}/canonical_book.json`,
    },
  });

  // ─── Insert in two passes ────────────────────────────────────────────
  console.log(`Creating ${jobSpecs.length} pipeline jobs...\n`);

  for (const spec of jobSpecs) {
    const { data, error } = await adminSupabase()
      .from("pipeline_jobs")
      .insert({
        book_id: BOOK_ID,
        chapter: spec.chapter,
        section: spec.section,
        step: spec.step,
        status: "pending",
        priority: spec.priority,
        input_artifacts: spec.inputArtifacts,
        depends_on: [],
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error(`❌ Failed to insert ${spec.step} ch${spec.chapter}:`, error?.message);
      process.exit(1);
    }
    jobIds.set(key(spec.step, spec.chapter), data.id);

    const label = spec.chapter ? `ch${spec.chapter}` : "book";
    process.stdout.write(`   ✅ ${spec.step.padEnd(28)} ${label}\n`);
  }

  // Second pass: resolve depends_on UUIDs
  let depsUpdated = 0;
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
      depsUpdated++;
    }
  }

  console.log(`\n✅ Enqueued ${jobSpecs.length} jobs (${depsUpdated} dependency links resolved)`);
  console.log(`\n   Per-chapter: extract_skeleton → generate_section → assemble_chapter → inject_existing_figures → recap → errata → microfix → render`);
  console.log(`   Book-level:  assemble_book → generate_index + generate_glossary`);
  console.log(`\n   Start worker: cd bookgen && npx tsx src/runner.ts`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

