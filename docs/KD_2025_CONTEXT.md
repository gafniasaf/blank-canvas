## KD 2025 context (Verzorgende IG & Verpleegkundige) — repo notes

This repo currently targets **N3-focus / basisboek** text while keeping the **N4 numbering/topic backbone** canonical.

This document captures **context** we received about **KD 2025**, and clarifies what we **do / do not** treat as a source of truth.

### Source of this context
Provided snippet: “**KD 2025 Training voor Accountmanagers**” (MBOleren.nl, sector: **Verzorgende IG & Verpleegkundige**).

It states:
- **KD definition**: describes what an MBO student must be able to do after earning a diploma.
- **Why KD matters**: legal requirement, basis for exams, inspected by the education inspectorate.
- **KD 2025 changes (high-level)**:
  - more **kerntaken**
  - doubling of **werkprocessen**
  - stronger focus on **competencies**
- Mentions commercial products/tools (e-learning modules, knowledge base, “AI-Mapper”).

### What we can safely use from this (today)
- **KD is mandatory** for curriculum/exams and will be used by teachers to judge difficulty/scope.
- **KD 2025 likely increases granularity** (more kerntaken/werkprocessen), which increases the need for:
  - explicit scope decisions (what is “basis” vs “verdieping”)
  - traceability from book sections → KD items
  - teacher-friendly differentiation cues (e.g., optional verdiepend blocks)

### What we must NOT assume from this snippet
This snippet is **not the official KD** and does not list:
- the actual kerntaken / werkprocessen text
- performance criteria / exam requirements
- qualification codes / version dates

Therefore:
- Do **not** claim “KD 2025 coverage” based on this document alone.
- Do **not** bake hard constraints into the pipeline that pretend we know KD requirements without primary sources.

### What we now have in-repo (minimal primary input)
We have an **official workprocess code/title list** (as provided in chat) stored as:
- `docs/kd/kd_2025_workprocesses.json`

We also have a **user-provided detailed companion** (keywords/explanations/examples) stored as:
- `docs/kd/kd_2025_workprocesses_detailed.json`

This is enough to:
- reference KD workprocesses by their canonical codes in mappings
- build a deterministic “scope tagging” layer (basis vs verdieping)

But it is still **not** the full KD text (no descriptions/performance criteria), so coverage claims still require:
- a real mapping, and ideally
- the official KD documents or a trusted export containing the full workprocess definitions.

### What we need as primary sources (required)
To make KD enforceable in our pipeline, we need one of:
- The official **KD 2025** documents for the relevant qualifications (e.g., Verzorgende IG / MBO Verpleegkundige) including kerntaken/werkprocessen.
- Or an **export** from a trusted tool (e.g., “AI-Mapper”) that contains the authoritative KD items we want to map to.

### How we intend to use KD 2025 in this repo (design intent)
Once primary sources exist, we can add a deterministic mapping layer:
- **Scope mapping**: chapter/subparagraph → {basis, verdieping} + rationale
- **Traceability mapping**: section → KD werkprocess(en) (for teachers, audits, and product claims)
- **Rendering cues** (Prince): e.g., “Verdieping” blocks get a distinct visual treatment (tint/background), while basis remains clean.

Implementation should remain deterministic and testable:
- store mappings as data files (not “in prompts only”)
- lint/validate mappings in CI


