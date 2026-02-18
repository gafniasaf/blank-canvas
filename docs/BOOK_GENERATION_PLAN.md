# Book generation plan (student PDFs, multi-book, no human intervention)

## Goal
Generate **student-facing books** (Prince PDFs) end-to-end with:
- consistent numbering/backbone
- stable formatting rules (Option A praktijk/verdieping)
- strong layout validation gates (Prince)
- **no teacher PDFs** for now
- KD used only as an **internal steering lens** (no KD tags/codes in student content)

## Current status (as of this repo state)
`books/manifest.json` contains **4 books**:
- `MBO_AF4_2024_COMMON_CORE` — ✅ upload + chapters ready
- `MBO_COMMUNICATIE_9789083251387_03_2024` — ✅ upload + chapters ready (figures mapping TBD)
- `MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024` — ✅ upload + chapters ready (figures mapping TBD)
- `MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024` — ✅ upload + chapters ready (figures mapping TBD)

Before we can run “no-touch” multi-book generation, **each manifest entry must have**:
- `upload_id` (Supabase book upload UUID)
- `chapters` (authoritative list)
- `canonical_n4_idml_path` (snapshot for numbering + tokens)
- figure mapping (optional but recommended): `new_pipeline/extract/figures_by_paragraph_all.json`-style mapping for that book

## Non-negotiables (student content)
- **Terminology**: use **zorgvrager** (never cliënt/client) and **zorgprofessional** (never verpleegkundige).
- **KD**: do not mention KD or show codes/tags in student content.
- **Option A only**: praktijk/verdieping labels must stay the strict Option-A format in rewrite JSON.

## Phase 0 — Prereqs and doc sync (once)
1. Keep guardrail docs in sync:
   - `docs/CURSOR_RULES.md`
   - `.cursorrules`
   - `.cursor/rules/INDESIGN_AUTOMATION.md`
   - `docs/JSON_FIRST_WORKFLOW_FOR_LLM_AGENT.md`
   - `docs/PRINCE_LAYOUT_RULES.md`
2. Confirm environment:
   - Supabase env vars present (no placeholders)
   - Anthropic key present if using Opus for LLM steps

## Phase 1 — Generate the remaining chapters of A&F (book 1)

### 1.1 Rewrite generation (JSON-first)
Run from repo root:

```bash
npm run build:book:json-first -- \
  --book MBO_AF4_2024_COMMON_CORE \
  --profile production \
  --mode prince \
  --seed approved \
  --jobs 2 \
  --provider anthropic --model claude-opus-4-5-20251101 \
  --write-all \
  --max-iters 4
```

Notes:
- **`--profile production`** enables the default quality hardening:
  - automatic **quality sweep** (max iters defaults to 8)
  - bullet hygiene during iteration
  - deterministic **text lint gate** (`lint:text`) so obvious text defects don’t reach the PDF

Output: `output/json_first/MBO_AF4_2024_COMMON_CORE/<RUN>/...FINAL.json`

### 1.2 Student PDF build (Prince, whole book)
Run from `new_pipeline/`:

```bash
cd new_pipeline
npm run build:book -- \
  --upload <UPLOAD_UUID_FROM_MANIFEST> \
  --idml <CANONICAL_IDML_FROM_MANIFEST> \
  --chapters 1,2,3,... \
  --figures extract/figures_by_paragraph_all.json \
  --rewrites <PATH_TO_FINAL_REWRITES_JSON>
```

Notes:
- `build:book` defaults to **`--align left` (ragged-right)** for student readability. Override with `--align justify` if needed.

This produces:
- `new_pipeline/output/book_professional.pdf` (student PDF)
- plus layout validation artifacts/logs

### 1.3 Optional (recommended) student-facing polish pass
If we want additional “human editor” smoothing without changing structure:
- run canonical-only polish scripts on the *overlayed* canonical JSON **before** final render.
  - deterministic shaping (`apply-kd-differentiation-poc.py` → to be generalized)
  - box humanization (`humanize-kd-boxes.py`)
  - constrained flow polish (`flow-polish-canonical.py`)

These are deliberately conservative and can be wired into a future `build:book` wrapper for full automation.

## Phase 2 — Onboard the other books (manifest completion)
For each additional book in `books/manifest.json`:

1. **Set `chapters`**
   - Source: IDML headings (or the generated KD mapping skeleton in `docs/kd/mappings/<book>.mapping.json`).
2. **Set `upload_id`**
   - Must exist in Supabase (`book_uploads` table).
3. **Figures**
   - If figure overlays exist: generate `figures_by_paragraph_all.json` for that book.
   - If not ready yet: run `new_pipeline` without `--figures` as a first milestone (text-only PDF).
4. Run Phase 1 for that book (rewrite → build PDF).

## Phase 3 — Scale to “12 books”
1. Add the remaining books to `books/manifest.json` with canonical INDD/IDML paths and template profiles.
2. Repeat Phase 2 for each book until all are runnable end-to-end.

## What we are *not* doing right now
- Teacher PDFs (KD appendix) — code exists, but not part of the default pipeline for now.
- Claims of “KD coverage” — we don’t have the official KD text/definitions or a validated mapping.


