/**
 * generate_ai_images strategy
 *
 * Reads the figure manifest produced by generate_figures, calls Nano Banana Pro
 * (gemini-3-pro-image-preview via Google Gemini API) to generate real images
 * from the descriptions, then replaces the placeholder PNGs.
 *
 * Input:  figure manifest JSON (from generate_figures) + chapter canonical JSON
 * Output: AI-generated PNG images replacing placeholders (same paths)
 *
 * The canonical JSON is NOT modified — it already references the correct paths.
 * We also generate a real chapter opener image.
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadFile, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { requireEnv, sleep } from "../env.js";
import { withRetries } from "../llm.js";

// =============================================================================
// Types
// =============================================================================

interface FigureManifestEntry {
  figureNumber: string;
  caption: string;
  description: string;
  src: string;
  sectionNumber: string;
}

interface FigureManifest {
  bookId: string;
  chapter: number;
  generatedAt: string;
  figures: FigureManifestEntry[];
}

// =============================================================================
// Nano Banana Pro — Google Gemini 3 Pro Image Preview
// =============================================================================

/** Model ID on Google Generative Language API */
const IMAGE_MODEL = "gemini-3-pro-image-preview";

/** Base URL for the Gemini API */
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Style prefix added to every prompt for consistent textbook aesthetics */
const STYLE_PREFIX =
  "Clean, professional educational illustration for a Dutch MBO healthcare textbook. " +
  "Modern flat design style with soft, muted healthcare colors (blue, green, teal). " +
  "No text or labels in the image (captions are added separately). " +
  "White or very light background. Suitable for professional medical education. ";

const OPENER_STYLE_PREFIX =
  "Atmospheric, professional cover photo for a healthcare textbook chapter. " +
  "Soft, warm lighting. No text overlays. " +
  "Modern healthcare setting with a caring, human-centered mood. " +
  "Suitable as a full-page chapter opener background image. ";

/**
 * Generate an image using Nano Banana Pro (Gemini 3 Pro Image Preview).
 *
 * The Gemini API uses the `generateContent` endpoint with
 * `responseModalities: ["IMAGE"]` to produce images.
 *
 * Response structure:
 *   candidates[0].content.parts[*] — contains { inlineData: { mimeType, data } }
 */
async function generateImage(prompt: string): Promise<Buffer> {
  const apiKey = requireEnv("GEMINI_API_KEY");

  const url = `${GEMINI_API_BASE}/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000), // 3 min timeout
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Nano Banana Pro API error ${resp.status}: ${errText}`);
  }

  const json = (await resp.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }>;
      };
    }>;
    error?: { message: string; code: number };
  };

  if (json.error) {
    throw new Error(`Nano Banana Pro error: ${json.error.message} (code ${json.error.code})`);
  }

  // Find the first image part in the response
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data && p.inlineData?.mimeType?.startsWith("image/"));

  if (!imagePart?.inlineData?.data) {
    throw new Error("Nano Banana Pro response missing image data");
  }

  return Buffer.from(imagePart.inlineData.data, "base64");
}

// =============================================================================
// Strategy
// =============================================================================

