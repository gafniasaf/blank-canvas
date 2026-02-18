#!/usr/bin/env python3
"""
Extract images-only PDF (Chapter 1 POC):
- Extract only chapter 1 pages
- Remove ALL body text (multi-line paragraphs)
- Keep ONLY image labels (short text near images with label patterns)
"""

import fitz  # PyMuPDF
import sys
import os
import re

# Label patterns (must match to be kept as label)
LABEL_PATTERNS = [
    r'^Afbeelding\s+\d',       # "Afbeelding 1.1"
    r'^Figuur\s+\d',           # "Figuur 1.1"
    r'^Fig\.\s*\d',            # "Fig. 1"
    r'^Tabel\s+\d',            # "Tabel 1.1"
    r'^Schema\s+\d',           # "Schema 1"
    r'^Bron:',                 # "Bron: ..."
    r'^©',                     # Copyright
]
LABEL_REGEX = re.compile('|'.join(LABEL_PATTERNS), re.IGNORECASE)

def boxes_touch(box1, box2, margin=5):
    """Check if two rectangles touch or nearly touch."""
    x0a, y0a, x1a, y1a = box1
    x0b, y0b, x1b, y1b = box2
    x0a -= margin
    y0a -= margin
    x1a += margin
    y1a += margin
    return not (x1a < x0b or x1b < x0a or y1a < y0b or y1b < y0a)

def get_block_text(block):
    """Extract text from block."""
    text = ""
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            text += span.get("text", "") + " "
    return text.strip()

def count_lines(block):
    """Count number of lines in block."""
    return len(block.get("lines", []))

def is_label(block, image_rects):
    """
    Determine if a text block is a label.
    Labels are: single/short text that matches label patterns OR touches images.
    """
    text = get_block_text(block)
    lines = count_lines(block)
    bbox = block["bbox"]
    
    # Check if matches label pattern (regardless of position)
    if LABEL_REGEX.match(text):
        return True
    
    # Very short text (1 line, few words) touching an image = label
    if lines == 1 and len(text.split()) <= 15:
        for img_rect in image_rects:
            if boxes_touch(bbox, img_rect, margin=10):
                return True
    
    return False

def process_chapter(input_path, output_path, start_page, end_page):
    """Extract chapter pages and remove body text."""
    
    print(f"Opening: {input_path}")
    src = fitz.open(input_path)
    
    # Create new document with only the chapter pages
    doc = fitz.open()
    doc.insert_pdf(src, from_page=start_page, to_page=end_page)
    src.close()
    
    total_pages = len(doc)
    print(f"Extracted pages {start_page+1}-{end_page+1} ({total_pages} pages)")
    
    stats = {"removed": 0, "kept_labels": 0}
    
    for page_num in range(total_pages):
        page = doc[page_num]
        
        # Get all image bounding boxes
        image_rects = []
        for info in page.get_image_info():
            bbox = info.get("bbox")
            if bbox:
                image_rects.append(tuple(bbox))
        
        # Also from dict blocks
        text_dict = page.get_text("dict")
        for block in text_dict["blocks"]:
            if block.get("type") == 1:  # Image
                image_rects.append(tuple(block["bbox"]))
        
        # Process text blocks
        blocks_to_redact = []
        
        for block in text_dict["blocks"]:
            if block.get("type") == 0:  # Text
                if is_label(block, image_rects):
                    stats["kept_labels"] += 1
                else:
                    blocks_to_redact.append(fitz.Rect(block["bbox"]))
                    stats["removed"] += 1
        
        # Apply redactions with white fill
        for rect in blocks_to_redact:
            page.add_redact_annot(rect, fill=(1, 1, 1))
        
        if blocks_to_redact:
            page.apply_redactions()
        
        print(f"  Page {page_num+1}/{total_pages}: removed {len(blocks_to_redact)}, kept {len([b for b in text_dict['blocks'] if b.get('type')==0]) - len(blocks_to_redact)} labels")
    
    # Save
    print(f"\nSaving to: {output_path}")
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    
    print(f"\nSummary:")
    print(f"  Text blocks removed: {stats['removed']}")
    print(f"  Labels kept: {stats['kept_labels']}")
    print(f"  Output: {output_path}")
    print("Done!")

if __name__ == "__main__":
    input_pdf = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf"
    output_pdf = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_CH1_IMAGES_ONLY.pdf"
    
    # Chapter 1: pages 20-51 (0-indexed: 19-50)
    START_PAGE = 19  # 0-indexed
    END_PAGE = 50    # 0-indexed (inclusive)
    
    process_chapter(input_pdf, output_pdf, START_PAGE, END_PAGE)
