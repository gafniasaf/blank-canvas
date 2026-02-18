#!/usr/bin/env python3
"""
Rename remaining output-XXX.png images based on their page position.
Handles front matter, chapter openers, and other special pages.
"""

import re
from pathlib import Path

# Known page mappings (based on book structure)
SPECIAL_PAGES = {
    0: "frontmatter_blank",
    1: "title_page",
    2: "frontmatter_p2",
    3: "colophon",
    4: "frontmatter_p4",
    5: "toc_p1",
    6: "toc_p2",
    7: "promo_mboleren",
    8: "frontmatter_p8",
    9: "frontmatter_p9",
    10: "frontmatter_p10",
    11: "frontmatter_p11",
    12: "frontmatter_p12",
    13: "intro_opener",
    14: "intro_p1",
    15: "intro_p2",
    16: "intro_p3",
    17: "intro_p4",
    18: "intro_p5",
    19: "intro_p6",
    20: "ch1_opener",
}

# Chapter ranges (from manifests)
CHAPTER_RANGES = [
    (21, 50, 1),
    (52, 64, 2),
    (66, 108, 3),
    (110, 152, 4),
    (154, 194, 5),
    (197, 242, 6),
    (244, 272, 7),
    (274, 322, 8),
    (325, 352, 9),
    (354, 370, 10),
    (373, 406, 11),
    (408, 444, 12),
    (446, 456, 13),
    (458, 519, 14),
]

def get_chapter_for_page(page_num):
    """Determine which chapter a page belongs to."""
    for start, end, ch in CHAPTER_RANGES:
        if start <= page_num <= end:
            return ch
    return None

def get_page_name(page_num):
    """Generate a descriptive name for a page."""
    if page_num in SPECIAL_PAGES:
        return SPECIAL_PAGES[page_num]
    
    # Check chapter openers (page before chapter start)
    for start, end, ch in CHAPTER_RANGES:
        if page_num == start - 1:
            return f"ch{ch}_opener"
    
    # Check if in a chapter
    ch = get_chapter_for_page(page_num)
    if ch:
        return f"ch{ch}_uncaptioned_p{page_num}"
    
    # Back matter (after ch14)
    if page_num > 519:
        return f"backmatter_p{page_num}"
    
    return f"page_{page_num:03d}"

def main():
    images_dir = Path("/Users/asafgafni/Downloads/MBO_AF4_2024_COMMON_CORE_IMAGES_ONLY_CROPPED")
    
    # Find remaining output-XXX.png files
    output_files = sorted(images_dir.glob("output-*.png"))
    print(f"Found {len(output_files)} remaining output-*.png files")
    
    # Separate by size (skip tiny blank files)
    MIN_SIZE_KB = 5
    renamed = 0
    
    for img in output_files:
        size_kb = img.stat().st_size / 1024
        match = re.search(r'output-(\d+)\.png', img.name)
        if not match:
            continue
        
        page_num = int(match.group(1))
        
        # Skip tiny files (likely blank)
        if size_kb < MIN_SIZE_KB:
            continue
        
        # Generate new name
        name = get_page_name(page_num)
        new_name = f"{name}.png"
        new_path = images_dir / new_name
        
        # Handle duplicates
        counter = 1
        while new_path.exists():
            new_name = f"{name}_{counter:02d}.png"
            new_path = images_dir / new_name
            counter += 1
        
        try:
            print(f"  output-{page_num:03d}.png ({size_kb:.0f}KB) -> {new_name}")
            img.rename(new_path)
            renamed += 1
        except Exception as e:
            print(f"  Error: {e}")
    
    print(f"\nRenamed {renamed} files")

if __name__ == "__main__":
    main()

