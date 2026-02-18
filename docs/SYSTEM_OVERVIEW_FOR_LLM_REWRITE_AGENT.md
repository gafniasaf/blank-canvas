## System overview for the LLM rewrite pipeline agent (InDesign/TestRun)

This document is a **handoff guide** for an agent working on the **LLM rewrite pipeline**. It explains:
- What the system’s **sources of truth** are
- How content flows through **LLM → JSON → InDesign apply → hard validation gates**
- How the **Prince (HTML→PDF)** pipeline relates to the same content and rules
- The **data contracts** you must not break (to avoid drift, misplacement, or broken layout)

If you change any “system rules” (paths, required fields, thresholds, formatting conventions), you must keep these in sync:
- `docs/CURSOR_RULES.md`
- `.cursorrules`
- `.cursor/rules/INDESIGN_AUTOMATION.md`

Related docs (read these too):
- `docs/CURSOR_RULES.md` (guardrails + required gates)
- `docs/INDESIGN_PERFECT_JSON_PLAYBOOK.md` (how to produce “perfect JSON”)
- `docs/PRINCE_LAYOUT_RULES.md` (Prince layout + validations)

---

## 1) Big picture: current default vs legacy (one backbone)

We maintain **one numbering/topic backbone** (N4 IDML snapshot) and two execution paths:

### A) Prince pipeline (current default — student books)
Goal: generate **student-facing PDFs** quickly and deterministically, with layout validation gates.

High-level flow:
1. Design tokens from canonical IDML → token CSS
2. Export canonical JSON (from DB) + inject figures (optional)
3. Overlay JSON-first rewrites by `paragraph_id` (deterministic)
4. Optional student-facing polish passes (no KD noise; terminology rules)
5. Prince render → automated layout validation suite

### B) InDesign apply pipeline (legacy — only if we return to apply)
Goal: safely apply rewrites into an InDesign baseline while proving the right text landed in the right paragraphs.

High-level flow:
1. LLM rewrite pipeline produces `~/Desktop/rewrites_for_indesign.json`
2. Deterministic preflight/fix/review checks run BEFORE touching InDesign
3. InDesign apply runs in safe mode (copy-only, hard-gated active document)
4. Post-apply proof/coverage/layout gates validate the result

---

## 2) Sources of truth (do not drift)

### Numbering/topic backbone (canonical)
- Canonical A&F N4 source INDD (Downloads):
  - `/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd`
- Canonical snapshot for deterministic checks (IDML):
  - `_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml`

### Multi-book scaling (12 books)
- `books/manifest.json` is the multi-book “source of truth” for scaling (each book declares its canonical INDD/IDML/baseline/template profile).

### InDesign apply input (LLM output)
- `~/Desktop/rewrites_for_indesign.json` is the single file that InDesign apply consumes.

---

## 3) The rewrite JSON contract (what the LLM pipeline must output)

### Required shape
The InDesign apply pipeline expects JSON shaped like:

```json
{
  "paragraphs": [
    {
      "paragraph_id": "…",
      "chapter": "1",
      "paragraph_number": 2,
      "subparagraph_number": 5,
      "style_name": "…",
      "original": "…",
      "rewritten": "…"
    }
  ]
}
```

Key fields:
- **`paragraph_id`**: stable identifier used for tracing/debugging and some validations.
- **`chapter` / `paragraph_number` / `subparagraph_number`**:
  - Must match the canonical backbone.
  - **`subparagraph_number` must exist on every row** (even if `null`).
- **`original`**:
  - Used for deterministic matching/apply and proof gates.
  - **Never modify `original`.**
- **`rewritten`**:
  - The text that will be applied to InDesign (same-paragraph semantics).
- **`style_name`**:
  - Used by JSON lint rules for bullet/list handling.

---

## 4) Critical formatting invariants (hard gates)

These are enforced by deterministic code and must be treated as non-negotiable.

### 4.1 No paragraph breaks in `rewritten`
InDesign uses `\r` to create a **new paragraph**. That is forbidden in rewrite content.
- Only `\n` is allowed.
- Hard gate: `validateCombinedRewriteText()` in `src/lib/indesign/rewritesForIndesign.ts`

### 4.2 Only Option A headings for Praktijk/Verdieping (and only bold the label)
Rule:
- The system uses **Option A only**:
  - blank line, then bold label with colon, then inline text **on the same line**

Exact markers (must match exactly):
- `<<BOLD_START>>In de praktijk:<<BOLD_END>>`
- `<<BOLD_START>>Verdieping:<<BOLD_END>>`

Example (inside `rewritten`):

```text
…basis text…

<<BOLD_START>>In de praktijk:<<BOLD_END>> bij een zorgvrager let je op …

<<BOLD_START>>Verdieping:<<BOLD_END>> dna is …
```

