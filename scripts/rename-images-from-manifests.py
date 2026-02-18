#!/usr/bin/env python3
"""
Rename cropped images based on figure manifests.
Uses pre-extracted caption data from InDesign - no PDF parsing needed!
"""

import json
import re
import sys
from pathlib import Path

# Minimum file size to consider (blank pages are ~2-3KB)
MIN_FILE_SIZE_KB = 10

def sanitize_filename(text, max_length=80):
    """Convert caption text to a safe filename."""
    text = re.sub(r'[<>:"/\\|?*\n\r]', '_', text)
    text = re.sub(r'[\s_]+', '_', text)
    text = text.strip('_.')
    if len(text) > max_length:
        text = text[:max_length].rstrip('_')
    return text

def load_all_manifests(manifest_dir: Path) -> dict:
    """Load all figure manifests and build page -> caption mapping."""
    page_to_caption = {}  # documentOffset -> caption info
    
    manifest_files = sorted(manifest_dir.glob("figure_manifest_ch*.json"))
    print(f"Found {len(manifest_files)} manifest files")
    
    for mf_path in manifest_files:
        try:
            with open(mf_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            chapter = data.get("chapter", "?")
            figures = data.get("figures", [])
            
            for fig in figures:
                page = fig.get("page", {})
                caption = fig.get("caption", {})
                
                doc_offset = page.get("documentOffset")
                if doc_offset is None:
                    continue
                
                label = caption.get("label", "").strip().rstrip(':')
                body = caption.get("body", "").strip()
                
                if label or body:
                    full_caption = f"{label} {body}".strip() if body else label
                    page_to_caption[doc_offset] = {
                        "chapter": chapter,
                        "label": label,
                        "body": body,
                        "full": full_caption,
                        "page_name": page.get("name", ""),
                    }
        except Exception as e:
            print(f"  Warning: Could not read {mf_path.name}: {e}")
    
    print(f"Loaded {len(page_to_caption)} figure captions")
    return page_to_caption

def main():
    # Paths
    manifest_dir = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/extract")
    images_dir = Path("/Users/asafgafni/Downloads/MBO_AF4_2024_COMMON_CORE_IMAGES_ONLY_CROPPED")
    
    if not manifest_dir.exists():
        print(f"Error: Manifest directory not found: {manifest_dir}")
        sys.exit(1)
    
    if not images_dir.exists():
        print(f"Error: Images directory not found: {images_dir}")
        sys.exit(1)
    
    # Load caption data from manifests
    print("Loading figure manifests...")
    page_to_caption = load_all_manifests(manifest_dir)
    
    # Get all image files
    image_files = sorted(images_dir.glob("output-*.png"))
    print(f"\nFound {len(image_files)} image files")
    
    # Filter out small/blank images
    real_images = []
    blank_count = 0
    for img in image_files:
        size_kb = img.stat().st_size / 1024
        if size_kb >= MIN_FILE_SIZE_KB:
            real_images.append(img)
        else:
            blank_count += 1
    
    print(f"  Real images (>= {MIN_FILE_SIZE_KB}KB): {len(real_images)}")
    print(f"  Blank/small images: {blank_count}")
    
    # Rename images
    renamed = 0
    no_caption = 0
    errors = 0
    rename_log = []
    
    print("\nRenaming images...")
    for img in real_images:
        # Extract page number from filename (output-037.png -> 37)
        match = re.search(r'output-(\d+)\.png', img.name)
        if not match:
            continue
        
        page_idx = int(match.group(1))
        
        if page_idx in page_to_caption:
            cap_info = page_to_caption[page_idx]
            safe_name = sanitize_filename(cap_info["full"])
            
            if not safe_name:
                safe_name = f"ch{cap_info['chapter']}_p{cap_info['page_name']}"
            
            new_name = f"{safe_name}.png"
            new_path = images_dir / new_name
            
            # Handle duplicates
            counter = 1
            while new_path.exists() and new_path != img:
                base = sanitize_filename(cap_info["full"], max_length=70)
                new_name = f"{base}_{counter:02d}.png"
                new_path = images_dir / new_name
                counter += 1
            
            try:
                img.rename(new_path)
                rename_log.append(f"{img.name} -> {new_name}")
                renamed += 1
            except Exception as e:
                print(f"  Error renaming {img.name}: {e}")
                errors += 1
        else:
            no_caption += 1
    
    # Print summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    print(f"  Renamed:         {renamed}")
    print(f"  No caption:      {no_caption}")
    print(f"  Errors:          {errors}")
    print(f"  Blank/skipped:   {blank_count}")
    print(f"  Total files:     {len(image_files)}")
    
    # Save rename log
    log_path = images_dir / "_rename_log.txt"
    with open(log_path, 'w') as f:
        f.write(f"Renamed {renamed} images\n\n")
        for line in sorted(rename_log):
            f.write(line + "\n")
    print(f"\nRename log saved to: {log_path}")

if __name__ == "__main__":
    main()

