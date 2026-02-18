## Prince layout rules & design decisions (new_pipeline)

This document is the **single source of truth** for the *Prince* (HTML→PDF) layout rules we have defined and implemented in this repo.

Scope:
- ✅ **Prince pipeline only** (`new_pipeline/*`): HTML generation, CSS templates, validations, layout heuristics.
- ❌ Not the InDesign rewrite/apply pipeline (covered elsewhere, e.g. `docs/CURSOR_RULES.md`).

If you change any rule here, update the relevant code + validations and keep the “system guardrail” docs in sync when applicable.

---

## How the Prince pipeline runs (CH1)

From `new_pipeline/`:

- `npm run build:ch1` (convenience for chapter 1) runs:
  - **Tokens**: `npm run tokens:ch1`
    - `tsx extract/parse-idml-design-tokens.ts ... --out new_pipeline/extract/design_tokens.json`
    - `tsx templates/generate-prince-css-from-tokens.ts ... --out new_pipeline/templates/prince-af-two-column.tokens.css`
  - **Token validation**: `npm run validate:tokens`
  - **Export canonical JSON + inject figures**: `tsx export/export-canonical-from-db.ts ... --out output/canonical_ch1_with_figures.json`
  - **Canonical vs DB validation**: `npm run validate:canonical:ch1`
  - **Figure validation**: `npm run validate:figures:ch1`
  - **Render + validate**: `npm run validate:render:ch1`

For future chapters (standardized):
- `npm run build:chapter -- --upload <UUID> --chapter <N> [--figures <figures.json>] [--rewrites <FINAL.json>] [--report]`
  - This runs the same tokens/render/layout validations as CH1, but outputs chapter-specific files:
    - `new_pipeline/output/canonical_ch<N>_with_figures.json`
    - `new_pipeline/output/canonical_ch<N>_professional.pdf`
  - Requires DB connectivity (same prerequisite as `export/export-canonical-from-db.ts`).

Whole-book (single merged PDF):
- `npm run build:book -- --upload <UUID> --chapters 1,2,3,... [--figures <figures_all.json>] [--rewrites <FINAL.json>] [--report]`
  - Exports canonical JSON per chapter, merges into one book JSON, optionally overlays JSON-first rewrites, renders one PDF, then runs the same layout gates.

Render-only (no DB needed):
- `npm run build:chapter -- --chapter <N> --in-json output/canonical_ch<N>_with_figures.json`
  - Skips DB export + canonical-vs-DB validation, but still runs figure checks, render, and layout gates.

Skeleton-first rewrite (no DB needed; produces a rewritten canonical JSON + PDF):
- `npm run build:chapter -- --chapter <N> --in-json output/canonical_ch<N>_with_figures.json --rewrite-mode skeleton [--section 1.1] [--rewrite-provider openai --rewrite-model gpt-4o-mini]`
  - Writes intermediate artifacts to `new_pipeline/output/`:
    - `skeleton_ch<N>.json`
    - `rewrites_ch<N>.json`
    - `<inputBaseName>.assembled.json`

Key outputs:
- **HTML**: `new_pipeline/output/canonical_ch1_with_figures_prince.html`
- **PDF**: `new_pipeline/output/canonical_ch1_professional.pdf`
- **Prince log**: `new_pipeline/output/canonical_ch1_prince.log`

---

## Source-of-truth inputs the Prince layout depends on

### Design tokens (typography + page geometry)
- File: `new_pipeline/extract/design_tokens.json`
- Source: IDML snapshot exported from the canonical InDesign doc.
- Used by: `new_pipeline/templates/generate-prince-css-from-tokens.ts`

### Canonical content JSON (text + numbering)
- Render input: `new_pipeline/output/canonical_ch1_with_figures.json`
- Contains:
  - `chapter/section/subparagraph` structure (numbers + titles)
  - content blocks: paragraphs, list blocks, steps, images
  - `role` values used for styling (examples: `body`, `bullet_lvl1`, `numbered_steps`)

### Figure assets (atomic exports)
- Figures are exported from InDesign as “atomic” PNGs so callouts/labels are preserved.
- The renderer references figure assets by path; paths in JSON are treated as **repo-root relative**.

---

## HTML structure rules (critical for multi-column layout)

### “Flattened” chapter body
Prince’s `column-span: all` works reliably when spanning elements are **direct children** of the multi-column container.

Therefore, the renderer intentionally emits headings and figures as direct children of `.chapter-body`, avoiding extra wrappers that would break `column-span`.

Renderer file:
- `new_pipeline/renderer/render-prince-pdf.ts`

CSS file:
- `new_pipeline/templates/prince-af-two-column.css`

---

## Frontmatter / Backmatter (Prince-only pages like Voorwoord, Colofon, Bronnen)

We support non-chapter pages as **Prince-native HTML fragments** that are injected into the generated HTML before rendering.

### Files (edit these for content)
- `new_pipeline/templates/frontmatter.html`
- `new_pipeline/templates/backmatter.html`

