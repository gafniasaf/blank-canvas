## KD (kwalificatiedossier) docs — how we track scope + mapping

We target **KD 2025** for the **zorg** domain (Verzorgende IG / MBO Verpleegkundige), while the book content uses the **canonical N4 numbering/topic backbone** as structure.

### What exists today
- Context-only notes: `docs/KD_2025_CONTEXT.md`
- KD 2025 workprocess codes/titles (official list as provided): `docs/kd/kd_2025_workprocesses.json`
- KD 2025 workprocess details (keywords/explanations/examples; user-provided summaries): `docs/kd/kd_2025_workprocesses_detailed.json`

### What is missing (and required for real KD alignment)
We need a **primary source** for KD 2025:
- official KD documents (kerntaken/werkprocessen) **or**
- a trusted KD export (e.g., from an internal “AI-Mapper” tool) containing the KD items we want to map to.

Until we have the **full** KD text/definitions and a validated mapping, we do **not** claim KD coverage; we only design the pipeline to support it.

### Planned repository artifacts (source of truth)
Once primary sources exist, we will add:
- `docs/kd/kd_2025_sources.md`
  - where the KD documents came from (URLs/versions) and how we parsed them
- `docs/kd/kd_2025_mapping.json` (or `.yaml`)
  - per subparagraph mapping:
    - `basis` vs `verdieping`
    - linked `kerntaken`/`werkprocessen`
    - short rationale (teacher-facing)

### What we added now (scaffold you can fill iteratively)
- Per-book mapping skeletons generated from IDML headings:
  - `docs/kd/mappings/*.mapping.json`
- Module registry (reusable didactic blocks):
  - `docs/kd/modules/module_registry.json`

Scripts:
- Generate skeletons: `python3 scripts/generate-kd-mapping-skeleton.py`
- Validate mappings: `python3 scripts/validate-kd-mappings.py`
- Auto-suggest first draft (non-destructive; writes `suggested_*` fields): `python3 scripts/suggest-kd-mapping-drafts.py`

### How the pipeline will use the KD mapping (design intent)
- **Rewrite prompts**: use KD mapping as an explicit constraint (basis text should remain simple; verdieping may be more technical).
- **Deterministic lints**: flag “too technical for basis” markers unless they are inside verdieping blocks.
- **Prince rendering**: render “verd ieping” blocks with a distinct background/tint to support combi-klassen differentiation.


