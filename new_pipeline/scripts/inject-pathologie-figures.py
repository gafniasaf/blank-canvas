#!/usr/bin/env python3
"""
Inject Pathologie figures into the canonical JSON based on the figure manifest.
Since we don't have precise paragraph anchors, we'll inject figures at section level
based on page ordering within each chapter.
"""
import json
import os
import sys
from pathlib import Path

MANIFEST_PATH = "new_pipeline/extract/figure_manifest_pathologie.json"
CANONICAL_PATH = "new_pipeline/output/pathologie_n4_PASS2.assembled.json"
OUTPUT_PATH = "new_pipeline/output/pathologie_n4_with_figures.json"
FIGURE_ASSETS_DIR = "new_pipeline/assets/figures/pathologie"

def main():
    # Load manifest
    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    # Load canonical JSON
    with open(CANONICAL_PATH, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    # Group figures by chapter
    figures_by_chapter = {}
    for fig in manifest['figures']:
        ch = fig['chapter']
        if ch not in figures_by_chapter:
            figures_by_chapter[ch] = []
        figures_by_chapter[ch].append(fig)
    
    # Sort figures within each chapter by page
    for ch in figures_by_chapter:
        figures_by_chapter[ch].sort(key=lambda f: f.get('pageIndex', 0))
    
    print(f"Figures by chapter: {[(ch, len(figs)) for ch, figs in sorted(figures_by_chapter.items())]}")
    
    total_injected = 0
    
    for chapter in book['chapters']:
        ch_num = chapter.get('number')
        # Handle both string and int chapter numbers
        ch_num_int = int(ch_num) if isinstance(ch_num, str) else ch_num
        if ch_num_int not in figures_by_chapter:
            continue
        
        figs = figures_by_chapter[ch_num_int]
        if not figs:
            continue
        
        sections = chapter.get('sections', [])
        if not sections:
            continue
        
        # Distribute figures across sections based on page order
        # Simple heuristic: divide figures evenly across sections
        figs_per_section = max(1, len(figs) // len(sections))
        fig_idx = 0
        
        for sec_idx, section in enumerate(sections):
            # Determine how many figures go in this section
            remaining_sections = len(sections) - sec_idx
            remaining_figs = len(figs) - fig_idx
            figs_for_this_section = min(figs_per_section, remaining_figs)
            
            # For the last section, take all remaining
            if sec_idx == len(sections) - 1:
                figs_for_this_section = remaining_figs
            
            if figs_for_this_section <= 0:
                continue
            
            section_figs = figs[fig_idx:fig_idx + figs_for_this_section]
            fig_idx += figs_for_this_section
            
            # Inject figures into section content
            content = section.get('content', [])
            
            for fig in section_figs:
                img_name = fig.get('image', {}).get('linkName', '') if fig.get('image') else ''
                if not img_name:
                    continue
                
                # Check if image file exists
                img_path = f"{FIGURE_ASSETS_DIR}/{img_name}"
                if not os.path.exists(img_path):
                    print(f"  Warning: Image not found: {img_path}")
                    continue
                
                # Create figure block
                figure_block = {
                    "type": "figure",
                    "images": [{
                        "src": img_path,
                        "alt": fig.get('caption', fig.get('label', 'Afbeelding')),
                        "width": "100%"
                    }],
                    "caption": fig.get('caption', ''),
                    "label": fig.get('label', '')
                }
                
                # Insert figure at end of content (or find appropriate spot)
                content.append(figure_block)
                total_injected += 1
            
            section['content'] = content
    
    print(f"Total figures injected: {total_injected}")
    
    # Save updated canonical JSON
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(book, f, ensure_ascii=False, indent=2)
    
    print(f"Saved: {OUTPUT_PATH}")

if __name__ == '__main__':
    main()

