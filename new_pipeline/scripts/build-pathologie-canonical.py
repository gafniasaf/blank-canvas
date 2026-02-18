#!/usr/bin/env python3
"""
Build a perfect canonical JSON for Pathologie N4 from InDesign IDMLs.

This script parses all chapter IDMLs and extracts:
- Chapter titles
- Section structure with numbers
- Body text content
- Figures with captions
- Lists
"""
import json
import re
import zipfile
from pathlib import Path
from datetime import datetime
from lxml import etree

REPO_ROOT = Path(__file__).parent.parent.parent
IDML_DIR = REPO_ROOT / "designs-relinked" / "MBO Pathologie nivo 4_9789083412016_03"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "PATHOLOGIE_N4__PERFECT_CANONICAL.json"
ASSETS_DIR = REPO_ROOT / "new_pipeline" / "assets"

# Chapter titles for Pathologie N4 (manually defined for accuracy)
CHAPTER_TITLES = {
    1: "Inleiding pathologie",
    2: "Pathologie van cellen en weefsels",
    3: "Infectieziekten",
    4: "Stoornissen in de bloedsomloop",
    5: "Stoornissen in de vochthuishouding en zuur-base-evenwicht",
    6: "Afweerstoornissen en allergie",
    7: "Tumoren",
    8: "Erfelijke aandoeningen",
    9: "Aandoeningen van het bewegingsapparaat",
    10: "Huidaandoeningen",
    11: "Psychiatrische aandoeningen",
    12: "Ouderdomsziekten",
}

# Paragraph styles to content type mapping (based on actual IDML analysis)
STYLE_MAPPING = {
    "•Hoofdstukkop": "chapter_number",
    "•Hoofdstuktitel": "chapter_title",
    "_Chapter Header": "section_h1",
    "_Subchapter Header": "section_h2",
    "Tussenkop balk mbo": "section_h3",
    "•Basis": "body",
    "_Tabeltekst": "body",
    "Table body": "body",
    "_Bullets": "list_item",
    "Bullets space after": "list_item",
    "_Nummer List": "list_item",
    "Caption": "caption",
    "•Fotobijschrift": "caption",
}


def clean_text(text: str) -> str:
    """Clean and normalize text."""
    if not text:
        return ""
    # Remove soft hyphens
    text = text.replace('\xad', '').replace('­', '')
    # Remove special InDesign characters
    text = text.replace('\ufeff', '')
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Fix common broken words from hyphenation
    broken_word_fixes = {
        'gen eesmiddelen': 'geneesmiddelen',
        'haarzakj es': 'haarzakjes',
        'Schimmelinfec ties': 'Schimmelinfecties',
        'do or': 'door',
        'Eczemat euze': 'Eczemateuze',
        'Hersen vlies': 'Hersenvlies',
        'h ersenen': 'hersenen',
        'zorg vrager': 'zorgvrager',
        'zorg professional': 'zorgprofessional',
        'bloed vaten': 'bloedvaten',
        'zenuw stelsel': 'zenuwstelsel',
        'hart spier': 'hartspier',
        'long ontsteking': 'longontsteking',
        'maag darm': 'maagdarm',
    }
    for wrong, correct in broken_word_fixes.items():
        text = text.replace(wrong, correct)
    
    return text


def get_style_type(style: str) -> str:
    """Map InDesign paragraph style to content type."""
    if not style:
        return "body"
    # Remove "ParagraphStyle/" prefix
    style_name = style.replace("ParagraphStyle/", "")
    
    # Check exact matches first
    for pattern, content_type in STYLE_MAPPING.items():
        if pattern in style_name:
            return content_type
    
    # Default mappings based on style name patterns
    style_lower = style_name.lower()
    
    # Chapter/section headers
    if 'chapter header' in style_lower:
        return 'section_h1'
    if 'subchapter header' in style_lower:
        return 'section_h2'
    
    # Body text
    if 'basis' in style_lower or 'body' in style_lower or 'tabel' in style_lower:
        return 'body'
    
    # Lists
    if 'bullet' in style_lower or 'nummer' in style_lower:
        return 'list_item'
    
    # Captions
    if 'caption' in style_lower or 'bijschrift' in style_lower:
        return 'caption'
    
    # Skip these non-content styles
    if 'voetregel' in style_lower or 'inhoudsopgave' in style_lower:
        return 'skip'
    
    return "body"  # Default to body


