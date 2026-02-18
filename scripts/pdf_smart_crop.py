#!/usr/bin/env python3
"""
Smart PDF Image Cropper

Converts PDF pages to high-res images, then uses contour detection
to find and extract individual image+label groups.

This is useful when:
- Multiple images per page that need separate exports
- Headers/footers vary in size
- You need "content-aware" cropping

Usage:
    python3 scripts/pdf_smart_crop.py <input.pdf> <output_dir> [options]
    
Options:
    --dpi <int>         DPI for rendering (default: 300)
    --min-area <int>    Minimum contour area in pixels (default: 10000)
    --padding <int>     Padding around detected regions (default: 20)
    --header <int>      Pixels to ignore from top (default: 150)
    --footer <int>      Pixels to ignore from bottom (default: 150)
    --single            Output one image per page (largest region only)
    --verbose           Show detailed progress

Example:
    python3 scripts/pdf_smart_crop.py \\
        deliverables/MBO_AF4_2024_COMMON_CORE/MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf \\
        output/af4_smart_crop \\
        --dpi 300 --min-area 15000
"""

import argparse
import os
import subprocess
import tempfile
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    print("Installing required packages...")
    subprocess.run(["pip3", "install", "opencv-python", "numpy"], check=True)
    import cv2
    import numpy as np


def render_pdf_pages(pdf_path: Path, dpi: int, temp_dir: Path) -> list[Path]:
    """Render PDF to temporary PNG files using ImageMagick."""
    output_pattern = temp_dir / "page-%04d.png"
    
    cmd = [
        "magick",
        "-density", str(dpi),
        str(pdf_path),
        str(output_pattern)
    ]
    
    print(f"Rendering PDF at {dpi} DPI...")
    subprocess.run(cmd, check=True, capture_output=True)
    
    # Find all rendered pages
    pages = sorted(temp_dir.glob("page-*.png"))
    print(f"Rendered {len(pages)} pages")
    return pages


def find_content_regions(
    image: np.ndarray,
    min_area: int,
    header_margin: int,
    footer_margin: int,
) -> list[tuple[int, int, int, int]]:
    """
    Find content regions in an image.
    Returns list of (x, y, w, h) bounding boxes.
    """
    h, w = image.shape[:2]
    
    # Create working area (exclude header/footer)
    work_top = header_margin
    work_bottom = h - footer_margin
    
    # Convert to grayscale
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    
    # Crop to working area
    work_region = gray[work_top:work_bottom, :]
    
    # Threshold: anything not white is content
    # Using inverted binary threshold
    _, thresh = cv2.threshold(work_region, 240, 255, cv2.THRESH_BINARY_INV)
    
    # Dilate to connect nearby elements (labels with their images)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    dilated = cv2.dilate(thresh, kernel, iterations=3)
    
    # Find contours
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    regions = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        area = cw * ch
        
        if area >= min_area:
            # Adjust y back to full image coordinates
            regions.append((x, y + work_top, cw, ch))
    
    # Sort by y position (top to bottom), then x (left to right)
    regions.sort(key=lambda r: (r[1], r[0]))
    
    return regions


def crop_and_save(
    image: np.ndarray,
    regions: list[tuple[int, int, int, int]],
    output_dir: Path,
    page_num: int,
    padding: int,
    single_mode: bool,
) -> int:
    """Crop regions from image and save as PNGs."""
    h, w = image.shape[:2]
    
    if single_mode and regions:
        # Keep only the largest region
        regions = [max(regions, key=lambda r: r[2] * r[3])]
    
    saved = 0
    for i, (x, y, rw, rh) in enumerate(regions):
        # Apply padding
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(w, x + rw + padding)
        y2 = min(h, y + rh + padding)
        
        # Crop
        cropped = image[y1:y2, x1:x2]
        
        # Generate filename
        if single_mode:
            filename = f"page_{page_num:03d}.png"
        else:
            filename = f"page_{page_num:03d}_region_{i+1:02d}.png"
        
        output_path = output_dir / filename
        cv2.imwrite(str(output_path), cropped)
        saved += 1
    
    return saved


def process_pdf(
    pdf_path: Path,
    output_dir: Path,
    dpi: int = 300,
    min_area: int = 10000,
    padding: int = 20,
    header_margin: int = 150,
    footer_margin: int = 150,
    single_mode: bool = False,
    verbose: bool = False,
) -> int:
    """Process a PDF and extract cropped images."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    total_saved = 0
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Render PDF pages
        pages = render_pdf_pages(pdf_path, dpi, temp_path)
        
        for page_num, page_path in enumerate(pages):
            if verbose:
                print(f"Processing page {page_num + 1}/{len(pages)}...")
            
            # Load image
            image = cv2.imread(str(page_path))
            if image is None:
                print(f"Warning: Could not load {page_path}")
                continue
            
            # Find content regions
            regions = find_content_regions(
                image, min_area, header_margin, footer_margin
            )
            
            if verbose and regions:
                print(f"  Found {len(regions)} region(s)")
            
            # Skip empty pages
            if not regions:
                if verbose:
                    print(f"  No content found, skipping")
                continue
            
            # Crop and save
            saved = crop_and_save(
                image, regions, output_dir, page_num, padding, single_mode
            )
            total_saved += saved
    
    return total_saved


def main():
    parser = argparse.ArgumentParser(
        description="Smart PDF Image Cropper - extracts images with labels"
    )
    parser.add_argument("pdf", type=str, help="Input PDF file")
    parser.add_argument("output", type=str, help="Output directory")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--min-area", type=int, default=10000, 
                        help="Minimum region area in pixels")
    parser.add_argument("--padding", type=int, default=20,
                        help="Padding around detected regions")
    parser.add_argument("--header", type=int, default=150,
                        help="Pixels to ignore from top")
    parser.add_argument("--footer", type=int, default=150,
                        help="Pixels to ignore from bottom")
    parser.add_argument("--single", action="store_true",
                        help="Output one image per page (largest region)")
    parser.add_argument("--verbose", action="store_true",
                        help="Show detailed progress")
    
    args = parser.parse_args()
    
    pdf_path = Path(args.pdf)
    output_dir = Path(args.output)
    
    if not pdf_path.exists():
        print(f"Error: PDF not found: {pdf_path}")
        return 1
    
    print(f"=== Smart PDF Cropper ===")
    print(f"Input:  {pdf_path}")
    print(f"Output: {output_dir}")
    print(f"DPI:    {args.dpi}")
    print(f"Min area: {args.min_area}")
    print(f"Padding: {args.padding}")
    print(f"Header margin: {args.header}")
    print(f"Footer margin: {args.footer}")
    print(f"Single mode: {args.single}")
    print()
    
    total = process_pdf(
        pdf_path=pdf_path,
        output_dir=output_dir,
        dpi=args.dpi,
        min_area=args.min_area,
        padding=args.padding,
        header_margin=args.header,
        footer_margin=args.footer,
        single_mode=args.single,
        verbose=args.verbose,
    )
    
    print(f"\nDone! Saved {total} images to {output_dir}")
    return 0


if __name__ == "__main__":
    exit(main())

