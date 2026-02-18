## JSON-first takeover handoff for the LLM rewrite pipeline agent (same repo, no InDesign runs)

This doc is meant for an agent who is **taking over the pipeline in the same codebase** (`/Users/asafgafni/Desktop/InDesign/TestRun`) while we intentionally **do not run any InDesign scripts**.

It is a companion to:
- `docs/SYSTEM_OVERVIEW_FOR_LLM_REWRITE_AGENT.md` (big picture + non-negotiables)

It adds:
- A complete **repo map**
- **Where all source books live** (Downloads folder listing + what is “canonical”)
- A JSON-first workflow that still keeps the **same guardrails** (so InDesign apply stays possible later)
- The **history / failure modes** that explain why these rules exist

---

## 0) If you read only 3 docs

Read these in order:
1. `docs/SYSTEM_OVERVIEW_FOR_LLM_REWRITE_AGENT.md` (sources of truth + contract + invariants)
2. `docs/CURSOR_RULES.md` (what must never drift)
3. `docs/INDESIGN_PERFECT_JSON_PLAYBOOK.md` (how “perfect JSON” is produced and validated)

---

## 1) Repo map (where things live)

### 1.1 Code / scripts
- `scripts/fix-rewrites-json-for-indesign.ts`: deterministic JSON fix-ups (**only edits `rewritten`**)
- `scripts/preflight-rewrites-json.ts`: per-paragraph + JSON-level lint checks
- `scripts/llm-iterate-rewrites-json.ts`: iterative write → check → repair loop (**current default: Anthropic / Claude Opus 4.5**, configurable)
- `scripts/llm-review-rewrites-json.ts`: LLM review pass (safe-only structural edits)
- `scripts/verify-json-numbering-vs-n4.py`: numbering/backbone verification against canonical IDML snapshot
- `scripts/promote-rewrites-for-indesign.ts`: “human approved” promotion step to `~/Desktop/rewrites_for_indesign.json`

If/when you return to InDesign runs, these become relevant again:
- `scripts/verify-json-coverage.ts` (coverage gate)
- `scripts/verify-applied-rewrites.ts` (proof gate; fuzzy hard-fail)
- `scripts/rewrite-from-original-safe-v5.jsx` (the apply engine; ExtendScript)

### 1.2 Data contracts (the “don’t break these” layer)
- `src/lib/indesign/rewritesForIndesign.ts`: paragraph-level validator (no `\\r`, Option A markers, etc.)
- `src/lib/indesign/rewritesForIndesignFixes.ts`: deterministic fix-ups (list-intro colon restore, layer-block moves)
- `src/lib/indesign/rewritesForIndesignJsonLint.ts`: cross-paragraph lints (list-intro + bullets, semicolon item parity)

### 1.3 Configuration + multi-book scaling
- `books/manifest.json`: where each book’s canonical source paths and outputs are declared
- `_source_exports/`: canonical IDML snapshots used by deterministic numbering checks
- `books/template_profiles/`: template profiles (needed only when running InDesign)

### 1.4 “Where do I run commands?”

- Repo root: `/Users/asafgafni/Desktop/InDesign/TestRun`
- NPM scripts live in `package.json`:
  - `npm run fix:json`
  - `npm run preflight:json`
  - `npm run review:json`
  - `npm run iterate:json`
  - `npm run promote:json`

---

## 2) Where the books live (source material)

### 2.1 Downloads root (all books)

All source books are under:
- `/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/`

As of the current environment, the key folders include:
- `MBO A&F 3_9789083251363_03/` (single `.indd`)
- `MBO A&F 4_9789083251370_03/` (single `.indd`, plus many generated outputs; the canonical is the `.2024.indd`)
- `MBO Communicatie_9789083251387_03/` (single `.indd`)
- `MBO Methodisch werken_9789083251394_03/` (single `.indd`)
- `MBO Persoonlijke Verzorging_9789083412023_03/` (single `.indd`)
- `MBO Praktijkgestuurd klinisch redeneren_9789083412030_03/` (single `.indd`)
- `MBO Wetgeving_9789083412061_03/` (single `.indd`)
- `MBO Pathologie nivo 4_9789083412016_03/` (folder exists)
- `_MBO VTH nivo 3_9789083412047_03/` (**.indb + many chapter .indd files**)
- `_MBO VTH nivo 4_9789083412054_03/` (**.indb + many chapter .indd files**)
- `MBO Pathologie nivo 3_9789083412009_03.2024 - ONLY PDF/` (PDF only; no INDD)