def extract_content_from_idml(idml_path: Path) -> dict:
    """Extract all content from an IDML file."""
    content = {
        "chapter_number": None,
        "chapter_title": None,
        "sections": [],
        "captions": {}
    }
    
    current_section = None
    current_content = []
    
    try:
        with zipfile.ZipFile(idml_path, 'r') as zf:
            # Get all story files
            story_files = sorted([f for f in zf.namelist() if f.startswith("Stories/Story_") and f.endswith(".xml")])
            
            all_paragraphs = []
            
            for story_file in story_files:
                with zf.open(story_file) as f:
                    tree = etree.parse(f)
                    
                    # Extract all paragraph style ranges
                    for psr in tree.xpath('//ParagraphStyleRange'):
                        style = psr.get('AppliedParagraphStyle', '')
                        style_type = get_style_type(style)
                        
                        # Get all text content from this paragraph
                        text_parts = []
                        for content_el in psr.xpath('.//Content'):
                            if content_el.text:
                                text_parts.append(content_el.text)
                        
                        text = clean_text(' '.join(text_parts))
                        
                        if text:
                            all_paragraphs.append({
                                "style": style,
                                "style_type": style_type,
                                "text": text
                            })
            
            # Process paragraphs to build structure
            for para in all_paragraphs:
                style_type = para['style_type']
                text = para['text']
                
                # Skip non-content paragraphs
                if style_type == 'skip':
                    continue
                
                if style_type == 'chapter_number':
                    # Extract chapter number
                    match = re.search(r'(\d+)', text)
                    if match:
                        content['chapter_number'] = int(match.group(1))
                
                elif style_type == 'chapter_title':
                    content['chapter_title'] = text
                
                elif style_type in ('section_h1', 'section_h2', 'section_h3', 'heading'):
                    # Save current section
                    if current_section:
                        current_section['content'] = current_content
                        content['sections'].append(current_section)
                    
                    # Extract section number from text
                    sec_match = re.match(r'^(\d+(?:\.\d+)*)\s+(.+)$', text)
                    if sec_match:
                        sec_num = sec_match.group(1)
                        sec_title = sec_match.group(2)
                    else:
                        sec_num = None
                        sec_title = text
                    
                    current_section = {
                        "number": sec_num,
                        "title": sec_title,
                        "level": 1 if style_type == 'section_h1' else (2 if style_type == 'section_h2' else 3)
                    }
                    current_content = []
                
                elif style_type == 'body':
                    if current_section is None:
                        # Create intro section
                        current_section = {"number": None, "title": "Inleiding", "level": 1}
                    current_content.append({"type": "paragraph", "text": text})
                
                elif style_type == 'list_item':
                    if current_section is None:
                        current_section = {"number": None, "title": "Inleiding", "level": 1}
                    current_content.append({"type": "list_item", "text": text})
                
                elif style_type == 'caption':
                    # Extract figure number and caption
                    cap_match = re.match(r'^(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)*)[:\.\s]*(.*)$', text, re.IGNORECASE)
                    if cap_match:
                        fig_num = cap_match.group(1)
                        caption_text = cap_match.group(2).strip()
                        content['captions'][f"Afbeelding {fig_num}"] = caption_text
            
            # Save last section
            if current_section:
                current_section['content'] = current_content
                content['sections'].append(current_section)
    
    except Exception as e:
        print(f"Error processing {idml_path}: {e}")
    
    return content


def merge_list_items(content_blocks: list) -> list:
    """Merge consecutive list items into proper list structures."""
    result = []
    current_list = None
    
    for block in content_blocks:
        if block['type'] == 'list_item':
            if current_list is None:
                current_list = {"type": "list", "items": []}
            current_list['items'].append(block['text'])
        else:
            if current_list is not None:
                result.append(current_list)
                current_list = None
            result.append(block)
    
    if current_list is not None:
        result.append(current_list)
    
    return result


