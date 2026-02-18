#!/usr/bin/env python3
"""
Extract figure captions from IDML by scanning Fotobijschrift paragraph styles.

Usage:
  python3 extract-idml-captions.py --idml /path/to/book.idml --out /path/to/captions.json
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path


FOTOBIJSCHRIFT_PATTERN = re.compile(
    r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/•Fotobijschrift(?!_credit)[^"]*"[^>]*>(.*?)</ParagraphStyleRange>',
    re.DOTALL,
)
PARAGRAPH_STYLE_PATTERN = re.compile(
    r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/([^"]+)"[^>]*>(.*?)</ParagraphStyleRange>',
    re.DOTALL,
)
CONTENT_PATTERN = re.compile(r"<Content>([^<]*)</Content>")
FIG_PATTERN = re.compile(r"(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)\s*(.*)")


def normalize_caption(text: str) -> str:
    cleaned = text.replace("\u00ad", "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def extract_captions(idml_path: Path) -> dict:
    captions: dict = {}
    with zipfile.ZipFile(idml_path, "r") as zf:
        story_files = [n for n in zf.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        for name in story_files:
            content = zf.read(name).decode("utf-8", errors="ignore")
            matches = FOTOBIJSCHRIFT_PATTERN.findall(content)
            for match in matches:
                contents = CONTENT_PATTERN.findall(match)
                full_text = "".join(contents).strip()
                fig_match = FIG_PATTERN.match(full_text)
                if not fig_match:
                    continue
                fig_num = fig_match.group(1)
                caption = normalize_caption(fig_match.group(2))
                if caption and fig_num not in captions:
                    captions[fig_num] = caption

            # Fallback: scan all paragraphs that start with "Afbeelding/Figuur"
            para_matches = PARAGRAPH_STYLE_PATTERN.findall(content)
            for style_name, match in para_matches:
                style_lower = style_name.lower()
                if "credit" in style_lower:
                    continue
                if not any(token in style_lower for token in ("fotobijschrift", "bijschrift", "annotation", "caption")):
                    continue
                contents = CONTENT_PATTERN.findall(match)
                full_text = "".join(contents).strip()
                fig_match = FIG_PATTERN.match(full_text)
                if not fig_match:
                    continue
                fig_num = fig_match.group(1)
                caption = normalize_caption(fig_match.group(2))
                if caption and fig_num not in captions:
                    captions[fig_num] = caption
    return captions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idml", required=True, help="Path to IDML file")
    parser.add_argument("--out", required=True, help="Path to output captions JSON")
    args = parser.parse_args()

    idml_path = Path(args.idml)
    out_path = Path(args.out)
    if not idml_path.exists():
        raise SystemExit(f"IDML not found: {idml_path}")

    captions = extract_captions(idml_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(captions, f, indent=2, ensure_ascii=False)

    print(f"Wrote {out_path}")
    print(f"Captions: {len(captions)}")


if __name__ == "__main__":
    main()

