## Pathologie N4 — exact skeleton JSON (as used) + Pass 1 / Pass 2 artifacts + rewrite prompts

This document pins the **exact JSON artifacts** and the **exact prompt strings** that were used by the Pathologie N4 rewrite pipeline **in this workspace** (`/Users/asafgafni/Desktop/InDesign/TestRun`).

It is written so another agent/computer can:
- verify they have the **same inputs/outputs** (via SHA256),
- understand which file is **Pass 1** vs **Pass 2**,
- and see the **literal LLM prompts** that are in code.

---

### Book identity

- **book_title**: `MBO Pathologie nivo 4`
- **level**: `n4`
- **book_id (meta.id)**: `427427d3-b7a5-48fe-88e1-1888b1559a70`

---

### Canonical input (source JSON before rewrites)

- **canonical book JSON (with figures references)**:
  - **path**: `new_pipeline/output/MBO_PATHOLOGIE_N4_9789083412016_03_2024/canonical_book_with_figures.json`
  - **bytes**: `2368106`
  - **sha256**: `6c4a9d25ff58283ab55a433e19314fc9bfb01f4bd702f6eada39994c6cd1f944`

**Note (important for Pass 2 debug chain):**
- `new_pipeline/output/_tmp_pathologie_PASS2_step0.json` is **byte-identical** to the canonical file above:
  - **bytes**: `2368106`
  - **sha256**: `6c4a9d25ff58283ab55a433e19314fc9bfb01f4bd702f6eada39994c6cd1f944`

**Pass 1 (book-level) output in the Pass 2 debug chain:**
- `new_pipeline/output/_tmp_pathologie_PASS2_step1.json` is the first step where **Pass 1 rewrites have been applied** to the canonical book JSON:
  - **bytes**: `2391421`
  - **sha256**: `29b535a7c7e3c558a76851e0cced7c589533147de81940835a5c9cbe0dcf40f8`

---

### Skeleton JSON used for generation (per chapter)

The pipeline’s “skeleton” files are chapter-scoped JSONs in the **skeleton schema** (sections → subsections → units with unit ids).

#### Skeletons present for Pathologie in this workspace

These **exist** and have `metadata.title == "MBO Pathologie nivo 4"`:

- **`new_pipeline/output/skeleton_ch7.json`**
  - **bytes**: `353066`
  - **sha256**: `3eafb322e51ee87561302fd9f3e0eb9780bc785c88d04a1754f6139ae2c3ec67`
- **`new_pipeline/output/skeleton_ch8.json`**
  - **bytes**: `270977`
  - **sha256**: `1aebd1b06d11a8e2bfb4821d7a730bc819e01492243acbbeb9d30c09a2048e9f`
- **`new_pipeline/output/skeleton_ch9.json`**
  - **bytes**: `95400`
  - **sha256**: `bf39452b0524c71a25b33acff22da91e154d4463d871032975ebea31f8d679e0`
- **`new_pipeline/output/skeleton_ch10.json`**
  - **bytes**: `151352`
  - **sha256**: `bdd9fe6ba38413fcbac2e2ca4bee6cd522ce0ebb5c9123b517cd9cda8863c281`
- **`new_pipeline/output/skeleton_ch11.json`**
  - **bytes**: `291026`
  - **sha256**: `13a4f5dda1b7bbb8272a0e10cdc8c6b433a90646b2c6a3a9c548acdc8880e8fd`
- **`new_pipeline/output/skeleton_ch12.json`**
  - **bytes**: `315981`
  - **sha256**: `96197a73dbbde97c7f992253b732477890351e1091407eb61de5ce848e7c3a30`

#### Skeletons missing for Pathologie in this workspace (chapters 1–6)

For **chapters 1–6**, the expected Pathologie skeletons (`skeleton_ch1.json` … `skeleton_ch6.json`) are **not present** here.

Why this matters:
- Skeleton unit ids are created with `crypto.randomUUID()` in `new_pipeline/scripts/extract-skeleton.ts`, so **the exact original skeleton JSON cannot be reconstructed** from canonical + rewrites alone.

How to recover (recommended):
- On the machine that originally generated the Pathologie Pass 1/2, locate the original `skeleton_ch1.json`…`skeleton_ch6.json` whose `metadata.title` is `MBO Pathologie nivo 4`, then copy them into a safe snapshot folder (do not overwrite other books).

---

### Pass 1 outputs (rewrite text per skeleton unit)

Pass 1 outputs are the per-chapter “rewritten_units” maps:
- **paths**: `new_pipeline/output/rewrites_ch<N>.json`
- **schema**: `{ metadata, rewritten_units: { unit_id: "text", ... } }`

Hashes (Pathologie):