def build_canonical():
    """Build the complete canonical JSON."""
    print("Building Pathologie N4 Canonical JSON...")
    
    canonical = {
        "meta": {
            "title": "MBO Pathologie",
            "short_title": "Pathologie N4",
            "subtitle": "Pathologie voor het mbo niveau 4",
            "level": "n4",
            "isbn": "9789083412016",
            "publisher": "Experius",
            "year": 2024,
            "edition": "1e druk",
            "language": "nl",
            "target_audience": "MBO Verpleegkunde niveau 4",
            "generated_at": datetime.now().isoformat(),
            "source": "InDesign IDML extraction",
            "total_chapters": 12
        },
        "assets": {
            "figures_dir": "new_pipeline/assets/figures/pathologie/",
            "chapter_openers_dir": "new_pipeline/assets/images/pathologie_chapter_openers/",
            "covers": {
                "front": "new_pipeline/assets/covers/pathologie/front_only.png",
                "back": "new_pipeline/assets/covers/pathologie/back_only.png"
            }
        },
        "chapters": []
    }
    
    # Process each chapter IDML
    for ch_num in range(1, 13):
        idml_path = IDML_DIR / f"Pathologie_mbo_CH{ch_num:02d}_03.2024.idml"
        
        if not idml_path.exists():
            print(f"  ⚠️  Missing: {idml_path.name}")
            continue
        
        print(f"  Processing Chapter {ch_num}...")
        chapter_content = extract_content_from_idml(idml_path)
        
        chapter = {
            "number": ch_num,
            "title": CHAPTER_TITLES.get(ch_num, chapter_content.get('chapter_title') or f"Hoofdstuk {ch_num}"),
            "opener_image": f"new_pipeline/assets/images/pathologie_chapter_openers/chapter_{ch_num}_opener.jpg",
            "sections": []
        }
        
        # Process sections
        for sec in chapter_content['sections']:
            section = {
                "number": sec.get('number'),
                "title": sec.get('title', ''),
                "content": merge_list_items(sec.get('content', []))
            }
            chapter['sections'].append(section)
        
        # Add figures to chapter - collect all unique figures for this chapter
        chapter_figures = []
        for fig_key, caption in chapter_content['captions'].items():
            fig_match = re.search(r'(\d+)\.(\d+)', fig_key)
            if fig_match:
                ch_in_fig = int(fig_match.group(1))
                fig_num_full = f"{fig_match.group(1)}.{fig_match.group(2)}"
                if ch_in_fig == ch_num:
                    chapter_figures.append({
                        "type": "figure",
                        "number": fig_num_full,
                        "caption": caption,
                        "src": f"new_pipeline/assets/figures/pathologie/Afbeelding_{fig_num_full}.png"
                    })
        
        # Sort figures by number and add to first section
        chapter_figures.sort(key=lambda f: (int(f['number'].split('.')[0]), int(f['number'].split('.')[1])))
        
        if chapter_figures and chapter['sections']:
            # Distribute figures across sections
            figs_per_section = max(1, len(chapter_figures) // max(1, len(chapter['sections'])))
            fig_idx = 0
            for sec_idx, section in enumerate(chapter['sections']):
                # Add figures to this section
                num_figs = figs_per_section if sec_idx < len(chapter['sections']) - 1 else len(chapter_figures) - fig_idx
                for _ in range(num_figs):
                    if fig_idx < len(chapter_figures):
                        section['content'].append(chapter_figures[fig_idx])
                        fig_idx += 1
        
        canonical['chapters'].append(chapter)
    
    # Calculate statistics
    total_sections = sum(len(ch['sections']) for ch in canonical['chapters'])
    total_paragraphs = 0
    total_figures = 0
    total_lists = 0
    
    for ch in canonical['chapters']:
        for sec in ch['sections']:
            for block in sec.get('content', []):
                if block['type'] == 'paragraph':
                    total_paragraphs += 1
                elif block['type'] == 'figure':
                    total_figures += 1
                elif block['type'] == 'list':
                    total_lists += 1
    
    canonical['meta']['statistics'] = {
        "total_chapters": len(canonical['chapters']),
        "total_sections": total_sections,
        "total_paragraphs": total_paragraphs,
        "total_figures": total_figures,
        "total_lists": total_lists
    }
    
    # Save
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(canonical, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Pathologie N4 Canonical JSON created!")
    print(f"   Output: {OUTPUT_JSON}")
    print(f"\n📊 Statistics:")
    print(f"   Chapters: {len(canonical['chapters'])}")
    print(f"   Sections: {total_sections}")
    print(f"   Paragraphs: {total_paragraphs}")
    print(f"   Figures: {total_figures}")
    print(f"   Lists: {total_lists}")


if __name__ == "__main__":
    build_canonical()

