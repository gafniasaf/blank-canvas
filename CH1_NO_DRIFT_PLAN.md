### CH1 “NO‑DRIFT” PLAN (source → JSON → InDesign)

This document is the **single source of truth** for what we are doing next.  
If something is not in this plan, I **do not change it** without asking you.

---

### Current status (so we don’t drift)

- **N3 prompt is now “harder” on simplicity**: distilled from real N3 anchors **plus** rejected CH1 output samples (LLM-based prompt builder). ✅
- **Generation is LLM-first end-to-end**: if a layer fails N3 QA, we do **LLM layer repair** (not deterministic emptying). ✅
- **Local DB restored via IDML ingest** (Supabase Postgres): ✅  
  - Target upload (current): `0742a918-0b1a-468e-af86-72c61a686b91` (title: `MBO A&F Common Core (basisboek, N3-focus) [auto]`, level `n3`)
- **CH1 regenerated**: ✅ (25/25 paragraphs) with non-empty layers after fill (praktijk ~16, verdieping ~13).
- **Exported**: `~/Desktop/rewrites_for_indesign.json` ✅ (lint: 25/25, 0 warnings)
- **Applied to InDesign (safe v5)**: ✅  
  - Output INDD: `~/Desktop/Generated_Books/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720_CH1_REBUILD_RELEASE_20251219_133942_V5_SAFE_REWRITTEN_V5_SAFE.indd`
- **Automated QA** (latest run): ✅ links/fonts OK, overset 0, headings bold OK, layer paras LEFT_ALIGN OK; **2 whitespace “missing space after punct” findings** remain to investigate.

---

### Locked decisions (do not revisit unless you explicitly change them)

- **Scope**: **Chapter 1 only** (generation, JSON export, InDesign apply, validations).
- **Output in InDesign**: **`basis` + “In de praktijk:” + “Verdieping:” in the SAME paragraph** (Option A).
  - Headings are inserted by the **assembly layer**, not by the rewrite layers themselves.
  - Headings are **bold**, include the **colon**, and are preceded by an **empty line** (double `\n`).
  - After the colon, text starts lowercase **except abbreviations** (AB0/DNA/ATP etc).
- **InDesign-safe text**:
  - **Never** write `\r` into any generated text. Only `\n` is allowed.
  - **No markdown/bullets/copywriting blocks** in generated text.
  - **Anchored objects (`\uFFFC`) must be preserved** during InDesign replacement.
- **Typography**:
  - Body paragraphs: **`LEFT_JUSTIFIED`** (justify, last line left), never “justify all lines”.
  - Single-word justification: **LEFT_ALIGN**.
  - Paragraphs containing layer blocks (Option A) are treated as **ragged-right (LEFT_ALIGN)** because InDesign can’t align single lines differently within one paragraph safely.
- **Safety principle**: **Never normalize/modify all stories**. Always identify **CH1 body story** and operate only there. Treat other stories as labels/callouts unless proven otherwise.

---

### What “LLM-first” means here (to avoid the “rule-based drift”)

- **LLM does the intelligence**:
  - Distill target N3 A&F style from real book anchors.
  - Generate/repair rewrites (basis/praktijk/verdieping) under constraints.
  - Decide whether praktijk/verdieping are meaningful per paragraph (empty is allowed when truly not useful).
- **Deterministic validators are guardrails (stop-conditions), not a writing method**:
  - They exist to prevent silent regressions that would otherwise require manual QA in InDesign.

---

### Stop-conditions (pipeline must halt if any fails)

#### JSON / rewrite quality (pre-InDesign)
- **No `\r`** anywhere in rewritten content.
- **No embedded layer labels** in rewrite layers (no “In de praktijk:” / “Verdieping:” inside praktijk/verdieping text).
- **N3 readability gate** must pass (short sentences, low long-word ratio; praktijk/verdieping max 2–3 short sentences when non-empty).
- **Assembly validator must pass**:
  - Option A formatting correct (`\n\n<<BOLD_START>>In de praktijk:<<BOLD_END>> ...` etc).
  - Abbreviation capitalization preserved after colon.
  - No “glued text” anomalies (missing spaces after punctuation) introduced by assembly.

