#!/usr/bin/env python3
"""
Extract figure captions from VTH N4 PDF and add them to the canonical JSON.
"""
import fitz
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = REPO_ROOT / "new_pipeline" / "output" / "highres_exports" / "MBO_VTH_N4_2024_HIGHRES.pdf"
CANONICAL_IN = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.json"
CANONICAL_OUT = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.json"

def extract_captions_from_pdf():
    """Extract figure captions from the PDF."""
    doc = fitz.open(str(PDF_PATH))
    captions = {}
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        text = page.get_text("text")
        
        # Find "Afbeelding X.Y caption..." patterns
        matches = re.finditer(
            r'Afbeelding\s+(\d+)\.(\d+)\s*[:\.]?\s*([^\n]+(?:\n(?![A-Z0-9]|\d+\.\d+)[^\n]+)?)',
            text, re.IGNORECASE
        )
        
        for match in matches:
            ch_num = match.group(1)
            fig_num = match.group(2)
            caption_text = match.group(3).strip()
            
            # Clean up caption
            caption_text = re.sub(r'\s+', ' ', caption_text)
            caption_text = re.sub(r'­', '', caption_text)  # Remove soft hyphens
            
            fig_key = f"{ch_num}.{fig_num}"
            
            # Skip if too short or is a reference
            if len(caption_text) > 10 and not caption_text.lower().startswith('zie '):
                if fig_key not in captions or len(caption_text) > len(captions[fig_key]):
                    captions[fig_key] = caption_text
    
    doc.close()
    return captions

def update_canonical_with_captions(captions):
    """Update the canonical JSON with extracted captions."""
    with open(CANONICAL_IN, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    updated_count = 0
    for chapter in book['chapters']:
        for section in chapter.get('sections', []):
            for block in section.get('content', []):
                if not isinstance(block, dict):
                    continue
                for img in block.get('images', []):
                    fig_number = img.get('figureNumber', '')
                    match = re.search(r'(\d+\.\d+)', fig_number)
                    if match:
                        fig_key = match.group(1)
                        if fig_key in captions:
                            old_caption = img.get('caption', '')
                            new_caption = captions[fig_key]
                            if not old_caption or len(new_caption) > len(old_caption):
                                img['caption'] = new_caption
                                updated_count += 1
    
    with open(CANONICAL_OUT, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    return book, updated_count

def main():
    print(f"Extracting captions from: {PDF_PATH}")
    captions = extract_captions_from_pdf()
    print(f"Extracted {len(captions)} unique captions from PDF")
    
    print(f"\nUpdating canonical JSON...")
    book, updated_count = update_canonical_with_captions(captions)
    print(f"Updated {updated_count} figure captions")
    
    print(f"\n✅ Output: {CANONICAL_OUT}")
    
    # Show sample
    print("\nSample captions:")
    count = 0
    for chapter in book['chapters']:
        for section in chapter.get('sections', []):
            for block in section.get('content', []):
                if isinstance(block, dict):
                    for img in block.get('images', []):
                        if img.get('caption'):
                            cap = img['caption']
                            cap_display = cap[:70] + '...' if len(cap) > 70 else cap
                            print(f"  {img['figureNumber']}: {cap_display}")
                            count += 1
                            if count >= 15:
                                return
    
if __name__ == "__main__":
    main()





