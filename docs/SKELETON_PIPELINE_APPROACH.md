# Skeleton-First Pipeline: Complete Approach

**Last Updated:** December 28, 2024  
**Status:** Working pipeline for A&F N4 book with Sonnet 4.5

## Overview

This document describes the complete "skeleton-first" pipeline for generating professional textbook PDFs with LLM-enhanced content including:
- Rewritten N3-style text
- "In de praktijk" (nursing practice) boxes
- "Verdieping" (deepening) boxes for complex content
- Microheadings for improved readability
- Per-chapter opener images from InDesign

## Pipeline Steps

### Step 1: Export Canonical JSON from Database

```bash
cd new_pipeline
npx tsx export/export-canonical-from-db.ts <UPLOAD_UUID> --out output/canonical_book_with_figures.json
```

### Step 2: Extract Chapter Opener Images from InDesign

Run the ExtendScript `export-chapter-openers-v2.jsx` in InDesign with the source book open:
- Opens InDesign document
- Finds pages with chapter title styles (•Hoofdstukcijfer, •Hoofdstuktitel)
- Exports each as JPEG to `new_pipeline/assets/images/chapter_openers/chapter_N_opener.jpg`

### Step 3: Generate Skeleton and Rewrites (Pass 1)

```bash
cd new_pipeline
for ch in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
  echo "========== CHAPTER $ch =========="
  npx tsx scripts/build-chapter.ts \
    --chapter $ch \
    --in-json output/canonical_book_with_figures.json \
    --rewrite-mode skeleton \
    --rewrite-provider anthropic \
    --rewrite-model claude-sonnet-4-5-20250929
done
```

This creates:
- `output/skeleton_ch1.json` - structural skeleton with unit classifications
- `output/rewrites_ch1.json` - LLM-generated rewrites for all units

**Note:** The loop overwrites skeleton files but accumulates rewrites into `rewrites_ch1.json`.

### Step 4: Add Verdieping & Microheadings (Pass 2)

```bash
cd new_pipeline
npx tsx scripts/pass2-verdieping-microheadings.ts \
  output/skeleton_ch1.json \
  output/rewrites_ch1.json \
  output/rewrites_ch1_pass2.json \
  --provider=anthropic \
  --model=claude-sonnet-4-5-20250929
```

This pass:
- Processes each section separately (avoids LLM context length limits)
- Selects ~30-40% of above-average-length blocks for microheadings
- Identifies complex content (≥65 words) for Verdieping boxes
- Marks Verdieping content with `<<VERDIEPING_BOX>>` markers
- Prepends microheadings with `<<MICRO_TITLE>>` markers

**Key Rules:**
- Verdieping blocks don't get microheadings (they have their own label)
- Microheadings are 2-4 word topic labels, not sentence fragments
- No generic terms like "uitleg", "beschrijving", "functie"

### Step 5: Assemble Final JSON

```bash
cd new_pipeline
npx tsx scripts/assemble-skeleton-rewrites.ts \
  output/canonical_book_with_figures.json \
  output/skeleton_ch1.json \
  output/rewrites_ch1_pass2.json \
  output/canonical_book_FINAL.assembled.json
```

The assembler:
- Extracts `<<VERDIEPING_BOX>>` content into `block.verdieping` field
- Strips markers and places content correctly
- Handles "SKIP" responses for irrelevant praktijk boxes

### Step 6: Render PDF

```bash
cd new_pipeline
npx tsx renderer/render-prince-pdf.ts \
  output/canonical_book_FINAL.assembled.json \
  --out output/canonical_book_FINAL.pdf
```

The renderer:
- Uses per-chapter opener images from `chapter_openers/chapter_N_opener.jpg`
- Falls back to default opener if per-chapter not found
- Renders Verdieping/Praktijk boxes with proper styling
- Applies microheadings as green bold titles

## Key Files

| File | Purpose |
|------|---------|
| `scripts/build-chapter.ts` | Main orchestrator for skeleton-first flow |
| `scripts/extract-skeleton.ts` | Extracts structural skeleton, classifies units |
| `scripts/generate-from-skeleton.ts` | LLM generates text for each unit |
| `scripts/pass2-verdieping-microheadings.ts` | Adds verdieping boxes and microheadings |
| `scripts/assemble-skeleton-rewrites.ts` | Combines skeleton + rewrites into canonical JSON |
| `renderer/render-prince-pdf.ts` | Generates HTML and PDF via Prince |
| `lib/llm.ts` | Centralized LLM helper functions |
| `lib/load-env.ts` | Environment variable loading |

## Content Rules

### Terminology (Non-negotiable)
- Use **"zorgvrager"** (never cliënt/client/patiënt)
- Use **"zorgprofessional"** (never verpleegkundige)
- Use **"je"** perspective for reader

### Verdieping Boxes
- Select EXISTING complex content (≥65 words, ~9 lines minimum)
- Do NOT generate new text - just mark for box rendering
- No microheadings (they have their own "Verdieping:" label)
- Content should explain mechanisms, formulas, multi-step processes

### In de praktijk Boxes
- GENERATED as new content by LLM
- Must be topically relevant to subsection
- Start with concrete moment/action, use "je" perspective
- Can be SKIPPED if no sensible nursing connection exists
- No boilerplate like "noteer in dossier" or "bespreek met team"

### Microheadings
- 2-4 word topic labels (e.g., "De celmembraan", "Bloeddruk meten")
- ~30-40% of above-average blocks
- Evenly distributed through sections
- No sentence fragments or generic words

## CSS Box Styling

```css
.box {
  break-inside: auto;
  page-break-inside: auto;
  box-decoration-break: clone;
}

.box p {
  orphans: 9;
  widows: 9;
}

.box .box-label {
  display: block;
  break-after: avoid;
}
```

## Troubleshooting

### LLM Context Length Exceeded
Pass 2 processes sections individually to avoid this. If it still happens, the error is caught and logged.

### Missing API Key
Ensure `.env.local` in repo root contains `ANTHROPIC_API_KEY=sk-ant-...`

### Chapter Opener Images Not Found
Run `export-chapter-openers-v2.jsx` in InDesign with the source book open.

### Verdieping/Praktijk Box Layout Issues
Check CSS for `orphans: 9; widows: 9;` on `.box p` and `break-after: avoid;` on `.box-label`.