### 2.2 Important nuance: some sources are `.indb` (InDesign Book)

The current automation scripts are designed around opening a **single canonical `.indd`** per book.

For `.indb` books you have two options:
- **Option A (recommended for now)**: pick the primary content `.indd` in the `.indb` set as the canonical “backbone INDD”, and add that to `books/manifest.json`.
- **Option B**: extend the InDesign scripts to understand `.indb` (more work; not needed in JSON-first mode).

### 2.3 `books/manifest.json` (multi-book source of truth in this repo)

The manifest is where we declare, per book:
- `canonical_n4_indd_path`
- `canonical_n4_idml_path`
- `baseline_full_indd_path`
- `chapters`
- `template_profile_path`
- `output_root`

**Important**: `chapters` is currently authoritative for book runs; if it only lists `[1]`, chapter 2 runs are intentionally blocked.

#### Current manifest coverage (important context)

Right now `books/manifest.json` only contains a subset of the Downloads books (template/profile entries were created for):
- `MBO_AF4_2024_COMMON_CORE`
- `MBO_COMMUNICATIE_9789083251387_03_2024`
- `MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024`
- `MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024`

All other Downloads folders listed in section 2.1 still need manifest entries before we can scale to “12 books” in a consistent way.

### 2.4 Canonical IDML snapshots (used for deterministic numbering checks)

Canonical snapshots live in:
- `_source_exports/`

Example snapshots currently present:
- `_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml`
- `_source_exports/MBO_COMMUNICATIE_9789083251387_03_2024__FROM_DOWNLOADS.idml`
- `_source_exports/MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024__FROM_DOWNLOADS.idml`
- `_source_exports/MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024__FROM_DOWNLOADS.idml`

If a book is missing an IDML snapshot, the numbering gate cannot be run until you generate it.

### 2.5 Adding a new book to the system (minimum viable steps)

In `books/manifest.json`, add a new entry with:
- `book_id`: stable identifier (used in scripts + output folders)
- `canonical_n4_indd_path`: the canonical backbone INDD in Downloads
- `canonical_n4_idml_path`: the exported IDML snapshot path under `_source_exports/`
- `baseline_full_indd_path`: the full baseline INDD that will be copied during apply (when/if we return to InDesign)
- `chapters`: list of chapter numbers we plan to run (keep accurate)
- `template_profile_path`: profile JSON path under `books/template_profiles/` (only needed for InDesign runs)
- `output_root`: where generated outputs go (used by wrappers)

Special cases:
- If the Downloads folder contains an `.indb`: decide which `.indd` inside is “canonical backbone” (Option A), or plan the work to extend scripts for `.indb`.
- If the book is PDF-only: it cannot be part of the deterministic N4-IDML numbering gate until an INDD/IDML source exists.

---

## 3) What we are doing now (JSON-first, no InDesign)

### We do NOT run
- Any `.jsx` wrappers
- Coverage/applied-rewrites proof gates (they require InDesign TSV outputs)

### Rewrite modes (important)
All rewrite scripts now support:
- `--mode prince` (**default**): optimize for Prince-first PDF layout + readability (no InDesign apply).
  - Bullets are a **didactic choice**.
  - Semicolon item-count parity is **NOT** required.
- `--mode indesign`: keep deterministic InDesign-apply safety (legacy / optional).
  - Semicolon item-count parity **IS** enforced.

### Structural invariants we still enforce in JSON-first mode
These protect layout and prevent “floating” blocks regardless of renderer:
- Never change `original`
- No `\\r` allowed in `rewritten`
- Option A headings only (`<<BOLD_START>>In de praktijk:<<BOLD_END>> ...`)
- Praktijk/verdieping blocks must not sit inside a list-intro paragraph that is followed by bullets (we deterministically move them)
- If a real list is kept, keep a readable list-intro (prefer ending with `:`)

### What we can and cannot validate in JSON-first mode (be explicit)

We **can** prove:
- JSON schema invariants (required fields present)
- structural text invariants (no `\\r`, Option A markers, list-intro colon integrity, semicolon item parity)
- N4 backbone key validity (if `_source_exports/<book>.idml` exists)
- readability goals via LLM checker + prose preview (micro-opsommingen)

