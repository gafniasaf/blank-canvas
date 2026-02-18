#!/usr/bin/env python3
"""
Extract InDesign figure mappings (figureNumber → caption) for all books from their IDMLs.
Creates CSV + JSON mapping files per book, similar to af4_indesign_mapping.csv/json.
"""

import csv
import json
import re
import zipfile
from pathlib import Path
from lxml import etree

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_ROOT = REPO_ROOT / "new_pipeline" / "output"

# Book configs: slug → IDML path(s)
BOOK_CONFIGS = {
    "af4": {
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml"],
        "name": "MBO A&F 4"
    },
    "communicatie": {
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_COMMUNICATIE_9789083251387_03_2024__FROM_DOWNLOADS.idml"],
        "name": "MBO Communicatie"
    },
    "methodisch_werken": {
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_METHODISCH_WERKEN_9789083251394_03_2024__FROM_DOWNLOADS.idml"],
        "name": "MBO Methodisch Werken"
    },
    "persoonlijke_verzorging": {
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024__FROM_DOWNLOADS.idml"],
        "name": "MBO Persoonlijke Verzorging"
    },
    "praktijkgestuurd_klinisch_redeneren": {
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024__FROM_DOWNLOADS.idml"],
        "name": "MBO Praktijkgestuurd Klinisch Redeneren"
    },
    "wetgeving": {
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_WETGEVING_9789083412061_03_2024__FROM_DOWNLOADS.idml"],
        "name": "MBO Wetgeving"
    },
    # Pathologie has no single IDML; use canonical JSON with figures
    "pathologie": {
        "idml_paths": [],
        "idml_dir": REPO_ROOT / "designs-relinked" / "MBO Pathologie nivo 4_9789083412016_03",
        "canonical_json": OUTPUT_ROOT / "pathologie_n4_with_figures.json",
        "name": "MBO Pathologie N4"
    },
    # VTH N4 - use prebuilt figure manifest (captions missing in source)
    "vth_n4": {
        "idml_paths": [],
        "figure_manifest": OUTPUT_ROOT / "vth_n4_assets" / "figure_manifest.json",
        "name": "MBO VTH N4"
    }
}


def extract_captions_from_idml(idml_path: Path) -> dict[str, str]:
    """Extract figure captions from an IDML file."""
    captions = {}
    if not idml_path.exists():
        print(f"  ⚠️  IDML not found: {idml_path}")
        return captions
    
    try:
        with zipfile.ZipFile(idml_path, "r") as zf:
            story_files = [f for f in zf.namelist() if f.startswith("Stories/Story_") and f.endswith(".xml")]
            for story_file in story_files:
                with zf.open(story_file) as f:
                    tree = etree.parse(f)
                    # Look for caption styles (case-insensitive)
                    for para in tree.xpath('//ParagraphStyleRange'):
                        style = para.get('AppliedParagraphStyle') or ''
                        style_lower = style.lower()
                        if not (
                            style_lower.startswith('paragraphstyle/•fotobijschrift') or
                            'bijschrift' in style_lower or
                            'annotation' in style_lower or
                            'caption' in style_lower
                        ):
                            continue

                        full_text = "".join(para.xpath('.//Content/text()')).strip()
                        # Match "Afbeelding X.Y" or "Figuur X.Y"
                        match = re.match(r'^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)*)\s*[:\.\s]*(.*)', full_text, re.IGNORECASE)
                        if match:
                            fig_num = match.group(2)
                            caption_text = match.group(3).strip()
                            # Clean up
                            caption_text = re.sub(r'\s+', ' ', caption_text)
                            if caption_text:
                                captions[fig_num] = caption_text
    except zipfile.BadZipFile:
        print(f"  ⚠️  Bad zip file: {idml_path}")
    except Exception as e:
        print(f"  ⚠️  Error processing {idml_path}: {e}")
    
    return captions


def merge_captions(base: dict[str, str], incoming: dict[str, str], conflicts: list[tuple], source_label: str) -> None:
    for fig_num, caption in incoming.items():
        if fig_num in base and base[fig_num] != caption:
            conflicts.append((fig_num, base[fig_num], caption, source_label))
            if len(caption) > len(base[fig_num]):
                base[fig_num] = caption
        else:
            base[fig_num] = caption


def sort_figure_key(fig_num: str) -> tuple:
    """Sort key for figure numbers like '1.2', '10.15', or 'Chapter 5.3_B'."""
    match = re.search(r'(\d+)\.(\d+)', fig_num)
    if match:
        chapter = int(match.group(1))
        number = int(match.group(2))
        suffix = fig_num[match.end():].strip()
        return (chapter, number, suffix)
    match = re.search(r'(\d+)', fig_num)
    if match:
        return (int(match.group(1)), 0, fig_num)
    return (9999, 9999, fig_num)


def build_entries_from_captions(captions: dict[str, str]) -> list[dict]:
    entries = []
    for fig_num in sorted(captions.keys(), key=sort_figure_key):
        entries.append({
            "figureNumber": fig_num,
            "caption": captions[fig_num],
            "imageFileName": f"Afbeelding_{fig_num}.png"
        })
    return entries


