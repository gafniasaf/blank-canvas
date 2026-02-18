#!/usr/bin/env python3
"""
Analyze PDF pages for layout issues:
- white-space ratio (rendered page)
- text length
- image count
- text block coverage ratio
Outputs JSON/CSV and prints suspect pages.
"""
import csv
import json
from pathlib import Path
from typing import List, Dict

import fitz  # PyMuPDF
from PIL import Image

REPO = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
PDF_PATH = REPO / "new_pipeline" / "output" / "vth_n4" / "MBO_VTH_N4_FULL_CLEANED.pdf"
OUT_JSON = REPO / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_pdf_page_density.json"
OUT_CSV = REPO / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_pdf_page_density.csv"


def white_ratio(img: Image.Image) -> float:
    # Convert to grayscale and compute ratio of pixels >= 245
    gray = img.convert("L")
    hist = gray.histogram()
    white = sum(hist[245:256])
    total = sum(hist)
    return white / total if total else 1.0


def main() -> None:
    if not PDF_PATH.exists():
        raise SystemExit(f"PDF not found: {PDF_PATH}")

    doc = fitz.open(str(PDF_PATH))
    rows: List[Dict] = []

    for i in range(doc.page_count):
        page = doc[i]
        text = page.get_text("text")
        images = page.get_images(full=True)

        # Render page at low DPI for quick white-space estimation
        pix = page.get_pixmap(dpi=72)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        w_ratio = white_ratio(img)

        # Text coverage: sum of text block rectangles / page area
        blocks = page.get_text("blocks")  # (x0, y0, x1, y1, "text", block_no, block_type)
        page_area = page.rect.width * page.rect.height
        text_area = 0.0
        for (x0, y0, x1, y1, _txt, _bno, btype) in blocks:
            if btype == 0:  # text
                text_area += max(0.0, (x1 - x0) * (y1 - y0))
        text_cov = (text_area / page_area) if page_area else 0.0

        rows.append(
            {
                "page": i + 1,
                "text_len": len(text.strip()),
                "image_count": len(images),
                "white_ratio": round(w_ratio, 4),
                "text_coverage": round(text_cov, 4),
            }
        )

    doc.close()

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump({"pages": rows}, f, indent=2, ensure_ascii=False)

    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["page", "text_len", "image_count", "white_ratio", "text_coverage"]
        )
        writer.writeheader()
        for r in rows:
            writer.writerow(r)

    # Flag suspect pages: high white ratio + some text (likely sparse layout)
    suspects = [
        r for r in rows if r["white_ratio"] >= 0.93 and r["text_len"] > 80
    ]
    suspects.sort(key=lambda r: (-r["white_ratio"], r["text_len"]))

    print("=== Page Density Analysis ===")
    print(f"Pages: {len(rows)}")
    print(f"Suspects (white_ratio>=0.93 & text_len>80): {len(suspects)}")
    print(f"JSON: {OUT_JSON}")
    print(f"CSV: {OUT_CSV}")
    if suspects:
        print("Top suspects:")
        for r in suspects[:15]:
            print(
                f"  p{r['page']}: white={r['white_ratio']} text_len={r['text_len']} img={r['image_count']} cov={r['text_coverage']}"
            )


if __name__ == "__main__":
    main()





