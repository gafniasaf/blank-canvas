#!/usr/bin/env python3
"""
Promote suggested_* fields into final mapping fields (difficulty/kd_workprocesses/modules).

Why:
- We keep auto-suggestions separate for safety and review.
- Once reviewed, this tool can "accept" suggestions deterministically.

Rules:
- Only promotes when final field is still empty/unknown (so we don't overwrite manual edits).
- difficulty: promotes suggested_difficulty -> difficulty if difficulty == "unknown"
- kd_workprocesses: promotes suggested_kd_workprocesses -> kd_workprocesses if empty
- modules: promotes suggested_modules -> modules if empty

Usage:
  python3 scripts/promote-kd-mapping-suggestions.py --book MBO_AF4_2024_COMMON_CORE
  python3 scripts/promote-kd-mapping-suggestions.py --all
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List


REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPINGS_DIR = REPO_ROOT / "docs" / "kd" / "mappings"


def promote_one(fp: Path) -> Dict[str, int]:
    data = json.loads(fp.read_text("utf-8"))
    entries = data.get("entries") or []

    stats = {"difficulty": 0, "kd_workprocesses": 0, "modules": 0, "entries_touched": 0}

    for e in entries:
        changed = False
        if str(e.get("difficulty") or "unknown") == "unknown" and "suggested_difficulty" in e:
            sd = str(e.get("suggested_difficulty") or "unknown")
            if sd:
                e["difficulty"] = sd
                stats["difficulty"] += 1
                changed = True

        if (e.get("kd_workprocesses") or []) == [] and "suggested_kd_workprocesses" in e:
            sk = e.get("suggested_kd_workprocesses") or []
            if isinstance(sk, list) and sk:
                e["kd_workprocesses"] = sk
                stats["kd_workprocesses"] += 1
                changed = True

        if (e.get("modules") or []) == [] and "suggested_modules" in e:
            sm = e.get("suggested_modules") or []
            if isinstance(sm, list) and sm:
                e["modules"] = sm
                stats["modules"] += 1
                changed = True

        if changed:
            stats["entries_touched"] += 1

    if stats["entries_touched"] > 0:
        data.setdefault("promotion", {})
        data["promotion"]["promoted_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        data["promotion"]["note"] = "Promoted suggested_* into final fields where final fields were empty/unknown."
        fp.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default="", help="Optional book_id to promote only one mapping")
    ap.add_argument("--all", action="store_true", help="Promote all mappings")
    args = ap.parse_args()

    if not args.all and not args.book:
        raise SystemExit("Provide --book <book_id> or --all")

    files = sorted(MAPPINGS_DIR.glob("*.mapping.json"))
    if args.book:
        files = [p for p in files if p.name.startswith(args.book + ".")]
    if not files:
        raise SystemExit("No mapping files found to promote.")

    totals = {"difficulty": 0, "kd_workprocesses": 0, "modules": 0, "entries_touched": 0}
    for fp in files:
        s = promote_one(fp)
        print(f"✅ promoted {fp.name}: {s}")
        for k in totals:
            totals[k] += s.get(k, 0)
    print(f"TOTAL: {totals}")


if __name__ == "__main__":
    main()
































