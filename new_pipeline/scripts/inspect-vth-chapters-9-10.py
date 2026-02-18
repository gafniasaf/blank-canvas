#!/usr/bin/env python3
"""
Inspect chapters 9 and 10 specifically in the VTH N4 PDF.
"""
import fitz
import json
from pathlib import Path

PDF_PATH = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/vth_n4/MBO_VTH_N4_FULL_CLEANED.pdf")
JSON_PATH = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/_canonical_jsons_all/VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json")

def main():
    # First, check the canonical JSON to see what's in chapters 9 and 10
    print("=" * 70)
    print("CANONICAL JSON - CHAPTERS 9 & 10")
    print("=" * 70)
    
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    for ch in book['chapters']:
        ch_num = ch.get('number')
        if ch_num in ['9', '10', 9, 10]:
            print(f"\n--- Chapter {ch_num}: {ch.get('title', 'NO TITLE')} ---")
            sections = ch.get('sections', [])
            print(f"Sections: {len(sections)}")
            
            for sec_idx, sec in enumerate(sections[:3]):  # First 3 sections
                print(f"\n  Section {sec_idx + 1}: {sec.get('number', 'NO NUMBER')}")
                content = sec.get('content', [])
                print(f"  Content blocks: {len(content)}")
                
                for block_idx, block in enumerate(content[:5]):  # First 5 blocks
                    block_type = block.get('type', 'unknown')
                    text = block.get('text', '') or block.get('basis', '')
                    if text:
                        preview = text[:200].replace('\n', ' ')
                        print(f"    [{block_idx}] {block_type}: {preview}...")
                    elif block.get('images'):
                        imgs = block.get('images', [])
                        for img in imgs:
                            print(f"    [{block_idx}] IMAGE: {img.get('figureNumber', 'NO NUM')} - {img.get('caption', 'NO CAPTION')[:60]}...")
    
    # Now check the PDF
    print("\n" + "=" * 70)
    print("PDF CONTENT - SEARCHING FOR CHAPTER 9 & 10 STARTS")
    print("=" * 70)
    
    doc = fitz.open(PDF_PATH)
    
    # Look for chapter starts
    chapter_starts = {}
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        
        # Look for chapter indicators
        if 'Sondevoeding' in text:  # Chapter 9 title
            chapter_starts[9] = page_num + 1
        if 'Neusmaagsonde' in text:  # Chapter 10 title
            chapter_starts[10] = page_num + 1
    
    print(f"Found chapter starts: {chapter_starts}")
    
    # Print pages around ch9 start based on expected page (~183 in source PDF)
    # Our PDF is generated, so it will have different pagination
    # Let's just look at a range of pages
    
    print("\n--- Searching for chapter 9 content around expected location ---")
    
    # Look for chapter 9 specific content
    for page_num in range(150, 220):  # Search around expected area
        if page_num >= len(doc):
            break
        page = doc[page_num]
        text = page.get_text("text")
        
        if 'Sondevoeding toedienen' in text or '9.1' in text[:200]:
            print(f"\n=== PAGE {page_num + 1} ===")
            print(text[:1500])
            print("..." if len(text) > 1500 else "")
            break
    
    print("\n--- Searching for chapter 10 content ---")
    
    for page_num in range(180, 250):
        if page_num >= len(doc):
            break
        page = doc[page_num]
        text = page.get_text("text")
        
        if 'Neusmaagsonde' in text or '10.1' in text[:200]:
            print(f"\n=== PAGE {page_num + 1} ===")
            print(text[:1500])
            print("..." if len(text) > 1500 else "")
            break
    
    # Check first pages to see structure
    print("\n" + "=" * 70)
    print("FIRST FEW CONTENT PAGES")
    print("=" * 70)
    
    for page_num in range(30, 40):  # After TOC/frontmatter
        page = doc[page_num]
        text = page.get_text("text")
        if text.strip():
            print(f"\n=== PAGE {page_num + 1} ===")
            print(text[:800])
            print("...")
            break
    
    doc.close()

if __name__ == "__main__":
    main()