Hard gates:
- Bold markers must be balanced.
- No unexpected bold spans are allowed (only the two label spans above).
- Headings must be preceded by a blank line.
- Colon must exist, and there must be a space after the colon.

Implementation:
- Builder: `buildCombinedBasisPraktijkVerdieping()` in `src/lib/indesign/rewritesForIndesign.ts`
- Validator: `validateCombinedRewriteText()` in the same file

### 4.3 Lowercase after colon (except abbreviations)
Rule:
- After `In de praktijk:` / `Verdieping:`, the next text should start lowercase
- Exceptions: abbreviation-like tokens such as DNA/ATP/AB0, mixed-case chemistry tokens, etc.

Implementation:
- `ensureLowercaseAfterColon()` in `src/lib/indesign/rewritesForIndesign.ts`

### 4.4 Layer text must be plain running text (no embedded newlines)
Rule:
- The LLM pipeline should generate **plain prose** for `basis` / `praktijk` / `verdieping`
- No internal line breaks inside these layers
- Line structure is added by the combiner (blank line + Option A label)

Implementation:
- `sanitizeLayerText()` collapses embedded newlines to spaces.

### 4.4b Terminology (student-facing; non-negotiable)
Rule:
- Use **“zorgvrager”** (never cliënt/client).
- Use **“zorgprofessional”** (never verpleegkundige).

Enforcement:
- Prompt constraints (writer/repair)
- Deterministic fix-ups (last-mile replacement in `scripts/llm-iterate-rewrites-json.ts`)

### 4.5 List-intro paragraphs + bullets (high-risk structure)
Rule:
- If **original** ends with `:` and the following paragraph(s) are bullets:
  - the rewritten intro must still end with `:`
  - praktijk/verdieping blocks must **not** live in that intro paragraph (they would land between intro and bullets)

Hard gate:
- `lintRewritesForIndesignJsonParagraphs()` in `src/lib/indesign/rewritesForIndesignJsonLint.ts`

Deterministic fixer:
- `applyDeterministicFixesToParagraphs()` in `src/lib/indesign/rewritesForIndesignFixes.ts` moves layer blocks out of list-intros (after the bullet run) and restores the trailing `:`.

### 4.6 Bullet paragraphs: semicolon items (mode-dependent)
Rule:
- Some bullet paragraphs are encoded as a single paragraph where items are separated by semicolons.
- In `--mode indesign` (deterministic apply): if the original has \(N\) semicolon items, the rewritten must have the **same** \(N\) items.
- In `--mode prince` (Prince-first): item-count parity is **not** required; bullets are a didactic choice and you may merge/split/convert to running text.

Hard gate:
- `lintRewritesForIndesignJsonParagraphs({ mode })` enforces item-count parity **only** in `--mode indesign`.

---

## 5) “Perfect JSON” workflow (how rewrites become InDesign-safe)

This repo intentionally separates **generation** from **promotion**.

### One-command whole-book (JSON-first, no InDesign)
If you want a chapter-by-chapter “iterate → fix → preflight” run that produces a single merged JSON for later InDesign apply:

```bash
npm run build:book:json-first -- --book <BOOK_ID>
```

See `docs/JSON_FIRST_WORKFLOW_FOR_LLM_AGENT.md` for full details and recommended flags.

### Standard command loop (recommended)
From repo root (`/Users/asafgafni/Desktop/InDesign/TestRun`):

- Deterministic fix-ups:

```bash
npm run fix:json
```

- Preflight (unit tests + paragraph-level + JSON-level lints):

```bash
npm run preflight:json
```

- Optional LLM reviewer (safe-only structural edits):

```bash
npm run review:json -- <IN.json> <OUT.json> --chapter 1
```

- Promotion (copies approved JSON to `~/Desktop/rewrites_for_indesign.json` with backup):

```bash
npm run promote:json -- <APPROVED.json>
```

Implementation pointers:
- Preflight runner: `scripts/preflight-rewrites-json.ts`
- Deterministic fixes: `scripts/fix-rewrites-json-for-indesign.ts`
- Promotion gate: `scripts/promote-rewrites-for-indesign.ts`
- Core invariants: `src/lib/indesign/rewritesForIndesign.ts`
- Cross-paragraph lints: `src/lib/indesign/rewritesForIndesignJsonLint.ts`

---

## 6) Legacy gates around InDesign apply (only if using InDesign again)

These exist to prevent “false green” and silent misplacement.

### 6.1 Numbering gate (against canonical N4 snapshot)
- Script: `scripts/verify-json-numbering-vs-n4.py`
- Rule: JSON must use only keys that exist in the N4 snapshot and must include `subparagraph_number` (even if `null`).

