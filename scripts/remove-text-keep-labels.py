#!/usr/bin/env python3
"""
Remove all text except image labels and captions.
"""
import fitz
import re

INPUT = '/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_CH1_IMAGES_ONLY_V2.pdf'

def is_image_label_or_caption(text, lines):
    text = text.strip()
    
    # Caption pattern - KEEP
    if text.startswith('Afbeelding'):
        return True
    
    # Section header pattern (1.1.8 etc) - DELETE
    if re.match(r'^\d+\.\d+', text):
        return False
    
    # Page header pattern - DELETE
    if 'Anatomie en fysiologie' in text:
        return False
    if re.match(r'^\d+\s+De cel', text):
        return False
    
    # Chapter title - DELETE
    if text in ['1', 'De cel']:
        return False
    
    # Bullet markers = body text - DELETE
    if 'ɤ' in text or 'ɖ' in text:
        return False
    
    # Long text = body text - DELETE
    if lines > 2:
        return False
    
    # Sentences ending with period = body text - DELETE
    if text.endswith('.') and len(text) > 30:
        return False
    
    # Short text without punctuation = likely label - KEEP
    if lines <= 2 and len(text) < 80:
        return True
    
    return False

def main():
    doc = fitz.open(INPUT)
    
    for pg in range(len(doc)):
        page = doc[pg]
        text_dict = page.get_text('dict')
        
        for block in text_dict['blocks']:
            if block.get('type') == 0:
                text = ''
                for line in block.get('lines', []):
                    for span in line.get('spans', []):
                        text += span.get('text', '') + ' '
                text = text.strip()
                lines = len(block.get('lines', []))
                
                if not is_image_label_or_caption(text, lines):
                    page.add_redact_annot(fitz.Rect(block['bbox']), fill=(1,1,1))
        
        page.apply_redactions()
        
        if (pg + 1) % 8 == 0 or pg == len(doc) - 1:
            print(f"Processed page {pg+1}/{len(doc)}")
    
    doc.save(INPUT, incremental=True, encryption=0)
    print("Done!")
    doc.close()

if __name__ == '__main__':
    main()


