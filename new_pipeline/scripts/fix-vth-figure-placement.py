#!/usr/bin/env python3
"""
Fix VTH N4 figure placement:
1. Move figures from beginning of sections to distributed positions
2. Sort figures in correct numerical order (1, 2, 3... not 4, 3, 2, 1)
3. Distribute figures evenly through content blocks
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.FIXED_PLACEMENT.json"

def sort_key(fig_num: str) -> tuple:
    """Sort figure numbers like 9.1, 9.2, 9.10 correctly."""
    # Handle "Afbeelding X.Y" format
    match = re.search(r'(\d+)\.(\d+)', fig_num)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    return (999, 999)

def main():
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    total_moved = 0
    
    for chapter in book['chapters']:
        ch_num = chapter.get('number')
        
        for section in chapter.get('sections', []):
            content = section.get('content', [])
            if not content:
                continue
            
            # Collect all figures and text blocks
            figures = []
            text_blocks = []
            
            for block in content:
                if block.get('images'):
                    figures.extend(block.get('images', []))
                else:
                    text_blocks.append(block)
            
            if not figures:
                continue
            
            # Sort figures by their number
            figures.sort(key=lambda f: sort_key(f.get('figureNumber', '0.0')))
            
            # Now redistribute: place figures evenly through the text
            # If we have N figures and M text blocks, place a figure every M/N blocks
            if not text_blocks:
                # Only figures, no text - keep them but in sorted order
                new_content = [{'type': 'paragraph', 'role': 'body', 'text': '', 'images': figures}]
            else:
                new_content = []
                
                # Calculate distribution
                num_figs = len(figures)
                num_text = len(text_blocks)
                
                # Strategy: place figures AFTER text blocks at regular intervals
                # e.g., with 4 figures and 10 text blocks: after blocks 2, 4, 7, 9
                if num_figs >= num_text:
                    # More figures than text - put one figure after each text block
                    fig_idx = 0
                    for text_block in text_blocks:
                        new_content.append(text_block)
                        if fig_idx < num_figs:
                            fig = figures[fig_idx]
                            new_content.append({
                                'type': 'paragraph',
                                'role': 'body', 
                                'text': '',
                                'images': [fig]
                            })
                            fig_idx += 1
                    # Add remaining figures at end
                    for remaining_fig in figures[fig_idx:]:
                        new_content.append({
                            'type': 'paragraph',
                            'role': 'body',
                            'text': '',
                            'images': [remaining_fig]
                        })
                else:
                    # More text than figures - distribute figures evenly
                    interval = num_text // (num_figs + 1)  # +1 to avoid placing at very start
                    fig_positions = [(i + 1) * interval for i in range(num_figs)]
                    
                    fig_idx = 0
                    for i, text_block in enumerate(text_blocks):
                        new_content.append(text_block)
                        # Check if we should insert a figure after this block
                        if fig_idx < num_figs and i + 1 >= fig_positions[fig_idx]:
                            fig = figures[fig_idx]
                            new_content.append({
                                'type': 'paragraph',
                                'role': 'body',
                                'text': '',
                                'images': [fig]
                            })
                            fig_idx += 1
                    
                    # Add any remaining figures at the end
                    for remaining_fig in figures[fig_idx:]:
                        new_content.append({
                            'type': 'paragraph',
                            'role': 'body',
                            'text': '',
                            'images': [remaining_fig]
                        })
                
                total_moved += num_figs
            
            section['content'] = new_content
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Fixed figure placement for {total_moved} figures")
    print(f"   Output: {OUTPUT_JSON}")
    
    # Verify chapter 9 and 10
    print("\n--- Verification: Chapter 9 structure ---")
    for ch in book['chapters']:
        if ch.get('number') in ['9', 9]:
            for sec in ch.get('sections', [])[:2]:
                print(f"\nSection {sec.get('number', 'intro')}:")
                for i, block in enumerate(sec.get('content', [])[:8]):
                    if block.get('images'):
                        for img in block['images']:
                            print(f"  [{i}] IMAGE: {img.get('figureNumber')}")
                    else:
                        txt = (block.get('text') or block.get('basis') or '')[:50]
                        print(f"  [{i}] text: {txt}...")

if __name__ == "__main__":
    main()





