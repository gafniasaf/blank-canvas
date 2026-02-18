#!/usr/bin/env python3
"""
Parse VTH N4 PDF using PyMuPDF for better text extraction.
Creates canonical JSON with all 30 chapters.
"""
import fitz  # PyMuPDF
import json
import re
from pathlib import Path
from typing import Optional, List, Dict, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = REPO_ROOT / "new_pipeline" / "output" / "highres_exports" / "MBO_VTH_N4_2024_HIGHRES.pdf"
OUTPUT_FILE = REPO_ROOT / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_canonical_pymupdf.json"

# Chapter titles and page numbers (extracted from PDF)
# Page numbers are 0-indexed
CHAPTER_PAGES = {
    1: (18, "Wet- en regelgeving"),
    2: (30, "Medicijnen"),
    3: (42, "Soorten medicijnen"),
    4: (58, "Toedienen van medicijnen"),
    5: (96, "Injecteren"),
    6: (114, "Infusies"),
    7: (144, "Bijzondere infusen"),
    8: (168, "Totale parenterale voeding en bloedtransfusie"),
    9: (182, "Sondevoeding toedienen"),
    10: (196, "Neusmaagsonde"),
    11: (208, "PEG-sonde, PEG-J-sonde en button"),
    12: (216, "Maagspoelen"),
    13: (222, "Blaaskatheters"),
    14: (258, "Suprapubische katheter"),
    15: (270, "Nefrostomiekatheter"),
    16: (280, "Blaasspoelen"),
    17: (292, "Stomazorg"),
    18: (314, "Continent urinestoma"),
    19: (322, "Darmspoelen"),
    20: (330, "Toedienen van zuurstof"),
    21: (346, "Uitzuigen van de luchtwegen"),
    22: (352, "Tracheostoma"),
    23: (370, "Thoraxdrainage"),
    24: (378, "Algemene wondverzorging"),
    25: (404, "Specifieke wondverzorging"),
    26: (432, "Monsters verzamelen"),
    27: (450, "Laboratoriumonderzoek"),
    28: (464, "Beeldvormende technieken en pathologisch onderzoek"),
    29: (472, "Endoscopie en functieonderzoek"),
    30: (478, "Verlenen van eerste hulp"),
}

CHAPTER_TITLES = {k: v[1] for k, v in CHAPTER_PAGES.items()}

def clean_text(text: str) -> str:
    """Clean extracted text."""
    # Fix hyphenation at line breaks
    text = re.sub(r'(\w)­\s*\n\s*(\w)', r'\1\2', text)  # soft hyphen
    text = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', text)  # regular hyphen
    # Normalize whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def is_chapter_start_page(text: str) -> Optional[int]:
    """Check if page starts with a chapter number (just a number on its own line)."""
    lines = text.strip().split('\n')
    if not lines:
        return None
    
    first_line = lines[0].strip()
    # Chapter pages start with just the chapter number
    if re.match(r'^(\d{1,2})$', first_line):
        ch_num = int(first_line)
        if 1 <= ch_num <= 30:
            # Verify by checking if title appears soon after
            full_text = '\n'.join(lines[:5]).lower()
            expected_title = CHAPTER_TITLES.get(ch_num, '').lower()[:20]
            if expected_title and expected_title in full_text:
                return ch_num
            # Also accept if it looks like a chapter opener
            if len(lines) <= 3 or 'leerdoel' in full_text[:500].lower():
                return ch_num
    return None

def extract_section_number(line: str) -> Optional[Tuple[str, str]]:
    """Extract section number and title from line."""
    # Pattern: X.Y or X.Y.Z followed by title
    match = re.match(r'^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(.+)', line.strip())
    if match:
        return match.group(1), match.group(2).strip()
    return None

def parse_page_content(text: str, chapter_num: int) -> List[Dict]:
    """Parse page content into sections and paragraphs."""
    blocks = []
    lines = text.split('\n')
    current_section = None
    current_para_lines = []
    
    # Skip page header/footer patterns
    skip_patterns = [
        r'^Verpleegtechnische handelingen voor het mbo$',
        r'^MBO Anatomie',
        r'^\d+$',  # Page numbers
        r'^Leerdoelen$',
    ]
    
    for line in lines:
        line = line.rstrip()
        
        # Skip headers/footers
        skip = False
        for pattern in skip_patterns:
            if re.match(pattern, line.strip()):
                skip = True
                break
        if skip:
            continue
        
        # Check for section header
        section_match = extract_section_number(line)
        if section_match:
            # Save current paragraph
            if current_para_lines:
                para_text = clean_text(' '.join(current_para_lines))
                if para_text:
                    blocks.append({
                        "type": "paragraph",
                        "role": "body",
                        "text": para_text,
                        "section": current_section
                    })
                current_para_lines = []
            
            sec_num, sec_title = section_match
            current_section = sec_num
            blocks.append({
                "type": "section_header",
                "number": sec_num,
                "title": sec_title
            })
        elif line.strip():
            # Check for bullet points
            if line.strip().startswith('ɠ') or line.strip().startswith('•'):
                # Save current para
                if current_para_lines:
                    para_text = clean_text(' '.join(current_para_lines))
                    if para_text:
                        blocks.append({
                            "type": "paragraph",
                            "role": "body",
                            "text": para_text,
                            "section": current_section
                        })
                    current_para_lines = []
                
                # Add bullet item
                bullet_text = re.sub(r'^[ɠ•]\s*', '', line.strip())
                if bullet_text:
                    blocks.append({
                        "type": "paragraph",
                        "role": "list-item",
                        "text": clean_text(bullet_text),
                        "section": current_section
                    })
            else:
                current_para_lines.append(line.strip())
        else:
            # Empty line - end of paragraph
            if current_para_lines:
                para_text = clean_text(' '.join(current_para_lines))
                if para_text and len(para_text) > 10:  # Skip very short fragments
                    blocks.append({
                        "type": "paragraph",
                        "role": "body",
                        "text": para_text,
                        "section": current_section
                    })
                current_para_lines = []
    
    # Don't forget last paragraph
    if current_para_lines:
        para_text = clean_text(' '.join(current_para_lines))
        if para_text and len(para_text) > 10:
            blocks.append({
                "type": "paragraph",
                "role": "body",
                "text": para_text,
                "section": current_section
            })
    
    return blocks

