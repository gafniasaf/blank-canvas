#!/usr/bin/env python3
"""
Assemble all VTH N4 rewrites (ch 1-30) into a single canonical JSON.
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
REWRITE_DIR = REPO_ROOT / "new_pipeline" / "output" / "vth_n4"
SKELETON_DIR = REWRITE_DIR  # Skeletons are in same dir
BASE_CANONICAL = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.REWRITTEN.json"

def apply_rewrites_to_section(section: dict, rewritten_units: dict) -> dict:
    """Apply rewritten units to a section's content."""
    content = section.get('content', [])
    for block in content:
        block_id = block.get('id')
        if block_id and block_id in rewritten_units:
            rewritten_text = rewritten_units[block_id]
            if isinstance(rewritten_text, str) and rewritten_text.strip():
                # Apply rewrite to text field
                block['text'] = rewritten_text
                if 'basis' in block:
                    block['basis'] = rewritten_text
    return section

def main():
    # Load base canonical
    print(f"Loading base canonical: {BASE_CANONICAL}")
    with open(BASE_CANONICAL, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_applied = 0
    
    # Process each chapter
    for ch_num in range(1, 31):
        # Try to find rewrite file (pass2 preferred)
        rewrite_file = REWRITE_DIR / f"rewrites_ch{ch_num}_pass2.json"
        if not rewrite_file.exists():
            rewrite_file = REWRITE_DIR / f"rewrites_ch{ch_num}.json"
        
        if not rewrite_file.exists():
            print(f"  ⚠️ No rewrite found for chapter {ch_num}")
            continue
        
        print(f"  📖 Loading rewrites for chapter {ch_num}...")
        with open(rewrite_file, 'r', encoding='utf-8') as f:
            rewrite_data = json.load(f)
        
        # Extract rewritten units
        rewritten_units = rewrite_data.get('rewritten_units', {})
        if not rewritten_units:
            print(f"    ⚠️ No rewritten_units in {rewrite_file.name}")
            continue
        
        units_count = len(rewritten_units)
        
        # Find the chapter in the book
        chapter = None
        for ch in book['chapters']:
            if ch.get('number') in [str(ch_num), ch_num]:
                chapter = ch
                break
        
        if not chapter:
            print(f"    ⚠️ Chapter {ch_num} not found in canonical")
            continue
        
        # Apply rewrites to each section
        applied = 0
        for section in chapter.get('sections', []):
            content = section.get('content', [])
            for block in content:
                block_id = block.get('id')
                if block_id and block_id in rewritten_units:
                    rewritten_text = rewritten_units[block_id]
                    if isinstance(rewritten_text, str) and rewritten_text.strip():
                        block['text'] = rewritten_text
                        if 'basis' in block:
                            block['basis'] = rewritten_text
                        applied += 1
        
        print(f"    ✅ Applied {applied}/{units_count} rewrites to chapter {ch_num}")
        total_applied += applied
    
    # Save assembled canonical
    print(f"\n💾 Saving assembled canonical to: {OUTPUT_JSON}")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Assembly complete!")
    print(f"   Total rewrites applied: {total_applied}")
    print(f"   Output: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()