#### Product-spec sanity (pre-InDesign)
- Chapter 1 must not end up with **all praktijk empty** and **all verdieping empty**.
  - This is not a style rule; it’s verifying we actually shipped the agreed “layers included” product.
  - Baseline reference: historically CH1 had **~12 praktijk** and **~7 verdieping** non-empty.

#### InDesign apply + QA
- Links/fonts: **0 missing**, **0 out-of-date**, **0 missing fonts**.
- CH1 validations: overset, headings correctness, whitespace anomalies (body story only), isolated bullets scan.
- Chapter-boundary rules:
  - Chapter start page: image only (no text).
  - Chapter end: blank page.

---

### Execution plan (commands & artifacts)

#### A) Distill N3 A&F style into a generator prompt (LLM)
- Input: `scripts/style/n3_style_anchors.json`
- Output: `scripts/style/n3_style_prompt.generated.json`

Command (recommended, uses rejected output examples to reduce complexity):
- `npx tsx scripts/style/distill-n3-style-prompt.ts --anchors scripts/style/n3_style_anchors.json --out scripts/style/n3_style_prompt.generated.json --candidate ~/Desktop/rewrites_for_indesign.json`

#### B) Regenerate CH1 rewrites in DB (LLM generation + LLM judge/repair)
- Upload ID (current): `0742a918-0b1a-468e-af86-72c61a686b91`
- Chapter: `1`
- Status: `approved`
- System prompt override: `scripts/style/n3_style_prompt.generated.json`

Command:
- `npx tsx scripts/rewrite-local-full.ts 0742a918-0b1a-468e-af86-72c61a686b91 1000 --status approved --chapter 1 --force --systemPromptFile scripts/style/n3_style_prompt.generated.json`

Then ensure layers are present (LLM-based fill, keeps QA gates):
- `npx tsx scripts/fill-praktijk-verdieping-chapter.ts 0742a918-0b1a-468e-af86-72c61a686b91 --chapter 1 --status approved --minPraktijk 10 --minVerdieping 6`

#### C) Export InDesign JSON (assembly layer = Option A headings + bold markers)
- Output: `~/Desktop/rewrites_for_indesign.json`

Command:
- `npx tsx scripts/generate-rewrites-json-for-indesign-pg.ts 0742a918-0b1a-468e-af86-72c61a686b91 --chapter 1`

Lint:
- `npx tsx scripts/lint-rewrites-json-for-indesign.ts ~/Desktop/rewrites_for_indesign.json`

#### D) Apply to InDesign safely (CH1 body story only)
- Use the **safe replacer** that skips labels/callouts and preserves anchors.
- Then run CH1 validation suite + chapter-boundary QA.
- Save checkpoint/release INDD.

Automation wrappers (in this repo):
- Apply: `/Users/asafgafni/Desktop/InDesign/TestRun/run-ch1-rewrite-v5-safe.jsx`
- Validate latest output: `/Users/asafgafni/Desktop/InDesign/TestRun/run-ch1-validation-suite-latest.jsx`

NOTE on Supabase local data:
- Do **NOT** stop Supabase with `--no-backup` if you care about keeping your local DB contents.
- Prefer `npx supabase stop` (default behavior) so you can restore if needed.

---

### “No drift” protocol (how we prevent me from pivoting)

- If I want to change **any locked decision**, I must:
  - point to the exact line in this doc,
  - propose the change,
  - ask you to approve it,
  - and update the doc first.
- If I discover a contradiction (e.g., validators force praktijk/verdieping to empty), I must:
  - stop,
  - explain the conflict,
  - propose an LLM-based fix (not a heuristic rewrite),
  - and only then proceed.


