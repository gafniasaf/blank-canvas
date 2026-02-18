# Skeleton-First Pipeline Status

**Last Updated**: December 28, 2025  
**Status**: ✅ Working and tested on sections 1.1 and 2.1

---

## Overview

The skeleton-first pipeline rewrites MBO textbook chapters with:
- **Basis content**: N3-level (simple, accessible) prose
- **Verdieping boxes**: Selected from existing complex content (minimum 65 words / ~9 lines)
- **In de praktijk boxes**: LLM-generated nursing scenarios (topically relevant, or SKIP if irrelevant)
- **Micro-headings**: Topic labels for above-average text blocks

---

## Entry Point

```bash
cd new_pipeline
npx tsx scripts/build-chapter.ts \
  --chapter 1 \
  --in-json output/canonical_ch1_with_figures.json \
  --rewrite-mode skeleton \
  --section 1.1  # Optional: filter to single section for testing
```

For full book:
```bash
npx tsx scripts/build-chapter.ts \
  --chapter 1 \
  --in-json output/canonical_book_with_figures.json \
  --rewrite-mode skeleton
```

---

## Pipeline Steps (Orchestrated by `build-chapter.ts`)

### 1. Extract Skeleton (`extract-skeleton.ts`)
- Converts canonical JSON → skeleton with `GenerationUnit`s
- LLM planning phase assigns:
  - **Micro-headings**: Topic labels (2-4 words, not sentence fragments, not bolded terms)
  - **Verdieping selection**: Existing units with ≥65 words and higher complexity
- Injects **praktijk box placeholders** (one per subsection without existing praktijk)
- Output: `output/skeleton_ch{N}.json`

### 2. Generate Rewrites (`generate-from-skeleton.ts`)
- Processes each `GenerationUnit` with LLM
- **Prose/composite_list**: Rewrite in N3 style, preserve bold terms
- **Verdieping**: Rewrite existing content (no meta-introductions like "In deze sectie...")
- **Praktijk**: Generate NEW content OR respond with `SKIP` if no relevant nursing scenario
- Anti-redundancy guards for praktijk openers/questions
- Output: `output/rewrites_ch{N}.json`

### 3. Assemble (`assemble-skeleton-rewrites.ts`)
- Merges rewrites back into canonical JSON
- Attaches boxes to host blocks via explicit `host_block_id`
- Output: `output/canonical_*.assembled.json`

### 4. Render PDF (`render-prince-pdf.ts`)
- Generates HTML with Prince XML
- CSS handles box styling, column flow, orphan/widow control

---

## Key Configuration

### Verdieping Rules
- **Minimum 65 words** (~9 lines) to be a candidate
- Selected by LLM based on relative complexity (formulas, mechanisms, multi-step reasoning)
- Spread out (not adjacent, avoid first units)
- Content is REWRITTEN from existing source (not generated new)

### Praktijk Rules
- **Generated NEW** by LLM for each subsection
- Must be **topically relevant** to the subsection content
- If no sensible nursing scenario exists → LLM responds `SKIP` → no box rendered
- Uses "je" perspective, "zorgvrager" terminology
- **No forced biology explanations** to patients
- Anti-redundancy: avoids repeated openers, generic phrases

### Micro-heading Rules
- Assigned to blocks with **above-average word count** (and ≥55 words)
- Must be **topic labels** (2-4 words), NOT:
  - Sentence fragments ("Een lysosoom is een")
  - Generic words ("uitleg", "beschrijving")
  - Bolded technical terms (those stay bold in body)

### Box Layout (CSS)
- Boxes CAN break across columns/pages (`break-inside: auto`)
- **Label stays with content** via `display: block; break-after: avoid`
- `box-decoration-break: clone` maintains visual appearance on both sides
- `orphans: 9; widows: 9` ensures substantial content on each side

---

## LLM Models

Default: `gpt-4o-mini` (fast, cheap)

To use different model:
```bash
# In generate-from-skeleton.ts, change provider/model args
--provider openai --model gpt-4o-mini
--provider anthropic --model claude-haiku-4-5-20251001
```

---

## Output Files

| File | Description |
|------|-------------|
| `skeleton_ch{N}.json` | Structural skeleton with units and planning |
| `rewrites_ch{N}.json` | LLM-generated text per unit |
| `canonical_*.assembled.json` | Final merged JSON |
| `canonical_*_prince.html` | HTML for Prince XML |
| `canonical_ch{N}_professional.pdf` | Final PDF |

---

## Validation Gates

All must pass before considering output valid:
- ✅ Skeleton validation (backbone, flow, completeness, KD compliance)
- ✅ Figure verification
- ✅ Prince log verification
- ✅ HTML anchor verification
- ✅ Page fill gate (min 50% used per page)
- ✅ Column balance gate
- ✅ Box justification gap gate

---

## Known Issues & Solutions

### Issue: Duplicate boxes rendered
**Cause**: `renderParagraphBlock` was rendering boxes twice for demoted lists  
**Fix**: Added `!opts?.suppressBoxes` guard in demoted-list path (line ~1639 in render-prince-pdf.ts)

### Issue: Praktijk content too generic / forced biology
**Cause**: Prompt required connecting to chapter content  
**Fix**: Updated prompt to require topical relevance but NOT forced explanations; added SKIP option

### Issue: Micro-headings using bolded terms or sentence fragments
**Cause**: Fallback logic picked first bolded term  
**Fix**: Updated LLM prompt with explicit bad/good examples; fallback now uses subject extraction

### Issue: Box label orphaned (appears alone at end of column)
**Cause**: CSS orphans/widows doesn't work for inline spans  
**Fix**: Made `.box-label` a block element with `break-after: avoid`

---

## File Locations

```
new_pipeline/
├── scripts/
│   ├── build-chapter.ts          # Main orchestrator
│   ├── extract-skeleton.ts       # Skeleton extraction + LLM planning
│   ├── generate-from-skeleton.ts # LLM text generation
│   └── assemble-skeleton-rewrites.ts # Merge rewrites into canonical
├── renderer/
│   └── render-prince-pdf.ts      # HTML generation + Prince rendering
├── templates/
│   └── prince-af-two-column.css  # PDF styling
├── lib/
│   ├── llm.ts                    # Centralized LLM helpers
│   └── load-env.ts               # Environment loading
└── output/                       # All generated artifacts
```

---

## Quick Test Commands

```bash
# Test single section (fast)
cd new_pipeline
npx tsx scripts/build-chapter.ts --chapter 1 --in-json output/canonical_ch1_with_figures.json --rewrite-mode skeleton --section 1.1

# Full chapter
npx tsx scripts/build-chapter.ts --chapter 1 --in-json output/canonical_ch1_with_figures.json --rewrite-mode skeleton

# Open result
open output/canonical_ch1_professional.pdf
```











