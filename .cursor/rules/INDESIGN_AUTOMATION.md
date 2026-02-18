---
description: Legacy rules for the InDesign/TestRun automation pipeline. Current default workflow is Prince-first; InDesign gates apply only if we run InDesign again.
globs:
  - "**/*"
---

## Source of truth (numbering + topics)
- **Multi-book source of truth (for scaling to 12 books)**: `books/manifest.json`
  - Each book declares its canonical N4 source INDD + canonical IDML snapshot + baseline INDD + template profile.
- **Canonical numbering/topic backbone**: the original A&F N4 book INDD in Downloads  
  `/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd`
- **Canonical snapshot**: export IDML from the Downloads INDD (for deterministic checks)  
  `./_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml` via `export-n4-idml-from-downloads.jsx`
- **InDesign apply input**: `~/Desktop/rewrites_for_indesign.json`

## Current default (Prince-first)
- We are **not using InDesign apply** in the current workflow.
- Rewrite scripts default to `--mode prince` (bullets are a didactic choice; semicolon item-count parity is not enforced).
- Use `--mode indesign` only if you intentionally return to deterministic InDesign apply.

## Hard gates (current workflow; do not skip)
- **Numbering/subparagraph gate** (N4 backbone): `scripts/verify-json-numbering-vs-n4.py` must pass for the rewrite JSON.
  - JSON must include `subparagraph_number` (even if `null`).
- **JSON structural preflight**: `npm run preflight:json -- <json>` must pass (no `\\r`, Option A, safe layer placement, etc).
- **Prince layout validation suite** (student PDFs): run the standardized suite in `new_pipeline/` on the newest rendered PDF.
  - Chapter: `cd new_pipeline && npm run build:chapter -- --upload <UUID> --chapter <N> [--figures <figures.json>] [--rewrites <FINAL.json>]`
  - Whole book: `cd new_pipeline && npm run build:book -- --upload <UUID> --chapters 1,2,3,... [--figures <figures_all.json>] [--rewrites <FINAL.json>]`

## Terminology (student-facing; non-negotiable)
- Use **“zorgvrager”** (never cliënt/client).
- Use **“zorgprofessional”** (never verpleegkundige).

## Output target (current default)
- We generate **student-facing PDFs** via `new_pipeline/` (Prince).
- **No teacher PDFs** (no KD appendix) are produced in the default workflow for now.

## InDesign safety rules
- Never save/modify baseline INDDs. Always `saveACopy` and work on the copy.
- Always hard-gate `app.activeDocument` before making changes.
- Post-pass scripts must operate on the newest output in `~/Desktop/Generated_Books/`.

## Legacy (only if using InDesign apply again)
- **Coverage gate**: `scripts/verify-json-coverage.ts` must pass on `~/Desktop/rewrite_v5_safe_json_coverage.tsv`.
  - Any section with ~0% coverage is a **hard failure**.
- **Applied-rewrites proof gate**: `scripts/verify-applied-rewrites.ts` must pass on the newest run’s `rewrite_v5_safe_replaced_detailed_final.tsv`.
  - **Fuzzy matches are forbidden** (hard-fail) to prevent silent paragraph misplacements.
- **InDesign layout validation**: `run-ch1-validation-suite-latest.jsx` must pass on the newest rewritten INDD.

## Content formatting rules (Option A)
- Only Option A headings:
  - `\n\n<<BOLD_START>>In de praktijk:<<BOLD_END>> <inline text…>`
  - `\n\n<<BOLD_START>>Verdieping:<<BOLD_END>> <inline text…>`
- After the colon, start lowercase **except** abbreviation-like tokens (DNA/AB0/ATP…).
- **Layer placement** (praktijk/verdieping):
  - Never place layers inside list-intro paragraphs ending with `:` when followed by bullet runs.
  - Preferred host is the last safe body paragraph of the subparagraph **after** any bullet run.
- **2-column bullet hygiene**:
  - No nested bullet levels in the main body text (flatten nested bullets).
  - Convert “explanatory bullets” (long/multi-sentence) into normal body paragraphs for better reading flow.
  - Post-pass: `normalize-bullets-chapter.jsx`
  - Hard gate: `scan-nested-bullets.jsx` (part of `run-chapter-validation-suite-latest.jsx`)
- Remove soft hyphens U+00AD from body text.
- Body paragraphs: `LEFT_JUSTIFIED` (justify with last line left); avoid `FULLY_JUSTIFIED` (justify-all); single-word justification left.

## KD 2025 scope (WIP)
- Target teaching context: **KD 2025** (zorg domain: Verzorgende IG / MBO Verpleegkundige).
- Repo note: we store the **KD 2025 workprocess codes/titles** in `docs/kd/kd_2025_workprocesses.json`, but we do **not** have the full KD text/definitions or a validated section→KD mapping yet; do **not** claim KD coverage.
- Context: `docs/KD_2025_CONTEXT.md`
- Planned KD mapping approach: `docs/kd/README.md`

## Optional (recommended): LLM reviewer auto-fix
- Run `npm run review:json -- <FIXED_DRAFT.json> <LLM_REVIEWED.json> [--chapter N]` before promotion/apply.
- Safe-only: move/drop existing praktijk/verdieping blocks within the same section; never touch `original`.

## Optional: LLM iterative loop (write → check → repair)
- Run `npm run iterate:json -- <IN.json> <OUT.json> --mode prince --chapter N --provider anthropic --model claude-opus-4-5-20251101 --max-iters 5 --target-score 100`
- “100%” means: preflight is green (0 structural errors) and LLM checker reports score ≥ target-score with 0 critical issues.

## When to update these rules
Update this file **immediately** if any of these change:
- Canonical source path(s) (Downloads INDD, exported IDML location)
- JSON schema / required fields
- Validation scripts, thresholds, or pass/fail criteria
- Chapter splitting/baseline generation strategy

See `docs/CURSOR_RULES.md` for the update policy and change-control checklist.


