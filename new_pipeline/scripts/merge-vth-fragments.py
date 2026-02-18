#!/usr/bin/env python3
"""
Merge fragmented text in VTH N4 canonical JSON.

Problem: PDF extraction created separate paragraphs for each bullet point.
Solution: Merge consecutive short paragraphs that look like bullet items.
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.FIXED_PLACEMENT.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.MERGED.json"

def is_bullet_fragment(text: str) -> bool:
    """Check if text looks like a bullet list item fragment."""
    text = text.strip()
    if not text:
        return False
    
    # Starts with lowercase (continuation)
    if text[0].islower():
        return True
    
    # Ends with semicolon (bullet item)
    if text.endswith(';'):
        return True
    
    # Very short (under 80 chars) and doesn't end with proper sentence ending
    if len(text) < 80 and not text.endswith(('.', '!', '?', ':')):
        return True
    
    return False

def should_merge(prev_text: str, curr_text: str) -> bool:
    """Determine if current text should be merged with previous."""
    if not prev_text or not curr_text:
        return False
    
    prev = prev_text.strip()
    curr = curr_text.strip()
    
    # Both are short bullet-like items
    if is_bullet_fragment(prev) and is_bullet_fragment(curr):
        return True
    
    # Previous ends with semicolon, current starts lowercase
    if prev.endswith(';') and curr[0].islower():
        return True
    
    # Previous ends with colon (list intro), current is short
    if prev.endswith(':') and len(curr) < 100:
        return True
    
    return False

def merge_paragraphs(content: list) -> list:
    """Merge fragmented paragraphs in content list."""
    if not content:
        return content
    
    merged = []
    i = 0
    
    while i < len(content):
        block = content[i]
        
        # Skip non-paragraph blocks or blocks with images
        if block.get('type') != 'paragraph' or block.get('images'):
            merged.append(block)
            i += 1
            continue
        
        text = block.get('text') or block.get('basis') or ''
        
        # Look ahead to merge consecutive bullet fragments
        merge_texts = [text]
        j = i + 1
        
        while j < len(content):
            next_block = content[j]
            
            # Stop if not a paragraph or has images
            if next_block.get('type') != 'paragraph' or next_block.get('images'):
                break
            
            next_text = next_block.get('text') or next_block.get('basis') or ''
            
            # Check if we should merge
            if should_merge(merge_texts[-1], next_text):
                merge_texts.append(next_text)
                j += 1
            else:
                break
        
        # Create merged block
        if len(merge_texts) > 1:
            # Merge the texts with proper spacing
            merged_text = ''
            for idx, t in enumerate(merge_texts):
                t = t.strip()
                if idx == 0:
                    merged_text = t
                elif t[0].islower():
                    # Continuation - add space
                    merged_text += ' ' + t
                else:
                    # New item - add newline and bullet
                    merged_text += '\n• ' + t
            
            new_block = block.copy()
            if 'text' in new_block:
                new_block['text'] = merged_text
            if 'basis' in new_block:
                new_block['basis'] = merged_text
            merged.append(new_block)
        else:
            merged.append(block)
        
        i = j
    
    return merged

def main():
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_merged = 0
    
    for chapter in book['chapters']:
        for section in chapter.get('sections', []):
            original_len = len(section.get('content', []))
            section['content'] = merge_paragraphs(section.get('content', []))
            merged_count = original_len - len(section['content'])
            if merged_count > 0:
                total_merged += merged_count
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Merged {total_merged} fragment blocks")
    print(f"   Output: {OUTPUT_JSON}")
    
    # Show example from chapter 10
    print("\n--- Sample: Chapter 10 Section intro ---")
    for ch in book['chapters']:
        if ch.get('number') in ['10', 10]:
            intro_sec = ch.get('sections', [{}])[0]
            for i, block in enumerate(intro_sec.get('content', [])[:6]):
                txt = block.get('text') or block.get('basis') or ''
                if txt:
                    print(f"[{i}] {txt[:200]}...")
                elif block.get('images'):
                    for img in block['images']:
                        print(f"[{i}] IMAGE: {img.get('figureNumber')}")

if __name__ == "__main__":
    main()





