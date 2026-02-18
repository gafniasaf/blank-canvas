# Robust InDesign Automation Plan — **Legacy / apply-only**

**Important (current default workflow):**
- We are **Prince-first** (student PDFs via `new_pipeline/`), and we are **not running InDesign apply** by default.
- Keep this document as the reference **only** for the day we intentionally return to InDesign apply + proof gates.
  - Current pipeline docs: `docs/JSON_FIRST_WORKFLOW_FOR_LLM_AGENT.md` + `docs/PRINCE_LAYOUT_RULES.md`

## 1. Goal
**Zero-Trust Validation**: Ensure the final InDesign output matches the input JSON content 100% (or strictly explicitly handled exceptions), with no layout regressions (overset, boundary leaks, missing frames).

## 2. Core Philosophy (Lessons Learned)
1.  **Layout Valid != Content Valid**: A "green" layout check does not mean the book is correct. We must verify that *content* was actually applied.
2.  **JSON is Source of Truth**: If the JSON says "rewrite this," and InDesign doesn't change, that is a failure.
3.  **Isolation**: Process chapters in separate files to prevent boundary leaks physically.
4.  **Deterministic Targeting**: Never rely on `app.activeDocument` heuristics; always open specific file paths.
5.  **Strict Option A**: "In de praktijk" / "Verdieping" headings must follow the strict `\n\nLabel: Text` structure.
6.  **N4 Backbone Is Canonical**: Chapter/paragraph/subparagraph numbering is **always** taken from the original A&F N4 book (Downloads). The basisboek adapts text, not the numbering/topic spine.

## 3. The "Robust" Pipeline Steps

### Step 0: Canonical Numbering Backbone (NEW)
*   **Action**: Export an IDML snapshot directly from the original N4 A&F INDD in Downloads and use it as the numbering ground truth.
*   **Scripts**:
    *   `export-n4-idml-from-downloads.jsx` → produces `.../_source_exports/...__FROM_DOWNLOADS.idml`
    *   `scripts/verify-json-numbering-vs-n4.py` → hard-fails if JSON numbering keys don’t exist in the N4 source
*   **Rules**:
    *   JSON must include `subparagraph_number` (even if `null`) so we can audit 1.1.1 vs 1.1.2 etc.

### Step 1: Isolation (Pre-Processing)
*   **Action**: Generate a `_CH<N>_ONLY_BASELINE.indd` for the target chapter.
*   **Logic**:
    *   Trim all pages belonging to other chapters.
    *   **Truncate the body story** at the next chapter marker (e.g., `^2`) to prevent hidden overset text from future chapters.
    *   **Repair Structure**: Insert missing column frames (e.g., the "missing right column" bug) *before* rewriting.
    *   **Elasticity**: Add extra blank pages to the end if the story overflows.

### Step 2: Content Application (Rewriting)
*   **Action**: Run `rewrite-from-original-safe-v5.jsx`.
*   **Enhancements**:
    *   **Coverage Logging**: Produce `json_coverage.tsv` (mapping every JSON ID to a used/unused status).
    *   **Detailed Trace**: Produce `replaced_detailed.tsv` (mapping every InDesign change to a JSON ID).
    *   **Scope Guard**: Ensure `chapter_filter` strictly limits edits to the target page range.

### Step 3: Layout Post-Processing
*   **Action**: Run `fix-praktijk-verdieping-headings.jsx` and `remove-soft-hyphens-ch1.jsx`.
*   **Enhancements**:
    *   Normalize all "In de praktijk" variants (case-insensitive, line-start) to strict Option A (`\n\nIn de praktijk: `).
    *   Remove invisible artifacts (U+00AD).

### Step 4: The "Golden Gate" Validation (NEW)
*   **Action**: Run `verify-json-coverage.ts` (or `.js`).
*   **Logic**:
    *   Read `json_coverage.tsv`.
    *   **FAIL** if any `paragraph_number` group (e.g., "1.4") has 0% coverage.
    *   **FAIL** if total coverage < 95% (configurable).
    *   **FAIL** if critical styles (e.g., `•Basis`) are skipped.
    *   Report exactly *which* sections are missing so humans can fix the JSON or the Baseline.

### Step 5: Layout Validation
*   **Action**: Run `run-ch1-validation-suite-latest.jsx`.
*   **Checks**:
    *   **Overset**: 0 allowed.
    *   **Boundary**: No text on opener images.
    *   **Columns**: No missing body frames.
    *   **Headings**: Strict Option A structure (bold, colon, blank line).
    *   **Typography**: No ragged-right paragraphs in body.

## 4. Immediate Action Plan (CH1 Specific)

1.  **Diagnose Section 1.4 Failure**:
    *   We know 1.4 exists on page 27 (offset 45).
    *   We know 1.4 JSON entries were *not* applied.
    *   *Task*: Compare the text on page 27 against the JSON `original` text for 1.4 to find the mismatch (likely bullets vs. paragraph differences).
2.  **Fix Matching**:
    *   If segmentation differs (INDD has 1 paragraph, JSON has 5 bullets), update `rewrites_for_indesign.json` to match the INDD structure (or vice versa).
3.  **Implement Coverage Gate**:
    *   Write the `verify-json-coverage` script to hard-fail the pipeline if 1.4 is missing.

## 5. Deliverables
*   `docs/ROBUST_INDESIGN_AUTOMATION_PLAN.md` (This document)
*   `export-n4-idml-from-downloads.jsx` (Canonical N4 → IDML snapshot)
*   `scripts/verify-json-numbering-vs-n4.py` (Numbering/subparagraph gate vs N4 Downloads)
*   `scripts/verify-json-coverage.ts` (The new guardrail)
*   Updated `run-ch1-rewrite-v5-safe.jsx` (Integrating the guardrail)

