#!/usr/bin/env python3
"""
Parse VTH N4 PDF text extract into canonical JSON format.
Extracts chapters, sections, and body text.
"""
import json
import re
from pathlib import Path
from typing import Optional, List, Tuple, Dict

REPO_ROOT = Path(__file__).resolve().parents[2]
INPUT_FILE = REPO_ROOT / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_full.txt"
OUTPUT_FILE = REPO_ROOT / "new_pipeline" / "output" / "vth_n4_text_extract" / "vth_n4_canonical_from_pdf.json"

# Chapter title patterns (from TOC analysis)
CHAPTER_TITLES = {
    1: "Wet- en regelgeving",
    2: "Medicijnen",
    3: "Soorten medicijnen",
    4: "Toedienen van medicijnen",
    5: "Injecteren",
    6: "Infusie",
    7: "Bijzondere infusen",
    8: "Totale parenterale voeding en bloedtransfusie",
    9: "Sondevoeding toedienen",
    10: "Neusmaagsonde",
    11: "PEG-sonde, PEG-J-sonde en button",
    12: "Maagspoelen",
    13: "Blaaskatheter",
    14: "Blaasspoeling",
    15: "Nefrostomiekatheter",
    16: "Urostoma",
    17: "Suprapubische katheter",
    18: "Continent urinestoma",
    19: "Darmspoelen",
    20: "Colostoma en ileostoma",
    21: "Tracheostoma",
    22: "Zuurstoftoediening",
    23: "Thoraxdrainage",
    24: "Wondverzorging",
    25: "Specifieke wondverzorging",
    26: "Decubituspreventie",
    27: "Laboratoriumonderzoek",
    28: "Beeldvormende technieken en functioneel onderzoek",
    29: "Palliatieve en terminale zorg",
    30: "Hygiëne en infectiepreventie",
}

def clean_text(text: str) -> str:
    """Clean extracted text - fix common OCR/extraction issues."""
    # Fix broken words at line ends
    text = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', text)
    # Normalize whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def extract_section_number(line: str) -> Optional[Tuple[str, str]]:
    """Extract section number and title from a line like '1.2 Some title'."""
    # Pattern: X.Y or X.Y.Z followed by text
    match = re.match(r'^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(.+)', line.strip())
    if match:
        return match.group(1), match.group(2).strip()
    return None

def find_chapter_boundaries(lines: List[str]) -> List[Tuple[int, int, int]]:
    """Find line indices where each chapter starts. Returns [(line_idx, chapter_num, title)]."""
    boundaries = []
    
    for i, line in enumerate(lines):
        # Look for patterns like "1        Wet- en regelgeving" or "12       Maagspoelen"
        # Chapter numbers at start of page, followed by spaces, then title
        match = re.match(r'^(\d{1,2})\s{4,}([A-Z][a-z].*?)(?:\s{4,}|$)', line)
        if match:
            ch_num = int(match.group(1))
            title = match.group(2).strip()
            if ch_num in CHAPTER_TITLES:
                # Verify it's actually the chapter (not TOC entry)
                # Check if next lines don't have multiple columns (TOC has 2 columns)
                if i + 5 < len(lines):
                    next_lines = ''.join(lines[i+1:i+5])
                    # TOC pages have dense multi-column text
                    if next_lines.count('\t') < 3 and len(next_lines) < 500:
                        boundaries.append((i, ch_num, CHAPTER_TITLES[ch_num]))
    
    return boundaries