### 6.2 Coverage gate (content applied)
- Output file: `~/Desktop/rewrite_v5_safe_json_coverage.tsv`
- Script: `scripts/verify-json-coverage.ts` (invoked by InDesign wrapper scripts)
- Rule: fail if any section has missing coverage (e.g. `1.4 = 0%`)

### 6.3 Applied-rewrites proof gate (hard proof the right text landed)
- Script: `scripts/verify-applied-rewrites.ts`
- Rule: **fuzzy matches are forbidden** (hard-fail) to prevent silent misplacements.

### 6.4 InDesign validation suite (layout + structure)
- Script: `run-ch1-validation-suite-latest.jsx` on the newest output.

---

## 7) InDesign apply safety model (why you must not “just run a script”)

The wrapper `run-ch1-rewrite-v5-safe.jsx` exists because we’ve repeatedly seen:
- “active document drift” (script runs on wrong open doc)
- baseline docs being modified in-place
- AppleEvent/UI prompts causing partial runs

Core safety rules:
- Never modify baseline INDD in-place; always `saveACopy` and work on the copy.
- Always hard-gate `app.activeDocument` is the intended document before editing.
- Post-pass scripts (headings/soft-hyphens) must run on the newest rewritten output.

---

## 8) How the Prince pipeline relates (for parity + additional validation)

Even if you’re focused on LLM→InDesign rewrites, you should understand the Prince side because:
- It reuses the same **design/formatting philosophy** (Option A, justification behavior, hyphenation hygiene).
- It adds deterministic **layout scanning** gates (page fill, column balance, box gap checks).

Key doc:
- `docs/PRINCE_LAYOUT_RULES.md`

Key entry points:
- `new_pipeline/export/export-canonical-from-db.ts` (DB → canonical JSON export)
- `new_pipeline/export/apply-rewrites-overlay.ts` (canonical JSON + JSON-first rewrites → overlayed canonical JSON)
- `new_pipeline/renderer/render-prince-pdf.ts` (canonical JSON → HTML → Prince PDF)
- `new_pipeline/templates/prince-af-two-column.css` (layout rules; token base)
- `new_pipeline/templates/prince-af-two-column.tokens.css` (generated from IDML tokens)
- `new_pipeline/validate/*` (Prince log checks + layout scanners)

Standardized build:
- `cd new_pipeline && npm run build:chapter -- --upload <UUID> --chapter <N> [--figures <figures.json>] [--rewrites <FINAL.json>] [--report]`
- Render-only (no DB needed):
  - `cd new_pipeline && npm run build:chapter -- --chapter <N> --in-json output/canonical_ch<N>_with_figures.json`
- Skeleton-first rewrite (no DB needed):
  - `cd new_pipeline && npm run build:chapter -- --chapter <N> --in-json output/canonical_ch<N>_with_figures.json --rewrite-mode skeleton [--section 1.1] [--rewrite-provider openai --rewrite-model gpt-4o-mini]`
- Whole-book build (single merged PDF):
  - `cd new_pipeline && npm run build:book -- --upload <UUID> --chapters 1,2,3,... [--figures <figures_all.json>] [--rewrites <FINAL.json>] [--report]`

---

## 9) What the rewrite-agent should (and should not) do

### You should
- Generate rewrites as **plain layer text** (basis/praktijk/verdieping), then let the combiner build the final `rewritten` string.
- Preserve deterministic structure for lists (especially bullet semicolon-encoded paragraphs).
- Keep all text in a **single paragraph** (no `\r`).
- Keep Praktijk/Verdieping strictly Option A and respect lowercase-after-colon rules.
- Run deterministic fix + preflight before promotion.

### You must not
- Modify `original`.
- Emit any bold markers beyond the allowed Praktijk/Verdieping label spans.
- Place Praktijk/Verdieping blocks inside list-intro paragraphs that are followed by bullets.
- Introduce `\r` or discretionary soft hyphens (U+00AD).
- Use fuzzy matching to “make it pass” in apply/proof scripts.

---

## 10) Quick troubleshooting map (common failures)

### “Contains \r”
- Your LLM output created paragraph breaks. Replace with `\n` or merge into a single paragraph.

### “Unbalanced bold markers”
- You emitted `<<BOLD_START>>` without a matching `<<BOLD_END>>` (or vice versa).

### “Unexpected bold marker span”
- You tried to bold words beyond the two allowed label spans. Not allowed by design.

### “Heading must be Option A”
- You used a standalone “In de praktijk” line or missed the colon / inline text.

### “list-intro … lost the trailing ':'”
- You removed the colon from an intro paragraph that anchors a bullet run.

### “bullet semicolon-list structure mismatch”
- Only applies in `--mode indesign` (deterministic apply).
  - In `--mode indesign`: you changed the number of semicolon-separated items. Restore item count.
  - In `--mode prince`: item-count changes are allowed.


