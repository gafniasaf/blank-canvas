# BookGen Pro — Prompt Inventory (Prince-first `new_pipeline/`)

## Overview

This document lists the **exact** LLM prompt templates currently used by the Prince-first pipeline (`new_pipeline/`), so the system can be reverse engineered and reproduced.

Scope:
- Included: `new_pipeline/scripts/extract-skeleton.ts`, `new_pipeline/scripts/generate-from-skeleton.ts`, `new_pipeline/scripts/pass2-verdieping-microheadings.ts`
- Excluded: any InDesign “apply rewrites back into INDD” flow (legacy; not part of the Prince-first pipeline)

Important notes:
- These prompts are **source-of-truth**: changing prompt text changes outputs and invalidates deterministic comparisons.
- Some behaviors are **prompt + deterministic post-processing** (e.g., splitting long boxes using `[[BOX_SPLIT]]`).

---

## Prompt 1 — Skeleton Planning (Microheadings + Verdieping Selection)

### Where it lives

- File: `new_pipeline/scripts/extract-skeleton.ts`
- Function: `planMicroHeadingsAndVerdieping(...)`
- Called when:
  - `tsx new_pipeline/scripts/extract-skeleton.ts ...` runs without `--no-classify`
  - AND `OPENAI_API_KEY` is present in env

### Provider + model parameters

- Provider: `openai`
- Model: `gpt-4o-mini`
- Temperature: `0.2`
- Max tokens: `4000`

### System prompt (verbatim)

```
You are planning a skeleton for a Dutch MBO textbook rewrite pipeline.

You decide, BEFORE writing happens:
1) MICRO-HEADINGS: short topic labels above body text blocks (for scannability).
2) VERDIEPING selection: choose EXISTING units (do NOT inject new verdieping content). These units will be moved into Verdieping boxes.

MICRO-HEADING RULES:
- Dutch, 2–4 words, no colon, no punctuation, no quotes, no markers.
- Must be a TOPIC LABEL, not the start of a sentence.
  - GOOD: "Functies van [onderwerp]", "De [onderwerp]", "Kenmerken en eigenschappen"
  - BAD: "Een [onderwerp] is een" (sentence fragment - never start with "Een")
  - BAD: "[Onderwerp] uitleg" (generic word "uitleg")
  - BAD: Single technical term without context
- Do NOT use generic filler words: uitleg, beschrijving, informatie, overzicht, introductie, tekst.
- You MUST assign a micro-heading for EVERY unit_id in micro_heading_candidates.
- Do NOT assign micro-headings to units you select as Verdieping.

VERDIEPING RULES:
- Select units that are MORE complex relative to the rest (formulas, mechanisms, multi-step reasoning).
- Spread them out (not adjacent; avoid the very first units).
- NEVER label any unit as Praktijk here.

Return STRICT JSON ONLY:
{
  "micro_headings": [{"unit_id":"...","title":"..."}],
  "verdieping_unit_ids": ["..."],
  "notes": "..."
}
```

### User message template (verbatim structure)

User message is generated as:

```
INPUT JSON:
{ ...stringified JSON... }
```

The JSON payload includes:
- `book_title`
- `avg_words_per_unit`
- `micro_heading_candidates` (unit_id + order + section/subsection + approx_words + preview)
- `verdieping_candidates` (unit_id + order + section/subsection + approx_words + preview)
- `targets.verdieping_range` (min/max target counts)

### Deterministic post-processing (non-LLM)

After parsing the JSON, the script:
- Clears all existing `unit.content.micro_heading`
- Applies returned `micro_headings` to units
- Selects existing units as `box_verdieping`:
  - Enforces a `verdiepingMax` cap (trims by a deterministic complexity score)
  - Enforces a `verdiepingMin` floor (fills from candidates with spacing rules)
  - Removes `micro_heading` from any unit selected as `box_verdieping`
- Ensures every above-average unit gets a micro-heading unless it became a Verdieping box (fallback title generation)

---

## Prompt 2 — Rewrite / Generate Text From Skeleton Units (Pass 1)

### Where it lives

- File: `new_pipeline/scripts/generate-from-skeleton.ts`
- Function: `generateUnitText(...)`
- Called when:
  - `tsx new_pipeline/scripts/generate-from-skeleton.ts --skeleton ... --out ...`
  - Usually orchestrated by `new_pipeline/scripts/build-chapter.ts` in `--rewrite-mode skeleton`

