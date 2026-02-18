#!/usr/bin/env python3
"""
Strict Pathologie N4 alignment from original IDML:
- Builds a skeleton JSON with block IDs and per-story ordering.
- Builds a canonical JSON using ordered blocks with full heading coverage.

Notes:
- Reading order is approximated via TextFrame positions (min_x, min_y).
- All stories are included in skeleton; canonical uses the ordered story list.
"""
from __future__ import annotations

import json
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from lxml import etree


REPO_ROOT = Path(__file__).parent.parent.parent
IDML_DIR = REPO_ROOT / "designs-relinked" / "MBO Pathologie nivo 4_9789083412016_03"
OUT_CANON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "PATHOLOGIE_N4__STRICT_CANONICAL.json"
OUT_SKELETON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "PATHOLOGIE_N4__STRICT_SKELETON.json"


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
    "_Table Header": "table_header",
    "_Tabelkop": "table_header",
}


HEADING_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)\s+(.*)$")
HEADING_ONLY_RE = re.compile(r"^(\d+(?:\.\d+)*)$")
FIGURE_RE = re.compile(r"^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)*)\s*[:\.\s]*(.*)$", re.IGNORECASE)
TABLE_CAPTION_RE = re.compile(r"^Tabel\s+(\d+(?:\.\d+)*)\b", re.IGNORECASE)


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = text.replace("\xad", "").replace("­", "").replace("\ufeff", "")
    text = " ".join(text.split())
    text = text.replace(" ,", ",").replace(" .", ".")
    return text


def get_style_type(style: str) -> str:
    if not style:
        return "body"
    style_name = style.replace("ParagraphStyle/", "")
    for pat, content_type in STYLE_MAPPING.items():
        if pat in style_name:
            return content_type
    style_lower = style_name.lower()
    if "chapter header" in style_lower:
        return "section_h1"
    if "subchapter header" in style_lower:
        return "section_h2"
    if "basis" in style_lower or "body" in style_lower or "tabel" in style_lower:
        return "body"
    if "bullet" in style_lower or "nummer" in style_lower:
        return "list_item"
    if "caption" in style_lower or "bijschrift" in style_lower:
        return "caption"
    if "voetregel" in style_lower or "inhoudsopgave" in style_lower:
        return "skip"
    return "body"


@dataclass
class StoryInfo:
    story_id: str
    story_file: str
    score: int
    min_x: float | None
    min_y: float | None
    frame_count: int


def parse_story_id(tree: etree._ElementTree) -> str | None:
    root = tree.getroot()
    story_el = root.xpath("//Story")
    if story_el:
        return story_el[0].get("Self")
    return None


def story_score(tree: etree._ElementTree) -> int:
    score = 0
    for psr in tree.xpath("//ParagraphStyleRange"):
        style = psr.get("AppliedParagraphStyle", "")
        st = get_style_type(style)
        if st in ("body", "list_item", "section_h1", "section_h2", "section_h3", "caption"):
            text = clean_text("".join(psr.xpath(".//Content/text()")))
            if text:
                score += 1
    return score


