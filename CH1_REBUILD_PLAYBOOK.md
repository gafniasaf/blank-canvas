# Chapter 1 Rebuild Playbook (A&F) — Lessons Learned + Rules

This document captures what went wrong in earlier iterations, and the **rules** we will follow when rebuilding Chapter 1 “from scratch” while preserving **images/labels/callouts** and meeting the **justification** requirements.

## Goals (non‑negotiable)

- **Keep images + labels/callouts correct** (positions, associations, anchored objects).
- **Keep layout stable** (do not reflow the book unexpectedly).
- **Chapter 1 only**: work in a strict chapter scope; do not “clean up the whole book”.
- **Justification rules**: body text may be justified, but **never justify-all-lines**; last line must align left.
- **No manual auditing by you**: we must have repeatable scripts/checks.

## Automation (recommended): one-command rebuild driver

The repo now includes a safe-by-default driver that implements this playbook’s steps end-to-end **on a timestamped copy** and only edits the **CH1 body story**:

- Script: `/Users/asafgafni/Desktop/InDesign/TestRun/ch1-rebuild-from-scratch.jsx`
- Baseline input (unchanged):  
  `"/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd"`

Run:

```bash
osascript -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/ch1-rebuild-from-scratch.jsx" language javascript'
```

Notes:
- The driver creates 2 files next to the baseline INDD:
  - `*_CH1_REBUILD_<ts>.indd` (working file; saved)
  - `*_CH1_REBUILD_RELEASE_<ts>.indd` (release checkpoint; savedACopy)
- It prints a summary including **CH1 range**, **body story index**, counts of applied fixes, and basic postchecks.

Helper:
- Open the newest release file and jump to `^1.1`:
  - Script: `/Users/asafgafni/Desktop/InDesign/TestRun/open-ch1-rebuild-release.jsx`
  - Run:

```bash
osascript -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/open-ch1-rebuild-release.jsx" language javascript'
```

## What went wrong (lessons learned)

### 1) “Global fixes” broke local formatting and callouts
Broad formatting passes across *all* stories on CH1 pages (or whole document) can touch:
- Small text frames used for **callouts/labels/captions**
- Tiny side stories (headers/footers, figure labels, page furniture)

These often rely on **local character overrides**. Changing `paragraph.contents`, `fontStyle`, or justification broadly can produce:
- **half‑bold words**
- labels losing styling or becoming inconsistent
- unexpected spacing/flow artifacts

**Lesson**: Always scope to the **main body story only**, and modify other stories only when explicitly targeted by a narrow check.

### 2) Replacing `paragraph.contents` can wipe character-level styling
Any script that assigns `para.contents = "..."` can remove:
- inline bold/italic overrides
- local kerning/tracking adjustments
- character-level fixes on callouts

**Lesson**: Only use `para.contents` in the **body story**, and re-apply required bold markers afterward. Never run broad character normalization across all stories.

### 3) “Fix one line” within a paragraph is impossible with justification
In InDesign, justification is a **paragraph property**. You cannot set “the last line before the layer heading” to left-align while keeping the rest justified *within the same paragraph*.

**Lesson**:
- Use **Option A headings** (heading and first sentence on the same line) to avoid a short standalone heading line that gets stretched by justification.
- If you require “the last line before `In de praktijk:` / `Verdieping:` is align-left (not justified)”, you must set the **entire paragraph** containing those headings to `LEFT_ALIGN` (ragged right). There is no per-line alignment inside a paragraph.

### 4) JSON issues were often the root cause (not InDesign)
We repeatedly saw “kapotte opbouw” where **`In de praktijk:`** appeared in the wrong place (e.g., between “zoals:” and the bullet list).

**Lesson**:
- InDesign didn’t invent these mistakes: if the **combined rewrite** is wrong in `rewrites_for_indesign.json`, the INDD output will be wrong too.
- Therefore: add a **human-review gate** for the JSON and do not overwrite `~/Desktop/rewrites_for_indesign.json` automatically.

### 5) Bullet paragraphs are tricky because we do not change paragraph counts
Many original books encode short lists as one paragraph with semicolons, e.g. `"zuurstof;koolstofdioxide;water."`.
Our safe apply script preserves layout by replacing text **in place** without splitting/merging paragraphs.

**Lesson**:
- Treat semicolon bullets as a *content encoding* that must be handled upstream (JSON generation + review rendering).
- Avoid inserting layer blocks (“In de praktijk”, “Verdieping”) into **list-intro paragraphs** (ending with `:`), otherwise the layer lands between the intro and the list.

