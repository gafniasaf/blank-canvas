#!/usr/bin/env python3
"""
Add unique IDs to all content blocks in the VTH N4 canonical JSON.
This is needed for the assembly script to map rewrites back.
"""
import json
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.WITH_IDS.json"

def main():
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_ids_added = 0
    
    for chapter in book['chapters']:
        for section in chapter.get('sections', []):
            # Add ID to section if missing
            if not section.get('id'):
                section['id'] = str(uuid.uuid4())
            
            for block in section.get('content', []):
                # Add ID to block if missing
                if not block.get('id'):
                    block['id'] = str(uuid.uuid4())
                    total_ids_added += 1
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Added {total_ids_added} IDs to blocks")
    print(f"   Output: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()





