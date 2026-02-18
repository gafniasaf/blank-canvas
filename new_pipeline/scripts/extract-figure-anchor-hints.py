#!/usr/bin/env python3
"""
Extract approximate anchor hints for figure captions from IDML.
Outputs per-book JSON with "between X and Y" ranges based on nearby headings.
"""

import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional
from lxml import etree

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_ROOT = REPO_ROOT / "new_pipeline" / "output"

BOOKS = {
    "af4": {
        "name": "MBO A&F 4",
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml"],
    },
    "communicatie": {
        "name": "MBO Communicatie",
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_COMMUNICATIE_9789083251387_03_2024__FROM_DOWNLOADS.idml"],
    },
    "methodisch_werken": {
        "name": "MBO Methodisch Werken",
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_METHODISCH_WERKEN_9789083251394_03_2024__FROM_DOWNLOADS.idml"],
    },
    "persoonlijke_verzorging": {
        "name": "MBO Persoonlijke Verzorging",
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024__FROM_DOWNLOADS.idml"],
    },
    "praktijkgestuurd_klinisch_redeneren": {
        "name": "MBO Praktijkgestuurd Klinisch Redeneren",
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024__FROM_DOWNLOADS.idml"],
    },
    "wetgeving": {
        "name": "MBO Wetgeving",
        "idml_paths": [REPO_ROOT / "_source_exports" / "MBO_WETGEVING_9789083412061_03_2024__FROM_DOWNLOADS.idml"],
    },
    "pathologie": {
        "name": "MBO Pathologie N4",
        "idml_dir": REPO_ROOT / "designs-relinked" / "MBO Pathologie nivo 4_9789083412016_03",
    },
}


FIGURE_RE = re.compile(r"^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)*)\s*[:\.\s]*(.*)", re.IGNORECASE)
HEADING_RE = re.compile(r"^(\d+(?:\.\d+)+)\b")
CHAPTER_RE = re.compile(r"^(\d+)\b")


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def extract_heading_number(text: str, style: str) -> Optional[str]:
    text = normalize_whitespace(text)
    style_lower = (style or "").lower()
    match = HEADING_RE.match(text)
    if match:
        return match.group(1)
    match = CHAPTER_RE.match(text)
    if match and ("hoofdstuk" in style_lower or "chapter" in style_lower):
        return match.group(1)
    return None


def extract_paragraphs(idml_path: Path) -> list[dict]:
    paragraphs = []
    with zipfile.ZipFile(idml_path, "r") as zf:
        story_files = sorted(
            [f for f in zf.namelist() if f.startswith("Stories/Story_") and f.endswith(".xml")]
        )
        for story_file in story_files:
            with zf.open(story_file) as f:
                tree = etree.parse(f)
            for psr in tree.xpath("//ParagraphStyleRange"):
                text = normalize_whitespace("".join(psr.xpath(".//Content/text()")))
                if not text:
                    continue
                paragraphs.append(
                    {
                        "text": text,
                        "style": psr.get("AppliedParagraphStyle") or "",
                        "story": story_file,
                    }
                )
    return paragraphs


def build_anchor_hints(paragraphs: list[dict]) -> list[dict]:
    anchors = []

    heading_indices = []
    for i, p in enumerate(paragraphs):
        heading_num = extract_heading_number(p["text"], p["style"])
        if heading_num:
            heading_indices.append((i, heading_num, p["text"], p["style"]))

    for i, p in enumerate(paragraphs):
        match = FIGURE_RE.match(p["text"])
        if not match:
            continue

        fig_num = match.group(2)
        caption_text = normalize_whitespace(match.group(3))

        prev_heading = None
        next_heading = None
        for idx, num, text, style in heading_indices:
            if idx < i:
                prev_heading = {"number": num, "text": text, "style": style}
            if idx > i:
                next_heading = {"number": num, "text": text, "style": style}
                break

        before_snippet = ""
        after_snippet = ""
        for j in range(i - 1, -1, -1):
            if paragraphs[j]["text"]:
                before_snippet = paragraphs[j]["text"][:180]
                break
        for j in range(i + 1, len(paragraphs)):
            if paragraphs[j]["text"]:
                after_snippet = paragraphs[j]["text"][:180]
                break

        hint = ""
        if prev_heading and next_heading:
            hint = f"tussen {prev_heading['number']} en {next_heading['number']}"
        elif prev_heading:
            hint = f"na {prev_heading['number']}"
        elif next_heading:
            hint = f"voor {next_heading['number']}"
        else:
            hint = "onbekend"

        anchors.append(
            {
                "figureNumber": fig_num,
                "caption": caption_text,
                "anchor_hint": hint,
                "before_heading": prev_heading,
                "after_heading": next_heading,
                "before_snippet": before_snippet,
                "after_snippet": after_snippet,
                "story": p["story"],
            }
        )

    return anchors


def main():
    generated = datetime.now().isoformat(timespec="seconds")
    for slug, cfg in BOOKS.items():
        idml_paths = list(cfg.get("idml_paths", []))
        idml_dir = cfg.get("idml_dir")
        if idml_dir and idml_dir.exists():
            idml_paths.extend(sorted(idml_dir.glob("*.idml")))

        if not idml_paths:
            print(f"Skip {slug}: no IDML sources")
            continue

        all_anchors = []
        for idml_path in idml_paths:
            if not idml_path.exists():
                print(f"Skip missing IDML: {idml_path}")
                continue
            paragraphs = extract_paragraphs(idml_path)
            anchors = build_anchor_hints(paragraphs)
            all_anchors.extend(anchors)

        output_dir = OUTPUT_ROOT / slug
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{slug}_anchor_hints.json"
        out_path.write_text(
            json.dumps(
                {
                    "book": cfg["name"],
                    "slug": slug,
                    "generated_at": generated,
                    "sources": [str(p) for p in idml_paths],
                    "anchors": all_anchors,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"Wrote {out_path} ({len(all_anchors)} anchors)")


if __name__ == "__main__":
    main()

