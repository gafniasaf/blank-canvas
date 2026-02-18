#!/usr/bin/env python3
"""
Scan the VTH N4 PDF for quality issues:
- Garbled/weird text
- Empty pages
- Wrong chapter titles
- Suspicious patterns
"""
import fitz  # PyMuPDF
import re
from pathlib import Path
from collections import defaultdict

PDF_PATH = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/vth_n4/MBO_VTH_N4_FULL_CLEANED.pdf")

def analyze_text(text: str, page_num: int) -> list[str]:
    """Find suspicious patterns in text."""
    issues = []
    
    # Check for garbled characters (high unicode, control chars)
    weird_chars = re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', text)
    if weird_chars:
        issues.append(f"Page {page_num}: Found {len(weird_chars)} control/weird characters")
    
    # Check for repeated characters (sign of encoding issues)
    repeated = re.findall(r'(.)\1{10,}', text)
    if repeated:
        issues.append(f"Page {page_num}: Found repeated character sequences: {repeated[:3]}")
    
    # Check for lorem ipsum or placeholder text
    if 'lorem ipsum' in text.lower():
        issues.append(f"Page {page_num}: Found placeholder 'lorem ipsum' text")
    
    # Check for very short text on a page (might be mostly empty)
    if len(text.strip()) < 50 and len(text.strip()) > 0:
        issues.append(f"Page {page_num}: Very short text ({len(text.strip())} chars): '{text.strip()[:100]}'")
    
    # Check for encoding issues (common patterns)
    if 'Ã©' in text or 'Ã«' in text or 'Ã¶' in text:
        issues.append(f"Page {page_num}: Possible UTF-8/Latin-1 encoding issue (Ã patterns)")
    
    # Check for broken words (hyphenation gone wrong)
    broken = re.findall(r'\b\w{1,2}\s+\w{1,2}\s+\w{1,2}\b', text)
    if len(broken) > 5:
        issues.append(f"Page {page_num}: Many short word sequences (possible broken text): {broken[:3]}")
    
    return issues

def main():
    doc = fitz.open(PDF_PATH)
    print(f"Scanning {PDF_PATH.name} ({len(doc)} pages)...\n")
    
    all_issues = []
    chapter_pages = {}
    current_chapter = None
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        
        # Detect chapter starts
        chapter_match = re.search(r'Hoofdstuk\s+(\d+)', text)
        if chapter_match:
            ch_num = int(chapter_match.group(1))
            if ch_num != current_chapter:
                current_chapter = ch_num
                chapter_pages[ch_num] = page_num + 1
        
        # Analyze text quality
        issues = analyze_text(text, page_num + 1)
        all_issues.extend(issues)
        
        # Check for empty pages (excluding chapter openers which are images)
        if len(text.strip()) == 0:
            # Check if page has images
            images = page.get_images()
            if not images:
                all_issues.append(f"Page {page_num + 1}: Completely empty (no text, no images)")
    
    # Print chapter detection
    print("=" * 60)
    print("CHAPTER DETECTION")
    print("=" * 60)
    for ch, pg in sorted(chapter_pages.items()):
        print(f"  Chapter {ch}: starts at page {pg}")
    
    if len(chapter_pages) < 30:
        print(f"\n⚠️ Only detected {len(chapter_pages)} chapters (expected 30)")
        missing = set(range(1, 31)) - set(chapter_pages.keys())
        if missing:
            print(f"   Missing chapters: {sorted(missing)}")
    
    # Print issues
    print("\n" + "=" * 60)
    print("QUALITY ISSUES FOUND")
    print("=" * 60)
    if all_issues:
        for issue in all_issues:
            print(f"  ⚠️ {issue}")
    else:
        print("  ✅ No obvious issues detected")
    
    # Sample text from chapters 9 and 10 (user mentioned these)
    print("\n" + "=" * 60)
    print("SAMPLE TEXT FROM CHAPTERS 9 & 10")
    print("=" * 60)
    
    for ch in [9, 10]:
        if ch in chapter_pages:
            start_page = chapter_pages[ch] - 1  # 0-indexed
            print(f"\n--- Chapter {ch} (page {start_page + 1}) ---")
            page = doc[start_page]
            text = page.get_text("text")
            # Print first 800 chars
            print(text[:800])
            print("...[truncated]..." if len(text) > 800 else "")
    
    # Sample random pages for quality check
    print("\n" + "=" * 60)
    print("RANDOM PAGE SAMPLES")
    print("=" * 60)
    
    import random
    sample_pages = random.sample(range(len(doc)), min(5, len(doc)))
    for pg in sorted(sample_pages):
        page = doc[pg]
        text = page.get_text("text")
        print(f"\n--- Page {pg + 1} ---")
        print(text[:400] if text.strip() else "[Empty or image-only page]")
        print("..." if len(text) > 400 else "")
    
    doc.close()
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total pages: {len(doc)}")
    print(f"Chapters detected: {len(chapter_pages)}")
    print(f"Issues found: {len(all_issues)}")

if __name__ == "__main__":
    main()