def organize_into_sections(blocks: List[Dict]) -> List[Dict]:
    """Organize flat block list into sections with content."""
    sections = []
    current_section = {"number": "", "title": "", "content": []}
    
    for block in blocks:
        if block["type"] == "section_header":
            # Save current section if it has content
            if current_section["content"]:
                sections.append(current_section)
            current_section = {
                "number": block["number"],
                "title": block["title"],
                "content": []
            }
        else:
            # Add content block
            content_block = {
                "type": block["type"],
                "role": block["role"],
                "text": block["text"]
            }
            current_section["content"].append(content_block)
    
    # Add final section
    if current_section["content"]:
        sections.append(current_section)
    
    return sections

def main():
    print(f"Opening PDF: {PDF_PATH}")
    doc = fitz.open(str(PDF_PATH))
    print(f"Total pages: {doc.page_count}")
    
    # Use predefined chapter page mappings
    chapter_pages = {ch_num: page_info[0] for ch_num, page_info in CHAPTER_PAGES.items()}
    
    print(f"\nUsing {len(chapter_pages)} predefined chapter boundaries")
    
    # Build canonical structure
    book = {
        "meta": {
            "title": "MBO VTH N4",
            "full_title": "Verpleegtechnische handelingen voor het mbo",
            "version": "pdf-extract-pymupdf-2024",
            "isbn": "9789083412054",
            "authors": ["Asaf Gafni", "Iris Verhagen"]
        },
        "chapters": []
    }
    
    # Process each chapter
    sorted_chapters = sorted(chapter_pages.items())
    
    for i, (ch_num, start_page) in enumerate(sorted_chapters):
        # Determine end page
        if i + 1 < len(sorted_chapters):
            end_page = sorted_chapters[i + 1][1]
        else:
            end_page = doc.page_count
        
        print(f"\nProcessing Chapter {ch_num}: pages {start_page + 1}-{end_page}")
        
        # Extract all pages for this chapter
        all_blocks = []
        for page_num in range(start_page, end_page):
            page = doc[page_num]
            text = page.get_text("text")
            blocks = parse_page_content(text, ch_num)
            all_blocks.extend(blocks)
        
        # Organize into sections
        sections = organize_into_sections(all_blocks)
        
        # If no sections found, create a default one
        if not sections:
            sections = [{
                "number": f"{ch_num}.1",
                "title": "",
                "content": []
            }]
        
        chapter = {
            "number": str(ch_num),
            "title": CHAPTER_TITLES.get(ch_num, f"Hoofdstuk {ch_num}"),
            "sections": sections
        }
        
        book["chapters"].append(chapter)
        
        total_content = sum(len(s.get("content", [])) for s in sections)
        print(f"  Sections: {len(sections)}, Content blocks: {total_content}")
    
    # Add placeholder chapters for any missing
    existing_chapters = {int(ch["number"]) for ch in book["chapters"]}
    for ch_num in range(1, 31):
        if ch_num not in existing_chapters:
            print(f"Adding placeholder for Chapter {ch_num}")
            book["chapters"].append({
                "number": str(ch_num),
                "title": CHAPTER_TITLES.get(ch_num, f"Hoofdstuk {ch_num}"),
                "sections": [{
                    "number": f"{ch_num}.1",
                    "title": "",
                    "content": []
                }]
            })
    
    # Sort chapters
    book["chapters"].sort(key=lambda x: int(x["number"]))
    
    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Output: {OUTPUT_FILE}")
    print(f"   Chapters: {len(book['chapters'])}")
    
    total_sections = sum(len(ch.get("sections", [])) for ch in book["chapters"])
    total_blocks = sum(
        len(sec.get("content", []))
        for ch in book["chapters"]
        for sec in ch.get("sections", [])
    )
    print(f"   Sections: {total_sections}")
    print(f"   Content blocks: {total_blocks}")
    
    # Show sample
    print("\n--- Sample from Chapter 1 ---")
    ch1 = book["chapters"][0]
    if ch1["sections"]:
        sec = ch1["sections"][0]
        print(f"Section: {sec['number']} {sec['title']}")
        for block in sec["content"][:3]:
            print(f"  [{block['role']}] {block['text'][:100]}...")

if __name__ == "__main__":
    main()