We **cannot** prove (without InDesign):
- the text landed in the correct story/frames
- overset, widows/orphans, chapter boundary leaks
- real page-flow aesthetics

---

## 4) JSON contract (do not break)

Required fields per row:
- `paragraph_id`
- `chapter`
- `paragraph_number`
- `subparagraph_number` (**must exist even if `null`**)
- `style_name`
- `original` (**never modify**)
- `rewritten`

Rule of thumb:
- **Only edit `rewritten`.**

---

## 5) The JSON-first command loop (repo root)

Run from:
- `/Users/asafgafni/Desktop/InDesign/TestRun`

### 5.0 One-command whole-book build (recommended once chapters list is ready)

If you want to run the **JSON-first** pipeline chapter-by-chapter (iterate → fix → preflight) and produce a single merged output JSON:

```bash
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --profile production
```

Notes:
- Chapters are taken from `books/manifest.json` (`books[].chapters`). If it only lists `[1]`, then **only CH1 will run**.
  - To build the whole book, update the manifest chapters list or pass `--chapters "1,2,3,..."`.
- If you do **not** pass `--in`, the orchestrator exports a fresh multi-chapter input JSON from the DB using `books[].upload_id` (or `--upload`).
- Default input is `~/Desktop/rewrites_for_indesign.json` and the script writes outputs under:
  - `output/json_first/<book>/<runId>/`
- Requires provider keys:
  - `ANTHROPIC_API_KEY` for Anthropic/Opus (current default in this repo)
  - `OPENAI_API_KEY` only if you run with `--provider openai` or enable `--review` (review script is OpenAI-only today)

Defaults (important):
- **Profile default**: `--profile production` (quality-first; safe for student PDFs).
- Use `--profile draft` when you want speed and are okay with more manual cleanup later.
- If you don’t pass `--in`, the orchestrator exports from Supabase and **seeds** `rewritten` from **approved** rewrites when present (`--seed approved`).
  - Override with `--seed original` if you want to force rewriting everything from scratch.
- If you don’t pass a write mode (`--write-all`, `--write-missing`, `--write-if-unchanged`), we default to:
  - `--write-if-unchanged`

Common options:

```bash
# Run only specific chapters
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --profile production --chapters "1,2,3"

# Run chapters in parallel (worker pool). Recommended: 2–4 jobs.
# This runs per-chapter LLM steps concurrently, then merges by paragraph_id, then runs one global fix+preflight+numbering gate.
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --profile production --jobs 3

# Allow high parallelism (risky: likely throttling / noisy retries depending on provider quotas)
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --jobs 8 --jobs-unsafe

# Faster / less strict:
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --profile draft --no-quality-sweep

# Also run the LLM reviewer pass per chapter (safe-only layer placement edits)
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --review

# Force rewrite everything from original (expensive)
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --seed original --write-all

# Promote the final merged JSON to ~/Desktop/rewrites_for_indesign.json (with backup)
npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --promote
```

### 5.1 Deterministic fix-ups (safe normalization)

Defaults:
- in: `~/Desktop/rewrites_for_indesign.json`
- out: `~/Desktop/rewrites_for_indesign.FIXED_DRAFT.json`

```bash
npm run fix:json -- [inJsonPath] [outJsonPath]
```

### 5.2 Preflight (unit tests + JSON lint)

```bash
npm run preflight:json -- [jsonPath]
```

### 5.3 Numbering gate (N4 backbone)

```bash
python3 scripts/verify-json-numbering-vs-n4.py <jsonPath> --require-subfield subparagraph_number
```

### 5.4 LLM iterate loop (write → check → repair)

Use this for quality + style convergence:

```bash
npm run iterate:json -- <IN.json> <OUT.json> --mode prince --chapter 2 --sample-pages 2 --words-per-page 550 --write-all --max-iters 10 --target-score 100 --provider anthropic --model claude-opus-4-5-20251101
```

Important behavior:
- Default convergence is **critical-only** (prevents “25 iterations of thrash”).
- Use `--strict-score` only if you explicitly want warnings to block convergence.

### 5.5 LLM review (semantic sanity; safe-only edits)

Use when you want an “editor pass” that can move/drop/keep layer blocks safely, without rewriting full content:

```bash
npm run review:json -- <IN.json> <OUT.json> --chapter 2 --sample-pages 2 --words-per-page 550
```

