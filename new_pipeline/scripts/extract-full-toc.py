#!/usr/bin/env python3
"""
Extract full TOC data (chapters + sections + subparagraphs) from canonical JSON files
"""

import json
import os
import re

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output')

# Book configurations with canonical JSON paths
BOOKS = {
    'af4': {
        'json': 'af4/af4_opus_45_full_rewritten.with_figures.with_openers.json',
        'title': 'Anatomie & Fysiologie',
    },
    'communicatie': {
        'json': 'communicatie/communicatie_with_all_figures.json',
        'title': 'Communicatie',
    },
    'wetgeving': {
        'json': 'wetgeving/wetgeving_with_all_figures.json',
        'title': 'Wetgeving',
    },
    'persoonlijke_verzorging': {
        'json': 'persoonlijke_verzorging/persoonlijke_verzorging_with_all_figures.json',
        'title': 'Persoonlijke Verzorging',
    },
    'klinisch_redeneren': {
        'json': 'klinisch_redeneren/klinisch_redeneren_with_all_figures.json',
        'title': 'Klinisch Redeneren',
    },
    'methodisch_werken': {
        'json': 'methodisch_werken/methodisch_werken_with_all_figures.json',
        'title': 'Methodisch Werken',
    },
    'pathologie': {
        'json': 'pathologie_n4_with_figures.json',
        'title': 'Pathologie',
    },
}

def extract_toc_from_json(book_id: str, config: dict) -> dict:
    """Extract full TOC from canonical JSON"""
    json_path = os.path.join(OUTPUT_DIR, config['json'])
    
    if not os.path.exists(json_path):
        print(f"JSON not found: {json_path}")
        return {'bookId': book_id, 'title': config['title'], 'items': []}
    
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    items = []
    
    for chapter in data.get('chapters', []):
        ch_num = str(chapter.get('number', ''))
        ch_title = chapter.get('title', '')
        
        # Clean chapter title (remove leading number/dot patterns)
        ch_title = re.sub(r'^\.?\d+\.?\s*', '', ch_title).strip()
        
        if ch_title:
            items.append({
                'level': 1,
                'num': ch_num,
                'label': ch_title,
                'page': ''  # Will estimate based on position
            })
        
        for section in chapter.get('sections', []):
            sec_num = section.get('number', '')
            # Prefer the section title from the canonical structure.
            # (Pathologie chapters often don't have explicit "paragraafkop" paragraphs
            # inside section content, so relying only on styleHint extraction would
            # drop most sections from the TOC.)
            sec_title = (section.get('title') or '').strip()
            
            # Look for section title in content
            for block in section.get('content', []):
                if block.get('type') == 'paragraph':
                    style = block.get('styleHint', '')
                    if 'aragraafkop' in style or 'ectionTitle' in style:
                        # Extract title from basis field
                        basis = block.get('basis', '')
                        # Remove leading number pattern
                        sec_title = re.sub(r'^[\d.]+\s*', '', basis).strip()
                        break
                
                # NOTE: We intentionally do NOT include subparagraph-level items (level 3)
                # in the printed TOC. All current books use chapters + sections only.
            
            if sec_title:
                # Remove any leading numbering just in case it leaked into the title.
                sec_title = re.sub(r'^[\d.]+\s*', '', sec_title).strip()
                items.append({
                    'level': 2,
                    'num': sec_num,
                    'label': sec_title,
                    'page': ''
                })
    
    # Sort items by number to ensure correct order
    def sort_key(item):
        parts = item['num'].split('.')
        return tuple(int(p) if p.isdigit() else 0 for p in parts)
    
    items.sort(key=sort_key)
    
    return {
        'bookId': book_id,
        'title': config['title'],
        'items': items
    }

def main():
    import sys
    
    book_id = sys.argv[1] if len(sys.argv) > 1 else 'all'
    
    if book_id == 'all':
        books_to_process = BOOKS.keys()
    elif book_id in BOOKS:
        books_to_process = [book_id]
    else:
        print(f"Unknown book: {book_id}")
        print(f"Available: {', '.join(BOOKS.keys())}")
        sys.exit(1)
    
    for bid in books_to_process:
        print(f"\n=== {bid} ===")
        toc = extract_toc_from_json(bid, BOOKS[bid])
        
        print(f"Found {len(toc['items'])} TOC items")
        
        # Show preview
        for item in toc['items'][:15]:
            indent = '  ' * (item['level'] - 1)
            print(f"{indent}{item['num']} {item['label'][:50]}")
        if len(toc['items']) > 15:
            print(f"  ... and {len(toc['items']) - 15} more")
        
        # Save
        out_path = os.path.join(OUTPUT_DIR, f"{bid}_toc_full.json")
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(toc, f, indent=2, ensure_ascii=False)
        print(f"Saved to {out_path}")

if __name__ == '__main__':
    main()

