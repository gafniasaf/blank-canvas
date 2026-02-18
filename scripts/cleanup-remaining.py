#!/usr/bin/env python3
import fitz
import re

doc = fitz.open('/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_CH1_IMAGES_ONLY_V2.pdf')

def should_delete(text):
    text = text.strip()
    if not text:
        return False
    
    # Page headers like "2  De cel", "10  De cel"
    if re.match(r'^\d+\s+De cel$', text):
        return True
    
    # Broken sentences ending with ":"
    if text.endswith(':'):
        return True
    
    # Broken sentences starting lowercase
    if text and text[0].islower():
        return True
    
    # Numbered list items (broken)
    if re.match(r'^\d+\s+Tijdens', text):
        return True
    
    # Bullet points
    if text.startswith('•'):
        return True
    
    # Specific broken fragments
    broken = [
        'ADP + P + energie',
        'ATP',
    ]
    for b in broken:
        if text == b or text.startswith(b + ' '):
            return True
    
    return False

total_deleted = 0

for pg in range(len(doc)):
    page = doc[pg]
    text_dict = page.get_text('dict')
    deleted_this_page = 0
    
    for block in text_dict['blocks']:
        if block.get('type') == 0:
            text = ''
            for line in block.get('lines', []):
                for span in line.get('spans', []):
                    text += span.get('text', '') + ' '
            text = text.strip()
            
            if should_delete(text):
                page.add_redact_annot(fitz.Rect(block['bbox']), fill=(1,1,1))
                deleted_this_page += 1
                total_deleted += 1
    
    if deleted_this_page > 0:
        page.apply_redactions()
        print(f"Page {pg+1}: deleted {deleted_this_page} items")

doc.save('/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_CH1_IMAGES_ONLY_V2.pdf', incremental=True, encryption=0)
print(f"\nTotal deleted: {total_deleted}")
doc.close()


