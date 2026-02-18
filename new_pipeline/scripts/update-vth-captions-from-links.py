#!/usr/bin/env python3
"""
Update VTH N4 figure captions using InDesign Links filenames.
Only replaces captions that are missing or likely truncated.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict

REPO = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
LINKS_DIR = Path("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/Links")
INPUT = REPO / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.json"
OUTPUT = REPO / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"

SUPPORTED_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".psd"}


def normalize_caption(raw: str) -> str:
    text = raw.replace("_", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def build_links_caption_map() -> Dict[str, str]:
    captions: Dict[str, str] = {}
    for p in LINKS_DIR.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() not in SUPPORTED_EXTS:
            continue
        # Pattern: ..._4.21_caption words here.ext
        m = re.search(r"_(\d+\.\d+)_(.+)\.(?:tif|tiff|jpg|jpeg|png|psd)$", p.name, re.IGNORECASE)
        if not m:
            continue
        fig_key = m.group(1)
        caption = normalize_caption(m.group(2))
        if caption:
            captions[fig_key] = caption
    return captions


def is_truncated(existing: str, replacement: str) -> bool:
    if not existing:
        return True
    existing = existing.strip()
    replacement = replacement.strip()
    if not existing:
        return True
    if len(existing) < 20 and len(replacement) > len(existing) + 5:
        return True
    if not existing.endswith((".", "!", "?")) and len(replacement) > len(existing) + 5:
        return True
    if replacement.lower().startswith(existing.lower()) and len(replacement) > len(existing) + 3:
        return True
    return False


def main() -> None:
    if not LINKS_DIR.exists():
        raise SystemExit(f"Links folder not found: {LINKS_DIR}")
    if not INPUT.exists():
        raise SystemExit(f"Canonical not found: {INPUT}")

    links_captions = build_links_caption_map()
    print(f"Link captions found: {len(links_captions)}")

    with INPUT.open("r", encoding="utf-8") as f:
        book = json.load(f)

    updated = 0
    updated_keys = []

    for chapter in book.get("chapters", []):
        for section in chapter.get("sections", []):
            for block in section.get("content", []):
                if not isinstance(block, dict):
                    continue
                for img in block.get("images", []):
                    fig = img.get("figureNumber", "")
                    m = re.search(r"(\d+\.\d+)", fig)
                    if not m:
                        continue
                    key = m.group(1)
                    if key not in links_captions:
                        continue
                    existing = (img.get("caption") or "").strip()
                    replacement = links_captions[key]
                    if is_truncated(existing, replacement):
                        img["caption"] = replacement
                        updated += 1
                        updated_keys.append(key)

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(book, f, indent=2, ensure_ascii=False)

    print(f"Updated captions: {updated}")
    if updated_keys:
        print("Updated keys sample:", updated_keys[:15])
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()