export default class GenerateAiImages implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const versionId = job.input_artifacts.book_version_id || "v1";
    const chapterNum = job.chapter;
    if (chapterNum == null) throw new Error("BLOCKED: chapter is required for generate_ai_images");

    await emitJobEvent(job.id, job.book_id, "progress", 5, `Loading figure manifest for chapter ${chapterNum}`);

    // Load figure manifest
    const manifestPath = artifactPath(job.book_id, versionId, `figure_manifest_ch${chapterNum}.json`);
    let manifest: FigureManifest;
    try {
      manifest = await downloadJson<FigureManifest>(manifestPath);
    } catch (e) {
      console.warn(`[generate_ai_images] No manifest for ch${chapterNum}: ${e instanceof Error ? e.message : e}`);
      return { ok: true, chapter: chapterNum, skipped: true, reason: "no manifest" };
    }

    const figures = manifest.figures || [];
    if (figures.length === 0) {
      return { ok: true, chapter: chapterNum, skipped: true, reason: "no figures in manifest" };
    }

    // Import fs/path for local file saves
    const fs = await import("fs");
    const path = await import("path");
    const repoRoot = path.resolve(
      new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "../../.."
    );

    const bookTitle = job.input_artifacts.book_title || job.book_id;
    const bookSlug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    let generated = 0;
    let failed = 0;

    // =========================================================================
    // Step 1: Generate chapter opener image
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 10, "Generating chapter opener image");

    const chapterTitle = job.input_artifacts.chapter_title || `Hoofdstuk ${chapterNum}`;
    const openerPrompt = OPENER_STYLE_PREFIX +
      `Theme: "${chapterTitle}" in a Dutch healthcare education context. ` +
      "Show a relevant healthcare scenario or setting that relates to the chapter topic. " +
      "Portrait orientation (taller than wide).";

    try {
      const openerPng = await withRetries(`nanobanana-opener-ch${chapterNum}`, () =>
        generateImage(openerPrompt)
      , 3);

      // Save locally (same path as the placeholder)
      const localOpenerDir = path.resolve(repoRoot, "new_pipeline/assets/books", bookSlug, "chapter_openers");
      fs.mkdirSync(localOpenerDir, { recursive: true });
      const localOpenerPath = path.resolve(localOpenerDir, `chapter_${chapterNum}_opener.png`);
      fs.writeFileSync(localOpenerPath, openerPng);

      // Upload to Storage
      const openerStoragePath = artifactPath(
        job.book_id, versionId,
        `assets/chapter_openers/chapter_${chapterNum}_opener.png`
      );
      await uploadFile(openerStoragePath, openerPng, "image/png");

      console.log(`🍌 Chapter ${chapterNum} opener: AI-generated (${(openerPng.length / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (e) {
      console.warn(`⚠️ Chapter ${chapterNum} opener failed: ${e instanceof Error ? e.message : e}`);
      failed++;
    }

    // Rate limit between API calls
    await sleep(2000);

    // =========================================================================
    // Step 2: Generate in-text figure images
    // =========================================================================
    for (let i = 0; i < figures.length; i++) {
      const fig = figures[i];
      const progress = 15 + Math.round((i / figures.length) * 75);
      await emitJobEvent(job.id, job.book_id, "progress", progress,
        `Generating image ${fig.figureNumber} (${i + 1}/${figures.length})`);

      const prompt = STYLE_PREFIX + fig.description;

      try {
        const imgPng = await withRetries(`nanobanana-fig-${fig.figureNumber}`, () =>
          generateImage(prompt)
        , 3);

        // Save locally (overwrite placeholder)
        const localPath = path.resolve(repoRoot, fig.src);
        const localDir = path.dirname(localPath);
        fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(localPath, imgPng);

        // Upload to Storage
        const storagePath = artifactPath(
          job.book_id, versionId,
          `assets/figures/Afbeelding_${fig.figureNumber}.png`
        );
        await uploadFile(storagePath, imgPng, "image/png");

        console.log(`🖼️  Afbeelding ${fig.figureNumber}: AI-generated (${(imgPng.length / 1024).toFixed(0)} KB) — ${fig.caption.slice(0, 60)}`);
        generated++;
      } catch (e) {
        console.warn(`⚠️ Afbeelding ${fig.figureNumber} failed: ${e instanceof Error ? e.message : e}`);
        failed++;
        // Keep the placeholder — the book still renders correctly
      }

      // Rate limit between images
      if (i < figures.length - 1) {
        await sleep(3000);
      }
    }

    // =========================================================================
    // Step 3: Update manifest with generation status
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 95, "Saving generation results");

    const updatedManifest = {
      ...manifest,
      aiGenerated: true,
      aiGeneratedAt: new Date().toISOString(),
      aiModel: IMAGE_MODEL,
      stats: { generated, failed, total: figures.length + 1 },
    };

    try {
      const manifestBlob = new Blob([JSON.stringify(updatedManifest, null, 2)], { type: "application/json" });
      await uploadFile(manifestPath, manifestBlob, "application/json");
    } catch {
      // Best-effort manifest update
    }

    // Save locally too
    const localManifestPath = path.resolve(
      repoRoot, "new_pipeline/assets/figures", bookSlug,
      `figure_manifest_ch${chapterNum}.json`
    );
    try {
      fs.writeFileSync(localManifestPath, JSON.stringify(updatedManifest, null, 2));
    } catch {
      // Best-effort
    }

    console.log(`\n✅ Chapter ${chapterNum}: ${generated} images generated, ${failed} failed (Nano Banana Pro)`);

    return {
      ok: true,
      chapter: chapterNum,
      generated,
      failed,
      total: figures.length + 1, // figures + opener
      model: IMAGE_MODEL,
    };
  }
}
