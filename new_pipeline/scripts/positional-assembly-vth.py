#!/usr/bin/env python3
"""
Positional assembly for VTH N4: Apply rewrites using section/position mapping
instead of UUID matching.
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "new_pipeline" / "output" / "vth_n4"
CANONICAL = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.POSITIONAL_REWRITE.json"

def main():
    # Load canonical
    print(f"Loading canonical: {CANONICAL}")
    with open(CANONICAL, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_replaced = 0
    
    for ch_num in range(7, 31):  # Chapters 7-30
        # Load skeleton and rewrites
        skeleton_path = OUTPUT_DIR / f"skeleton_ch{ch_num:02d}.json"
        rewrite_path = OUTPUT_DIR / f"rewrites_ch{ch_num}_pass2.json"
        
        if not skeleton_path.exists() or not rewrite_path.exists():
            print(f"  ⚠️ Skipping chapter {ch_num} (missing files)")
            continue
        
        with open(skeleton_path, 'r', encoding='utf-8') as f:
            skeleton = json.load(f)
        with open(rewrite_path, 'r', encoding='utf-8') as f:
            rewrites = json.load(f)
        
        rewritten_units = rewrites.get('rewritten_units', {})
        
        # Find corresponding chapter in canonical
        chapter = None
        for ch in book['chapters']:
            if ch.get('number') in [str(ch_num), ch_num]:
                chapter = ch
                break
        
        if not chapter:
            print(f"  ⚠️ Chapter {ch_num} not found in canonical")
            continue
        
        # Build a mapping: (section_index, subparagraph_index) -> rewritten_text
        position_to_rewrite = {}
        
        for sec_idx, skel_sec in enumerate(skeleton.get('sections', [])):
            for sub in skel_sec.get('subsections', []):
                for unit in sub.get('units', []):
                    unit_id = unit.get('id')
                    if unit_id not in rewritten_units:
                        continue
                    
                    n4_mapping = unit.get('n4_mapping', [])
                    if n4_mapping:
                        # Use the first mapping entry
                        ref = n4_mapping[0]
                        subpara_idx = ref.get('subparagraph_index', 0)
                        position_to_rewrite[(sec_idx, subpara_idx)] = rewritten_units[unit_id]
        
        # Apply rewrites to canonical chapter
        canonical_sections = chapter.get('sections', [])
        
        for sec_idx, can_sec in enumerate(canonical_sections):
            content = can_sec.get('content', [])
            
            # Track position for non-image blocks
            block_idx = 0
            for block in content:
                # Skip image-only blocks
                if block.get('images') and not (block.get('text') or block.get('basis')):
                    continue
                
                key = (sec_idx, block_idx)
                if key in position_to_rewrite:
                    new_text = position_to_rewrite[key]
                    # Clean up markers
                    new_text = new_text.replace('<<BOLD_START>>', '**').replace('<<BOLD_END>>', '**')
                    new_text = new_text.replace('<<MICRO_TITLE>>', '').replace('<<MICRO_TITLE_END>>', '\n')
                    
                    block['text'] = new_text
                    if 'basis' in block:
                        block['basis'] = new_text
                    total_replaced += 1
                
                block_idx += 1
        
        print(f"  ✅ Chapter {ch_num}: applied {sum(1 for k in position_to_rewrite if k[0] < len(canonical_sections))} rewrites")
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Positional assembly complete!")
    print(f"   Total blocks replaced: {total_replaced}")
    print(f"   Output: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()





