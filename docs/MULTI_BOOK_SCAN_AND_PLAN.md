## Multi-book scan + reuse plan (MBO books)

This document summarizes a deterministic scan of the books currently declared in `books/manifest.json`, and proposes a reuse-first plan for a **new per-book structure** aligned to **KD 2025** (zorg).

### What this scan is (and is not)
- **Is**: deterministic inventory of IDML structure + keyword-based KD signal scan across each book’s IDML text.
- **Is not**: a validated “KD coverage” claim. Final KD alignment requires a real mapping and (ideally) full official KD definitions.

### Inputs
- Book list: `books/manifest.json`
- IDML snapshots: `_source_exports/*.idml`
- KD keywords (user-provided summaries): `docs/kd/kd_2025_workprocesses_detailed.json`

### Outputs
Written to `output/reports/`:
- `mbo_books_inventory.json` (per-book structure summary)
- `mbo_books_overlap.csv` (pairwise token overlap based on headings)
- `mbo_books_kd_projection.json` / `.csv` (KD keyword signal scan)

---

## 1) Books currently in manifest (4)
- `MBO_AF4_2024_COMMON_CORE` (A&F Common Core) — 14 chapters
- `MBO_COMMUNICATIE_9789083251387_03_2024` — 8 chapters found in IDML
- `MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024` — chapters found in IDML
- `MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024` — chapters found in IDML

Note: the long-term plan mentions 12 books, but only 4 are declared today. The scan approach scales once the other books are added to `books/manifest.json` and have IDML snapshots.

---

## 2) What “reuse” realistically means (important)
Heading-token overlap between these books is **low** (different subject domains), so reuse is less about copying chapters and more about reusing **didactic “skill modules”** that support KD workprocesses:
- SBAR / structured reporting
- observation & signaling patterns
- care-plan logic (goals → interventions → evaluation)
- acute response structure
- safety/ethics/digital care (AI/technology)
- clinical reasoning (N4 verdieping) patterns

---

## 3) KD-projection: likely KD focus per book (signal scan)
This is based on keyword hits in IDML text and should be treated as directional.

### A&F Common Core (`MBO_AF4_2024_COMMON_CORE`)
Observed signal: light KD language, mostly generic terms.
Implication:
- This book reads as **knowledge backbone**; to be teacher-friendly for KD 2025 we need consistent “apply in care” framing:
  - standardized “In de praktijk” blocks tied to B1 workprocesses (observe/report/advice/acute)
  - “Verdieping” blocks for N4-only technical depth (P2), clearly optional

### Communicatie (`MBO_COMMUNICATIE_...`)
Observed signal: strong hits on collaboration/overdracht/voorlichting language.
Implication:
- This book should be the “KD skill anchor” for:
  - **B1-K2-W2** (samenwerken met professionals, SBAR/overdracht)
  - **B1-K1-W6** (informatie/advies/voorlichting)
  - and can host reusable templates for communication-in-care scenarios.

### Persoonlijke verzorging (`MBO_PERSOONLIJKE_VERZORGING_...`)
Observed signal: strong hits on hygiëne/medicatie/complicaties/rapporteren language.
Implication:
- This book should own the “hands-on care execution” layer:
  - **B1-K1-W3/W4/W5** (interventies, verpleegtechnisch, acute)
  - plus consistent “what to observe + what to report” patterns reused in A&F chapters.

### Praktijkgestuurd klinisch redeneren (`MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_...`)
Observed signal: strong N4-oriented terms (klinisch redeneren, diagnose, EBP, coördineren).
Implication:
- This book is the natural “Verdieping/N4” anchor:
  - **P2-K1-W1/W3** (verpleegkundige diagnose; coördineren/optimaliseren)
  - can provide reusable “reasoning frames” that A&F can reference as optional verdieping.

---

## 4) Proposed new per-book structure (high-level)

### A&F Common Core (knowledge backbone)
- Keep anatomy/physiology topics, but add deterministic didactic wrappers:
  - per subparagraph: 1 “basis” explanation + 1 small practice cue (B1) + optional verdieping (P2)
- Avoid deep molecular mechanisms in basis; push them into verdieping.

### Communicatie (KD communication + coordination backbone)
- Organize by workprocess tasks (overdracht, MDO, gesprekstechnieken, voorlichting).
- Export reusable “communication blocks” to be embedded in other books as short praktijk blocks.

### Persoonlijke verzorging (execution + safety)
- Organize by care actions, safety, hygiene, meds, complications.
- Reuse A&F as “why” knowledge but keep PV as “how” and “what to watch”.

### Klinisch redeneren (N4 verdieping track)
- Provide deep reasoning + EBP + diagnosis/coordinating templates.
- Make it easy to embed small “N4 verdieping” inserts into A&F without forcing N3 to read them.

---

## 5) Next steps (implementation-ready)
1. Create a data-driven **module registry** (shared snippets) with stable IDs.
2. Create per-book mapping files:
   - section/subparagraph → {basis, praktijk (B1), verdieping (P2)} + linked KD workprocess codes.
3. Add deterministic checks:
   - ensure each subparagraph has at least one “B1-linked practice cue” (configurable per book)
4. Render-time styling:
   - visually distinguish “verd ieping” (N4) from basis (tint/background) for combi-klassen.
































