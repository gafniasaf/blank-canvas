#!/usr/bin/env python3
"""
Crop figures with smart padding based on figure type.
Large anatomical diagrams get full-width treatment.
"""

import json
from pathlib import Path
from PIL import Image

METADATA_FILE = Path.home() / "Desktop/extracted_figures/figure_metadata.json"
PAGE_EXPORTS_DIR = Path.home() / "Desktop/page_exports"
OUTPUT_DIR = Path.home() / "Desktop/extracted_figures/final"

PTS_TO_PX = 150 / 72  # InDesign points to pixels at 150 DPI

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(METADATA_FILE) as f:
        figures = json.load(f)
    
    print(f"Processing {len(figures)} figures with smart padding...")
    
    exported = 0
    skipped = 0
    
    for i, fig in enumerate(figures):
        page_name = fig["page"]
        page_file = PAGE_EXPORTS_DIR / f"page_{page_name}.jpg"
        
        if not page_file.exists():
            skipped += 1
            continue
        
        try:
            img = Image.open(page_file)
        except:
            skipped += 1
            continue
        
        # Image bounds in pixels
        img_top = fig["top"] * PTS_TO_PX
        img_left = fig["left"] * PTS_TO_PX
        img_bottom = fig["bottom"] * PTS_TO_PX
        img_right = fig["right"] * PTS_TO_PX
        img_width = img_right - img_left
        img_height = img_bottom - img_top
        
        # Determine padding based on figure characteristics
        # Large figures (>40% page width) likely have labels on both sides
        page_width = img.width
        is_wide_figure = img_width > (page_width * 0.35)
        
        if is_wide_figure:
            # Full-width treatment: capture entire page width + generous vertical
            pad_left = img_left  # Go to page edge
            pad_right = page_width - img_right  # Go to page edge
            pad_top = 30 * PTS_TO_PX
            pad_bottom = 200 * PTS_TO_PX  # Extra for caption
        else:
            # Standard figure: moderate padding
            pad_left = 150 * PTS_TO_PX
            pad_right = 150 * PTS_TO_PX
            pad_top = 30 * PTS_TO_PX
            pad_bottom = 150 * PTS_TO_PX
        
        # Calculate crop bounds
        crop_left = max(0, img_left - pad_left)
        crop_top = max(0, img_top - pad_top)
        crop_right = min(img.width, img_right + pad_right)
        crop_bottom = min(img.height, img_bottom + pad_bottom)
        
        # Skip invalid or tiny crops
        crop_width = crop_right - crop_left
        crop_height = crop_bottom - crop_top
        if crop_width < 100 or crop_height < 100:
            skipped += 1
            continue
        
        # Crop and save
        cropped = img.crop((int(crop_left), int(crop_top), int(crop_right), int(crop_bottom)))
        
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in fig.get("imageName", "fig"))
        output_file = OUTPUT_DIR / f"p{page_name}_f{i+1}_{safe_name[:20]}.jpg"
        cropped.save(output_file, quality=95)
        exported += 1
        
        if (i + 1) % 50 == 0:
            print(f"  Processed {i + 1}/{len(figures)}...")
    
    print(f"\nDone! Exported: {exported}, Skipped: {skipped}")
    print(f"Output: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()







