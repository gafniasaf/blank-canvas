# Cursor Rules (Project Guardrails) — InDesign/TestRun

## Why these rules exist
This project has **hard-won lessons learned** around:
- **Numbering/topic drift**: JSON no longer matches the N4 source
- **False confidence**: “green” layout validation didn’t prove content was applied
- **Safety bugs**: InDesign automation accidentally touched the wrong document

Cursor rules make these non‑negotiables visible to every AI-assisted edit.

## Where the rules live
We keep rules in two places for compatibility:
- **`.cursorrules`** (repo root): high-signal “always apply” rules
- **`.cursor/rules/INDESIGN_AUTOMATION.md`**: structured rules for Cursor

**These must stay in sync.** Treat this file as the canonical explanation of what the rules mean and how to update them.

## What the rules are (summary)

### Sources of truth
- **Multi-book source of truth (for scaling to 12 books)**: `books/manifest.json`
  - Each book must declare:
    - canonical N4 source INDD (Downloads)
    - canonical N4 IDML snapshot (for deterministic numbering checks)
    - the baseline INDD we copy+trim per chapter
    - the per-template profile JSON (masters/styles/frame bounds)
  - If any of these change, update the rules files listed in “Keep rules in sync”.
- **Canonical numbering/topic backbone**: original A&F **N4** INDD in Downloads  
  `/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd`
- **Canonical snapshot** (for deterministic checks): IDML exported from that INDD  
  `./_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml` (generate via `export-n4-idml-from-downloads.jsx`)
- **Rewrite JSON output** (legacy filename): `~/Desktop/rewrites_for_indesign.json`

### Mandatory validations (gates)
**Prince-first (current default):**
- **Numbering/subparagraph gate**  
  `python3 scripts/verify-json-numbering-vs-n4.py --json <json> --idml <n4_idml> --require-subfield true`
- **JSON structural preflight**  
  `npm run preflight:json -- <json>` (no `\\r`, Option A markers, safe layer placement, etc)
- **Prince layout validation suite**  
  Run the validation suite in `new_pipeline/` on the newest rendered PDF output.

**Legacy (only if using InDesign again):**
- Coverage gate / applied-rewrites proof gate / InDesign validation suite are only relevant for InDesign apply flows.

### Safety rules
- Never modify baseline INDDs in-place; always `saveACopy`.
- Always hard-gate the active document before editing.
- Post-pass scripts must run on the newest rewritten output INDD.

### Formatting rules
- Only **Option A** headings (`\n\n<<BOLD_START>>Label:<<BOLD_END>> inline text...`).
- After the colon, start lowercase **except** abbreviation-like tokens (DNA/AB0/ATP…).
- **Layer placement rule** (praktijk/verdieping):
  - Never place layers inside list-intro paragraphs ending with `:` when they are followed by bullet runs.
  - Preferred host is the last safe body paragraph of the subparagraph **after** any bullet run.
- **2-column bullet hygiene** (MBO-V / N3):
  - No nested bullet levels in the main body text (flatten nested bullets).
  - Convert “explanatory bullets” (long/multi-sentence) into normal body paragraphs so the core explanation reads as running text.
  - Post-pass script: `normalize-bullets-chapter.jsx` (runs after applied-rewrites proof gate).
  - Hard gate: `scan-nested-bullets.jsx` (part of `run-chapter-validation-suite-latest.jsx`).
- Remove soft hyphens (U+00AD).
- Body text should be `LEFT_JUSTIFIED` (justify with last line left); avoid `FULLY_JUSTIFIED` (justify-all); single-word left.

### Terminology (student-facing; non-negotiable)
- Use **“zorgvrager”** (never cliënt/client).
- Use **“zorgprofessional”** (never verpleegkundige).

### Output target (current default)
- We generate **student-facing PDFs** via `new_pipeline/` (Prince).
- **No teacher PDFs** (no KD appendix) are produced in the default workflow for now.
- Student content must remain **KD-free** (no codes/tags/“KD” mentions); KD is only an internal steering lens.

### KD 2025 (kwalificatiedossier) scope (WIP)
- We target **KD 2025** for the **zorg** domain (Verzorgende IG / MBO Verpleegkundige), in the sense that the book should be teachable/examinable in that context.
- The repo now contains the **official KD 2025 workprocess codes/titles** (as provided) in `docs/kd/kd_2025_workprocesses.json`.
- **Important**: we still do **not** have the full official KD text/definitions and we do not have a validated section→KD mapping, so we cannot claim “KD coverage” yet.
- Context notes (not a primary source): `docs/KD_2025_CONTEXT.md`
- Planned KD mapping approach: `docs/kd/README.md`

### LLM reviewer (optional but recommended)
- Use the LLM reviewer to auto-fix **layer block placement** (praktijk/verdieping) before InDesign apply:
  - `npm run review:json -- <FIXED_DRAFT.json> <LLM_REVIEWED.json> [--chapter N]`
  - Safe edits only: MOVE/DROP existing blocks **within the same section** (no new content, never touch `original`).

### LLM iterative loop (optional, LLM-first)
- If you want a loop that iterates until “100%” (preflight green + LLM score), run:
  - `npm run iterate:json -- <IN.json> <OUT.json> --mode prince --chapter N --provider anthropic --model claude-opus-4-5-20251101 --max-iters 5 --target-score 100`
- The loop is still safety-gated (never touch `original`, never emit `\r`, Option A markers, safe layer placement).
  - In `--mode prince`: bullets are a didactic tool (item-count parity is not enforced).
  - In `--mode indesign`: preserves deterministic list/bullet structure (semicolon item-count parity enforced).

### DB/Docker discipline
- Use real Supabase env vars (no dummy/test placeholders).
- Stop Supabase/Docker after use.

## When to update the Cursor rules
Update the rules **immediately** when any of these change:
- **Source-of-truth paths** (Downloads INDD path, exported IDML path)
- **JSON schema** (fields, required invariants like `subparagraph_number`)
- **Validation scripts** (added/removed/renamed) or their thresholds
- **Chapter splitting strategy** (baseline maker logic, truncation markers)
- **Heading format rules** (“In de praktijk” / “Verdieping”) or typography conventions

If you changed a rule in any playbook (e.g. `docs/ROBUST_INDESIGN_AUTOMATION_PLAN.md`, `CH1_NO_DRIFT_PLAN.md`), you must mirror it here.

## Change-control checklist (keep us honest)
When you change system rules:
1. Update the relevant playbook doc(s).
2. Update **this** file (`docs/CURSOR_RULES.md`).
3. Update `.cursorrules`.
4. Update `.cursor/rules/INDESIGN_AUTOMATION.md`.
5. If applicable, update/extend a deterministic guardrail script and make it part of the pipeline.

This ensures Cursor rules never lag behind the system.