### 6) Validation must be baseline-aware for boundary pages
The baseline template already contains body-story words on the chapter-2 intro/image page for this book.

**Lesson**:
- Chapter boundary checks should be **relative to baseline** (delta-based) to avoid false positives.
- Keep strict rules only for: CH1 start image page and CH1 blank end page.

## Rebuild strategy (safe-by-default)

### A) Work on a copy, never the original
- Always open the original preview INDD **read-only in practice**.
- Immediately `saveACopy` to a timestamped working file.
- Close the original (no save prompts) and work only in the copy.

### B) Strict chapter scope
- Determine Chapter 1 range by finding first `^1.1` and first `^2.1`, and define the page-offset range between them.
- All checks and fixes must be constrained to that range.

## JSON review gate (required) — “perfect JSON” workflow

Goal: you read the JSON **before** it is consumed by InDesign.

### 1) Generate a DRAFT JSON (do NOT overwrite Desktop final)
The generator now writes a draft by default and only promotes when you explicitly do so.

Generate:

```bash
cd /Users/asafgafni/Desktop/bookautomation/book-insight-craft-main
npx tsx scripts/generate-rewrites-json-for-indesign-pg.ts <UPLOAD_ID> --chapter 1
```

Output (default):
- `~/Desktop/rewrites_for_indesign.DRAFT.json`

Important behavior:
- The generator suppresses praktijk/verdieping blocks in **list-intro paragraphs** (e.g. ending with “zoals:”) to avoid misplacement between intro and bullet list.
- It records those suppressions under `generation_warnings` in the JSON.

### 2) Lint the draft (structural rules)

```bash
cd /Users/asafgafni/Desktop/bookautomation/book-insight-craft-main
npx tsx scripts/lint-rewrites-json-for-indesign.ts ~/Desktop/rewrites_for_indesign.DRAFT.json
```

### 3) Export a human REVIEW.md

```bash
cd /Users/asafgafni/Desktop/bookautomation/book-insight-craft-main
npx tsx scripts/export-rewrites-review-md.ts ~/Desktop/rewrites_for_indesign.DRAFT.json
```

This writes:
- `~/Desktop/rewrites_for_indesign.DRAFT.json.REVIEW.md`

### 4) (Optional) Proofread (spelling/grammar only; preserves structure)

```bash
cd /Users/asafgafni/Desktop/bookautomation/book-insight-craft-main
export OPENAI_API_KEY=... # required
npx tsx scripts/proofread-rewrites-json.ts ~/Desktop/rewrites_for_indesign.DRAFT.json ~/Desktop/rewrites_for_indesign.DRAFT.proofread.json
npx tsx scripts/export-rewrites-review-md.ts ~/Desktop/rewrites_for_indesign.DRAFT.proofread.json
```

### 5) Human approval → promote to Desktop final JSON
Only after you approve the content:

```bash
cd /Users/asafgafni/Desktop/bookautomation/book-insight-craft-main
npx tsx scripts/promote-rewrites-for-indesign.ts ~/Desktop/rewrites_for_indesign.DRAFT.json
```

This copies to:
- `~/Desktop/rewrites_for_indesign.json`
- and writes a timestamped backup next to it.

### 6) Apply to InDesign (safe v5)
Run the safe chapter-scoped apply on the baseline INDD and validate output (see the rest of this playbook).

### C) Main-body story only (protect labels/callouts)
- Compute word counts per story within the CH1 range.
- Choose the **body story = max word count**.
- Apply text/justification cleanup **only to the body story**.
- Treat any other story as **potential label/callout/caption story** and leave it untouched unless:
  - the anomaly scan flags it, and
  - the fix is a tiny targeted change.

## Rules: “In de praktijk” / “Verdieping”

### Placement
- Always inside the **same existing paragraph**.
- **Forbidden**: `\r` (new paragraph).
- **Allowed**: `\n` (forced line break).

### Heading format (Option A — approved)
To avoid ugly justification stretching, headings must be inline:

- Blank line first (same paragraph): `\n\n`
- Bold heading label with colon, then a space, then text:
  - `In de praktijk:` **(bold)** + space + content
  - `Verdieping:` **(bold)** + space + content

Example:
```
...\n\nIn de praktijk: Bij een zorgvrager ...\n\nVerdieping: AB0-antigenen ...
```