### 5.6 Promotion (when we want a single canonical Desktop JSON)

Promotion copies an approved JSON into:
- `~/Desktop/rewrites_for_indesign.json`

and creates a backup of the previous Desktop file.

```bash
npm run promote:json -- <APPROVED.json>
```

---

## 6) Prince-first PDF build (whole book + images)

This repo has a separate, Prince-first rendering pipeline in `new_pipeline/`.

It is designed to:
- export a **canonical, structured JSON** per chapter from the DB (keeps headings/subheadings/lists),
- inject **atomic figure assets** (PNG exports from InDesign so labels/callouts remain correct),
- deterministically **overlay** JSON-first rewrites onto canonical blocks by `paragraph_id`,
- render a **single book PDF** with Prince,
- run the Prince layout validation suite.

### 6.1 Figure manifests (atomic export) — generated from InDesign

Exporter:
- `export-figure-manifest.jsx`

What it writes:
- `new_pipeline/extract/figure_manifest_ch<N>.json`
- `new_pipeline/assets/figures/ch<N>/...png` (atomic figures)

Run it (InDesign 2026, long timeout):

```bash
osascript -e 'with timeout of 7200 seconds
tell application "Adobe InDesign 2026" to do script (POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/export-figure-manifest.jsx") language javascript
end timeout'
```

### 6.2 Copy non-atomic linked images (per chapter)

Some figures are plain linked images. Copy them into repo assets and write a local mapping file:

```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline
npx tsx extract/copy-ch1-images.ts --chapter 8
```

Outputs:
- `new_pipeline/assets/images/ch8/...`
- `new_pipeline/extract/ch8-images-map.json`

### 6.3 Map figures to DB paragraph IDs (per chapter) + merge

```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

# Per chapter
npx tsx extract/map-figures-to-paragraphs.ts <UPLOAD_UUID> --chapter 8

# Merge all chapters into a single mapping file (paragraph_id -> images[])
npx tsx extract/merge-figures-by-paragraph.ts --chapters 1,2,3,4,5,6,7,8,9,10,11,12,13,14 --out extract/figures_by_paragraph_all.json
```

Outputs:
- `new_pipeline/extract/figures_by_paragraph_ch<N>.json`
- `new_pipeline/extract/figures_by_paragraph_all.json`

### 6.4 Deterministic rewrites overlay (canonical JSON + rewrites JSON)

Overlay script:
- `new_pipeline/export/apply-rewrites-overlay.ts`

It:
- applies `rewritten` onto canonical `basis` by `paragraph_id`,
- converts list/steps → paragraph when rewrite is prose (no semicolons),
- strips inline `<<BOLD_START>>In de praktijk:<<BOLD_END>> ...` / `Verdieping:` markers from `basis`,
- by default **does not overwrite** existing `praktijk/verdieping` fields from the DB export (use `--overwrite-boxes` if needed).

### 6.5 One-command whole-book PDF build (multi-chapter, validated)

Entry point:
- `new_pipeline/scripts/build-book.ts` (`npm run build:book`)

Example:

```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

npm run build:book -- \
  --upload <UPLOAD_UUID> \
  --chapters 1,2,3,4,5,6,7,8,9,10,11,12,13,14 \
  --figures new_pipeline/extract/figures_by_paragraph_all.json \
  --rewrites /Users/asafgafni/Desktop/InDesign/TestRun/output/json_first/MBO_AF4_2024_COMMON_CORE/<RUN>/rewrites_for_indesign.MBO_AF4_2024_COMMON_CORE.FINAL.json
```

Default outputs:
- `new_pipeline/output/book_professional.pdf`
- `new_pipeline/output/book_prince.log`
- `new_pipeline/output/canonical_book_with_figures.json`
- `new_pipeline/output/canonical_book_with_figures.rewritten.json`

### 6.6 Student-facing polish passes (current workflow; optional but recommended)
These run **after** we have canonical+rewrites (i.e. after `apply-rewrites-overlay.ts`) and before the final render.

Goals:
- keep student PDF **KD-free** (no codes/tags)
- improve readability without changing numbering/structure
- enforce house terminology: **zorgvrager**, **zorgprofessional**

Tools (chapter POC today; will be scaled to whole-book runs):
- `new_pipeline/export/apply-kd-differentiation-poc.py`: deterministic “basis vs verdieping + praktijk density” shaping
- `new_pipeline/export/humanize-kd-boxes.py`: LLM rewrite of newly-added boxes (keeps edits local + safe)
- `new_pipeline/export/flow-polish-canonical.py`: optional last-mile flow polish for flagged spots (constrained LLM editor)

