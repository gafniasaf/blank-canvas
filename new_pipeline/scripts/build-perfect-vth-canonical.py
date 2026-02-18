#!/usr/bin/env python3
"""
Build a perfect canonical JSON for VTH N4 that another agent can use
to generate the complete book.

Output structure:
{
  "meta": { title, subtitle, level, isbn, authors, ... },
  "chapters": [
    {
      "number": "1",
      "title": "Wet- en regelgeving",
      "opener_image": "path/to/chapter_1_opener.jpg",
      "sections": [
        {
          "number": "1.1",
          "title": "Section title",
          "content": [
            { "type": "paragraph", "text": "..." },
            { "type": "figure", "number": "1.1", "caption": "...", "src": "..." },
            { "type": "list", "items": ["item1", "item2"] },
            ...
          ]
        }
      ]
    }
  ]
}
"""
import json
import re
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.TITLES_FIXED.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__PERFECT_CANONICAL.json"
ASSETS_DIR = REPO_ROOT / "new_pipeline" / "assets"

# Chapter titles from the original book
CHAPTER_TITLES = {
    1: "Wet- en regelgeving",
    2: "Medicijnen",
    3: "Soorten medicijnen",
    4: "Toedienen van medicijnen",
    5: "Injecteren",
    6: "Infusies",
    7: "Bijzondere infusen",
    8: "Totale parenterale voeding en bloedtransfusie",
    9: "Sondevoeding toedienen",
    10: "Neusmaagsonde",
    11: "PEG-sonde, PEG-J-sonde en button",
    12: "Maagspoelen",
    13: "Blaaskatheters",
    14: "Suprapubische katheter",
    15: "Nefrostomiekatheter",
    16: "Blaasspoelen",
    17: "Stomazorg",
    18: "Continent urinestoma",
    19: "Darmspoelen",
    20: "Colostoma en ileostoma",
    21: "Tracheostoma",
    22: "Zuurstoftoediening",
    23: "Thoraxdrainage",
    24: "Algemene wondverzorging",
    25: "Specifieke wondverzorging",
    26: "Decubituspreventie",
    27: "Laboratoriumonderzoek",
    28: "Beeldvormende technieken en pathologisch onderzoek",
    29: "Endoscopie en functieonderzoek",
    30: "Verlenen van eerste hulp",
}

def clean_text(text: str) -> str:
    """Clean and normalize text."""
    if not text:
        return ""
    # Remove soft hyphens
    text = text.replace('\xad', '').replace('­', '')
    # Fix common broken words
    fixes = {
        'zorg vrager': 'zorgvrager',
        'zorg professional': 'zorgprofessional',
        'in brengen': 'inbrengen',
        'uit voeren': 'uitvoeren',
        'aan brengen': 'aanbrengen',
        'ver wijderen': 'verwijderen',
        'contro leren': 'controleren',
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
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def parse_content_block(block: dict) -> dict:
    """Parse a content block into a clean structure."""
    result = {"type": "paragraph"}
    
    # Handle images/figures
    if block.get('images'):
        imgs = block['images']
        if imgs:
            img = imgs[0]
            return {
                "type": "figure",
                "number": img.get('figureNumber', '').replace('Afbeelding ', ''),
                "caption": clean_text(img.get('caption', '')),
                "src": img.get('src', ''),
                "alt": img.get('alt', '')
            }
    
    # Get text content
    text = clean_text(block.get('text') or block.get('basis') or '')
    
    if not text:
        return None
    
    # Check if it's a bullet list (has • character)
    if '•' in text:
        # Split on bullet points
        parts = re.split(r'\s*•\s*', text)
        intro = parts[0].strip() if parts[0].strip() else None
        items = [p.strip() for p in parts[1:] if p.strip()]
        
        if items:
            return {
                "type": "list",
                "intro": intro,
                "items": items
            }
    
    # Check if it ends with colon (list intro without items yet)
    if text.endswith(':'):
        return {
            "type": "list_intro",
            "text": text
        }
    
    # Regular paragraph
    result["text"] = text
    return result

def build_perfect_canonical():
    """Build the perfect canonical JSON."""
    
    # Load the fixed JSON
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        source = json.load(f)
    
    # Build the new structure
    canonical = {
        "meta": {
            "title": "MBO Verpleegtechnische handelingen",
            "short_title": "VTH N4",
            "subtitle": "Verpleegtechnische handelingen voor het mbo",
            "level": "n4",
            "isbn": "9789083412054",
            "publisher": "Experius",
            "year": 2024,
            "edition": "1e druk",
            "language": "nl",
            "target_audience": "MBO Verpleegkunde niveau 4",
            "generated_at": datetime.now().isoformat(),
            "source": "PDF extraction with post-processing fixes",
            "total_chapters": 30
        },
        "assets": {
            "figures_dir": "new_pipeline/assets/figures/vth_n4/",
            "chapter_openers_dir": "new_pipeline/assets/images/vth_n4_chapter_openers/",
            "covers": {
                "front": "new_pipeline/assets/covers/vth_n4/front_only.png",
                "back": "new_pipeline/assets/covers/vth_n4/back_only.png"
            }
        },
        "chapters": []
    }
    
    # Process each chapter
    for ch in source.get('chapters', []):
        ch_num = int(ch.get('number', 0))
        
        chapter = {
            "number": ch_num,
            "title": CHAPTER_TITLES.get(ch_num, ch.get('title', f'Hoofdstuk {ch_num}')),
            "opener_image": f"new_pipeline/assets/images/vth_n4_chapter_openers/chapter_{ch_num}_opener.jpg",
            "sections": []
        }
        
        # Process sections
        for sec in ch.get('sections', []):
            sec_num = sec.get('number', '')
            sec_title = clean_text(sec.get('title', ''))
            
            section = {
                "number": sec_num if sec_num else None,
                "title": sec_title,
                "content": []
            }
            
            # Process content blocks
            for block in sec.get('content', []):
                parsed = parse_content_block(block)
                if parsed:
                    section["content"].append(parsed)
            
            # Only add non-empty sections
            if section["content"] or section["title"]:
                chapter["sections"].append(section)
        
        canonical["chapters"].append(chapter)
    
    # Add statistics
    total_sections = sum(len(ch["sections"]) for ch in canonical["chapters"])
    total_paragraphs = 0
    total_figures = 0
    total_lists = 0
    
    for ch in canonical["chapters"]:
        for sec in ch["sections"]:
            for block in sec["content"]:
                if block["type"] == "paragraph":
                    total_paragraphs += 1
                elif block["type"] == "figure":
                    total_figures += 1
                elif block["type"] == "list":
                    total_lists += 1
    
    canonical["meta"]["statistics"] = {
        "total_chapters": len(canonical["chapters"]),
        "total_sections": total_sections,
        "total_figures": total_figures,
        "total_lists": total_lists
    }
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(canonical, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Perfect canonical JSON created!")
    print(f"   Output: {OUTPUT_JSON}")
    print(f"\n📊 Statistics:")
    print(f"   Chapters: {len(canonical['chapters'])}")
    print(f"   Sections: {total_sections}")
    print(f"   Figures: {total_figures}")
    print(f"   Lists: {total_lists}")

if __name__ == "__main__":
    build_perfect_canonical()