These are plain HTML fragments (not full HTML documents). They are inserted by:
- `new_pipeline/renderer/render-prince-pdf.ts`

### Styling rules
- Uses the same token-driven CSS as the rest of the book (same fonts/colors/spacing).
- The matter pages use a dedicated page master (`@page matter`) that **removes running headers** (no chapter/section header text) while keeping page numbers.
- Each matter section is wrapped in `.matter-section` (starts on a new page).
- Matter body text is wrapped in `.matter-body.chapter-body` so it uses the same two-column flow as chapters.

---

## Typography rules (InDesign parity)

### Body font + size + leading
Token-driven:
- `--font-body`, `--body-size`, `--body-leading`

### Justification: InDesign LEFT_JUSTIFIED
Rule:
- Body paragraphs are **justified**, but the last line remains left (InDesign `LEFT_JUSTIFIED` behavior).

Implementation:
- `.p { text-align: justify; }`

Avoid:
- `FULLY_JUSTIFIED` (justify-all) for body text.

### Widows/orphans and page fill trade-off
We expose:
- `--orphans`, `--widows`

Lower values increase page fill but can allow less-ideal breaks.

### Hyphenation (Dutch)
Enabled globally:
- `hyphens: auto;`
- `prince-hyphens: auto;`
- `hyphenate-limit-chars`, `hyphenate-limit-lines`, `hyphenate-limit-zone`

Hyphenation exceptions:
- Stored in `new_pipeline/templates/hyphenation_exceptions.json`
- Applied in renderer via insertion of **Word Joiner (U+2060)** to forbid specific breaks.

Validation:
- `python3 new_pipeline/validate/scan-hyphenation.py output/canonical_ch1_professional.pdf`

LLM fixer:
- `new_pipeline/fix/llm-fix-hyphenation.ts`
  - Generates exceptions and re-renders.

---

## Newline handling (must not break justification)

### Rule
Body text must not contain forced line breaks that become `<br>` inside body paragraphs, because that prevents normal justification and causes “one sentence per line”.

### Implementation
Renderer normalizes newline runs to spaces for flowing text:
- `renderInlineText(..., { preserveLineBreaks: false })`

Hard gate:
- `new_pipeline/validate/verify-no-hard-linebreaks.ts`
  - Fails if any `<p class="p..."> ... <br> ... </p>` exists in the generated HTML.

Wired into:
- `npm run validate:render:ch1`

---

## Heading rules

### Section headings (`h2.section-title`)
Token-driven spacing:
- `--h2-space-before`, `--h2-space-after` (from `_Chapter Header`)
Rendered **column-contained** (no `column-span`) to avoid column-set resets that can create half-empty columns in Prince’s multi-column flow.

### Subparagraph headings (`h3.subparagraph-title`)
Token-driven spacing:
- `--h3-space-before`, `--h3-space-after` (from `_Subchapter Header`)
Plus a small aesthetic tweak:
- `--h3-space-before-scale` (defaults to `1.25`) to give slightly more air above.

### Keep rules
All headings have:
- `break-after: avoid; page-break-after: avoid;`
to avoid headings stranded at the bottom with no following content.

---

## Lists and bullets (deterministic “too many bullets” rules)

### Goals
- Keep bullets only when they visually communicate a real list.
- Avoid turning single long “bullet sentences” into noisy bullet blocks.
- Never allow misaligned bullet markers (“sticking out to the left”).

### Renderer: list reconstruction + demotion
File:
- `new_pipeline/renderer/render-prince-pdf.ts`

Rules (deterministic):
- **Keep bullets only** when there are **≥3 short, parallel** items.
  - “Short” is a heuristic (currently: ~≤48 chars and ≤8 words; no sentence punctuation).
- Otherwise **demote** to normal paragraph text (`.p.list-demoted`) with no bullet glyph.
- Combine consecutive short list blocks (e.g., 2 + 2 items) into one run so real lists aren’t accidentally demoted.
- Nested lists (lvl2/lvl3) are only kept when they can be nested under a kept parent; else demoted.

Demoted list readability:
- For demoted lists that contain longer “explanatory” items, we render each item as its own paragraph.
- If an item has the pattern `Label. Uitleg...` (e.g. `De temperatuur. ...`), we render `Label` as a **micro-title** and the rest as body text.
  - Important: we explicitly **do not** treat full-sentence leads as labels (e.g. `Lactase breekt lactose af.` is NOT a heading).

### List spacing rule (prevent “list sticks to next line”)
Even though InDesign `_Bullets` often has SpaceAfter=0pt, in Prince we enforce a gap after lists:
- `ul.bullets + .p { margin-top: var(--block-gap); }`
- `ol.steps + .p { margin-top: var(--block-gap); }`

### Bullet marker alignment (marker inside text column)
Bullets are rendered with a hanging indent where the marker is right-aligned inside the hanging width so it doesn’t protrude left of the column.

