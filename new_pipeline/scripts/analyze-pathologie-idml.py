#!/usr/bin/env python3
"""
Analyze how closely the Pathologie N4 canonical JSON aligns with the original IDMLs.
Outputs coverage stats for body text, list items, headings, and figures.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from lxml import etree


REPO_ROOT = Path(__file__).parent.parent.parent
IDML_DIR = REPO_ROOT / "designs-relinked" / "MBO Pathologie nivo 4_9789083412016_03"
DEFAULT_CANON_PATH = (
    REPO_ROOT
    / "new_pipeline"
    / "output"
    / "_canonical_jsons_all"
    / "PATHOLOGIE_N4__PERFECT_CANONICAL.json"
)


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


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = text.replace("\xad", "").replace("­", "").replace("\ufeff", "")
    text = " ".join(text.split())
    text = text.replace(" ,", ",").replace(" .", ".")
    return text


def normalize(text: str) -> str:
    text = text.lower()
    chars: list[str] = []
    for ch in text:
        if ch.isalnum():
            chars.append(ch)
        else:
            chars.append(" ")
    return " ".join("".join(chars).split())


def extract_fig_number(text: str) -> str | None:
    match = re.match(r"^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)*)", text, re.IGNORECASE)
    if match:
        return match.group(2)
    return None


def load_canonical(canon_path: Path):
    with canon_path.open("r", encoding="utf-8") as f:
        canon = json.load(f)
    canon_paras = set()
    canon_list_items = set()
    canon_titles = set()
    canon_figs = set()
    for ch in canon.get("chapters", []):
        for sec in ch.get("sections", []):
            title = sec.get("title") or ""
            raw_title = sec.get("raw_title") or ""
            if title:
                canon_titles.add(normalize(title))
                number = sec.get("number")
                if number:
                    canon_titles.add(normalize(f"{number} {title}"))
            if raw_title:
                canon_titles.add(normalize(raw_title))
            for block in sec.get("content", []):
                if block.get("type") == "paragraph":
                    canon_paras.add(normalize(block.get("text", "")))
                elif block.get("type") == "list":
                    for item in block.get("items", []):
                        canon_list_items.add(normalize(item))
                elif block.get("type") == "list_item":
                    canon_list_items.add(normalize(block.get("text", "")))
                elif block.get("type") == "figure":
                    num = block.get("number")
                    if num:
                        canon_figs.add(num)
    return canon, canon_paras, canon_list_items, canon_titles, canon_figs


def analyze_idml():
    idml_stats = defaultdict(Counter)
    all_body: list[str] = []
    all_list: list[str] = []
    all_titles: list[str] = []
    all_figs: set[str] = set()

    for ch_num in range(1, 13):
        idml_path = IDML_DIR / f"Pathologie_mbo_CH{ch_num:02d}_03.2024.idml"
        if not idml_path.exists():
            continue
        with zipfile.ZipFile(idml_path, "r") as zf:
            for story_file in [f for f in zf.namelist() if f.startswith("Stories/Story_") and f.endswith(".xml")]:
                with zf.open(story_file) as f:
                    tree = etree.parse(f)
                    for psr in tree.xpath("//ParagraphStyleRange"):
                        style = psr.get("AppliedParagraphStyle", "")
                        st = get_style_type(style)
                        if st == "skip":
                            continue
                        text_parts = []
                        for content_el in psr.xpath(".//Content"):
                            if content_el.text:
                                text_parts.append(content_el.text)
                        text = clean_text(" ".join(text_parts))
                        if not text:
                            continue
                        idml_stats[ch_num][st] += 1
                        if st == "body":
                            all_body.append(text)
                        elif st == "list_item":
                            all_list.append(text)
                        elif st in ("section_h1", "section_h2", "section_h3"):
                            all_titles.append(text)
                        elif st == "caption":
                            fig_num = extract_fig_number(text)
                            if fig_num:
                                all_figs.add(fig_num)

    return idml_stats, all_body, all_list, all_titles, all_figs


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze Pathologie IDML vs canonical coverage.")
    parser.add_argument(
        "--canonical",
        type=str,
        default=str(DEFAULT_CANON_PATH),
        help="Path to canonical JSON to compare against.",
    )
    args = parser.parse_args()
    canon_path = Path(args.canonical)
    canon, canon_paras, canon_list_items, canon_titles, canon_figs = load_canonical(canon_path)
    idml_stats, all_body, all_list, all_titles, all_figs = analyze_idml()

    body_norm = [normalize(t) for t in all_body]
    list_norm = [normalize(t) for t in all_list]
    title_norm = [normalize(t) for t in all_titles]

    body_total = len(body_norm)
    list_total = len(list_norm)
    title_total = len(title_norm)

    body_matched = sum(1 for t in body_norm if t in canon_paras)
    list_matched = sum(1 for t in list_norm if t in canon_list_items)
    title_matched = sum(1 for t in title_norm if t in canon_titles)

    missing_in_canon = sorted(all_figs - canon_figs)[:20]
    extra_in_canon = sorted(canon_figs - all_figs)[:20]

    print("=== IDML vs Canonical Coverage (normalized exact matches) ===")
    print(f"Canonical: {canon_path}")
    print(f"Body paragraphs: {body_matched}/{body_total} matched ({body_matched/body_total*100:.1f}%)")
    print(f"List items:      {list_matched}/{list_total} matched ({list_matched/list_total*100:.1f}%)")
    print(f"Headings:        {title_matched}/{title_total} matched ({title_matched/title_total*100:.1f}%)")
    print()

    print("=== Figure counts ===")
    print(f"IDML figure captions found: {len(all_figs)}")
    print(f"Canonical figures:          {len(canon_figs)}")
    print(f"Missing in canonical (sample 20): {missing_in_canon}")
    print(f"Extra in canonical (sample 20):   {extra_in_canon}")
    print()

    print("=== Per-chapter style counts (IDML) ===")
    for ch_num in range(1, 13):
        if ch_num in idml_stats:
            c = idml_stats[ch_num]
            print(
                f"Ch{ch_num:02d}: body={c['body']}, list={c['list_item']}, "
                f"h1={c['section_h1']}, h2={c['section_h2']}, "
                f"h3={c['section_h3']}, caption={c['caption']}"
            )

    unnumbered = sum(
        1 for ch in canon.get("chapters", []) for sec in ch.get("sections", []) if not sec.get("number")
    )
    print()
    print(f"Canonical sections without number: {unnumbered}")


if __name__ == "__main__":
    main()

