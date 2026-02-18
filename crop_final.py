#!/usr/bin/env python3
"""
Final cropping script with correct padding for all labels and captions.
"""

import json
from pathlib import Path
from PIL import Image

METADATA_FILE = Path.home() / "Desktop/extracted_figures/figure_metadata.json"
PAGE_EXPORTS_DIR = Path.home() / "Desktop/page_exports"
OUTPUT_DIR = Path.home() / "Desktop/extracted_figures/final_with_labels"

PTS_TO_PX = 150 / 72

# Generous padding that works for all figures
PADDING_TOP = 50       # Space above for labels
PADDING_BOTTOM = 250   # Space below for image content + caption + bottom labels

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Clear existing files
    for f in OUTPUT_DIR.glob("*.jpg"):
        f.unlink()
    
    with open(METADATA_FILE) as f:
        figures = json.load(f)
    
    print(f"Processing {len(figures)} figures with generous padding...")
    
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
        
        # Full page width + generous vertical padding
        crop_left = 0
        crop_right = img.width
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
    
    print(f"\nDone!")
    print(f"  Exported: {exported} figures")
    print(f"  Skipped: {skipped}")
    print(f"  Output: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()