Note:
- We are **not generating teacher PDFs** (no KD appendix) in the default workflow for now.

---

## 7) Bullet fatigue + “micro-opsommingen” (the new writing goal)

### 7.1 The goal
We want more running text like:
- “Je huid beschermt, voelt en regelt warmte.”
instead of a visually heavy bullet list.

Micro-opsommingen work best when:
- It’s a genuine “3–4 properties” enumeration
- The list items are short (1–5 words)
- The reader should keep reading, not “scan a checklist”

Example (from user’s editorial target):
“De haar zit vast in je huid met de haarwortel. We delen haren in twee typen: vellushaar en terminale haren.”

### 7.2 Reality check (why bullets may still exist in canonical JSON)
`style_name` comes from the baseline template. If a paragraph is bullet-styled in the baseline:
- it will still *render as bullets* in InDesign later,
- even if `rewritten` is a sentence.

So in JSON-first mode we split “what humans read” vs “what later applies deterministically”:
- **Canonical JSON** stays apply-safe.
- **Prose preview** collapses bullet runs into micro-opsommingen for human review.

### 7.3 Prose preview (recommended review artifact)

Generate a preview that reads as continuous text:

```bash
python3 - <<'PY'
import json, re
from pathlib import Path

INP=Path('~/Desktop/rewrites_for_indesign.json').expanduser()
OUT=Path('~/Desktop/prose_preview.txt').expanduser()

j=json.loads(INP.read_text('utf-8'))
paras=[p for p in (j.get('paragraphs') or []) if str(p.get('chapter',''))=='2']

def is_bullet_style(sn: str) -> bool:
  s=(sn or '').lower()
  return 'bullet' in s or '_bullets' in s or '•bullets' in s

def split_items(s: str):
  return [x.strip() for x in (s or '').split(';') if x.strip()]

def join_dutch(items):
  if not items: return ''
  if len(items)==1: return items[0]
  if len(items)==2: return f\"{items[0]} en {items[1]}\"
  return ', '.join(items[:-1]) + f\" en {items[-1]}\"

def ensure_period(s: str):
  t=s.rstrip()
  if not t: return t
  return t if t[-1] in '.!?' else t + '.'

lines=[]
i=0
while i < len(paras):
  p=paras[i]
  rw=str(p.get('rewritten') or '').strip()
  if not rw:
    i += 1
    continue
  if rw.endswith(':'):
    j=i+1
    items=[]
    while j < len(paras) and is_bullet_style(paras[j].get('style_name') or ''):
      items += split_items(str(paras[j].get('rewritten') or '').strip())
      j += 1
    if items:
      clean=[re.sub(r\"[\\s;.,]+$\", \"\", it).strip() for it in items if it.strip()]
      lines.append(ensure_period(rw + \" \" + join_dutch(clean)))
      i = j
      continue
  if is_bullet_style(p.get('style_name') or ''):
    items=split_items(rw)
    clean=[re.sub(r\"[\\s;.,]+$\", \"\", it).strip() for it in items if it.strip()]
    if clean: lines.append(ensure_period(join_dutch(clean)))
  else:
    lines.append(re.sub(r\"\\n+\", \"\\n\", rw))
  i += 1

OUT.write_text(\"\\n\".join(lines).strip()+\"\\n\",\"utf-8\")
print(\"wrote\", OUT)
PY
```

### 7.4 How to write for “micro-opsommingen” (without breaking gates)

When you see this pattern:
- `•Basis` ends with `:`
- followed by 2–4 short bullet items (semicolon encoded)

Prefer writing the **list-intro** as a normal sentence that reads well even if the bullets exist:
- If you **keep a real list** (semicolon items): end the intro with `:` so the list is anchored.
- If you **don’t want bullets** (Prince-first mode): rewrite the list as one or two flowing sentences (no semicolons).

Note:
- Bullet paragraphs are semicolon-encoded in canonical JSON. In `--mode indesign`, deterministic fixes keep separators tight (no spaces) to preserve deterministic apply.

---

## 8) History: why the guardrails exist (key incidents)

