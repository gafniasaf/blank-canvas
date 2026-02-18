#!/usr/bin/env python3
"""
Extract section/paragraph page numbers by scanning PDF body text
Looks for section headers like "1.1 Title" and tracks their page numbers
"""

import subprocess
import re
import json
import os

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output')

BOOKS = {
    'af4': 'books_with_index/anatomie_fysiologie_n4_WITH_INDEX.pdf',
    'communicatie': 'communicatie/communicatie_FINAL.pdf',
    'wetgeving': 'wetgeving/wetgeving_FINAL.pdf',
    'persoonlijke_verzorging': 'persoonlijke_verzorging/persoonlijke_verzorging_FINAL.pdf',
    'klinisch_redeneren': 'klinisch_redeneren/klinisch_redeneren_FINAL.pdf',
    'methodisch_werken': 'methodisch_werken/methodisch_werken_FINAL.pdf',
    'pathologie': 'pathologie/pathologie_FINAL.pdf',
}

# Old auto-generated TOC pages at the start of the source PDFs (before the chapter 1 opener)
SKIP_OLD_TOC_PAGES = {
    # AF4: 5 TOC pages + old Colofon + old Voorwoord (cover was already stripped in WITH_INDEX)
    'af4': 7,
    'communicatie': 1,
    'wetgeving': 1,
    'klinisch_redeneren': 1,
    'methodisch_werken': 1,
    'persoonlijke_verzorging': 3,
    'pathologie': 6,
}


def extract_section_pages(pdf_path: str, skip_pages: int = 0) -> dict:
    """Scan PDF to find section headings and their page numbers"""
    
    if not os.path.exists(pdf_path):
        print(f"PDF not found: {pdf_path}")
        return {}
    
    # Extract text with page breaks preserved
    try:
        # IMPORTANT: Skip the old, auto-generated TOC pages at the start of the PDF,
        # otherwise we'll incorrectly detect headings inside the TOC itself (page 1, etc).
        args = ['pdftotext', '-layout']
        if skip_pages and skip_pages > 0:
            args += ['-f', str(skip_pages + 1)]
        args += [pdf_path, '-']
        result = subprocess.run(
            args,
            capture_output=True, text=True, check=True
        )
        text = result.stdout
    except Exception as e:
        print(f"Error extracting text: {e}")
        return {}
    
    # Split by form feed (page break) character
    pages = text.split('\f')
    
    section_pages = {}
    
    # Pattern for section headers: "1.1 Title" or "1.1.1 Title" at start of line
    section_pattern = re.compile(r'^\s*(\d+\.\d+(?:\.\d+)?)\s+([A-Z][a-zA-Z])', re.MULTILINE)
    
    # If we started from a later page, keep page numbers aligned to the ORIGINAL PDF numbering.
    base_page_num = (skip_pages + 1) if (skip_pages and skip_pages > 0) else 1
    for idx, page_text in enumerate(pages, start=0):
        page_num = base_page_num + idx
        # Find all section headers on this page
        for match in section_pattern.finditer(page_text):
            sec_num = match.group(1)
            # Only record first occurrence
            if sec_num not in section_pages:
                section_pages[sec_num] = str(page_num)
    
    return section_pages

def update_toc_with_pages(book_id: str, section_pages: dict):
    """Update TOC JSON with section page numbers"""
    
    # Load existing TOC
    toc_path = os.path.join(OUTPUT_DIR, f'{book_id}_toc_full.json')
    if not os.path.exists(toc_path):
        toc_path = os.path.join(OUTPUT_DIR, f'{book_id}_toc.json')
    
    if not os.path.exists(toc_path):
        print(f"TOC not found for {book_id}")
        return
    
    with open(toc_path, 'r', encoding='utf-8') as f:
        toc_data = json.load(f)
    
    # Update page numbers
    updated_count = 0
    for item in toc_data.get('items', []):
        num = item.get('num', '')
        if num in section_pages and not item.get('page'):
            item['page'] = section_pages[num]
            updated_count += 1
    
    # Save updated TOC
    out_path = os.path.join(OUTPUT_DIR, f'{book_id}_toc_with_pages.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(toc_data, f, indent=2, ensure_ascii=False)
    
    print(f"{book_id}: Found {len(section_pages)} sections, updated {updated_count} items")
    print(f"  Saved to: {out_path}")
    
    return out_path

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
        pdf_path = os.path.join(OUTPUT_DIR, BOOKS[bid])
        section_pages = extract_section_pages(pdf_path, SKIP_OLD_TOC_PAGES.get(bid, 0))
        
        # Show some examples
        items = list(section_pages.items())[:10]
        for num, page in items:
            print(f"  {num} -> page {page}")
        if len(section_pages) > 10:
            print(f"  ... and {len(section_pages) - 10} more")
        
        update_toc_with_pages(bid, section_pages)

if __name__ == '__main__':
    main()