def extract_story_positions(zf: zipfile.ZipFile, story_id_by_file: dict[str, str]) -> dict[str, StoryInfo]:
    story_positions: dict[str, StoryInfo] = {}
    spread_files = [f for f in zf.namelist() if f.startswith("Spreads/Spread_") and f.endswith(".xml")]
    for spread_file in spread_files:
        with zf.open(spread_file) as f:
            tree = etree.parse(f)
        for tf in tree.xpath("//TextFrame"):
            parent_story = tf.get("ParentStory")
            if not parent_story:
                continue
            # Parse path anchors to get bbox
            anchors = tf.xpath(".//PathPointType/@Anchor")
            coords = []
            for anchor in anchors:
                parts = anchor.split()
                if len(parts) == 2:
                    try:
                        x = float(parts[0])
                        y = float(parts[1])
                        coords.append((x, y))
                    except ValueError:
                        continue
            if not coords:
                continue
            min_x = min(x for x, _ in coords)
            min_y = min(y for _, y in coords)
            # Apply item transform translation if present
            transform = tf.get("ItemTransform", "")
            tx = ty = 0.0
            if transform:
                parts = transform.split()
                if len(parts) == 6:
                    try:
                        tx = float(parts[4])
                        ty = float(parts[5])
                    except ValueError:
                        tx = ty = 0.0
            abs_x = min_x + tx
            abs_y = min_y + ty

            info = story_positions.get(parent_story)
            if not info:
                story_positions[parent_story] = StoryInfo(
                    story_id=parent_story,
                    story_file=story_id_by_file.get(parent_story, ""),
                    score=0,
                    min_x=abs_x,
                    min_y=abs_y,
                    frame_count=1,
                )
            else:
                info.frame_count += 1
                if info.min_x is None or abs_x < info.min_x:
                    info.min_x = abs_x
                if info.min_y is None or abs_y < info.min_y:
                    info.min_y = abs_y
    return story_positions


def extract_table(table_el: etree._Element) -> dict[str, Any]:
    rows = []
    for row in table_el.xpath(".//Row"):
        row_cells = []
        # Cells are referenced via Cell nodes on the table, but text is nested.
        cells = row.xpath(".//Cell") if row is not None else []
        for cell in cells:
            cell_text = clean_text("".join(cell.xpath(".//Content/text()")))
            row_cells.append(cell_text)
        if row_cells:
            rows.append(row_cells)
    if not rows:
        # Fallback: gather any cell contents in document order
        cells = table_el.xpath(".//Cell")
        for cell in cells:
            cell_text = clean_text("".join(cell.xpath(".//Content/text()")))
            rows.append([cell_text])
    return {"rows": rows}


def parse_heading(text: str) -> tuple[str | None, str, str]:
    raw = text
    match = HEADING_NUMBER_RE.match(text)
    if match:
        return match.group(1), match.group(2).strip(), raw
    match = HEADING_ONLY_RE.match(text)
    if match:
        return match.group(1), "", raw
    return None, text, raw


def extract_story_blocks(tree: etree._ElementTree, story_id: str, story_file: str, ch_num: int) -> list[dict]:
    blocks: list[dict] = []
    block_index = 0
    in_table = False

    for event, elem in etree.iterwalk(tree.getroot(), events=("start", "end")):
        tag = etree.QName(elem.tag).localname if isinstance(elem.tag, str) else elem.tag

        if event == "start" and tag == "Table":
            table_data = extract_table(elem)
            # Use last paragraph as table caption if it matches (do not remove)
            caption = None
            if blocks and blocks[-1]["type"] == "paragraph":
                if TABLE_CAPTION_RE.match(blocks[-1]["text"]):
                    caption = blocks[-1]["text"]
                    blocks[-1]["role"] = "table_caption"
            blocks.append(
                {
                    "id": f"ch{ch_num:02d}_{story_id}_tbl{block_index:04d}",
                    "type": "table",
                    "caption": caption,
                    "rows": table_data["rows"],
                    "source": {"story": story_file, "story_id": story_id},
                }
            )
            block_index += 1
            in_table = True

        if event == "end" and tag == "Table":
            in_table = False

        if event == "start" and tag == "ParagraphStyleRange" and not in_table:
            style = elem.get("AppliedParagraphStyle", "") or ""
            stype = get_style_type(style)
            if stype == "skip":
                continue
            text = clean_text("".join(elem.xpath(".//Content/text()")))
            if not text:
                continue

            block_id = f"ch{ch_num:02d}_{story_id}_p{block_index:04d}"
            block_index += 1

            if stype in ("section_h1", "section_h2", "section_h3"):
                number, title, raw_heading = parse_heading(text)
                blocks.append(
                    {
                        "id": block_id,
                        "type": "heading",
                        "level": 1 if stype == "section_h1" else (2 if stype == "section_h2" else 3),
                        "number": number,
                        "title": title,
                        "raw": raw_heading,
                        "style": style,
                        "source": {"story": story_file, "story_id": story_id},
                    }
                )
                continue

            if stype == "list_item":
                blocks.append(
                    {
                        "id": block_id,
                        "type": "list_item",
                        "text": text,
                        "style": style,
                        "source": {"story": story_file, "story_id": story_id},
                    }
                )
                continue

            if stype == "caption":
                match = FIGURE_RE.match(text)
                if match:
                    fig_num = match.group(2)
                    caption = match.group(3).strip()
                else:
                    fig_num = None
                    caption = text
                blocks.append(
                    {
                        "id": block_id,
                        "type": "figure",
                        "number": fig_num,
                        "caption": caption,
                        "raw": text,
                        "src": f"new_pipeline/assets/figures/pathologie/Afbeelding_{fig_num}.png" if fig_num else None,
                        "style": style,
                        "source": {"story": story_file, "story_id": story_id},
                    }
                )
                continue

            if stype in ("chapter_number", "chapter_title"):
                # Keep as paragraph but tagged
                blocks.append(
                    {
                        "id": block_id,
                        "type": "paragraph",
                        "text": text,
                        "style": style,
                        "role": stype,
                        "source": {"story": story_file, "story_id": story_id},
                    }
                )
                continue

            # default body paragraph
            blocks.append(
                {
                    "id": block_id,
                    "type": "paragraph",
                    "text": text,
                    "style": style,
                    "source": {"story": story_file, "story_id": story_id},
                }
            )

    return blocks