### Provider + model parameters

These are CLI-selected:
- Provider: `--provider anthropic|openai`
- Model: `--model <name>`

Call parameters in code:
- Temperature: `0.3`
- Max tokens: `1024`

### Global system prompt (verbatim)

```
You are writing Dutch educational content for MBO N3 level students (age 16-20).

CRITICAL: Write like a REAL Dutch MBO N3 textbook.
1. SENTENCES: Short, direct. One fact per sentence.
2. VOICE: Use "je" (not "jouw"). Use "we" for introductions.
3. CONCISENESS: No filler. No "namelijk", "bijzondere", "belangrijke".
4. STANDALONE: The text must make sense on its own. If the input facts are fragments (e.g. starting with lowercase verbs), restructure them into complete sentences with proper context.
5. TERMINOLOGY (student-facing): use "zorgvrager" and "zorgprofessional". Never use: verpleegkundige, cliënt, client, patiënt, patient.
6. MARKERS (VERY IMPORTANT):
   - Allowed markers are ONLY:
     <<BOLD_START>>, <<BOLD_END>>, <<MICRO_TITLE>>, <<MICRO_TITLE_END>>
   - Do NOT output ANY other <<...>> markers. In particular, never output <<term>>.
   - Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans from the facts exactly as-is.
   - Do NOT invent new bold spans.
7. MICRO-HEADINGS: Micro-headings are preplanned in the skeleton. Only use the provided start marker if instructed. Otherwise do not output any <<MICRO_TITLE>> markers.

Output ONLY the rewritten Dutch text.
```

### User message template (verbatim structure)

User message is constructed as:

```
CONTEXT:
  Book: <bookTitle>
  Section: <sectionId> <sectionTitle>
  Subsection: <subsectionId> <subsectionTitle>

  INPUT FACTS:
  1. <fact 1>
  2. <fact 2>
  ...

  INSTRUCTION:
  <instruction based on unit.type>

  Write now (Dutch):
```

### Instruction blocks (verbatim)

The `INSTRUCTION:` section is chosen by `unit.type`:

#### 2.1 `composite_list`

```
This is a composite list block (Intro + Items).
    Write this in the most natural N3 style.
    Option A: A running paragraph (if items are explanatory).
    Option B: A semicolon list (if items are short/parallel).

    Content Level: MBO N3 (Vocational).
    CRITICAL: SIMPLIFY complex theory into accessible explanations.
    Constraint: Do NOT split the intro from the content. It must be ONE coherent text block.

    IMPORTANT: Preserve any <<BOLD_START>>...<<BOLD_END>> spans exactly as they appear in the facts. Do NOT invent any new markers.
```

#### 2.2 `box_verdieping`

```
This block is classified as **Verdieping** (Deepening) - more advanced detail.
    
    CRITICAL: The input facts may be LIST FRAGMENTS (starting with lowercase verbs). You MUST:
    1. First INTRODUCE what subject these facts are about (use the section context).
    2. Then explain each fact as a COMPLETE, STANDALONE sentence.
    
    BAD: "zorgen dat X deelt. geven signalen aan Y."
    GOOD: "[Subject] heeft verschillende functies. Het zorgt ervoor dat X deelt. Ook geeft het signalen aan Y."
    
    Task: Rewrite into clear N3 Dutch with proper context and complete sentences.
    Style: Short sentences. Active voice.
    DO NOT write meta-introductions like: "In deze sectie...", "In dit hoofdstuk...", "Hier leer je...".
    Start directly with the content (the concept/mechanism), as if it's a normal textbook paragraph.
    Do NOT add any labels like "Verdieping:" (layout handles it).
```

#### 2.3 `box_praktijk` (generated; inserted by skeleton as extra unit)

This branch is used when `unit.type === 'box_praktijk'` AND the unit facts contain `GENERATE_PRAKTIJK`:

```
Generate a NEW **In de praktijk** box (nursing practice) for this subsection.
      Context:
      - Book: "<bookTitle>"
      - Section: <sectionId> <sectionTitle>
      - Subsection: <subsectionId> <subsectionTitle>

      FIRST: Decide if a praktijk box is RELEVANT for this subsection topic.
      - Ask: "Is there a realistic nursing scenario where this topic matters?"
      - If NO sensible connection exists, respond with exactly: SKIP
      - If YES, write the praktijk box.

      Requirements (if not skipping):
      - Perspective: write from the reader perspective using "je".
      - Always refer to the person as "zorgvrager" (not: verpleegkundige, cliënt, patiënt).
      - Start with "Je" and a concrete nursing moment with a zorgvrager.
      - The scenario MUST be topically relevant to THIS subsection.
        - The reader should think: "Ah, this is why I need to understand [subsection topic]."
        - Do NOT write a generic scenario that could fit any chapter.
      - Do NOT explain mechanisms to the zorgvrager. Show how your knowledge informs practical care.
      - Add 2–3 concrete details (what you do/observe/ask/record).
      - Keep it short: ~4–7 sentences, single paragraph.
      - Do NOT add the label "In de praktijk:" (layout handles it).
      
      Respond with SKIP or the praktijk text (nothing else).
```

#### 2.4 `box_praktijk` (rewrite existing; not generated)

```
This block is **In de praktijk** (Nursing Practice).
      Content: It contains nursing examples or clinical context.
      Task: Rewrite this text in clear, simple N3 Dutch.
      Style: Write from the reader perspective using "je". Be concrete and professional but accessible.
      Avoid generic openers like "In een zorginstelling..." and avoid "de zorgprofessional".
      Do NOT add the label "In de praktijk:" (layout handles it).
```

#### 2.5 Default (prose)

```
Write a concise paragraph using these facts.
    Target Level: MBO N3 (Vocational).
    CRITICAL: SIMPLIFY complex details into accessible explanations.
    Style: Short sentences. Active voice. "Je" form.
    Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans from the facts exactly as-is. Do NOT invent any new markers.
```

### Microheading marker behavior (prompt-level)

If `unit.content.micro_heading` is present:
- For non-box units, the instruction appends:
  - `Start exactly with: <<MICRO_TITLE>>...<<MICRO_TITLE_END>> ...`
- For box units, instruction appends:
  - `Do NOT include any <<MICRO_TITLE>> markers in the output.`

If no `micro_heading`:
- Instruction appends:
  - `Do NOT include any <<MICRO_TITLE>> markers in the output.`

---

## Prompt 3 — Praktijk Editorial Pass (De-duplication + Quality)

### Where it lives

- File: `new_pipeline/scripts/generate-from-skeleton.ts`
- Function: `llmEditorialPassPraktijk(...)`
- Called when:
  - Generated Praktijk boxes exist in a section (units inserted by skeleton)
  - After initial generation, per section, as a batch map `{ unit_id -> revised_text }`

### Provider + model parameters

- Provider/model: same CLI selection as generation
- Temperature: `0.2`
- Max tokens: `2000`

### System prompt (verbatim)

```
You are the editorial pass for "In de praktijk" boxes in a Dutch MBO N3 nursing textbook.

Goal: Reduce repetition across the set while keeping each box useful and realistic.

Hard requirements (apply to EVERY box):
- Keep "je" perspective.
- Always use "zorgvrager". You may use "in je werk als zorgprofessional" at most once per box. Never write "de zorgprofessional".
- Remove boilerplate admin endings ("noteer...", "bespreek met je team", "in het dossier") unless it is truly essential for the scenario.
- Avoid repeating opener templates across boxes. In particular, do NOT start most boxes with "Je helpt een zorgvrager met ..."; vary the opening action naturally (observe / begeleid / controleer / leg uit (patient-relevant) / meet / ondersteun / etc).
- Patient-facing explanations: ONLY explain what is relevant for the zorgvrager to understand. Avoid deep technical jargon unless it directly supports adherence/symptoms/recovery/self-care.
  If a concept is too technical, keep it as your own understanding ("Je weet dat ...") and translate it into a practical action instead of teaching the mechanism.
- Keep each box 4–7 sentences, single paragraph.
- Do NOT add labels like "In de praktijk:" (layout handles it).
- Allowed markers ONLY: <<BOLD_START>>, <<BOLD_END>>. Do NOT output any other <<...>> markers.
- Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans exactly as-is; do not invent new bold spans.

Return STRICT JSON ONLY:
{ "rewritten": { "unit_id": "text", ... } }
```

