#!/usr/bin/env python3
"""
Create first-pass KD mapping suggestions for per-book mapping skeletons.

This script does NOT overwrite the final fields:
- difficulty
- kd_workprocesses
- modules

Instead it adds:
- suggested_difficulty
- suggested_kd_workprocesses
- suggested_modules
- suggested_notes

This keeps the mapping reviewable and safe to iterate.

Inputs:
- docs/kd/mappings/*.mapping.json
- docs/kd/kd_2025_workprocesses.json (valid codes)
- docs/kd/modules/module_registry.json (valid module IDs)
- docs/kd/kd_2025_workprocesses_detailed.json (keywords for heuristic suggestions)

Outputs:
- Updates mapping files in-place (adds suggested_* fields)
- Writes a summary report:
  - output/reports/kd_mapping_suggestions_summary.json

Usage:
  python3 scripts/suggest-kd-mapping-drafts.py
  python3 scripts/suggest-kd-mapping-drafts.py --book MBO_AF4_2024_COMMON_CORE
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPINGS_DIR = REPO_ROOT / "docs" / "kd" / "mappings"
KD_CODES_PATH = REPO_ROOT / "docs" / "kd" / "kd_2025_workprocesses.json"
KD_DETAILED_PATH = REPO_ROOT / "docs" / "kd" / "kd_2025_workprocesses_detailed.json"
MODULES_PATH = REPO_ROOT / "docs" / "kd" / "modules" / "module_registry.json"
REPORTS_DIR = REPO_ROOT / "output" / "reports"


def load_kd_codes() -> Set[str]:
    kd = json.loads(KD_CODES_PATH.read_text("utf-8"))
    codes: Set[str] = set()
    for kt in (kd.get("basisdeel") or {}).get("kerntaken") or []:
        for wp in kt.get("werkprocessen") or []:
            c = str(wp.get("code") or "").strip()
            if c:
                codes.add(c)
    for kt in (kd.get("profieldeel_niveau_4") or {}).get("kerntaken") or []:
        for wp in kt.get("werkprocessen") or []:
            c = str(wp.get("code") or "").strip()
            if c:
                codes.add(c)
    return codes


def load_module_ids() -> Set[str]:
    reg = json.loads(MODULES_PATH.read_text("utf-8"))
    return {str(m.get("module_id") or "").strip() for m in reg.get("modules") or [] if str(m.get("module_id") or "").strip()}


def normalize(s: str) -> str:
    t = str(s or "").lower()
    t = t.replace("’", "'")
    t = re.sub(r"[^0-9a-zà-ÿ]+", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t


COMPLEX_TOKENS = {
    # A&F-ish / abstract concepts that often should be moved to "verdieping" or "mixed" for N3.
    "dna",
    "rna",
    "mrna",
    "trna",
    "rrna",
    "codon",
    "anticodon",
    "transcriptie",
    "translatie",
    "mitose",
    "prometafase",
    "metafase",
    "anafase",
    "telofase",
    "interfase",
    "chromatide",
    "centromeer",
    "histonen",
    "chromatine",
    "locus",
    "diploid",
    "haploid",
    "osmotische",
    "colloïd",
    "endocytose",
    "exocytose",
    "fagocytose",
    "pinocytose",
    "enzymatische",
    "citroenzuurcyclus",
    "ebp",
    "evidence",
}


def suggest_difficulty(book_id: str, kind: str, title: str) -> str:
    # Only suggest for subparagraph blocks (where we expect didactic inserts).
    if kind != "subparagraph":
        return "unknown"
    t = normalize(title)

    # Clinical reasoning book is naturally mixed (N3 route + N4 verdieping).
    if "KLINISCH_REDENEREN" in book_id:
        if any(x in t for x in ("ebp", "diagnose", "klinisch", "optimaliseer", "coördineer")):
            return "verdieping"
        return "mixed"

    if any(tok in t.split() for tok in COMPLEX_TOKENS) or any(tok in t for tok in ("dna", "rna", "mitose", "transcript", "translat")):
        return "mixed"

    return "basis"


def book_default_workprocesses(book_id: str) -> List[str]:
    # Baseline defaults (very conservative). These are *suggestions* only.
    if "COMMUNICATIE" in book_id:
        return ["B1-K2-W2", "B1-K1-W6", "B1-K1-W1"]
    if "PERSOONLIJKE_VERZORGING" in book_id:
        return ["B1-K1-W3", "B1-K1-W4", "B1-K1-W5", "B1-K1-W1"]
    if "KLINISCH_REDENEREN" in book_id:
        return ["P2-K1-W1", "P2-K1-W3", "B1-K1-W2", "B1-K3-W2"]
    # A&F / common core: knowledge backbone with practice framing
    return ["B1-K1-W6", "B1-K1-W1", "B1-K2-W2"]


def suggest_modules(book_id: str, title: str, diff: str) -> List[str]:
    t = normalize(title)

    mods: List[str] = []

    # Universal: basic observation/reporting + advice
    if "COMMUNICATIE" in book_id:
        mods.append("PRAKTIJK_OBSERVE_SIGNAL_REPORT_SBAR")
        mods.append("PRAKTIJK_INFO_ADVICE_HEALTH")
    elif "PERSOONLIJKE_VERZORGING" in book_id:
        mods.append("PRAKTIJK_OBSERVE_SIGNAL_REPORT_SBAR")
    elif "KLINISCH_REDENEREN" in book_id:
        mods.append("PRAKTIJK_OBSERVE_SIGNAL_REPORT_SBAR")
    else:
        mods.append("PRAKTIJK_INFO_ADVICE_HEALTH")
        mods.append("PRAKTIJK_OBSERVE_SIGNAL_REPORT_SBAR")

    # Acute topics → suggest acute module
    if any(w in t for w in ("ademhaling", "hart", "bloedsomloop", "shock", "benauwd", "bewustzijn")):
        mods.append("PRAKTIJK_ACUTE_PROTOCOL_BLS")

    # N4 verdieping modules
    if diff in ("verdieping", "mixed") and "KLINISCH_REDENEREN" in book_id:
        mods.append("VERDIEPING_N4_KLINISCH_REDENEREN_DIAGNOSE")
        mods.append("VERDIEPING_N4_COORDINATE_OPTIMIZE")

    # De-dupe keep order
    seen = set()
    out: List[str] = []
    for m in mods:
        if m in seen:
            continue
        seen.add(m)
        out.append(m)
    return out[:3]  # keep it small


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default="", help="Optional book_id to process only one mapping file")
    args = ap.parse_args()

    kd_codes = load_kd_codes()
    module_ids = load_module_ids()
    _kd_detailed = json.loads(KD_DETAILED_PATH.read_text("utf-8"))  # loaded for future richer heuristics

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    summary: Dict[str, Any] = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "books": []}

    files = sorted(MAPPINGS_DIR.glob("*.mapping.json"))
    if args.book:
        files = [p for p in files if p.name.startswith(args.book + ".")]
    if not files:
        raise SystemExit("No mapping files found to process.")

    for fp in files:
        data = json.loads(fp.read_text("utf-8"))
        book_id = str(data.get("book_id") or fp.stem.replace(".mapping", "")).strip()

        entries = data.get("entries") or []
        touched = 0
        stats = {"suggested_basis": 0, "suggested_mixed": 0, "suggested_verdieping": 0, "suggested_unknown": 0}

        defaults = [c for c in book_default_workprocesses(book_id) if c in kd_codes]

        for e in entries:
            kind = str(e.get("kind") or "")
            title = str(e.get("title") or "")

            sdiff = suggest_difficulty(book_id, kind, title)
            if sdiff == "basis":
                stats["suggested_basis"] += 1
            elif sdiff == "mixed":
                stats["suggested_mixed"] += 1
            elif sdiff == "verdieping":
                stats["suggested_verdieping"] += 1
            else:
                stats["suggested_unknown"] += 1

            suggested_kd = list(defaults) if kind == "subparagraph" else []
            suggested_mods = suggest_modules(book_id, title, sdiff) if kind == "subparagraph" else []
            suggested_mods = [m for m in suggested_mods if m in module_ids]

            # Only set suggested_* fields if not already present (idempotent).
            changed = False
            if "suggested_difficulty" not in e:
                e["suggested_difficulty"] = sdiff
                changed = True
            if "suggested_kd_workprocesses" not in e:
                e["suggested_kd_workprocesses"] = suggested_kd
                changed = True
            if "suggested_modules" not in e:
                e["suggested_modules"] = suggested_mods
                changed = True
            if "suggested_notes" not in e:
                e["suggested_notes"] = "AUTO: first-pass heuristic suggestion; requires human review."
                changed = True

            if changed:
                touched += 1

        if touched > 0:
            data.setdefault("suggestions", {})
            data["suggestions"]["suggested_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            data["suggestions"]["note"] = "AUTO heuristic suggestions in suggested_* fields only (final fields unchanged)."
            fp.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

        summary["books"].append({"book_id": book_id, "file": str(fp), "touched_entries": touched, **stats})

    out = REPORTS_DIR / "kd_mapping_suggestions_summary.json"
    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False), "utf-8")
    print(f"✅ KD mapping suggestions written. Summary: {out}")


if __name__ == "__main__":
    main()
































