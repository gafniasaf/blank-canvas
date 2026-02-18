#!/usr/bin/env python3
"""
PDF Cropper with Bottom Chop + Metadata-based Naming

1. Renders PDF page at high DPI
2. Chops X% from bottom (to remove footer labels)
3. Trims remaining whitespace
4. Names output based on figure metadata

Usage:
    python3 scripts/pdf_crop_with_bottom_chop.py <input.pdf> <metadata_dir_or_file> <output_dir> [options]

Options:
    --dpi <int>         DPI for rendering (default: 300)
    --chop <percent>    Percent to chop from bottom (default: 5)
    --fuzz <percent>    Fuzz factor for trim (default: 5)
"""

import argparse
import json
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

from PIL import Image


def load_metadata_from_dir(metadata_dir: Path) -> dict[int, list[dict]]:
    """Load and merge metadata from multiple JSON files in a directory."""
    by_page: dict[int, list[dict]] = defaultdict(list)
    
    for json_file in sorted(metadata_dir.rglob("figure_metadata.json")):
        print(f"  Loading {json_file.parent.name}...")
        with open(json_file, "r", encoding="utf-8") as f:
            figures = json.load(f)
        
        for fig in figures:
            page_idx = fig.get("pageIndex", 0)
            by_page[page_idx].append(fig)
    
    return by_page


def load_metadata_from_file(metadata_file: Path) -> dict[int, list[dict]]:
    """Load metadata from a single JSON file."""
    with open(metadata_file, "r", encoding="utf-8") as f:
        figures = json.load(f)
    
    by_page: dict[int, list[dict]] = defaultdict(list)
    for fig in figures:
        page_idx = fig.get("pageIndex", 0)
        by_page[page_idx].append(fig)
    
    return by_page


def sanitize_filename(name: str) -> str:
    """Make a string safe for use as filename."""
    if "." in name:
        name = name.rsplit(".", 1)[0]
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    return safe[:60]


def process_pdf(
    pdf_path: Path,
    metadata_path: Path,
    output_dir: Path,
    dpi: int = 300,
    chop_percent: float = 5,
    fuzz: int = 5,
) -> tuple[int, int]:
    """Process PDF with bottom chop + trim."""
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load metadata
    print(f"Loading metadata from {metadata_path}...")
    if metadata_path.is_dir():
        by_page = load_metadata_from_dir(metadata_path)
    else:
        by_page = load_metadata_from_file(metadata_path)
    
    if not by_page:
        print("No figures found in metadata!")
        return 0, 0
    
    max_page = max(by_page.keys())
    print(f"Found figures on {len(by_page)} pages (max pageIndex: {max_page})")
    
    # Get total pages in PDF
    result = subprocess.run(
        ["magick", "identify", "-format", "%n\n", str(pdf_path)],
        capture_output=True, text=True
    )
    total_pages = len(result.stdout.strip().split("\n"))
    print(f"PDF has {total_pages} pages")
    print(f"Bottom chop: {chop_percent}%")
    print()
    
    exported = 0
    skipped = 0
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        for page_idx in sorted(by_page.keys()):
            figures = by_page[page_idx]
            
            if page_idx >= total_pages:
                skipped += len(figures)
                continue
            
            # Step 1: Render page at full resolution
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
                skipped += len(figures)
                continue
            
            # Step 2: Chop bottom X% using PIL
            img = Image.open(temp_raw)
            w, h = img.size
            new_h = int(h * (1 - chop_percent / 100))
            img_chopped = img.crop((0, 0, w, new_h))
            
            temp_chopped = temp_path / f"chopped_{page_idx:04d}.png"
            img_chopped.save(temp_chopped)
            img.close()
            img_chopped.close()
            
            # Step 3: Trim with ImageMagick
            temp_trimmed = temp_path / f"trimmed_{page_idx:04d}.png"
            cmd_trim = [
                "magick",
                str(temp_chopped),
                "-fuzz", f"{fuzz}%",
                "-trim",
                "+repage",
                str(temp_trimmed)
            ]
            
            try:
                subprocess.run(cmd_trim, check=True, capture_output=True)
            except subprocess.CalledProcessError:
                skipped += len(figures)
                continue
            
            # Check if result is valid
            if not temp_trimmed.exists():
                skipped += len(figures)
                continue
            
            result_img = Image.open(temp_trimmed)
            rw, rh = result_img.size
            result_img.close()
            
            if rw <= 10 or rh <= 10:
                skipped += len(figures)
                continue
            
            # Name based on largest figure on this page
            if len(figures) == 1:
                fig_name = figures[0].get("imageName", f"page_{page_idx}")
            else:
                largest = max(figures, key=lambda f: f.get("width", 0) * f.get("height", 0))
                fig_name = largest.get("imageName", f"page_{page_idx}")
            
            safe_name = sanitize_filename(fig_name)
            output_path = output_dir / f"p{page_idx:04d}_{safe_name}.png"
            
            # Move to output
            temp_trimmed.rename(output_path)
            exported += 1
            
            if exported % 50 == 0:
                print(f"  Processed {exported} pages...")
    
    return exported, skipped


def main():
    parser = argparse.ArgumentParser(
        description="PDF Cropper with Bottom Chop + Trim"
    )
    parser.add_argument("pdf", type=str, help="Input PDF file")
    parser.add_argument("metadata", type=str, help="Metadata JSON file or directory")
    parser.add_argument("output", type=str, help="Output directory")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--chop", type=float, default=5, help="Percent to chop from bottom")
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
    
    print(f"=== PDF Cropper with Bottom Chop ===")
    print(f"PDF:      {pdf_path}")
    print(f"Metadata: {metadata_path}")
    print(f"Output:   {output_dir}")
    print(f"DPI:      {args.dpi}")
    print(f"Chop:     {args.chop}%")
    print(f"Fuzz:     {args.fuzz}%")
    print()
    
    exported, skipped = process_pdf(
        pdf_path=pdf_path,
        metadata_path=metadata_path,
        output_dir=output_dir,
        dpi=args.dpi,
        chop_percent=args.chop,
        fuzz=args.fuzz,
    )
    
    print(f"\nDone!")
    print(f"  Exported: {exported}")
    print(f"  Skipped:  {skipped}")
    print(f"  Output:   {output_dir}")
    return 0


if __name__ == "__main__":
    exit(main())