def group_list_items(blocks: list[dict]) -> list[dict]:
    grouped: list[dict] = []
    current_list: dict | None = None

    for block in blocks:
        if block["type"] == "list_item":
            if current_list is None:
                current_list = {
                    "id": block["id"] + "_list",
                    "type": "list",
                    "items": [],
                    "source": block.get("source"),
                }
            current_list["items"].append(block["text"])
        else:
            if current_list is not None:
                grouped.append(current_list)
                current_list = None
            grouped.append(block)

    if current_list is not None:
        grouped.append(current_list)

    # Convert paragraph ending with ':' into list intro when followed by list
    with_intro: list[dict] = []
    i = 0
    while i < len(grouped):
        block = grouped[i]
        if (
            block["type"] == "paragraph"
            and block.get("text", "").endswith(":")
            and i + 1 < len(grouped)
            and grouped[i + 1]["type"] == "list"
        ):
            next_list = grouped[i + 1]
            next_list["intro"] = block["text"]
            i += 1  # skip the paragraph block
        else:
            with_intro.append(block)
        i += 1

    return with_intro


def build_sections_from_blocks(blocks: list[dict]) -> list[dict]:
    sections: list[dict] = []
    current = None

    for block in blocks:
        if block["type"] == "heading":
            if current:
                sections.append(current)
            current = {
                "number": block.get("number"),
                "title": block.get("title", ""),
                "raw_title": block.get("raw", ""),
                "level": block.get("level", 1),
                "content": [],
                "source": block.get("source"),
                "id": block.get("id"),
            }
            continue
        if current is None:
            current = {
                "number": None,
                "title": "Inleiding",
                "level": 1,
                "content": [],
                "source": block.get("source"),
            }
        current["content"].append(block)

    if current:
        sections.append(current)
    return sections


