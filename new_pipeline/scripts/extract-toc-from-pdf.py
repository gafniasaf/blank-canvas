#!/usr/bin/env python3
"""
Extract TOC data from existing Prince-generated PDFs
The PDFs already have a basic text TOC on the first pages
"""

import subprocess
import re
import json
import os

# Book configurations
BOOKS = {
    'communicatie': {
        'pdf': 'output/communicatie/communicatie_FINAL.pdf',
        'title': 'Communicatie',
        'toc_pages': (1, 2),
    },
    'wetgeving': {
        'pdf': 'output/wetgeving/wetgeving_FINAL.pdf', 
        'title': 'Wetgeving',
        'toc_pages': (1, 2),
    },
    'persoonlijke_verzorging': {
        'pdf': 'output/PV_PROSE_WITH_IMAGES_professional.pdf',
        'title': 'Persoonlijke Verzorging',
        'toc_pages': (1, 2),
    },
    'klinisch_redeneren': {
        'pdf': 'output/klinisch_redeneren_full_rewritten_professional.with_openers.pdf',
        'title': 'Praktijkgestuurd Klinisch Redeneren',
        'toc_pages': (1, 2),
    },
    'methodisch_werken': {
        'pdf': 'output/methodisch_werken_full_rewritten_professional.v2_figfix.pdf',
        'title': 'Methodisch Werken',
        'toc_pages': (1, 2),
    },
    'pathologie': {
        'pdf': 'output/pathologie_n4_with_figures_professional.pdf',
        'title': 'Pathologie',
        'toc_pages': (1, 3),  # Might have more TOC pages
    },
}

def extract_toc_text(pdf_path: str, first_page: int, last_page: int) -> str:
    """Extract text from TOC pages using pdftotext with layout preservation"""
    try:
        result = subprocess.run(
            ['pdftotext', '-f', str(first_page), '-l', str(last_page), '-layout', pdf_path, '-'],
            capture_output=True, text=True, check=True
        )
        return result.stdout
    except Exception as e:
        print(f"Error extracting text from {pdf_path}: {e}")
        return ""

def parse_toc_line(line: str):
    """Parse a TOC line like '1. Title here ..... 45'"""
    line = line.strip()
    if not line:
        return None
    
    # Pattern for layout text: number followed by title, then dots, then page number at end
    # Examples from layout:
    #   1. Informatie uitwisselen
    #   ........................................... 2
    #   1.2 Subtitle .................. 12
    
    # First check if this line starts with a number (chapter/section entry)
    match = re.match(r'^(\d+(?:\.\d+)*)\s*\.?\s+(.+)$', line)
    if match:
        num, rest = match.groups()
        # Check if the rest contains dots and a page number
        page_match = re.search(r'\.{2,}\s*(\d+)\s*$', rest)
        if page_match:
            page = page_match.group(1)
            label = re.sub(r'\s*\.{2,}\s*\d+\s*$', '', rest).strip()
        else:
            page = ''
            label = re.sub(r'\s*\.+\s*$', '', rest).strip()
        
        if label:
            level = 1 if '.' not in num else 2
            return {'level': level, 'num': num, 'label': label, 'page': page}
    
    # Check if this is a continuation line with just dots and page number
    page_only = re.match(r'^\.{2,}\s*(\d+)\s*$', line)
    if page_only:
        return {'_page_only': page_only.group(1)}
    
    return None

def extract_toc(book_id: str, config: dict) -> dict:
    """Extract TOC from a book's PDF"""
    pdf_path = config['pdf']
    if not pdf_path.startswith('/'):
        pdf_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), pdf_path)
    
    if not os.path.exists(pdf_path):
        print(f"PDF not found: {pdf_path}")
        return {'bookId': book_id, 'title': config['title'], 'items': []}
    
    text = extract_toc_text(pdf_path, config['toc_pages'][0], config['toc_pages'][1])
    
    items = []
    prev_item = None
    
    for line in text.split('\n'):
        # Skip header lines
        if 'Inhoudsopgave' in line or 'MBO ' in line or 'Niveau' in line:
            continue
        if not line.strip():
            continue
            
        item = parse_toc_line(line)
        if item:
            # Check if this is a page-only continuation
            if '_page_only' in item:
                if prev_item and not prev_item['page']:
                    prev_item['page'] = item['_page_only']
            else:
                items.append(item)
                prev_item = item
        elif prev_item and not prev_item['page']:
            # Check if this line is just a page number
            page_match = re.match(r'^\s*(\d+)\s*$', line.strip())
            if page_match:
                prev_item['page'] = page_match.group(1)
    
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
    
    output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output')
    
    for bid in books_to_process:
        print(f"\n=== {bid} ===")
        toc = extract_toc(bid, BOOKS[bid])
        
        print(f"Found {len(toc['items'])} TOC items")
        for item in toc['items'][:10]:
            indent = '  ' if item['level'] == 2 else ''
            print(f"{indent}{item['num']} {item['label']} ... {item['page']}")
        if len(toc['items']) > 10:
            print(f"  ... and {len(toc['items']) - 10} more")
        
        # Save
        out_path = os.path.join(output_dir, f"{bid}_toc.json")
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(toc, f, indent=2, ensure_ascii=False)
        print(f"Saved to {out_path}")

if __name__ == '__main__':
    main()

