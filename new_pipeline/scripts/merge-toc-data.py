#!/usr/bin/env python3
"""
Merge TOC data: structure from canonical JSON + page numbers from PDF extraction
"""

import json
import os
import re

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output')

def merge_toc_files(book_id: str):
    """Merge full TOC structure with PDF page numbers"""
    
    full_path = os.path.join(OUTPUT_DIR, f'{book_id}_toc_full.json')
    pdf_path = os.path.join(OUTPUT_DIR, f'{book_id}_toc.json')
    
    if not os.path.exists(full_path):
        print(f"Full TOC not found: {full_path}")
        return
    
    with open(full_path, 'r', encoding='utf-8') as f:
        full_data = json.load(f)
    
    # Load PDF TOC for page numbers
    pdf_pages = {}
    if os.path.exists(pdf_path):
        with open(pdf_path, 'r', encoding='utf-8') as f:
            pdf_data = json.load(f)
        # Build lookup by number
        for item in pdf_data.get('items', []):
            num = item.get('num', '')
            page = item.get('page', '')
            if num and page:
                pdf_pages[num] = page
    
    # Merge page numbers into full data
    for item in full_data.get('items', []):
        num = item.get('num', '')
        if num in pdf_pages:
            item['page'] = pdf_pages[num]
        # For sections, try to find chapter page if no specific page
        elif '.' in num and not item.get('page'):
            ch_num = num.split('.')[0]
            if ch_num in pdf_pages:
                # Don't use chapter page for sections
                pass
    
    # Save merged data
    merged_path = os.path.join(OUTPUT_DIR, f'{book_id}_toc_merged.json')
    with open(merged_path, 'w', encoding='utf-8') as f:
        json.dump(full_data, f, indent=2, ensure_ascii=False)
    
    print(f"{book_id}: Merged {len(full_data['items'])} items, {len(pdf_pages)} with pages")
    return merged_path

def main():
    import sys
    
    books = ['communicatie', 'wetgeving', 'persoonlijke_verzorging', 
             'klinisch_redeneren', 'methodisch_werken', 'pathologie']
    
    book_id = sys.argv[1] if len(sys.argv) > 1 else 'all'
    
    if book_id == 'all':
        for bid in books:
            merge_toc_files(bid)
    else:
        merge_toc_files(book_id)

if __name__ == '__main__':
    main()