def build_for_chapter(ch_num: int) -> tuple[dict, dict]:
    idml_path = IDML_DIR / f"Pathologie_mbo_CH{ch_num:02d}_03.2024.idml"
    if not idml_path.exists():
        return {}, {}

    with zipfile.ZipFile(idml_path, "r") as zf:
        story_files = [f for f in zf.namelist() if f.startswith("Stories/Story_") and f.endswith(".xml")]
        story_id_by_file: dict[str, str] = {}
        story_tree_by_id: dict[str, etree._ElementTree] = {}
        story_scores: dict[str, int] = {}

        for story_file in story_files:
            with zf.open(story_file) as f:
                tree = etree.parse(f)
            story_id = parse_story_id(tree)
            if not story_id:
                continue
            story_id_by_file[story_id] = story_file
            story_tree_by_id[story_id] = tree
            story_scores[story_id] = story_score(tree)

        story_positions = extract_story_positions(zf, story_id_by_file)

        # Build ordered story list
        story_infos: list[StoryInfo] = []
        for story_id, score in story_scores.items():
            pos = story_positions.get(story_id)
            story_infos.append(
                StoryInfo(
                    story_id=story_id,
                    story_file=story_id_by_file.get(story_id, ""),
                    score=score,
                    min_x=pos.min_x if pos else None,
                    min_y=pos.min_y if pos else None,
                    frame_count=pos.frame_count if pos else 0,
                )
            )

        # Reading order: top-to-bottom, then left-to-right
        story_infos.sort(
            key=lambda s: (
                999999 if s.min_y is None else s.min_y,
                999999 if s.min_x is None else s.min_x,
                -s.score,
            )
        )

        # Extract blocks per story
        stories_out = []
        ordered_blocks = []
        for story in story_infos:
            tree = story_tree_by_id.get(story.story_id)
            if not tree:
                continue
            blocks = extract_story_blocks(tree, story.story_id, story.story_file, ch_num)
            if not blocks:
                continue
            stories_out.append(
                {
                    "story_id": story.story_id,
                    "story_file": story.story_file,
                    "score": story.score,
                    "min_x": story.min_x,
                    "min_y": story.min_y,
                    "frame_count": story.frame_count,
                    "blocks": blocks,
                }
            )
            ordered_blocks.extend(blocks)

        # Keep list_item blocks for strict alignment; do not group into lists.
        sections = build_sections_from_blocks(ordered_blocks)

        skeleton = {
            "number": ch_num,
            "title": CHAPTER_TITLES.get(ch_num, f"Hoofdstuk {ch_num}"),
            "idml": str(idml_path),
            "stories": stories_out,
            "ordered_blocks": ordered_blocks,
        }

        canonical = {
            "number": ch_num,
            "title": CHAPTER_TITLES.get(ch_num, f"Hoofdstuk {ch_num}"),
            "sections": sections,
        }

        return skeleton, canonical


def main() -> None:
    generated_at = datetime.now().isoformat(timespec="seconds")

    skeleton = {
        "meta": {
            "title": "MBO Pathologie",
            "short_title": "Pathologie N4",
            "level": "n4",
            "isbn": "9789083412016",
            "generated_at": generated_at,
            "source": "IDML strict extraction",
            "notes": "Story order approximated by TextFrame positions (min_x, min_y).",
        },
        "chapters": [],
    }

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
            "generated_at": generated_at,
            "source": "IDML strict extraction",
            "total_chapters": 12,
        },
        "assets": {
            "figures_dir": "new_pipeline/assets/figures/pathologie/",
            "chapter_openers_dir": "new_pipeline/assets/images/pathologie_chapter_openers/",
            "covers": {
                "front": "new_pipeline/assets/covers/pathologie/front_only.png",
                "back": "new_pipeline/assets/covers/pathologie/back_only.png",
            },
        },
        "chapters": [],
    }

    for ch_num in range(1, 13):
        s, c = build_for_chapter(ch_num)
        if s:
            skeleton["chapters"].append(s)
        if c:
            canonical["chapters"].append(c)

    OUT_SKELETON.parent.mkdir(parents=True, exist_ok=True)
    OUT_CANON.parent.mkdir(parents=True, exist_ok=True)

    OUT_SKELETON.write_text(json.dumps(skeleton, indent=2, ensure_ascii=False), encoding="utf-8")
    OUT_CANON.write_text(json.dumps(canonical, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"✅ Wrote skeleton: {OUT_SKELETON}")
    print(f"✅ Wrote canonical: {OUT_CANON}")


if __name__ == "__main__":
    main()

