#!/usr/bin/env python3
"""
Extract chapter opener images for VTH N4 from the source PDF.
Uses known chapter start pages and saves chapter_N_opener.jpg files.
"""
from __future__ import annotations

from pathlib import Path
import fitz  # PyMuPDF

REPO = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
SOURCE_PDF = REPO / "new_pipeline" / "output" / "highres_exports" / "MBO_VTH_N4_2024_HIGHRES.pdf"
OUT_DIR = REPO / "new_pipeline" / "assets" / "images" / "vth_n4_chapter_openers"

# 0-based page indices for chapter start pages (from earlier detection)
CHAPTER_PAGES = {
    1: 18,
    2: 30,
    3: 42,
    4: 58,
    5: 96,
    6: 114,
    7: 144,
    8: 168,
    9: 182,
    10: 196,
    11: 208,
    12: 216,
    13: 222,
    14: 258,
    15: 270,
    16: 280,
    17: 292,
    18: 314,
    19: 322,
    20: 330,
    21: 346,
    22: 352,
    23: 370,
    24: 378,
    25: 404,
    26: 432,
    27: 450,
    28: 464,
    29: 472,
    30: 478,
}


def main() -> None:
    if not SOURCE_PDF.exists():
        raise SystemExit(f"Missing source PDF: {SOURCE_PDF}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pdf = fitz.open(str(SOURCE_PDF))

    extracted = 0
    skipped = []

    for ch, idx in CHAPTER_PAGES.items():
        page = pdf[idx]
        imgs = page.get_images(full=True)
        if not imgs:
            skipped.append(ch)
            continue

        # Use the first image on the opener page
        xref = imgs[0][0]
        pix = fitz.Pixmap(pdf, xref)
        if pix.colorspace and pix.colorspace.n > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)

        out_path = OUT_DIR / f"chapter_{ch}_opener.jpg"
        pix.save(str(out_path))
        extracted += 1

    pdf.close()

    print(f"Extracted openers: {extracted}")
    if skipped:
        print(f"Chapters without opener image: {skipped}")
    print(f"Output dir: {OUT_DIR}")


if __name__ == "__main__":
    main()





