# Perfect JSON → InDesign Playbook (NO‑DRIFT) — **Legacy / apply-only**

This document is the **authoritative execution plan** for generating an **InDesign-apply-ready** chapter without regressions.

**Important (current default workflow):**
- We are **Prince-first** (student PDFs via `new_pipeline/`), and we are **not running InDesign apply** by default.
- For the current pipeline, read:
  - `docs/JSON_FIRST_WORKFLOW_FOR_LLM_AGENT.md` (rewrite pipeline + how it feeds Prince)
  - `docs/PRINCE_LAYOUT_RULES.md` (PDF rendering + validations)

If you change behavior that is covered here, you **must**:
- Update this document, and
- Update/add guardrail tests so drift is caught automatically.

Related specs:
- `PIPELINE_NO_DRIFT.md` (global invariants across books)
- `docs/PARAGRAPH_STRUCTURE.md` (numbering model)
- `/Users/asafgafni/Desktop/InDesign/TestRun/CH1_REBUILD_PLAYBOOK.md` (chapter‑1 rebuild notes; source of many lessons below)

---

## 0) Non‑negotiables (locked decisions)

### InDesign safety
- **No paragraph breaks in generated text**: never emit `\r` in `rewritten`. Only `\n` is allowed.
- **Anchored objects** (`\uFFFC`) must be preserved. Never “retype” anchored-object paragraphs blindly.
- **Never run global edits across all stories**. Always scope to the **chapter body story** (largest wordcount in CH range).
- **Labels/callouts/captions are protected**: do not modify their stories unless explicitly targeted and proven safe.

### Layering model (“Option A”)
- The LLM writes **plain prose layers** only: `basis`, optional `praktijk`, optional `verdieping`
- The **labels** are added at assembly time:
  - `\n\n<<BOLD_START>>In de praktijk:<<BOLD_END>> <tekst>`
  - `\n\n<<BOLD_START>>Verdieping:<<BOLD_END>> <tekst>`
- **No “Option B”** (standalone heading line). Heading + first sentence must be on the same line.
- After the colon, start lowercase **except** abbreviation-like tokens (DNA/AB0/ATP…).

### Typography rules in InDesign
- Body paragraphs: `Justification.LEFT_JUSTIFIED` (last line aligned left; never justify-all-lines).
- Paragraphs that contain layer blocks: **also** `Justification.LEFT_JUSTIFIED` to keep book layout consistent (requirement: last line aligned left).

---

## 1) Source of truth: numbering + topic backbone

### Goal
Keep the **N4 A&F** structure as the backbone (chapter/paragraph/subparagraph numbers and topic order), while rewriting the prose to the **basisboek** level.

### What “backbone” means in the system
- Numbering is stored as:
  - `chapter_number` (TEXT)
  - `paragraph_number` (INTEGER)
  - `subparagraph_number` (INTEGER or NULL)
- The “unit” of didactic flow is the **subparagraph** (`1.1.1`, `1.1.2`, …).

Critical: the pipeline must never “invent” numbering. It must come from headers in the source IDML/INDD.

---

## 2) Content generation strategy (how we avoid logic jumps)

### A) Rewrite with context, not isolation
Even if InDesign replacement happens per paragraph, the model must be guided by the **subparagraph context**:
- Provide the LLM with:
  - the current unit (`1.1.2`)
  - the previous and next unit (short excerpts)
  - a “do not jump” rule: practice/depth must reuse concepts already present in the unit

### B) Conservative layers (reduce risk)
To reduce “jumps/plaatsingbugs”, treat layers as **optional**:
- If not clearly relevant → output empty layer.
- Prefer **1× praktijk and/or 1× verdieping per subparagraph** (not per bullet item).

### C) Placement rule for layers (prevents broken build-up)
Never place layers:
- Inside list-intro paragraphs (ending with `:`) if followed by bullet runs
- Inside bullet paragraphs (`_Bullets*`) unless the subparagraph contains *only* bullets (then usually skip layers)

Preferred host:
- The **last safe body paragraph** of the subparagraph **after** any bullet run.

---

## 3) “Perfect JSON” workflow (human review gate)

### Step 3.1 — Generate draft JSON (never overwrite final)
Generate the draft JSON to Desktop:
- `~/Desktop/rewrites_for_indesign.DRAFT.json`

### Step 3.2 — Deterministic fix-up (safe structural repair)
Run:
- `npm run fix:json -- <DRAFT.json> <FIXED_DRAFT.json>`

What it may do:
- Normalize punctuation spacing in `rewritten` (safe/deterministic)
- Move misplaced layer blocks out of list-intro paragraphs before bullet runs

What it must **never** do:
- Modify `original`
- Introduce `\r`

### Step 3.3 — Lint (hard stop conditions)
Run:
- `npm run preflight:json -- <FIXED_DRAFT.json>`

Hard-stop checks include:
- No `\r`
- Valid bold marker usage
- Option A headings
- Cross-paragraph misplacement check (list-intro + layers + bullets)

