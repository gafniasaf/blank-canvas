#!/usr/bin/env python3
"""
Final validation for VTH N4 Canonical JSON.
Checks: Structure, Text Content, Figures, Captions, Assets.
"""
import json
from pathlib import Path

REPO_ROOT = Path('/Users/asafgafni/Desktop/InDesign/TestRun')
CANONICAL = REPO_ROOT / 'new_pipeline' / 'output' / '_canonical_jsons_all' / 'VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.json'
ASSETS_DIR = REPO_ROOT / 'new_pipeline' / 'assets' / 'figures' / 'vth_n4'

def validate():
    print(f"Validating: {CANONICAL.name}")
    
    with CANONICAL.open('r', encoding='utf-8') as f:
        book = json.load(f)

    # 1. Structure Check
    chapters = book.get('chapters', [])
    print(f"\n[1] Structure")
    print(f"    Chapters: {len(chapters)} (Expected: 30)")
    
    if len(chapters) != 30:
        print("    ❌ ERROR: Incorrect chapter count")
    
    empty_chapters = []
    for ch in chapters:
        sections = ch.get('sections', [])
        if not sections:
            empty_chapters.append(ch['number'])
    
    if empty_chapters:
        print(f"    ❌ ERROR: Empty chapters found: {empty_chapters}")
    else:
        print("    ✅ All chapters have sections")

    # 2. Text Content Check
    print(f"\n[2] Text Content")
    total_blocks = 0
    total_chars = 0
    low_content_chapters = []
    
    for ch in chapters:
        ch_blocks = 0
        ch_chars = 0
        for sec in ch.get('sections', []):
            for block in sec.get('content', []):
                if isinstance(block, dict):
                    ch_blocks += 1
                    ch_chars += len(block.get('text', ''))
        
        total_blocks += ch_blocks
        total_chars += ch_chars
        
        # Arbitrary threshold for "suspiciously empty" chapter
        if ch_chars < 1000:
            # Check if it's one of the "placeholder" ones (but we extracted all 30)
            low_content_chapters.append(f"Ch{ch['number']} ({ch_chars} chars)")

    print(f"    Total Blocks: {total_blocks}")
    print(f"    Total Characters: {total_chars}")
    
    if low_content_chapters:
        print(f"    ⚠️ WARNING: Low content chapters: {', '.join(low_content_chapters)}")
    else:
        print("    ✅ Text content looks substantial per chapter")

    # 3. Figures & Assets Check
    print(f"\n[3] Figures & Assets")
    figures = []
    for ch in chapters:
        for sec in ch.get('sections', []):
            for block in sec.get('content', []):
                if isinstance(block, dict):
                    for img in block.get('images', []):
                        figures.append(img)
    
    print(f"    Total Figures in JSON: {len(figures)}")
    
    missing_assets = []
    missing_captions = []
    missing_numbers = []
    
    for img in figures:
        src = img.get('src', '')
        # Fix path relative to repo root if needed, or check logic
        # src in JSON is usually 'assets/figures/vth_n4/...'
        # We check against absolute ASSETS_DIR
        filename = src.split('/')[-1]
        file_path = ASSETS_DIR / filename
        
        if not file_path.exists():
            missing_assets.append(src)
            
        if not img.get('caption'):
            missing_captions.append(img.get('figureNumber'))
            
        if not img.get('figureNumber'):
            missing_numbers.append(src)

    if missing_assets:
        print(f"    ❌ ERROR: Missing assets ({len(missing_assets)}): {missing_assets[:3]}...")
    else:
        print("    ✅ All assets exist on disk")
        
    if missing_captions:
        print(f"    ❌ ERROR: Missing captions ({len(missing_captions)}): {missing_captions[:3]}...")
    else:
        print("    ✅ All figures have captions")
        
    if missing_numbers:
        print(f"    ❌ ERROR: Missing figure numbers ({len(missing_numbers)}")
    else:
        print("    ✅ All figures have numbers")

    # Final Verdict
    print(f"\n=== FINAL VERDICT ===")
    if len(chapters) == 30 and not empty_chapters and not missing_assets and not missing_captions:
        print("✅ COMPLETE AND RELIABLE")
        print("   Ready for PDF generation or further processing.")
    else:
        print("❌ ISSUES FOUND - See details above")

if __name__ == "__main__":
    validate()