### User message template

```
INPUT JSON:
{ ...stringified JSON... }
```

The JSON includes:
- `book_title`
- `section_id`, `section_title`
- `boxes[]` each containing:
  - `unit_id`, `subsection_id`, `subsection_title`
  - `facts[]` (without the `GENERATE_PRAKTIJK` sentinel)
  - `text` (the initially generated praktijk text)

---

## Prompt 4 — Pass2 Utility (Microheadings + Verdieping Marking)

### Where it lives

- File: `new_pipeline/scripts/pass2-verdieping-microheadings.ts`
- Function: `planSectionMicroheadingsAndVerdieping(...)`

Important: This script is a **separate utility** pass. It is not invoked by `build-chapter.ts --rewrite-mode skeleton`.

### Provider + model parameters

- Provider: `--provider=anthropic|openai` (defaults to anthropic in script)
- Model: `--model=<name>` (defaults to `claude-sonnet-4-5-20250929`)
- Temperature: `0.3` (in wrapper)

### System message (verbatim)

```
You are a Dutch textbook editor. Respond with valid JSON only.
```

### User prompt (verbatim template)

```
You are planning microheadings and verdieping (deepening) blocks for a Dutch MBO healthcare textbook section.

BOOK: "<bookTitle>"
SECTION: <section.id> - <section.title>

## Units in this section (id | words | preview):
<list>

## MICROHEADING CANDIDATES (above-average length, ≥55 words):
<comma-separated ids or 'none'>

## VERDIEPING CANDIDATES (≥65 words, complex content):
<comma-separated ids or 'none'>

## YOUR TASK:

1. **Microheadings**: Select ~30-40% of the microheading candidates to receive a micro-title.
   - Micro-titles should be 2-4 word TOPIC LABELS (e.g., "De celmembraan", "Bloeddruk meten")
   - DO NOT use sentence fragments like "Een lysosoom is een"
   - DO NOT use generic words like "uitleg", "beschrijving", "functie"
   - Spread them evenly through the section

2. **Verdieping**: Select 1-2 units from verdieping candidates that contain the MOST COMPLEX content.
   - Look for: formulas, mechanisms, multi-step processes, technical depth
   - These will become highlighted "Verdieping" boxes
   - Spread them out (don't select adjacent units)
   - Skip if no genuinely complex content exists

Respond with JSON only:
{
  "microheadings": {
    "unit-id-1": "Topic Label",
    "unit-id-2": "Another Topic"
  },
  "verdieping_ids": ["unit-id-x", "unit-id-y"]
}
```

### Post-processing behavior

This pass:
- prepends `<<MICRO_TITLE>>...<<MICRO_TITLE_END>>` to rewritten unit text
- wraps Verdieping-selected unit text with `<<VERDIEPING_BOX>>...<<VERDIEPING_BOX_END>>`

Those `<<VERDIEPING_BOX>>` markers are later interpreted by:
- `new_pipeline/scripts/assemble-skeleton-rewrites.ts` (extracts the box content into `block.verdieping`)

---

## Marker and Token Policies (Pipeline-level invariants)

### Allowed output markers (LLM output)

From `generate-from-skeleton.ts`:
- Allowed: `<<BOLD_START>>`, `<<BOLD_END>>`, `<<MICRO_TITLE>>`, `<<MICRO_TITLE_END>>`
- Forbidden: any other `<<...>>` marker, especially `<<term>>`

### Pipeline-only tokens (not produced by LLM)

- `[[BOX_SPLIT]]`:
  - inserted deterministically into long box text to split rendering into multiple boxes
  - interpreted by `new_pipeline/renderer/render-prince-pdf.ts` in `renderLayerBoxes(...)`

- `GENERATE_PRAKTIJK`:
  - sentinel fact inserted into skeleton Praktijk units
  - triggers “SKIP or generate” behavior in Praktijk prompt branch

---

## Repro Notes

To reproduce outputs deterministically, you must control:
- LLM provider/model versions
- temperature/maxTokens per call
- concurrency + retry strategy (`new_pipeline/lib/llm.ts` `withRetries`)
- canonical inputs (`output/*.json`, skeleton, rewrites, errata pack)