def normalize_label_to_number(label: str) -> str:
    label = label.replace("Afbeelding", "").replace("Figuur", "")
    label = label.replace(":", "").strip()
    return label


def extract_figures_from_pathologie_json(json_path: Path) -> list[dict]:
    if not json_path.exists():
        print(f"  ⚠️  Pathologie JSON not found: {json_path}")
        return []
    with json_path.open(encoding="utf-8") as f:
        data = json.load(f)

    figures = {}
    for chapter in data.get("chapters", []):
        for section in chapter.get("sections", []):
            for item in section.get("content", []):
                if item.get("type") != "figure":
                    continue
                label = item.get("label", "")
                fig_num = normalize_label_to_number(label)
                if not fig_num:
                    continue
                caption = (item.get("caption") or "").strip()
                images = item.get("images") or []
                image_file = ""
                if images:
                    src = images[0].get("src", "")
                    image_file = Path(src).name if src else ""
                existing = figures.get(fig_num)
                if not existing or (caption and len(caption) > len(existing["caption"])):
                    figures[fig_num] = {
                        "figureNumber": fig_num,
                        "caption": caption,
                        "imageFileName": image_file
                    }
    return [figures[k] for k in sorted(figures.keys(), key=sort_figure_key)]


def extract_figures_from_manifest(manifest_path: Path) -> list[dict]:
    if not manifest_path.exists():
        print(f"  ⚠️  Manifest not found: {manifest_path}")
        return []
    with manifest_path.open(encoding="utf-8") as f:
        manifest = json.load(f)
    entries = []
    for fig in manifest:
        label = fig.get("figureNumber", "")
        fig_num = normalize_label_to_number(label)
        if not fig_num:
            continue
        src = fig.get("src", "")
        entries.append({
            "figureNumber": fig_num,
            "caption": (fig.get("caption") or "").strip(),
            "imageFileName": Path(src).name if src else ""
        })
    return sorted(entries, key=lambda e: sort_figure_key(e["figureNumber"]))


def write_mapping_files(slug: str, entries: list[dict], book_name: str):
    """Write CSV and JSON mapping files for a book."""
    output_dir = OUTPUT_ROOT / slug
    output_dir.mkdir(parents=True, exist_ok=True)
    
    csv_path = output_dir / f"{slug}_indesign_mapping.csv"
    json_path = output_dir / f"{slug}_indesign_mapping.json"
    
    # Write CSV
    with csv_path.open('w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['figureNumber', 'caption', 'imageFileName'])
        for entry in entries:
            writer.writerow([entry["figureNumber"], entry["caption"], entry["imageFileName"]])
    
    # Write JSON
    json_data = {
        "book": book_name,
        "slug": slug,
        "totalFigures": len(entries),
        "figures": entries
    }
    
    with json_path.open('w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False)
    
    print(f"  ✅ {slug}: {len(entries)} figures → {csv_path.name}, {json_path.name}")
    return csv_path, json_path


def main():
    print("=" * 60)
    print("Extracting InDesign mappings for all books")
    print("=" * 60)
    
    all_mapping_files = []
    
    for slug, config in BOOK_CONFIGS.items():
        print(f"\n📖 {config['name']} ({slug})")
        
        entries = []
        captions = {}
        conflicts = []
        
        # Try IDML paths first
        for idml_path in config.get('idml_paths', []):
            if idml_path.exists():
                extracted = extract_captions_from_idml(idml_path)
                merge_captions(captions, extracted, conflicts, idml_path.name)
                print(f"  Found {len(extracted)} captions in {idml_path.name}")

        # Try IDML directory (e.g., Pathologie chapters)
        idml_dir = config.get("idml_dir")
        if idml_dir and idml_dir.exists():
            idml_files = sorted(idml_dir.glob("*.idml"))
            if idml_files:
                print(f"  Scanning {len(idml_files)} IDML files in {idml_dir.name}")
                for idml_path in idml_files:
                    extracted = extract_captions_from_idml(idml_path)
                    merge_captions(captions, extracted, conflicts, idml_path.name)
                print(f"  Captions merged: {len(captions)} total")
        
        if captions:
            if conflicts:
                print(f"  WARN: {len(conflicts)} caption conflicts across IDMLs (kept longest).")
            entries = build_entries_from_captions(captions)

        if not entries and config.get("canonical_json"):
            print(f"  Using canonical JSON: {config['canonical_json'].name}")
            entries = extract_figures_from_pathologie_json(config["canonical_json"])

        if not entries and config.get("figure_manifest"):
            print(f"  Using figure manifest: {config['figure_manifest'].name}")
            entries = extract_figures_from_manifest(config["figure_manifest"])
        
        if entries:
            csv_path, json_path = write_mapping_files(slug, entries, config['name'])
            all_mapping_files.extend([csv_path, json_path])
        else:
            print(f"  ⚠️  No captions found for {slug}")
    
    print("\n" + "=" * 60)
    print(f"Created {len(all_mapping_files)} mapping files")
    print("=" * 60)
    
    return all_mapping_files


if __name__ == "__main__":
    main()

