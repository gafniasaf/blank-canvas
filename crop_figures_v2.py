#!/usr/bin/env python3
"""
Crop figures with generous padding to ensure labels are included.
Uses image bounds from metadata + large margin for labels.
"""

import json
from pathlib import Path
from PIL import Image

METADATA_FILE = Path.home() / "Desktop/extracted_figures/figure_metadata.json"
PAGE_EXPORTS_DIR = Path.home() / "Desktop/page_exports"
OUTPUT_DIR = Path.home() / "Desktop/extracted_figures/with_labels"

# InDesign points to pixels at 150 DPI
PTS_TO_PX = 150 / 72

# Generous padding around images to capture labels (in points)
# Labels can be quite far from the image
LABEL_PADDING_TOP = 20       # Labels above image
LABEL_PADDING_BOTTOM = 150   # Caption below + some margin
LABEL_PADDING_LEFT = 120     # Labels to the left (like anatomical labels)
LABEL_PADDING_RIGHT = 120    # Labels to the right

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(METADATA_FILE) as f:
        figures = json.load(f)
    
    print(f"Processing {len(figures)} figures with generous label padding...")
    
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
        except Exception as e:
            skipped += 1
            continue
        
        # Get image bounds and add padding for labels
        # Bounds are in points, convert to pixels
        img_top = fig["top"] * PTS_TO_PX
        img_left = fig["left"] * PTS_TO_PX
        img_bottom = fig["bottom"] * PTS_TO_PX
        img_right = fig["right"] * PTS_TO_PX
        
        # Add generous padding for labels
        crop_top = max(0, img_top - LABEL_PADDING_TOP * PTS_TO_PX)
        crop_left = max(0, img_left - LABEL_PADDING_LEFT * PTS_TO_PX)
        crop_bottom = min(img.height, img_bottom + LABEL_PADDING_BOTTOM * PTS_TO_PX)
        crop_right = min(img.width, img_right + LABEL_PADDING_RIGHT * PTS_TO_PX)
        
        # Validate
        if crop_right <= crop_left or crop_bottom <= crop_top:
            skipped += 1
            continue
        
        # Skip if too small (probably an icon)
        if (crop_right - crop_left) < 100 or (crop_bottom - crop_top) < 100:
            skipped += 1
            continue
        
        # Crop
        cropped = img.crop((int(crop_left), int(crop_top), int(crop_right), int(crop_bottom)))
        
        # Save
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in fig.get("imageName", "fig"))
        output_file = OUTPUT_DIR / f"page_{page_name}_fig_{i+1}_{safe_name[:25]}.jpg"
        cropped.save(output_file, quality=95)
        exported += 1
        
        if (i + 1) % 50 == 0:
            print(f"  Processed {i + 1}/{len(figures)}...")
    
    print(f"\nDone! Exported: {exported}, Skipped: {skipped}")
    print(f"Output: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()







