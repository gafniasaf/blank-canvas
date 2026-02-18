#!/usr/bin/env python3
"""
Validate per-book KD mapping files.

Checks:
- kd_workprocesses must be valid KD 2025 codes (from docs/kd/kd_2025_workprocesses.json)
- modules must exist in docs/kd/modules/module_registry.json
- difficulty must be one of {unknown,basis,verdieping,mixed}

Usage:
  python3 scripts/validate-kd-mappings.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Set


REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPINGS_DIR = REPO_ROOT / "docs" / "kd" / "mappings"
KD_CODES_PATH = REPO_ROOT / "docs" / "kd" / "kd_2025_workprocesses.json"
MODULES_PATH = REPO_ROOT / "docs" / "kd" / "modules" / "module_registry.json"

ALLOWED_DIFFICULTY = {"unknown", "basis", "verdieping", "mixed"}


def load_kd_codes() -> Set[str]:
    kd = json.loads(KD_CODES_PATH.read_text("utf-8"))
    codes: Set[str] = set()
    # basisdeel
    for kt in (kd.get("basisdeel") or {}).get("kerntaken") or []:
        for wp in kt.get("werkprocessen") or []:
            codes.add(str(wp.get("code") or "").strip())
    # profieldeel
    for kt in (kd.get("profieldeel_niveau_4") or {}).get("kerntaken") or []:
        for wp in kt.get("werkprocessen") or []:
            codes.add(str(wp.get("code") or "").strip())
    return {c for c in codes if c}


def load_module_ids() -> Set[str]:
    reg = json.loads(MODULES_PATH.read_text("utf-8"))
    mids = {str(m.get("module_id") or "").strip() for m in reg.get("modules") or []}
    return {m for m in mids if m}


def main() -> None:
    kd_codes = load_kd_codes()
    module_ids = load_module_ids()

    if not MAPPINGS_DIR.exists():
        raise SystemExit(f"Missing mappings dir: {MAPPINGS_DIR}")

    errors: List[str] = []
    files = sorted(MAPPINGS_DIR.glob("*.mapping.json"))
    if not files:
        raise SystemExit(f"No mapping files found in {MAPPINGS_DIR}")

    for fp in files:
        data = json.loads(fp.read_text("utf-8"))
        entries = data.get("entries") or []
        for e in entries:
            key = str(e.get("key") or "")
            diff = str(e.get("difficulty") or "unknown")
            if diff not in ALLOWED_DIFFICULTY:
                errors.append(f"{fp.name}:{key}: invalid difficulty '{diff}'")
            for c in e.get("kd_workprocesses") or []:
                cc = str(c or "").strip()
                if cc and cc not in kd_codes:
                    errors.append(f"{fp.name}:{key}: unknown KD code '{cc}'")
            for m in e.get("modules") or []:
                mid = str(m or "").strip()
                if mid and mid not in module_ids:
                    errors.append(f"{fp.name}:{key}: unknown module_id '{mid}'")

    if errors:
        print("❌ KD mapping validation failed:")
        for err in errors[:200]:
            print("-", err)
        if len(errors) > 200:
            print(f"... and {len(errors) - 200} more")
        sys.exit(2)

    print(f"✅ KD mapping validation passed ({len(files)} files)")


if __name__ == "__main__":
    main()
































