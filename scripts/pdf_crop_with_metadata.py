#!/usr/bin/env python3
"""
PDF Cropper with Metadata-based Naming

Processes a PDF and names output images based on figure_metadata.json.
Uses ImageMagick for high-quality PDF rendering and trimming.

Usage:
    python3 scripts/pdf_crop_with_metadata.py <input.pdf> <metadata.json> <output_dir> [options]

Options:
    --dpi <int>         DPI for rendering (default: 300)
    --fuzz <percent>    Fuzz factor for trim (default: 5)
"""

import argparse
import json
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path


def load_metadata(metadata_path: Path) -> dict[int, list[dict]]:
    """Load metadata and group by pageIndex."""
    with open(metadata_path, "r", encoding="utf-8") as f:
        figures = json.load(f)
    
    # Group figures by pageIndex
    by_page: dict[int, list[dict]] = defaultdict(list)
    for fig in figures:
        page_idx = fig.get("pageIndex", 0)
        by_page[page_idx].append(fig)
    
    return by_page


def sanitize_filename(name: str) -> str:
    """Make a string safe for use as filename."""
    # Remove extension if present
    if "." in name:
        name = name.rsplit(".", 1)[0]
    # Replace unsafe characters
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    return safe[:60]  # Limit length


def process_pdf(
    pdf_path: Path,
    metadata_path: Path,
    output_dir: Path,
    dpi: int = 300,
    fuzz: int = 5,
) -> int:
    """Process PDF and export cropped images with proper names."""
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load metadata
    print(f"Loading metadata from {metadata_path}...")
    by_page = load_metadata(metadata_path)
    
    if not by_page:
        print("No figures found in metadata!")
        return 0
    
    max_page = max(by_page.keys())
    print(f"Found figures on {len(by_page)} pages (max pageIndex: {max_page})")
    
    # Get total pages in PDF
    result = subprocess.run(
        ["magick", "identify", "-format", "%n\n", str(pdf_path)],
        capture_output=True, text=True
    )
    # Each page outputs a line, count unique
    total_pages = len(result.stdout.strip().split("\n"))
    print(f"PDF has {total_pages} pages")
    
    exported = 0
    skipped = 0
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Process each page that has figures
        for page_idx in sorted(by_page.keys()):
            figures = by_page[page_idx]
            
            if page_idx >= total_pages:
                print(f"  Warning: pageIndex {page_idx} exceeds PDF pages ({total_pages})")
                skipped += len(figures)
                continue
            
            # Render this page
            temp_png = temp_path / f"page_{page_idx:04d}.png"
            
            cmd = [
                "magick",
                "-density", str(dpi),
                f"{pdf_path}[{page_idx}]",
                "-fuzz", f"{fuzz}%",
                "-trim",
                "+repage",
                str(temp_png)
            ]
            
            try:
                subprocess.run(cmd, check=True, capture_output=True)
            except subprocess.CalledProcessError as e:
                print(f"  Warning: Failed to process page {page_idx}: {e.stderr.decode()[:100]}")
                skipped += len(figures)
                continue
            
            # Check if output is valid (not 1x1 empty)
            identify = subprocess.run(
                ["magick", "identify", "-format", "%w %h", str(temp_png)],
                capture_output=True, text=True
            )
            dims = identify.stdout.strip().split()
            if len(dims) >= 2:
                w, h = int(dims[0]), int(dims[1])
                if w <= 10 or h <= 10:
                    # Empty page, skip
                    skipped += len(figures)
                    continue
            
            # Name the output based on figures on this page
            # If multiple figures on same page, use the largest one's name
            # (since we're exporting the whole trimmed page)
            if len(figures) == 1:
                fig_name = figures[0].get("imageName", f"page_{page_idx}")
            else:
                # Multiple figures - pick the largest by area
                largest = max(figures, key=lambda f: f.get("width", 0) * f.get("height", 0))
                fig_name = largest.get("imageName", f"page_{page_idx}")
            
            safe_name = sanitize_filename(fig_name)
            output_path = output_dir / f"p{page_idx:04d}_{safe_name}.png"
            
            # Move temp file to output
            temp_png.rename(output_path)
            exported += 1
            
            if exported % 50 == 0:
                print(f"  Processed {exported} pages...")
    
    return exported, skipped


def main():
    parser = argparse.ArgumentParser(
        description="PDF Cropper with Metadata-based Naming"
    )
    parser.add_argument("pdf", type=str, help="Input PDF file")
    parser.add_argument("metadata", type=str, help="Figure metadata JSON file")
    parser.add_argument("output", type=str, help="Output directory")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--fuzz", type=int, default=5, help="Fuzz percent for trim")
    
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
    
    print(f"=== PDF Cropper with Metadata ===")
    print(f"PDF:      {pdf_path}")
    print(f"Metadata: {metadata_path}")
    print(f"Output:   {output_dir}")
    print(f"DPI:      {args.dpi}")
    print(f"Fuzz:     {args.fuzz}%")
    print()
    
    exported, skipped = process_pdf(
        pdf_path=pdf_path,
        metadata_path=metadata_path,
        output_dir=output_dir,
        dpi=args.dpi,
        fuzz=args.fuzz,
    )
    
    print(f"\nDone!")
    print(f"  Exported: {exported}")
    print(f"  Skipped:  {skipped}")
    print(f"  Output:   {output_dir}")
    return 0


if __name__ == "__main__":
    exit(main())

