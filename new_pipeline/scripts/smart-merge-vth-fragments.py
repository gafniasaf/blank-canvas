#!/usr/bin/env python3
"""
Smart merge of fragmented VTH N4 content.
Combines bullet fragments into coherent lists while preserving actual content.
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.SMART_MERGED.json"

def is_bullet_item(text: str) -> bool:
    """Check if text looks like a bullet list item."""
    text = text.strip()
    if not text:
        return False
    # Ends with semicolon (typical bullet ending)
    if text.endswith(';'):
        return True
    # Starts with lowercase (continuation)
    if text and text[0].islower():
        return True
    # Very short and doesn't end with period
    if len(text) < 80 and not text.endswith('.'):
        return True
    return False

def is_list_intro(text: str) -> bool:
    """Check if text introduces a list (ends with colon)."""
    text = text.strip()
    return text.endswith(':')

def merge_content_blocks(content: list) -> list:
    """Merge fragmented bullet items into coherent lists."""
    if not content:
        return content
    
    merged = []
    i = 0
    
    while i < len(content):
        block = content[i]
        
        # Skip image-only blocks
        if block.get('images') and not (block.get('text') or block.get('basis')):
            merged.append(block)
            i += 1
            continue
        
        text = (block.get('text') or block.get('basis') or '').strip()
        
        # Check if this is a list intro followed by bullet items
        if is_list_intro(text):
            # Collect following bullet items
            bullet_texts = [text]
            j = i + 1
            
            while j < len(content):
                next_block = content[j]
                # Stop at images
                if next_block.get('images') and not (next_block.get('text') or next_block.get('basis')):
                    break
                
                next_text = (next_block.get('text') or next_block.get('basis') or '').strip()
                
                if is_bullet_item(next_text) or (next_text and next_text[0].islower()):
                    bullet_texts.append('• ' + next_text)
                    j += 1
                else:
                    break
            
            if len(bullet_texts) > 1:
                # Merge into single block
                merged_text = bullet_texts[0] + '\n' + '\n'.join(bullet_texts[1:])
                new_block = block.copy()
                new_block['text'] = merged_text
                if 'basis' in new_block:
                    new_block['basis'] = merged_text
                merged.append(new_block)
                i = j
                continue
        
        # Check for consecutive bullet items without intro
        if is_bullet_item(text):
            bullet_texts = ['• ' + text]
            j = i + 1
            
            while j < len(content):
                next_block = content[j]
                if next_block.get('images') and not (next_block.get('text') or next_block.get('basis')):
                    break
                
                next_text = (next_block.get('text') or next_block.get('basis') or '').strip()
                
                if is_bullet_item(next_text):
                    bullet_texts.append('• ' + next_text)
                    j += 1
                else:
                    break
            
            if len(bullet_texts) > 1:
                merged_text = '\n'.join(bullet_texts)
                new_block = block.copy()
                new_block['text'] = merged_text
                if 'basis' in new_block:
                    new_block['basis'] = merged_text
                merged.append(new_block)
                i = j
                continue
        
        # Regular block - keep as is
        merged.append(block)
        i += 1
    
    return merged

def clean_text(text: str) -> str:
    """Clean up common PDF extraction issues."""
    # Fix soft hyphens
    text = text.replace('­', '')
    text = text.replace('\xad', '')
    # Fix broken words
    text = re.sub(r'(\w)-\s+(\w)', r'\1\2', text)
    # Fix extra spaces
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def main():
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_merged = 0
    
    for chapter in book['chapters']:
        ch_num = chapter.get('number')
        
        for section in chapter.get('sections', []):
            original_count = len(section.get('content', []))
            
            # Clean text in all blocks first
            for block in section.get('content', []):
                if block.get('text'):
                    block['text'] = clean_text(block['text'])
                if block.get('basis'):
                    block['basis'] = clean_text(block['basis'])
            
            # Merge fragments
            section['content'] = merge_content_blocks(section.get('content', []))
            
            new_count = len(section['content'])
            if new_count < original_count:
                total_merged += (original_count - new_count)
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Smart merge complete!")
    print(f"   Merged {total_merged} fragment blocks")
    print(f"   Output: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()