### Content rules
- Prose only (no “Situatie/Opdracht/Criteria/Veiligheid” blocks)
- No bullets/numbering in these blocks
- No overlap across layers:
  - praktijk ≠ basis in other words
  - verdieping ≠ basis/praktijk
- Terminology: prefer “zorgvrager”, “zorgprofessional”, “zorgverlener”
- N3 brevity:
  - praktijk/verdieping: **2–3 short sentences**

## Rules: Justification (opmaak)

### Body text
- Allowed: justified, but **must not** be “justify all lines”.
- Required: **last line aligned left**.
  - In InDesign terms: `LEFT_JUSTIFIED` (justify with last line left).

### Paragraphs that contain layer headings (In de praktijk / Verdieping)
Because the headings are inserted using **forced line breaks** (`\n`) *inside the same paragraph*, the line **immediately before** `In de praktijk:` / `Verdieping:` is **not** the paragraph’s “last line” in InDesign — so it can get stretched by justification.

**Rule** (requested): the last line **before** those headings must be **align left (not justified)**.

**Implementation (InDesign limitation)**: InDesign cannot align only one line inside a paragraph.  
So for any paragraph that contains `In de praktijk:` or `Verdieping:`, set the **entire paragraph** to:
- `LEFT_ALIGN` (ragged right; no justification stretching anywhere in that paragraph)

### Disallowed
- `FULLY_JUSTIFIED` (justify-all-lines).
- single-word justified stretching:
  - set `singleWordJustification = LEFT_ALIGN` where available.

### Paragraph-level overrides
If any paragraph-level override uses `FULLY_JUSTIFIED`, change it to `LEFT_JUSTIFIED`.

### Justification “spacing” tuning (only if needed, body story only)
If you still see too much/too little spacing, adjust on **paragraph objects** (not global styles) in the body story:
- word spacing: 80 / 100 / 120
- letter spacing: -2 / 0 / 2
- glyph scaling: 98 / 100 / 102
- enable hyphenation
- use Adobe Paragraph Composer

**Never** apply these settings to non-body stories (labels/callouts).

## Validation & anomaly detection (must run every iteration)

### Minimum required scripts (repo)
- `validate-ch1.jsx`: CH1 overset, headings, spacing anomalies
- `scan-ch1-anomalies.jsx`: stray stories & bullet/list anomalies (non-body stories)
- `scan-ch1-isolated-bullets.jsx`: finds “single floating bullet” in body story

### Acceptance criteria (CH1)
- Links/fonts: 0 missing / 0 modified
- CH1 overset frames: 0
- Headings present and bold:
  - `In de praktijk:` count matches expected
  - `Verdieping:` count matches expected
- Isolated bullet paragraphs in body story: 0
- No “missing space after punctuation” anomalies in body text

### Operational note: avoid AppleScript timeouts (-1712)
If InDesign is busy, wrap calls with a larger timeout:

```bash
osascript -e 'with timeout of 600 seconds' \
  -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/validate-ch1.jsx" language javascript' \
  -e 'end timeout'
```

### Validation note: caption double-spaces
Many figure captions intentionally contain a double space (e.g., `Afbeelding 1.2␠␠...`).  
`validate-ch1.jsx` now validates whitespace anomalies on the **CH1 body story only** by default, to avoid false positives from captions/callouts.

### Validation note: layer paragraphs are LEFT_ALIGN
To satisfy the “last line before `In de praktijk:` / `Verdieping:` must be align-left” requirement, paragraphs containing those headings are validated as `LEFT_ALIGN` (not `LEFT_JUSTIFIED`).

## What NOT to do (hard “don’t” list)

- Don’t run any “normalize bold/spacing/justification” across **all stories**.
- Don’t modify paragraph style definitions globally unless explicitly approved.
- Don’t try to “fix” labels/callouts by changing their story text unless targeted.
- Don’t save the original INDD; always use `saveACopy` with a timestamp.
- Don’t attempt to fix later chapters while working on CH1.

## Rebuild checklist (the actual “from scratch” run)

1) Open original CH1 preview INDD → verify links/fonts OK
2) SaveACopy to `*_CH1_REBUILD_<ts>.indd` → close original
3) Detect CH1 range + body story
4) Apply rewrites in body story (preserve anchors; avoid \r)
5) Apply Option A headings (`In de praktijk:` / `Verdieping:`) + bold labels
6) Apply justification rules (no FULLY_JUSTIFIED; last line left)
7) Run validation scripts:
   - validate CH1
   - scan anomalies
   - scan isolated bullets
8) SaveACopy “release” checkpoint for review


