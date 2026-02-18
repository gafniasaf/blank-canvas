#!/usr/bin/env python3
"""
Simple, reliable cropping approach:
- Use full page width for all figures (to capture labels on both sides)
- Use generous vertical padding above and below
- This ensures no labels are cut off
"""

import json
from pathlib import Path
from PIL import Image

METADATA_FILE = Path.home() / "Desktop/extracted_figures/figure_metadata.json"
PAGE_EXPORTS_DIR = Path.home() / "Desktop/page_exports"
OUTPUT_DIR = Path.home() / "Desktop/extracted_figures/complete"

PTS_TO_PX = 150 / 72

# Vertical padding in points
PADDING_TOP = 30      # Space above image for labels
PADDING_BOTTOM = 120  # Space below for caption + labels

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(METADATA_FILE) as f:
        figures = json.load(f)
    
    print(f"Processing {len(figures)} figures with full-width cropping...")
    
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
        img_bottom = fig["bottom"] * PTS_TO_PX
        img_height = img_bottom - img_top
        
        # Skip tiny images (icons)
        if img_height < 80:
            skipped += 1
            continue
        
        # Use FULL page width to capture all labels on both sides
        crop_left = 0
        crop_right = img.width
        
        # Add generous vertical padding
        crop_top = max(0, img_top - PADDING_TOP * PTS_TO_PX)
        crop_bottom = min(img.height, img_bottom + PADDING_BOTTOM * PTS_TO_PX)
        
        # Ensure minimum height
        if (crop_bottom - crop_top) < 150:
            skipped += 1
            continue
        
        # Crop
        cropped = img.crop((int(crop_left), int(crop_top), int(crop_right), int(crop_bottom)))
        
        # Save
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







