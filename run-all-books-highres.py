#!/usr/bin/env python3
"""
Run high-res labeled figure extraction for ALL books in:
  /Users/asafgafni/Downloads/MBO 2024/Binnenwerk

Pipeline per INDD (only *.2024.indd):
  1) InDesign: export figure metadata + needed pages
  2) InDesign: export needed pages as 300dpi JPGs
  3) Python: smart-crop figures with labels into PNGs

Outputs per document:
  ~/Desktop/highres_labeled_figures/<book_dir>/<indd_stem>/
    - figure_metadata.json
    - needed_pages.txt
    - page_exports_300/page_<pagename>.jpg
    - figures_300/*.png
    - _DONE.txt
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


IN_DIR = Path("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk")
OUT_BASE = Path.home() / "Desktop/highres_labeled_figures"

WORK_DIR = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
CONFIG_PATH = WORK_DIR / "_export_config.json"

SCRIPT_METADATA = WORK_DIR / "export-metadata-from-config.jsx"
SCRIPT_PAGES_300 = WORK_DIR / "export-pages-300-from-config.jsx"
SMART_CROP = WORK_DIR / "smart_crop.py"

INDESIGN_APP = "Adobe InDesign 2026"


def run_osascript_do_script(script_path: Path) -> None:
    applescript = f'''with timeout of 14400 seconds
tell application "{INDESIGN_APP}"
    activate
    do script POSIX file "{script_path.as_posix()}" language javascript
end tell
end timeout'''
    subprocess.run(["osascript", "-e", applescript], check=True)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def list_indd_files() -> list[tuple[Path, Path]]:
    """
    Returns list of (book_dir, indd_path) for all *.2024.indd under book_dir.
    Skips PDF-only folder.
    """
    if not IN_DIR.exists():
        raise RuntimeError(f"Input dir not found: {IN_DIR}")

    pairs: list[tuple[Path, Path]] = []
    for book_dir in sorted(IN_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not book_dir.is_dir():
            continue
        if "ONLY PDF" in book_dir.name:
            continue

        for indd in sorted(book_dir.glob("*.2024.indd"), key=lambda p: p.name.lower()):
            pairs.append((book_dir, indd))

    return pairs


def main() -> int:
    OUT_BASE.mkdir(parents=True, exist_ok=True)

    pairs = list_indd_files()
    print(f"Found {len(pairs)} INDD files to process.")

    for idx, (book_dir, indd_path) in enumerate(pairs, start=1):
        book_out = OUT_BASE / book_dir.name
        doc_out = book_out / indd_path.stem

        done_marker = doc_out / "_DONE.txt"
        if done_marker.exists():
            print(f"[{idx}/{len(pairs)}] SKIP (done): {indd_path.name}")
            continue

        print(f"[{idx}/{len(pairs)}] Processing: {indd_path}")

        metadata_path = doc_out / "figure_metadata.json"
        needed_pages_path = doc_out / "needed_pages.txt"
        page_exports_300 = doc_out / "page_exports_300"
        figures_out = doc_out / "figures_300"

        cfg = {
            "silent": True,
            "closeDocAfter": True,
            "docPath": str(indd_path),
            "metadataPath": str(metadata_path),
            "neededPagesPath": str(needed_pages_path),
            "pageExports300Dir": str(page_exports_300),
            "pageExportsFallbackDir": "",  # optional
            "figuresOutDir": str(figures_out),
            "figuresOutExt": ".png",
            "noClean": False,
        }

        write_text(CONFIG_PATH, json.dumps(cfg, indent=2) + "\n")

        start = time.time()

        # 1) Metadata
        try:
            run_osascript_do_script(SCRIPT_METADATA)
        except subprocess.CalledProcessError as e:
            print(f"ERROR: metadata failed for {indd_path.name}: {e}", file=sys.stderr)
            continue

        # 2) 300dpi page exports
        try:
            run_osascript_do_script(SCRIPT_PAGES_300)
        except subprocess.CalledProcessError as e:
            print(f"ERROR: page export failed for {indd_path.name}: {e}", file=sys.stderr)
            continue

        # 3) Smart crop (high-res)
        try:
            subprocess.run(
                ["python3", str(SMART_CROP), "--config", str(CONFIG_PATH)],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"ERROR: smart crop failed for {indd_path.name}: {e}", file=sys.stderr)
            continue

        elapsed = time.time() - start
        done_marker.parent.mkdir(parents=True, exist_ok=True)
        done_marker.write_text(
            "DONE\n"
            f"when: {datetime.now().isoformat(timespec='seconds')}\n"
            f"doc: {indd_path}\n"
            f"seconds: {elapsed:.1f}\n",
            encoding="utf-8",
        )
        print(f"✓ DONE {indd_path.name} in {elapsed:.1f}s  → {doc_out}")

    print("\nAll done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())