def parse_chapter_content(lines: List[str], start_idx: int, end_idx: int, chapter_num: int) -> Dict:
    """Parse chapter content into sections and paragraphs."""
    chapter = {
        "number": str(chapter_num),
        "title": CHAPTER_TITLES.get(chapter_num, f"Hoofdstuk {chapter_num}"),
        "sections": []
    }
    
    current_section = None
    current_content = []
    
    for line in lines[start_idx:end_idx]:
        line = line.rstrip()
        
        # Skip page headers/footers
        if re.match(r'^\d+\s+Verpleegtechnische handelingen', line):
            continue
        if re.match(r'^Verpleegtechnische handelingen\s+\d+', line):
            continue
        if re.match(r'^\d+\s+MBO Anatomie', line):
            continue
            
        # Check for section header
        section_match = extract_section_number(line)
        if section_match:
            # Save previous section
            if current_section:
                current_section["content"] = parse_content_blocks(current_content)
                chapter["sections"].append(current_section)
            
            sec_num, sec_title = section_match
            current_section = {
                "number": sec_num,
                "title": sec_title,
                "content": []
            }
            current_content = []
        elif current_section:
            if line.strip():
                current_content.append(line)
        elif line.strip():
            # Content before first section
            current_content.append(line)
    
    # Add final section
    if current_section:
        current_section["content"] = parse_content_blocks(current_content)
        chapter["sections"].append(current_section)
    elif current_content:
        # Chapter has no sections, just content
        chapter["sections"].append({
            "number": f"{chapter_num}.1",
            "title": "",
            "content": parse_content_blocks(current_content)
        })
    
    return chapter

def parse_content_blocks(lines: List[str]) -> List[Dict]:
    """Convert lines into content blocks (paragraphs, lists, etc.)."""
    blocks = []
    current_para = []
    in_list = False
    
    for line in lines:
        line = line.strip()
        if not line:
            if current_para:
                text = ' '.join(current_para)
                text = clean_text(text)
                if text:
                    blocks.append({
                        "type": "paragraph",
                        "role": "list-item" if in_list else "body",
                        "text": text
                    })
                current_para = []
                in_list = False
            continue
        
        # Check if it's a bullet point
        if line.startswith('•') or line.startswith('-') or line.startswith('ɠ'):
            if current_para:
                text = ' '.join(current_para)
                text = clean_text(text)
                if text:
                    blocks.append({
                        "type": "paragraph",
                        "role": "list-item" if in_list else "body",
                        "text": text
                    })
                current_para = []
            in_list = True
            # Remove bullet marker
            line = re.sub(r'^[•\-ɠ]\s*', '', line)
        
        current_para.append(line)
    
    # Final paragraph
    if current_para:
        text = ' '.join(current_para)
        text = clean_text(text)
        if text:
            blocks.append({
                "type": "paragraph",
                "role": "list-item" if in_list else "body",
                "text": text
            })
    
    return blocks

def main():
    print(f"Reading: {INPUT_FILE}")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    print(f"Total lines: {len(lines)}")
    
    # Find chapter boundaries
    boundaries = find_chapter_boundaries(lines)
    print(f"Found {len(boundaries)} chapter boundaries")
    for b in boundaries[:10]:
        print(f"  Line {b[0]}: Chapter {b[1]} - {b[2][:40]}...")
    
    # Build canonical structure
    book = {
        "meta": {
            "title": "MBO VTH N4",
            "full_title": "Verpleegtechnische handelingen voor het mbo",
            "version": "pdf-extract-2024",
            "isbn": "9789083412054",
            "authors": ["Asaf Gafni", "Iris Verhagen"]
        },
        "chapters": []
    }
    
    # Sort boundaries by chapter number
    boundaries.sort(key=lambda x: x[1])
    
    # Parse each chapter
    for i, (start_idx, ch_num, title) in enumerate(boundaries):
        # Find end index (start of next chapter or end of file)
        if i + 1 < len(boundaries):
            end_idx = boundaries[i + 1][0]
        else:
            end_idx = len(lines)
        
        print(f"Parsing Chapter {ch_num}: lines {start_idx}-{end_idx}")
        chapter = parse_chapter_content(lines, start_idx, end_idx, ch_num)
        book["chapters"].append(chapter)
    
    # Fill in missing chapters with placeholders
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
    
    # Sort chapters by number
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

if __name__ == "__main__":
    main()

