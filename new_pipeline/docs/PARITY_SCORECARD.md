## InDesign parity scorecard (Prince output, target ~90% parity)

This scorecard defines “close to InDesign” for the Prince-rendered PDF, and where each item is validated (hard gate vs visual calibration).

### A) Hard gates (must be green)

- **A1 Grid tokens present**: `design_tokens.json` must include page size, margins (inner/outer/top/bottom), body column count and gutter.
  - **Enforced by**: `new_pipeline/validate/verify-design-tokens.ts` (new)

- **A2 Content coverage parity**: canonical JSON must include all DB paragraph IDs for the chapter (excluding explicitly skipped header styles) and preserve ordering.
  - **Enforced by**: `new_pipeline/validate/verify-canonical-vs-db.ts` (new)

- **A3 Numbering parity**: all paragraphs retain canonical (chapter, paragraph_number, subparagraph_number) and subparagraph_number is present (even if null), consistent with existing rules.
  - **Enforced by**: existing gate `scripts/verify-json-numbering-vs-n4.py` for InDesign JSON; for canonical JSON: `verify-canonical-vs-db.ts` (new)

- **A4 Figures parity**:
  - File exists on disk.
  - Caption body exists.
  - Figure label exists and ends with `:`.
  - No duplicate figure numbers within chapter.
  - **Enforced by**: `new_pipeline/validate/verify-figures.ts` (already)

- **A5 Prince render clean**:
  - No missing-image warnings.
  - No CSS parse errors.
  - No severe overflow warnings (if present in logs).
  - **Enforced by**: `new_pipeline/validate/verify-prince-log.ts` (new)

- **A6 Text hygiene**:
  - No soft hyphens (U+00AD).
  - No control characters.
  - **Enforced by**: `verify-canonical-vs-db.ts` (new)

### B) Visual parity gates (measured on reference spreads; must pass score thresholds)

We accept that page breaks and line breaks differ. We still demand strong visual parity on representative spreads.

- **B1 Page geometry parity (±1mm)**:
  - page size matches (195x265mm)
  - margins match within tolerance
  - column count matches
  - column gutter matches within tolerance
  - **Measured by**: token extraction + sanity check script; confirmed by screenshots

- **B2 Typography system parity**:
  - body size/leading feels equivalent (no cramped or airy pages)
  - headings hierarchy (h2/h3) matches scale relationships
  - captions smaller than body and aligned like book
  - **Measured by**: reference spreads; tuning via token CSS generator

- **B3 Paragraph rhythm parity**:
  - body paragraphs use “space-after” rhythm (not indents) if that’s the InDesign style
  - headings spacing above/below matches (not too loose)
  - **Measured by**: reference spreads

- **B4 Lists parity**:
  - bullets lvl1/2/3: indentation, spacing, bullet glyph style, nested rhythm
  - numbered steps render as true ordered lists (not “1 … 2 …” glued)
  - **Measured by**: reference spreads + `verify-canonical-vs-db.ts` checks list blocks exist for list styles

- **B5 Callouts parity (Praktijk/Verdieping)**:
  - label formatting matches Option A (label bold only + colon, inline text)
  - box styling approximates InDesign: padding, rule/border, background tint
  - **Measured by**: reference spreads

- **B6 Figures placement parity**:
  - figures appear near intended anchors
  - single-column vs full-width behavior matches intent
  - caption alignment + label formatting matches
  - **Measured by**: reference spreads

### C) Reference spreads (for calibration loop)

For Chapter 1, we tune against 4–6 spreads:
- TOC page
- plain body spread
- body + figure + caption
- body + bullets (lvl1/2)
- body + Praktijk/Verdieping callout
- optional table spread
































