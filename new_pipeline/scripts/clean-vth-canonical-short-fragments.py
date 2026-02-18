#!/usr/bin/env python3
"""
Clean PDF-derived VTH canonical by merging very short body fragments
into the previous paragraph (often line-wrapped list fragments).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
INPUT = REPO / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.json"
OUTPUT = REPO / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.json"


def should_merge(text: str) -> bool:
    if not text:
        return False
    text = text.strip()
    # Merge very short fragments that look like list continuations
    if len(text) <= 12 and text[-1] in ";:,":
        return True
    # Merge tiny numeric/unit fragments like "1 ml;" or "5 mm"
    if len(text) <= 8 and re.fullmatch(r"\d+\s*(ml|mm|cm|%|mg)?;?", text, re.IGNORECASE):
        return True
    return False


def main() -> None:
    with INPUT.open("r", encoding="utf-8") as f:
        book = json.load(f)

    merged = 0

    for chapter in book.get("chapters", []):
        for section in chapter.get("sections", []):
            content = section.get("content", [])
            new_content = []
            for block in content:
                if not isinstance(block, dict):
                    new_content.append(block)
                    continue

                if (
                    block.get("type") == "paragraph"
                    and block.get("role") == "body"
                    and not block.get("images")
                ):
                    text = (block.get("text") or "").strip()
                    if should_merge(text) and new_content:
                        prev = new_content[-1]
                        if (
                            isinstance(prev, dict)
                            and prev.get("type") == "paragraph"
                            and prev.get("role") == "body"
                            and not prev.get("images")
                        ):
                            prev_text = (prev.get("text") or "").rstrip()
                            sep = "" if prev_text.endswith(" ") else " "
                            prev["text"] = prev_text + sep + text
                            merged += 1
                            continue

                new_content.append(block)

            section["content"] = new_content

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(book, f, indent=2, ensure_ascii=False)

    print(f"Saved cleaned canonical: {OUTPUT}")
    print(f"Merged short fragments: {merged}")


if __name__ == "__main__":
    main()





