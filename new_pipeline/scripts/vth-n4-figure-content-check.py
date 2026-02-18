#!/usr/bin/env python3
"""
Cross-check figure content by comparing assets to source PDF images.
Uses a simple perceptual hash (aHash) to flag likely mismatches.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import fitz  # PyMuPDF
from PIL import Image
import io

REPO = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
SOURCE_PDF = REPO / "new_pipeline" / "output" / "highres_exports" / "MBO_VTH_N4_2024_HIGHRES.pdf"
ASSETS_DIR = REPO / "new_pipeline" / "assets" / "figures" / "vth_n4"
REPORT_JSON = REPO / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_figure_content_check.json"


def parse_fig_key_from_filename(name: str) -> Optional[str]:
    match = re.match(r"Afbeelding_(\d+)\.(\d+)\.png", name)
    if not match:
        return None
    return f"{match.group(1)}.{match.group(2)}"


def image_to_ahash(img: Image.Image, size: int = 8) -> int:
    # Convert to grayscale, resize, compute average hash
    img = img.convert("L").resize((size, size), Image.Resampling.BILINEAR)
    pixels = list(img.getdata())
    avg = sum(pixels) / len(pixels)
    bits = 0
    for i, px in enumerate(pixels):
        if px > avg:
            bits |= 1 << i
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def load_asset_hashes() -> Dict[str, int]:
    hashes: Dict[str, int] = {}
    for png in ASSETS_DIR.glob("Afbeelding_*.png"):
        key = parse_fig_key_from_filename(png.name)
        if not key:
            continue
        with png.open("rb") as f:
            img = Image.open(f)
            img.load()
        hashes[key] = image_to_ahash(img)
    return hashes


def extract_caption_positions(page: fitz.Page, relevant_keys: set[str]) -> List[Tuple[str, float]]:
    # Use text blocks with coordinates
    blocks = page.get_text("blocks")  # (x0, y0, x1, y1, "text", block_no, block_type)
    results: List[Tuple[str, float]] = []
    for (x0, y0, x1, y1, text, *_rest) in blocks:
        for match in re.finditer(r"Afbeelding\s+(\d+)\.(\d+)", text, re.IGNORECASE):
            key = f"{match.group(1)}.{match.group(2)}"
            if key in relevant_keys:
                results.append((key, y0))
    return results


def extract_image_rects(page: fitz.Page) -> List[Tuple[fitz.Rect, int]]:
    rects: List[Tuple[fitz.Rect, int]] = []
    for img in page.get_images(full=True):
        xref = img[0]
        for rect in page.get_image_rects(xref):
            rects.append((rect, xref))
    return rects


def render_clip_hash(page: fitz.Page, rect: fitz.Rect) -> int:
    pix = page.get_pixmap(clip=rect, dpi=150)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    return image_to_ahash(img)


def main():
    if not SOURCE_PDF.exists():
        raise SystemExit(f"Missing source PDF: {SOURCE_PDF}")
    if not ASSETS_DIR.exists():
        raise SystemExit(f"Missing assets dir: {ASSETS_DIR}")

    asset_hashes = load_asset_hashes()
    relevant_keys = set(asset_hashes.keys())
    print(f"Assets: {len(asset_hashes)}")

    doc = fitz.open(str(SOURCE_PDF))

    # Map figure key -> best matching image hash found in source PDF
    source_map: Dict[str, Dict] = {}

    for page_idx in range(doc.page_count):
        page = doc[page_idx]
        captions = extract_caption_positions(page, relevant_keys)
        if not captions:
            continue

        image_rects = extract_image_rects(page)
        if not image_rects:
            continue

        # Sort image rects by vertical position (top)
        image_rects.sort(key=lambda r: r[0].y0)
        captions.sort(key=lambda c: c[1])

        # Map each caption to nearest image above it
        for key, cap_y in captions:
            best = None
            best_dist = None
            for rect, xref in image_rects:
                # Prefer images above the caption
                if rect.y1 <= cap_y:
                    dist = cap_y - rect.y1
                else:
                    dist = abs(rect.y0 - cap_y)
                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    best = rect

            if best is None:
                continue

            # Hash the clipped image region
            try:
                clip_hash = render_clip_hash(page, best)
            except Exception:
                continue

            source_map[key] = {
                "page": page_idx + 1,
                "clip_hash": clip_hash,
                "caption_y": cap_y,
            }

    doc.close()

    # Compare asset hashes vs source hashes
    results = {}
    mismatches = []
    missing_in_source = []

    for key, asset_hash in asset_hashes.items():
        src = source_map.get(key)
        if not src:
            missing_in_source.append(key)
            continue
        dist = hamming(asset_hash, src["clip_hash"])
        results[key] = {
            "page": src["page"],
            "hash_distance": dist,
        }
        # Threshold for likely mismatch (tune if needed)
        if dist > 12:
            mismatches.append((key, dist, src["page"]))

    report = {
        "assets_total": len(asset_hashes),
        "source_mapped": len(source_map),
        "missing_in_source": missing_in_source,
        "mismatches": [
            {"figure": k, "hash_distance": d, "page": p} for k, d, p in mismatches
        ],
        "results": results,
    }

    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_JSON.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print("=== Figure Content Check ===")
    print(f"Mapped in source PDF: {len(source_map)}")
    print(f"Missing in source: {len(missing_in_source)}")
    print(f"Likely mismatches: {len(mismatches)}")
    print(f"Report: {REPORT_JSON}")
    if mismatches:
        print("Mismatch sample:", mismatches[:10])
    if missing_in_source:
        print("Missing sample:", missing_in_source[:10])


if __name__ == "__main__":
    main()

