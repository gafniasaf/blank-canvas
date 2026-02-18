## KD modules (reusable blocks) — registry + usage

We want reuse across books to happen at the **didactic module** level, not by copying whole chapters.

### What is a “module”?
A module is a reusable, KD-aligned building block that can be embedded in many places, e.g.:
- a short **In de praktijk** cue that reinforces B1 workprocess behavior (observe → report → act)
- an optional **Verdieping** insert for N4 (P2) without forcing N3 students to read it

### Source of truth
- `docs/kd/modules/module_registry.json` is the registry of module IDs and what they are for.

### How modules will be used (design intent)
Per book/section mapping files can reference module IDs.
At render/rewrite time we can:
- inject or prompt-generate the module content in the right place
- keep consistent language/structure across books (teacher-friendly)

This keeps the pipeline deterministic:
- modules have stable IDs
- mappings can be linted/validated
































