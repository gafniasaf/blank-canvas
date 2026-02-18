#!/usr/bin/env python3
"""
PDF Cropper - Individual Figures

Exports each figure from the PDF as a separate image, even when multiple
figures are on the same page. Uses figure metadata for precise cropping.

Usage:
    python3 scripts/pdf_crop_individual_figures.py <input.pdf> <metadata.json> <output_dir> [options]
"""

import argparse
import json
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

from PIL import Image


def load_metadata(metadata_path: Path) -> list[dict]:
    """Load metadata from file or directory."""
    if metadata_path.is_dir():
        figures = []
        for json_file in sorted(metadata_path.rglob("figure_metadata.json")):
            with open(json_file, "r", encoding="utf-8") as f:
                figures.extend(json.load(f))
        return figures
    else:
        with open(metadata_path, "r", encoding="utf-8") as f:
            return json.load(f)


def sanitize_filename(name: str) -> str:
    """Make a string safe for use as filename."""
    if "." in name:
        name = name.rsplit(".", 1)[0]
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    return safe[:50]


def process_pdf(
    pdf_path: Path,
    metadata_path: Path,
    output_dir: Path,
    dpi: int = 300,
    min_area: float = 500,  # Minimum area in page units to export
    padding_percent: float = 5,  # Padding around each figure
    chop_bottom_percent: float = 10,  # Chop from bottom before processing
) -> tuple[int, int]:
    """Process PDF and export each figure individually."""
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load metadata
    print(f"Loading metadata from {metadata_path}...")
    figures = load_metadata(metadata_path)
    
    if not figures:
        print("No figures found in metadata!")
        return 0, 0
    
    # Get page dimensions from first figure
    page_width = figures[0].get('pageWidthUnits', 195)
    page_height = figures[0].get('pageHeightUnits', 265)
    
    # Filter out small figures (logos, icons)
    significant_figures = []
    for fig in figures:
        area = fig.get('width', 0) * fig.get('height', 0)
        if area >= min_area:
            significant_figures.append(fig)
    
    print(f"Total figures in metadata: {len(figures)}")
    print(f"Significant figures (area >= {min_area}): {len(significant_figures)}")
    
    # Group by pageIndex
    by_page = defaultdict(list)
    for fig in significant_figures:
        by_page[fig['pageIndex']].append(fig)
    
    print(f"Pages with figures: {len(by_page)}")
    
    # Get total pages in PDF
    result = subprocess.run(
        ["magick", "identify", "-format", "%n\n", str(pdf_path)],
        capture_output=True, text=True
    )
    total_pages = len(result.stdout.strip().split("\n"))
    print(f"PDF has {total_pages} pages")
    print(f"Bottom chop: {chop_bottom_percent}%")
    print(f"Padding: {padding_percent}%")
    print()
    
    exported = 0
    skipped = 0
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        for page_idx in sorted(by_page.keys()):
            page_figures = by_page[page_idx]
            
            if page_idx >= total_pages:
                skipped += len(page_figures)
                continue
            
            # Render page
            temp_raw = temp_path / f"raw_{page_idx:04d}.png"
            cmd_render = [
                "magick",
                "-density", str(dpi),
                f"{pdf_path}[{page_idx}]",
                str(temp_raw)
            ]
            
            try:
                subprocess.run(cmd_render, check=True, capture_output=True)
            except subprocess.CalledProcessError:
                skipped += len(page_figures)
                continue
            
            # Load rendered page
            img = Image.open(temp_raw)
            img_w, img_h = img.size
            
            # Calculate scale from page units to pixels
            scale_x = img_w / page_width
            scale_y = img_h / page_height
            
            # Chop bottom
            chop_pixels = int(img_h * chop_bottom_percent / 100)
            effective_h = img_h - chop_pixels
            
            # Export each figure on this page
            for fig_idx, fig in enumerate(page_figures):
                # Get figure bounds in page units
                fig_top = fig.get('top', 0)
                fig_left = fig.get('left', 0)
                fig_bottom = fig.get('bottom', 0)
                fig_right = fig.get('right', 0)
                fig_width = fig_right - fig_left
                fig_height = fig_bottom - fig_top
                
                # Add padding (in page units)
                pad_x = fig_width * padding_percent / 100
                pad_y = fig_height * padding_percent / 100
                
                # Convert to pixels
                crop_left = int((fig_left - pad_x) * scale_x)
                crop_top = int((fig_top - pad_y) * scale_y)
                crop_right = int((fig_right + pad_x) * scale_x)
                crop_bottom = int((fig_bottom + pad_y) * scale_y)
                
                # Clamp to image bounds
                crop_left = max(0, crop_left)
                crop_top = max(0, crop_top)
                crop_right = min(img_w, crop_right)
                crop_bottom = min(effective_h, crop_bottom)  # Don't go into chopped area
                
                # Validate
                if crop_right <= crop_left or crop_bottom <= crop_top:
                    skipped += 1
                    continue
                
                # Check minimum size (skip tiny results)
                if (crop_right - crop_left) < 50 or (crop_bottom - crop_top) < 50:
                    skipped += 1
                    continue
                
                # Crop
                cropped = img.crop((crop_left, crop_top, crop_right, crop_bottom))
                
                # Generate filename
                fig_name = sanitize_filename(fig.get('imageName', f'fig_{fig_idx}'))
                output_path = output_dir / f"p{page_idx:04d}_{fig_name}.png"
                
                # Handle duplicates (same name on same page)
                counter = 1
                while output_path.exists():
                    output_path = output_dir / f"p{page_idx:04d}_{fig_name}_{counter}.png"
                    counter += 1
                
                cropped.save(output_path)
                exported += 1
            
            img.close()
            
            if exported % 50 == 0 and exported > 0:
                print(f"  Processed {exported} figures...")
    
    return exported, skipped


def main():
    parser = argparse.ArgumentParser(
        description="PDF Cropper - Individual Figures"
    )
    parser.add_argument("pdf", type=str, help="Input PDF file")
    parser.add_argument("metadata", type=str, help="Metadata JSON file or directory")
    parser.add_argument("output", type=str, help="Output directory")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--min-area", type=float, default=500, help="Minimum figure area")
    parser.add_argument("--padding", type=float, default=5, help="Padding percent around figures")
    parser.add_argument("--chop", type=float, default=10, help="Percent to chop from bottom")
    
    args = parser.parse_args()
    
    pdf_path = Path(args.pdf)
    metadata_path = Path(args.metadata)
    output_dir = Path(args.output)
    
    if not pdf_path.exists():
        print(f"Error: PDF not found: {pdf_path}")
        return 1
    
    if not metadata_path.exists():
        print(f"Error: Metadata not found: {metadata_path}")
        return 1
    
    print(f"=== PDF Cropper - Individual Figures ===")
    print(f"PDF:      {pdf_path}")
    print(f"Metadata: {metadata_path}")
    print(f"Output:   {output_dir}")
    print()
    
    exported, skipped = process_pdf(
        pdf_path=pdf_path,
        metadata_path=metadata_path,
        output_dir=output_dir,
        dpi=args.dpi,
        min_area=args.min_area,
        padding_percent=args.padding,
        chop_bottom_percent=args.chop,
    )
    
    print(f"\nDone!")
    print(f"  Exported: {exported}")
    print(f"  Skipped:  {skipped}")
    print(f"  Output:   {output_dir}")
    return 0


if __name__ == "__main__":
    exit(main())





