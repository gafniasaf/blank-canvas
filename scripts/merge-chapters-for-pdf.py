#!/usr/bin/env python3
"""
Merge per-chapter rewrites into ONE deduplicated rewrites JSON for Prince rendering.

Important nuance in this repo:
- Each `chXX.iterated.json` currently contains the *full book* (same 2461 paragraph_ids),
  but only chapter XX's paragraphs are the freshest in that file.
- The Prince overlay (`apply-rewrites-overlay.ts`) keeps the LAST occurrence per paragraph_id.
  So we must output each paragraph_id exactly once, picking it from its correct chapter file.
"""

import json
from collections import Counter
from pathlib import Path

BASE = Path(
    "/Users/asafgafni/Desktop/InDesign/TestRun/output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715"
)
OUT = BASE / "FINAL_by_chapter.json"

all_paragraphs = []

for ch in range(1, 15):
    f = BASE / f"ch{ch:02d}.iterated.json"
    if not f.exists():
        raise SystemExit(f"Missing input: {f}")
    data = json.loads(f.read_text("utf-8"))
    paras = data.get("paragraphs", [])
    picked = [p for p in paras if str(p.get("chapter", "")).strip() == str(ch)]
    all_paragraphs.extend(picked)
    print(f"  ch{ch:02d}: picked {len(picked)} paragraphs (from {len(paras)} total in file)")

ids = [p.get("paragraph_id") for p in all_paragraphs]
total = len(ids)
unique = len(set(ids))
dups = [k for k, v in Counter(ids).items() if v > 1]

if dups:
    raise SystemExit(f"Duplicate paragraph_ids detected after merge (sample): {dups[:10]}")

merged = {"paragraphs": all_paragraphs}
OUT.write_text(json.dumps(merged, ensure_ascii=False, indent=2), "utf-8")
print(f"\n✅ Merged {total} unique paragraphs -> {OUT}")

