#!/usr/bin/env python3
"""Scan PDF and report all remaining text, flagging suspicious items."""
import fitz

INPUT = '/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_CH1_IMAGES_ONLY_V2.pdf'

doc = fitz.open(INPUT)

print("=== SCANNING ALL REMAINING TEXT ===\n")

suspicious = []

for pg in range(len(doc)):
    page = doc[pg]
    text_dict = page.get_text('dict')
    
    page_texts = []
    for block in text_dict['blocks']:
        if block.get('type') == 0:
            text = ''
            for line in block.get('lines', []):
                for span in line.get('spans', []):
                    text += span.get('text', '') + ' '
            text = text.strip()
            if text:
                page_texts.append(text)
    
    if page_texts:
        print(f"--- PAGE {pg+1} ---")
        for t in page_texts:
            flag = ""
            # Looks like broken sentence - starts lowercase
            if t and t[0].islower():
                flag = " [!] STARTS LOWERCASE"
                suspicious.append((pg+1, t[:60]))
            # Ends with comma/semicolon - broken sentence
            elif t.endswith(',') or t.endswith(';'):
                flag = " [!] ENDS COMMA/SEMICOLON"
                suspicious.append((pg+1, t[:60]))
            # Long text might be body text
            elif len(t) > 70:
                flag = " [!] LONG"
                suspicious.append((pg+1, t[:60]))
            # Contains body text indicators
            elif any(w in t.lower() for w in ['namelijk', 'bijvoorbeeld', 'hierbij', 'daarom', 'omdat']):
                flag = " [!] BODY TEXT WORD"
                suspicious.append((pg+1, t[:60]))
            
            display = t[:80] + ('...' if len(t) > 80 else '')
            print(f"  \"{display}\"{flag}")
        print()

print("\n" + "="*50)
print("SUSPICIOUS ITEMS TO REVIEW:")
print("="*50)
if suspicious:
    for pg, txt in suspicious:
        print(f"  Page {pg}: \"{txt}\"")
else:
    print("  None found!")

doc.close()


