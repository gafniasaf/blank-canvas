/**
 * render_chapter_pdf strategy
 *
 * Renders a canonical chapter JSON to PDF using Prince XML.
 * Then runs the validation suite (page-fill, column-balance, box-gaps, etc.)
 *
 * Ported from TestRun: new_pipeline/renderer/render-prince-pdf.ts
 * + new_pipeline/scripts/build-chapter.ts (validation calls)
 *
 * Input:  canonical chapter JSON
 * Output: PDF + HTML + Prince log (uploaded to Storage)
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadFile } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type { CanonicalBook } from "../schema/canonical.js";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function renderToHtml(canonical: CanonicalBook, cssPath: string): string {
  // Simplified HTML renderer — in production, this would use the full TestRun
  // render-prince-pdf.ts logic with Handlebars templates.
  const lines: string[] = [];
  lines.push("<!DOCTYPE html>");
  lines.push(`<html lang="nl"><head><meta charset="utf-8">`);
  lines.push(`<link rel="stylesheet" href="${cssPath}">`);
  lines.push(`<title>${canonical.meta.title}</title></head><body>`);

  for (const ch of canonical.chapters) {
    lines.push(`<section class="chapter" data-chapter="${ch.number}">`);
    lines.push(`<h1>Hoofdstuk ${ch.number} ${ch.title}</h1>`);

    for (const sec of ch.sections) {
      lines.push(`<section class="section" data-section="${sec.number}">`);
      lines.push(`<h2>${sec.number} ${sec.title ?? ""}</h2>`);

      for (const block of sec.content) {
        if (block.type === "paragraph") {
          lines.push(`<div class="paragraph" data-id="${block.id}">`);
          lines.push(`<p>${block.basis}</p>`);
          if (block.praktijk) {
            lines.push(`<div class="box-praktijk"><p class="box-label"><strong>In de praktijk:</strong></p><p>${block.praktijk}</p></div>`);
          }
          if (block.verdieping) {
            lines.push(`<div class="box-verdieping"><p class="box-label"><strong>Verdieping:</strong></p><p>${block.verdieping}</p></div>`);
          }
          lines.push("</div>");
        } else if (block.type === "list") {
          const tag = block.ordered ? "ol" : "ul";
          lines.push(`<${tag}>${block.items.map((i) => `<li>${i}</li>`).join("")}</${tag}>`);
        } else if (block.type === "steps") {
          lines.push(`<ol class="steps">${block.items.map((i) => `<li>${i}</li>`).join("")}</ol>`);
        } else if (block.type === "subparagraph") {
          lines.push(`<section class="subparagraph" data-number="${block.number}">`);
          lines.push(`<h3>${block.number} ${block.title ?? ""}</h3>`);
          for (const inner of block.content) {
            if (inner.type === "paragraph") {
              lines.push(`<p>${inner.basis}</p>`);
            }
          }
          lines.push("</section>");
        }
      }
      lines.push("</section>");
    }

    // Recap section
    if (ch.recap) {
      lines.push('<section class="chapter-recap">');
      if (ch.recap.objectives?.length) {
        lines.push("<h2>Leerdoelen</h2><ul>");
        for (const obj of ch.recap.objectives) lines.push(`<li>${obj.text}</li>`);
        lines.push("</ul>");
      }
      if (ch.recap.glossary?.length) {
        lines.push("<h2>Kernbegrippen</h2><dl>");
        for (const g of ch.recap.glossary) lines.push(`<dt>${g.term}</dt><dd>${g.definition}</dd>`);
        lines.push("</dl>");
      }
      if (ch.recap.selfCheckQuestions?.length) {
        lines.push("<h2>Zelftoets</h2><ol>");
        for (const q of ch.recap.selfCheckQuestions) lines.push(`<li>${q.question}</li>`);
        lines.push("</ol>");
      }
      lines.push("</section>");
    }

    lines.push("</section>");
  }

  lines.push("</body></html>");
  return lines.join("\n");
}

function runValidation(pdfPath: string, scriptDir: string): { passed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const scripts = [
    { name: "verify-page-fill.py", args: ["--min-used", "0.50", "--ignore-first", "2", "--ignore-last", "1", "--ignore-before-first-chapter"] },
    { name: "verify-column-balance.py", args: ["--ignore-first", "2", "--ignore-last", "1", "--ignore-before-first-chapter"] },
    { name: "verify-box-justify-gaps.py", args: ["--max-gap-pt", "12", "--ignore-first", "2"] },
  ];

  for (const script of scripts) {
    const fullPath = path.join(scriptDir, script.name);
    if (!fs.existsSync(fullPath)) {
      warnings.push(`Validation script not found: ${script.name} (skipped)`);
      continue;
    }
    const result = spawnSync("python3", [fullPath, pdfPath, ...script.args], {
      cwd: scriptDir,
      timeout: 60_000,
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      warnings.push(`${script.name}: ${result.stderr?.slice(0, 500) || "non-zero exit"}`);
    }
  }

  return { passed: warnings.length === 0, warnings };
}

export default class RenderChapterPdf implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const chapter = job.chapter;
    if (chapter == null) throw new Error("BLOCKED: chapter is required for render_chapter_pdf");

    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading canonical");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);

    // Create temp directory for rendering
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bookgen-render-"));
    const htmlPath = path.join(tmpDir, `ch${chapter}.html`);
    const pdfPath = path.join(tmpDir, `ch${chapter}.pdf`);
    const logPath = path.join(tmpDir, `ch${chapter}.prince.log`);

    try {
      await emitJobEvent(job.id, job.book_id, "progress", 25, "Generating HTML");

      // Use bundled CSS if available, otherwise minimal inline
      const cssPath = path.resolve(import.meta.dirname ?? ".", "../templates/prince-af-two-column.css");
      const html = renderToHtml(canonical, fs.existsSync(cssPath) ? cssPath : "");
      fs.writeFileSync(htmlPath, html, "utf-8");

      await emitJobEvent(job.id, job.book_id, "progress", 40, "Running Prince XML");

      // Run Prince
      const princeResult = spawnSync("prince", [htmlPath, "-o", pdfPath, "--log", logPath], {
        cwd: tmpDir,
        timeout: 120_000,
        encoding: "utf-8",
      });

      if (princeResult.status !== 0) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8").slice(0, 2000) : "";
        throw new Error(`Prince render failed (exit ${princeResult.status}): ${logContent || princeResult.stderr?.slice(0, 500)}`);
      }

      await emitJobEvent(job.id, job.book_id, "progress", 65, "Running validation suite");

      // Run validation scripts
      const validateDir = path.resolve(import.meta.dirname ?? ".", "../validate");
      const validation = runValidation(pdfPath, validateDir);

      if (validation.warnings.length > 0) {
        console.warn(`[render] Validation warnings for ch${chapter}:`, validation.warnings);
      }

      await emitJobEvent(job.id, job.book_id, "progress", 80, "Uploading artifacts");

      // Upload PDF + HTML + log to Storage
      const versionId = job.input_artifacts.book_version_id || "v1";
      const pdfStoragePath = `books/${job.book_id}/${versionId}/pdf/ch${chapter}.pdf`;
      const htmlStoragePath = `books/${job.book_id}/${versionId}/html/ch${chapter}.html`;

      const pdfBuffer = fs.readFileSync(pdfPath);
      await uploadFile(pdfStoragePath, Buffer.from(pdfBuffer), "application/pdf");

      const htmlContent = fs.readFileSync(htmlPath);
      await uploadFile(htmlStoragePath, Buffer.from(htmlContent), "text/html");

      return {
        ok: true,
        pdfPath: pdfStoragePath,
        htmlPath: htmlStoragePath,
        validationPassed: validation.passed,
        validationWarnings: validation.warnings,
      };
    } finally {
      // Cleanup temp files
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