- **CH1** `new_pipeline/output/rewrites_ch1.json` — `82572` bytes — `d907a398c6145a34563529f6d16453158447aa226e7f5aa68d732e1fd0313763`
- **CH2** `new_pipeline/output/rewrites_ch2.json` — `76382` bytes — `43cc79ac7248bc205a8e1e43a195b6368032665942ce5156f8758074e3ea86b5`
- **CH3** `new_pipeline/output/rewrites_ch3.json` — `277488` bytes — `3f9b94e7d2e6c0c197db5c7c85b2d04776b8ec48b746d720ccffafc2bdb8629d`
- **CH4** `new_pipeline/output/rewrites_ch4.json` — `101775` bytes — `1540e5564cf76cfa9f30c44a1b564c4c3462dcbf7963f991580de9894f412815`
- **CH5** `new_pipeline/output/rewrites_ch5.json` — `100393` bytes — `1c2d56367dfe500ac5f8ab2296f34ac74f465aa0b6f6780d41a573d0c014a8a6`
- **CH6** `new_pipeline/output/rewrites_ch6.json` — `180676` bytes — `4f5a5df918cf3e5c8aeea75d46e1c9636fdc32d669fbd5c2c1c6f0cc46c9ef14`
- **CH7** `new_pipeline/output/rewrites_ch7.json` — `162205` bytes — `684787a4340fb69d35f132b43aa2c57c2c191ade7267497f0d77f582c5dc02f7`
- **CH8** `new_pipeline/output/rewrites_ch8.json` — `121453` bytes — `06dbe959998cb8272c35fd8eab5cd4d97c8440ff9b3ac7f387ba0992ea1ccfbf`
- **CH9** `new_pipeline/output/rewrites_ch9.json` — `40999` bytes — `8cb9122f3b51d6723e90a23e2b194ead44891625177bb98ce6ab2f721bc06911`
- **CH10** `new_pipeline/output/rewrites_ch10.json` — `67075` bytes — `003d3bf252ad7b5a5104346b2c192a508a9ee74b36bea0cde84d3ef267d63ad6`
- **CH11** `new_pipeline/output/rewrites_ch11.json` — `117350` bytes — `56057c96260bf17913cccc659dd0fae2f32cd258cb517980083d91c02c8090f0`
- **CH12** `new_pipeline/output/rewrites_ch12.json` — `137679` bytes — `0b2aa63b7b7d1338b49e86d0fe70a7ea0953b51bc18d4cea77c356e09c236851`

---

### Pass 2 outputs (microheadings + verdieping marking)

Pass 2 outputs are:
- **paths**: `new_pipeline/output/rewrites_ch<N>_pass2.json`
- **what changes**:
  - adds `<<MICRO_TITLE>>...<<MICRO_TITLE_END>>` prefixes to selected units
  - wraps selected complex units in `<<VERDIEPING_BOX>>...<<VERDIEPING_BOX_END>>`

Hashes (Pathologie):

- **CH1** `new_pipeline/output/rewrites_ch1_pass2.json` — `83972` bytes — `093a0c666a4588cc0d89b2ea160a257656f6648c126dd6dcd2a959b85440d75c`
- **CH2** `new_pipeline/output/rewrites_ch2_pass2.json` — `76889` bytes — `07a85a64f29aa6e9aff85f3a1c29835cf3716e5c96749dc0f2add8f8adb950ec`
- **CH3** `new_pipeline/output/rewrites_ch3_pass2.json` — `283382` bytes — `9efeab420d702855d87680eab1b63a212b22e093e4569425a29ba267b81410d2`
- **CH4** `new_pipeline/output/rewrites_ch4_pass2.json` — `102931` bytes — `0410a3bb67c6611b96a9770c6a07c934afee1c96ac82de88893b54c250ec7a8f`
- **CH5** `new_pipeline/output/rewrites_ch5_pass2.json` — `101815` bytes — `9507735c759f0bc5b6134a0fc6606ad937bf285311db5b1bb03915728e1bea31`
- **CH6** `new_pipeline/output/rewrites_ch6_pass2.json` — `184527` bytes — `d41843639889448438e401ba3f9c468da5895ba6ebd2394f727f226c8d92ab70`
- **CH7** `new_pipeline/output/rewrites_ch7_pass2.json` — `165070` bytes — `577ed4fc4944d34dfb21cb70e9af2af56d9649af46957651203106aee84533f1`
- **CH8** `new_pipeline/output/rewrites_ch8_pass2.json` — `122969` bytes — `044ed1c487cde44062db8461b28f2756aefcfd6eff06c9743c05ac3b6b07d287`
- **CH9** `new_pipeline/output/rewrites_ch9_pass2.json` — `41456` bytes — `d240dc9783d3d5c4183375a08c11042329b444aea4c64d87522554b6cd81225c`
- **CH10** `new_pipeline/output/rewrites_ch10_pass2.json` — `67901` bytes — `79c31f80a98a8c8af86bf5a1dfdc4a8e62406b9b6799235279cffa93dfc89367`
- **CH11** `new_pipeline/output/rewrites_ch11_pass2.json` — `118576` bytes — `867633fd089ae13f05444070d56cc75fa31fe7a297b68aca82298eff06db62c8`
- **CH12** `new_pipeline/output/rewrites_ch12_pass2.json` — `139631` bytes — `9dd34cdc4327ac913976df64b28d775c023262e7f3b8f84068653242c472a7b1`

---

### Assembled book JSON after Pass 2

This is the book-level JSON after applying Pass 1 + Pass 2 outputs to the canonical:

- **`new_pipeline/output/pathologie_n4_PASS2.assembled.json`**
  - **bytes**: `2588967`
  - **sha256**: `852d3a57a8140382ddf1b13acd81b7e9ef7104f0e46d2638b8c86bc0b1f3195c`

Note:
- `new_pipeline/output/_tmp_pathologie_PASS2_step12.json` is **byte-identical** to the assembled file above.

Optional downstream artifact (figures injected into the assembled JSON):
- **`new_pipeline/output/pathologie_n4_with_figures.json`**
  - **bytes**: `2653167`
  - **sha256**: `fa9b665dca0530a5dbb393161e3176fc9cc82a8ed13f68916dbb6889253d0611`

---

### Rewrite prompts (exact strings as implemented in code)

Below are the literal prompts found in the pipeline scripts.

#### Pass 1 prompt — `new_pipeline/scripts/generate-from-skeleton.ts`

**System prompt (`SYSTEM_PROMPT`)**:

```text
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

**User prompt template (as constructed in `userPrompt`)**:

```text
CONTEXT:
  Book: ${bookTitle}
  Section: ${sectionId} ${sectionTitle}
  Subsection: ${subsectionId} ${subsectionTitle}

INPUT FACTS:
${facts_as_numbered_list}

INSTRUCTION:
${instruction_block}

Write now (Dutch):
```

**Per-unit instruction blocks (selected by `unit.type`)**:

- **`composite_list`**:

```text
This is a composite list block (Intro + Items).
    Write this in the most natural N3 style.
    Option A: A running paragraph (if items are explanatory).
    Option B: A semicolon list (if items are short/parallel).

    Content Level: MBO N3 (Vocational).
    CRITICAL: SIMPLIFY complex theory into accessible explanations.
    Constraint: Do NOT split the intro from the content. It must be ONE coherent text block.

    IMPORTANT: Preserve any <<BOLD_START>>...<<BOLD_END>> spans exactly as they appear in the facts. Do NOT invent any new markers.
```

- **`box_verdieping`**:

```text
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

- **`box_praktijk`** (rewrite existing praktijk text):

```text
This block is **In de praktijk** (Nursing Practice).
      Content: It contains nursing examples or clinical context.
      Task: Rewrite this text in clear, simple N3 Dutch.
      Style: Write from the reader perspective using "je". Be concrete and professional but accessible.
      Avoid generic openers like "In een zorginstelling..." and avoid "de zorgprofessional".
      Do NOT add the label "In de praktijk:" (layout handles it).
```

- **`box_praktijk`** (GENERATE a new praktijk box when facts include `GENERATE_PRAKTIJK`):

```text
Generate a NEW **In de praktijk** box (nursing practice) for this subsection.
      Context:
      - Book: "${bookTitle}"
      - Section: ${sectionId} ${sectionTitle}
      - Subsection: ${subsectionId} ${subsectionTitle}

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

- **Default (prose-like units)**:

```text
Write a concise paragraph using these facts.
    Target Level: MBO N3 (Vocational).
    CRITICAL: SIMPLIFY complex details into accessible explanations.
    Style: Short sentences. Active voice. "Je" form.
    Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans from the facts exactly as-is. Do NOT invent any new markers.
```

#### Pass 1 “Praktijk editorial pass” prompt — `new_pipeline/scripts/generate-from-skeleton.ts`

This is an additional LLM call that is applied **after** generation, to reduce repetition across the set of generated “In de praktijk” boxes **within the same section**.

**System prompt**:

```text
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

**User message**:

```text
INPUT JSON:
{
  "book_title": "...",
  "section_id": "...",
  "section_title": "...",
  "boxes": [
    {
      "unit_id": "...",
      "subsection_id": "...",
      "subsection_title": "...",
      "facts": ["..."],
      "text": "..."
    }
  ]
}
```

#### Pass 2 prompt — `new_pipeline/scripts/pass2-verdieping-microheadings.ts`

This script asks the model to select microheadings and verdieping ids **per section**.

**System message**:

```text
You are a Dutch textbook editor. Respond with valid JSON only.
```

**User prompt template (`prompt`)**:

```text
You are planning microheadings and verdieping (deepening) blocks for a Dutch MBO healthcare textbook section.

BOOK: "${bookTitle}"
SECTION: ${section.id} - ${section.title}

## Units in this section (id | words | preview):
${units_list}

## MICROHEADING CANDIDATES (above-average length, ≥55 words):
${microheading_candidates_csv_or_none}

## VERDIEPING CANDIDATES (≥65 words, complex content):
${verdieping_candidates_csv_or_none}

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

---

### Verification commands (optional)

From repo root:

```bash
python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
  'new_pipeline/output/MBO_PATHOLOGIE_N4_9789083412016_03_2024/canonical_book_with_figures.json',
  'new_pipeline/output/pathologie_n4_PASS2.assembled.json',
]

root = Path('.').resolve()
for rel in paths:
  p = root / rel
  h = hashlib.sha256()
  with p.open('rb') as f:
    for chunk in iter(lambda: f.read(1024*1024), b''):
      h.update(chunk)
  print(h.hexdigest(), rel)
PY
```