### Step 3.4 — Optional: LLM reviewer (auto-fix, safe-only)
If you want a “human-like reviewer” that can prevent subtle layer-placement issues before InDesign apply, run:
- `npm run review:json -- <FIXED_DRAFT.json> <LLM_REVIEWED.json> [--chapter N]`

Safety contract (non-negotiable):
- Never modifies `original`
- Never emits `\r`
- Only MOVE/DROP existing layer blocks (praktijk/verdieping) **within the same section** (`chapter.paragraph.subparagraph`)
- No new factual content is generated

After review, re-run lint:
- `npm run preflight:json -- <LLM_REVIEWED.json>`

### Step 3.4b — Optional: LLM iterative pipeline (write → check → repair until 100%)
If you want an LLM-first loop (instead of one-shot review), run:
- `npm run iterate:json -- <IN.json> <OUT.json> --chapter N --model gpt-5.2 --max-iters 5 --target-score 100`

Definition of “100%” in this loop:
- Deterministic preflight is green (0 errors from structure/formatting lints)
- LLM checker reports score ≥ target-score **and** 0 critical issues

This loop is allowed to run multiple repair rounds, but it is still safety-gated:
- Never modifies `original`
- Never emits `\r`
- Preserves list/bullet structure (intro `:` + semicolon item counts)

### Step 3.5 — Export human review Markdown
Run:
- `npx tsx scripts/export-rewrites-review-md.ts <FIXED_DRAFT.json>`

Output:
- `<FIXED_DRAFT.json>.REVIEW.md`

### Step 3.6 — Human approval → promote
Run:
- `npm run promote:json -- <FIXED_DRAFT.json>`

Promotion must re-run lints; if lint fails, promotion must abort.

---

## 4) InDesign apply (safe v5) + validation

### Apply (chapter scoped)
- Wrapper: `/Users/asafgafni/Desktop/InDesign/TestRun/run-ch1-rewrite-v5-safe.jsx`
- Safe apply: `scripts/rewrite-from-original-safe-v5.jsx`

Requirements:
- Always pass chapter scope (`app.scriptArgs` / chapter_filter).
- Only modify the **body story in range**.

### Validate (no manual QA)
Run the InDesign validation suite:
- `/Users/asafgafni/Desktop/InDesign/TestRun/run-ch1-validation-suite-latest.jsx`

Minimum acceptance:
- 0 overset in CH1 body story
- Chapter boundary pages satisfy rules (baseline-aware when needed)
- No “justify-all-lines”; last lines align left

---

## 5) Lessons learned (root causes + how we prevent repeats)

### Lesson: InDesign does not invent problems—JSON does
If the combined text is wrong in JSON, InDesign will faithfully render it **but** the apply script can still misplace text if matching heuristics are too permissive.
Guardrails:
- Mandatory draft→fixed→lint→review→promote gate (no auto-overwrite of final)
- InDesign apply matching must be **exact/legacy-first**; fuzzy is last-resort only.
- Applied-rewrites proof gate must **hard-fail on any fuzzy matches** to prevent silent misplacements.

### Lesson: “global fixes” break callouts/captions
Edits across all stories can destroy label/callout formatting.
Guardrail:
- strict body-story scoping in scripts; avoid `para.contents = ...` outside body story

### Lesson: list-intro + bullets is the highest-risk structure
Putting praktijk/verdieping inside a list-intro paragraph places it between intro and bullets.
Guardrails:
- deterministic fix-up script moves it out
- linter fails build if it’s still present

### Lesson: paragraph alignment inside a paragraph is impossible
You cannot left-align only “the last line before a heading” within a single paragraph.
Guardrail:
- paragraphs containing layer blocks must be `LEFT_ALIGN`

### Lesson: extraction/ingest fidelity matters (weird “original” starts)
Some “original” values looked like glued lists because extraction merged items.
Guardrails:
- baseline-vs-JSON verification scripts for CH1
- IDML ingest must be consistent with the numbering model (one coherent approach; no contradictory ingest modes)

### Lesson: invisible soft hyphens (U+00AD) leak into output
Some paragraphs contain discretionary soft hyphens (e.g. `cel­kern`) that are invisible but can break copy/paste and QA.
Guardrails:
- post-pass cleanup: remove U+00AD from the **CH1 body story only** (never global)
- validation audit (`audit-ch1-body-quality.jsx`) must report **0** soft hyphens in the body story range

### Lesson: chapter boundary heuristics must be baseline-aware
Some templates already contain body words on intro/image pages.
Guardrail:
- delta-based checks (compare against baseline)

---

## 6) Guardrails (tests + preflight)

### Unit tests (Vitest)
The following invariants must be covered by tests:
- `validateCombinedRewriteText` rejects `\r`, bad bold spans, Option B headings
- JSON-level lint detects list-intro misplacement before bullets
- Fix-up function moves layer blocks out of list-intros deterministically

Run:
- `npm test`

### Preflight (before any InDesign run)
Run:
- `npm run preflight:json -- <FIXED_DRAFT.json>`

This must:
- run unit tests
- lint the target JSON