This is the “why” section. These guardrails were originally added for **deterministic InDesign apply**.
In `--mode prince` we keep the reading-flow / hygiene guardrails, but we deliberately relax semicolon item-count parity.

### 8.1 “Floating words / out-of-context lines” happened
Root causes we observed:
- list-intro lost its trailing `:` → first bullet looked like a random word (“water;”)
- bullet semicolon item-count mismatch → (InDesign apply) could not align items
- fuzzy matching could rewrite the wrong paragraph silently

Fixes that are now hard rules:
- list-intro colon integrity lint + deterministic restore
- (In `--mode indesign`) semicolon item-count parity lint for bullet paragraphs
- **fuzzy matches forbidden** (hard gate in `scripts/verify-applied-rewrites.ts`)

### 8.2 Trust failure: JSON ≠ what ended up in InDesign
We previously had runs where JSON looked “fine” but the output INDD was wrong because:
- matching drifted
- fuzzy claimed paragraphs
- logs didn’t prove final applied text

This is why the pipeline later uses:
- coverage TSV (did we touch every paragraph?)
- applied-fingerprint TSV (did the right text land exactly?)

Even in JSON-first mode, we keep JSON apply-safe so those proofs remain possible later.

### 8.3 The LLM iterate loop “thrash” problem
We had an iteration run that took ~25 cycles because:
- the loop treated warnings as failures and kept re-editing good text
- the checker penalized “bullet→prose explanation moves” as meaning loss, contradicting our intent

Fix:
- default convergence is now **critical-only** and the checker judges meaning at **section level**.

### 8.4 Other high-impact lessons learned (quick bullets)

- **Anchored objects**: some paragraphs contain anchored objects (U+FFFC). The InDesign apply engine must preserve those; therefore JSON must never introduce `\\r` and should avoid structural “splits” that would move anchors.
- **Layer blocks in list-intros**: praktijk/verdieping inside a list-intro paragraph (followed by bullets) caused “blocks” to land between intro and list. This is why we move layer blocks out of list-intros.
- **Soft hyphens (U+00AD)**: invisible characters caused subtle layout/validation issues; they are stripped in normalization and should not be introduced by LLM outputs.
- **Nested bullets**: nested bullet levels are visually noisy in two columns; we aim to reduce them (in JSON-first: via writing style + prose preview; in InDesign: via post-passes).
- **InDesign version mismatch**: some automation scripts (e.g. `scripts/run-book.ts`) reference “Adobe InDesign 2026” in AppleScript. If the environment only has 2024, those scripts must be updated before running them. (Not relevant for JSON-first runs, but critical for takeover later.)

---

## 9) Troubleshooting (JSON-first)

### 9.1 “PRE-FLIGHT FAILED: Contains \\r”
You introduced paragraph breaks. Replace with `\\n` or merge into a single paragraph.

### 9.2 “list-intro paragraph … lost trailing ':'”
Your rewrite removed `:` from an intro that anchors bullets. Restore it.

### 9.3 “bullet semicolon-list structure mismatch”
This only applies in `--mode indesign`.
- In `--mode indesign`: you changed the number of semicolon items. Restore item count exactly.
- In `--mode prince`: item-count changes are allowed (bullets are not a deterministic contract).

### 9.4 “Bullets still feel like bullets”
That is expected in canonical JSON. Use the **prose preview** for human review.

---

## 10) Environment + secrets (discipline)

LLM scripts:
- use provider keys from `.env.local` (or your shell):
  - `ANTHROPIC_API_KEY` (current default in this repo)
  - `OPENAI_API_KEY` only if you run provider=openai or use the OpenAI-only review step

DB scripts:
- `scripts/export-rewrites-json-from-db.ts` uses Supabase REST:
  - `SUPABASE_URL` / `VITE_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- `new_pipeline/export/export-canonical-from-db.ts` uses Postgres:
  - `DATABASE_URL` (or local Supabase defaults if not set)

Rules:
- Never commit `.env` / `.env.local` (already ignored)
- Use real env vars (no placeholders)

---

## 11) Change-control (keep rules in sync)

If you change any system rules, update:
- `docs/CURSOR_RULES.md`
- `.cursorrules`
- `.cursor/rules/INDESIGN_AUTOMATION.md`
- `docs/SYSTEM_OVERVIEW_FOR_LLM_REWRITE_AGENT.md`
- this doc (`docs/JSON_FIRST_WORKFLOW_FOR_LLM_AGENT.md`)