### Bullet marker → text gap (readability)
We enforce a consistent gap between the bullet/step marker and the start of the text:
- CSS var: `--bullet-marker-gap`
- Used by:
  - `ul.bullets li::before { padding-right: var(--bullet-marker-gap); }`
  - `ol.steps li::before { padding-right: var(--bullet-marker-gap); }`

---

## Figures (images)

### Figure sizing
Current rule in renderer:
- Figures are rendered as `full-width` (full content width).
- `<figure>` is `width: 100%`, and `<img>` is `width: 100%` so captions wrap to the figure width.

### Full-width placement to avoid half-empty pages
CSS rule:
- Full-width figures prefer **bottom placement** so they fill leftover space and reduce “half page white”.
  - `figure.figure-block.full-width { float: bottom; }`
  - We use Prince page-float behavior for full-width figures:
    - `float-reference: page`
    - (no `column-span: all`) so figures don’t trigger column-set resets that leave big blank columns.

### Chapter opener (full-bleed)
Rule:
- Chapter opener should fill 100% of the page (no margins/whitespace around).

Implementation:
- Renderer tags opener: `<figure class="figure-block full-width chapter-opener">`
- Export convention (optional):
  - If a chapter opener image exists at `new_pipeline/assets/images/ch{N}/Book_chapter_opener.jpg`,
    it is attached as a chapter-level image and rendered as the opener.
- CSS:
  - `@page chapter-first { margin: 0; ... }`
  - `figure.chapter-opener { width: var(--page-width); height: var(--page-height); }`
  - `img { object-fit: cover; }`
  - Title block overlays with absolute positioning and uses normal margin padding to align to the book grid.

---

## Praktijk / Verdieping boxes

### Input format (Option A only)
Text is stored as:
- `\n\n<<BOLD_START>>In de praktijk:<<BOLD_END>> ...`
- `\n\n<<BOLD_START>>Verdieping:<<BOLD_END>> ...`

### Styling goals
- Textbook feel, print-friendly (flat tints, not web gradients).
- Praktijk: grey/green tint + classic icon.
- Verdieping: warm reddish/brown tint + classic icon.

Implementation:
- `.box.praktijk` / `.box.verdieping` with CMYK tints
- Label line:
  - The label (icon + “In de praktijk:” / “Verdieping:”) renders on its **own top line**, left-aligned.
  - Icon is embedded via `.box-label::before` (SVG data URL).
- Typography:
  - Box body text is **italic**.
  - Label stays **bold, non-italic**.
- First-line justification guard:
  - The first two words of the box text are wrapped in `<span class="box-lead">...</span>`.
  - CSS sets `.box-lead { display: inline-block; white-space: nowrap; text-align: left; }`
    to prevent Prince from creating huge justified gaps on short first lines (e.g. “Bij    een”).

---

## Validations (Prince pipeline)

### Hard gates currently in use
- `validate/verify-prince-log.ts` (Prince log must be clean)
- `validate/verify-no-hard-linebreaks.ts` (no `<br>` inside body paragraphs)
- `validate/verify-box-justify-gaps.py` (no extreme word gaps on Praktijk/Verdieping first lines)

### Page fill gate (new)
- Script: `new_pipeline/validate/verify-page-fill.py`
- NPM script: `npm run validate:pagefill:ch1`
  - Default threshold: page must have content reaching at least **50%** of the body area height (ignoring first 2 pages).

Note: this is a heuristic gate; tune thresholds and ignored pages as we learn which pages are legitimately sparse.

### Column balance gate (new)
Detects pages where the **right column is effectively empty** (the “half-page white on the right” problem).

- Script: `new_pipeline/validate/verify-column-balance.py`
- NPM script: `npm run validate:columnbalance:ch1`

### Report mode (JSON/TSV)
For tracking and debugging, we generate a deterministic report of per-page layout metrics:
- Script: `new_pipeline/validate/report-layout.py`
- NPM script: `npm run report:layout:ch1`
  - Writes:
    - `new_pipeline/output/canonical_ch1_layout_report.json`
    - `new_pipeline/output/canonical_ch1_layout_report.tsv`

---

## Known intentional deviations from InDesign

Prince output is not a 1:1 page composer. Intentional differences include:
- Heuristic placement of figures in a multi-column HTML flow.
- Deterministic bullet demotion rules (to reduce noisy bullets).
- Extra list→paragraph spacing for readability.
- Small spacing tweak above `h3` (subparagraph titles) for “air”.

---

## Where to change what

- **Renderer (HTML structure + heuristics)**:
  - `new_pipeline/renderer/render-prince-pdf.ts`
- **Base template (manual rules)**:
  - `new_pipeline/templates/prince-af-two-column.css`
- **Token generator (IDML → CSS vars)**:
  - `new_pipeline/templates/generate-prince-css-from-tokens.ts`
- **Token CSS output (generated; do not hand edit)**:
  - `new_pipeline/templates/prince-af-two-column.tokens.css`
- **Validations**:
  - `new_pipeline/validate/*`


