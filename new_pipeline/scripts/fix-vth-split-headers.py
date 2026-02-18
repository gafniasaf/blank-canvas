#!/usr/bin/env python3
"""
Fix split section headers in VTH N4.
Headers like "13.7.1 Hoe plaats je een eenmalige" should merge with
following text "blaaskatheter bij een man?"
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.SMART_MERGED.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.HEADERS_FIXED.json"

def is_incomplete_header(text: str) -> bool:
    """Check if text looks like an incomplete section header."""
    text = text.strip()
    if not text:
        return False
    
    # Starts with section number pattern (e.g., "13.7.1", "2.3", etc.)
    if re.match(r'^\d+(\.\d+)*\s+', text):
        # Doesn't end with proper punctuation (? . !)
        if not re.search(r'[.?!:]\s*$', text):
            return True
    
    # Title patterns that are incomplete
    incomplete_patterns = [
        r'Hoe\s+\w+\s+je\s*$',  # "Hoe plaats je"
        r'Wat\s+is\s+\w+\s*$',   # "Wat is een"
        r'een\s+\w+\s*$',        # ends with "een [word]"
        r'de\s+\w+\s*$',         # ends with "de [word]"
        r'het\s+\w+\s*$',        # ends with "het [word]"
    ]
    
    for pattern in incomplete_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    
    return False

def should_merge_with_previous(prev_text: str, curr_text: str) -> bool:
    """Check if current text should be merged with previous incomplete header."""
    prev = prev_text.strip()
    curr = curr_text.strip()
    
    if not prev or not curr:
        return False
    
    # Previous is incomplete header
    if not is_incomplete_header(prev):
        return False
    
    # Current starts with lowercase (continuation)
    if curr[0].islower():
        return True
    
    # Current completes a question
    if '?' in curr[:100] and not '?' in prev:
        return True
    
    return False

def fix_split_headers(content: list) -> list:
    """Fix split section headers by merging them."""
    if not content:
        return content
    
    fixed = []
    i = 0
    
    while i < len(content):
        block = content[i]
        
        # Skip image-only blocks
        if block.get('images') and not (block.get('text') or block.get('basis')):
            fixed.append(block)
            i += 1
            continue
        
        text = (block.get('text') or block.get('basis') or '').strip()
        
        # Check if this is an incomplete header
        if is_incomplete_header(text) and i + 1 < len(content):
            next_block = content[i + 1]
            
            # Skip if next is image-only
            if next_block.get('images') and not (next_block.get('text') or next_block.get('basis')):
                fixed.append(block)
                i += 1
                continue
            
            next_text = (next_block.get('text') or next_block.get('basis') or '').strip()
            
            if should_merge_with_previous(text, next_text):
                # Merge the texts
                merged_text = text + ' ' + next_text
                new_block = block.copy()
                new_block['text'] = merged_text
                if 'basis' in new_block:
                    new_block['basis'] = merged_text
                fixed.append(new_block)
                i += 2  # Skip both blocks
                continue
        
        fixed.append(block)
        i += 1
    
    return fixed

def fix_broken_words(text: str) -> str:
    """Fix common broken words from PDF extraction."""
    # Fix "zorg vrager" -> "zorgvrager"
    text = re.sub(r'\bzorg\s+vrager\b', 'zorgvrager', text, flags=re.IGNORECASE)
    # Fix "zorg professional" -> "zorgprofessional"
    text = re.sub(r'\bzorg\s+professional\b', 'zorgprofessional', text, flags=re.IGNORECASE)
    # Fix "in brengen" -> "inbrengen"
    text = re.sub(r'\bin\s+brengen\b', 'inbrengen', text, flags=re.IGNORECASE)
    # Fix "uit voeren" -> "uitvoeren"
    text = re.sub(r'\buit\s+voeren\b', 'uitvoeren', text, flags=re.IGNORECASE)
    # Fix "aan brengen" -> "aanbrengen"
    text = re.sub(r'\baan\s+brengen\b', 'aanbrengen', text, flags=re.IGNORECASE)
    # Fix "ver wijderen" -> "verwijderen"
    text = re.sub(r'\bver\s+wijderen\b', 'verwijderen', text, flags=re.IGNORECASE)
    # Fix "ont steken" -> "ontsteken"
    text = re.sub(r'\bont\s+stek\w*\b', lambda m: m.group(0).replace(' ', ''), text, flags=re.IGNORECASE)
    # Fix hyphenated line breaks: "bloed-\nplaatjes" -> "bloedplaatjes"
    text = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', text)
    # Fix "contro leren" -> "controleren"
    text = re.sub(r'\bcontro\s+leren\b', 'controleren', text, flags=re.IGNORECASE)
    # Fix generic pattern: word split by single space inside
    # This is tricky, so only do common medical terms
    fixes = {
        'bloed plaatjes': 'bloedplaatjes',
        'hart klachten': 'hartklachten', 
        'darm spoeling': 'darmspoeling',
        'blaas katheter': 'blaaskatheter',
        'buik vlies': 'buikvlies',
        'stappen plan': 'stappenplan',
        'neus maagsonde': 'neusmaagsonde',
    }
    for wrong, correct in fixes.items():
        text = re.sub(re.escape(wrong), correct, text, flags=re.IGNORECASE)
    
    return text

def main():
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_headers_fixed = 0
    
    for chapter in book['chapters']:
        for section in chapter.get('sections', []):
            original_count = len(section.get('content', []))
            
            # Fix broken words in all blocks
            for block in section.get('content', []):
                if block.get('text'):
                    block['text'] = fix_broken_words(block['text'])
                if block.get('basis'):
                    block['basis'] = fix_broken_words(block['basis'])
            
            # Fix split headers
            section['content'] = fix_split_headers(section.get('content', []))
            
            new_count = len(section['content'])
            if new_count < original_count:
                total_headers_fixed += (original_count - new_count)
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Headers fixed!")
    print(f"   Merged {total_headers_fixed} split headers")
    print(f"   Also fixed common broken words")
    print(f"   Output: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()





