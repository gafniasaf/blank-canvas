#!/usr/bin/env python3
"""
Build VTH N4 figure assets from InDesign Links folder.
Converts source images to PNG named Afbeelding_{X.Y}.png using canonical figure list.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

REPO = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
LINKS_DIR = Path("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/Links")
CANONICAL = REPO / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.json"
OUT_DIR = REPO / "new_pipeline" / "assets" / "figures" / "vth_n4"
REPORT = REPO / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_links_assets_report.json"

SUPPORTED_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".psd"}


def get_expected_fig_keys() -> List[str]:
    with CANONICAL.open("r", encoding="utf-8") as f:
        book = json.load(f)
    keys = set()
    for ch in book.get("chapters", []):
        for sec in ch.get("sections", []):
            for block in sec.get("content", []):
                if not isinstance(block, dict):
                    continue
                for img in block.get("images", []):
                    fig = img.get("figureNumber", "")
                    m = re.search(r"(\d+\.\d+)", fig)
                    if m:
                        keys.add(m.group(1))
    return sorted(keys, key=lambda x: (int(x.split(".")[0]), int(x.split(".")[1])))


def extract_fig_key(filename: str) -> str | None:
    # Pattern: "..._4.21_..." -> 4.21
    m = re.search(r"_(\d+\.\d+)_", filename)
    if m:
        return m.group(1)
    # Pattern: "30.34.png"
    m = re.match(r"^(\d+\.\d+)\.(?:png|jpg|jpeg|tif|tiff|psd)$", filename, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def pick_best_sources(expected: set[str]) -> Dict[str, Path]:
    candidates: Dict[str, List[Path]] = {}
    for p in LINKS_DIR.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() not in SUPPORTED_EXTS:
            continue
        key = extract_fig_key(p.name)
        if not key or key not in expected:
            continue
        candidates.setdefault(key, []).append(p)

    best: Dict[str, Path] = {}
    for key, files in candidates.items():
        # Prefer the largest file size
        best_file = max(files, key=lambda f: f.stat().st_size)
        best[key] = best_file
    return best


def convert_to_png(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Flatten to avoid transparency issues
    cmd = ["magick", str(src), "-flatten", str(dest)]
    subprocess.run(cmd, check=True)


def main() -> None:
    if not LINKS_DIR.exists():
        raise SystemExit(f"Links folder not found: {LINKS_DIR}")
    if not CANONICAL.exists():
        raise SystemExit(f"Canonical not found: {CANONICAL}")

    expected = set(get_expected_fig_keys())
    best_sources = pick_best_sources(expected)

    # Backup existing output folder if present
    if OUT_DIR.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = OUT_DIR.parent / f"vth_n4__backup_{ts}"
        shutil.move(str(OUT_DIR), str(backup_dir))
        print(f"Backed up existing assets to: {backup_dir}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    missing = []
    converted = []
    for key in sorted(expected, key=lambda x: (int(x.split(".")[0]), int(x.split(".")[1]))):
        src = best_sources.get(key)
        dest = OUT_DIR / f"Afbeelding_{key}.png"
        if not src:
            missing.append(key)
            continue
        try:
            convert_to_png(src, dest)
            converted.append({"key": key, "src": str(src), "dest": str(dest)})
        except Exception as e:
            missing.append(key)
            print(f"Failed to convert {key} from {src}: {e}")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    with REPORT.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "expected_figures": sorted(expected),
                "converted_count": len(converted),
                "missing_count": len(missing),
                "missing_figures": missing,
                "converted": converted,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(f"Converted: {len(converted)}")
    print(f"Missing: {len(missing)}")
    print(f"Report: {REPORT}")


if __name__ == "__main__":
    main()





