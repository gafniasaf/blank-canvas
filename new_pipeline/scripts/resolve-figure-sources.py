#!/usr/bin/env python3
"""
Resolve OneDrive image source folders for each book in books/manifest.json
by matching chapter overlaps. Writes new_pipeline/config/figure_sources.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "books" / "manifest.json"
OUTPUT_ROOT = REPO_ROOT / "new_pipeline" / "output"
CONFIG_DIR = REPO_ROOT / "new_pipeline" / "config"
CONFIG_PATH = CONFIG_DIR / "figure_sources.json"
DOWNLOADS_DIR = Path("/Users/asafgafni/Downloads")


def load_manifest() -> List[dict]:
    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("books", [])


def load_output_index() -> Dict[str, dict]:
    """Map upload_id -> {slug, json_path, title} from output JSONs."""
    index: Dict[str, dict] = {}
    for json_file in OUTPUT_ROOT.rglob("*_full_rewritten.with_openers.with_figures.json"):
        try:
            with json_file.open("r", encoding="utf-8") as f:
                data = json.load(f)
            upload_id = data.get("meta", {}).get("id")
            if not upload_id:
                continue
            index[upload_id] = {
                "slug": json_file.parent.name,
                "json_path": str(json_file),
                "title": data.get("meta", {}).get("title", ""),
            }
        except Exception:
            continue
    return index


def parse_chapter_numbers(dir_path: Path) -> List[int]:
    chapters: List[int] = []
    for child in dir_path.iterdir():
        if not child.is_dir():
            continue
        if not child.name.lower().startswith("chapter"):
            continue
        m = re.search(r"(\d+)", child.name)
        if m:
            chapters.append(int(m.group(1)))
    return sorted(set(chapters))


def list_onedrive_dirs() -> List[dict]:
    onedrive_dirs: List[dict] = []
    for d in sorted(DOWNLOADS_DIR.glob("OneDrive_*")):
        if not d.is_dir():
            continue
        chapters = parse_chapter_numbers(d)
        png_count = len(list(d.rglob("*.png")))
        onedrive_dirs.append(
            {
                "path": str(d),
                "name": d.name,
                "chapters": chapters,
                "png_count": png_count,
                "mtime": d.stat().st_mtime,
            }
        )
    return onedrive_dirs


def score_overlap(book_chapters: List[int], dir_chapters: List[int]) -> Tuple[float, int]:
    if not book_chapters or not dir_chapters:
        return 0.0, 0
    book_set = set(book_chapters)
    dir_set = set(dir_chapters)
    overlap = len(book_set & dir_set)
    if overlap == 0:
        return 0.0, 0
    recall = overlap / len(book_set)
    precision = overlap / len(dir_set)
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    return f1, overlap


def resolve_sources(books: List[dict], output_index: Dict[str, dict], onedrive_dirs: List[dict]) -> dict:
    assignments: Dict[str, dict] = {}
    used_dirs: set = set()
    candidates_by_book: Dict[str, List[dict]] = {}

    # Build candidate list
    scored: List[dict] = []
    for book in books:
        upload_id = book.get("upload_id")
        output_info = output_index.get(upload_id)
        if not output_info:
            continue
        slug = output_info["slug"]
        book_chapters = book.get("chapters", [])
        book_candidates: List[dict] = []

        for od in onedrive_dirs:
            score, overlap = score_overlap(book_chapters, od["chapters"])
            if score <= 0:
                continue
            entry = {
                "book_slug": slug,
                "book_id": book.get("book_id"),
                "upload_id": upload_id,
                "onedrive_dir": od["path"],
                "onedrive_name": od["name"],
                "score": round(score, 4),
                "overlap": overlap,
                "book_chapters": book_chapters,
                "dir_chapters": od["chapters"],
                "png_count": od["png_count"],
                "mtime": od["mtime"],
            }
            book_candidates.append(entry)
            scored.append(entry)

        # Sort candidates for reporting
        book_candidates.sort(
            key=lambda x: (x["score"], x["overlap"], x["png_count"], x["mtime"]),
            reverse=True,
        )
        candidates_by_book[slug] = book_candidates[:3]

    # Greedy assignment: highest score first, avoid reusing dirs
    scored.sort(
        key=lambda x: (x["score"], x["overlap"], x["png_count"], x["mtime"]),
        reverse=True,
    )

    for entry in scored:
        slug = entry["book_slug"]
        dir_path = entry["onedrive_dir"]
        if slug in assignments:
            continue
        if dir_path in used_dirs:
            continue
        if entry["score"] < 0.6 or entry["overlap"] < 3:
            continue
        assignments[slug] = {
            "onedrive_dir": dir_path,
            "score": entry["score"],
            "overlap": entry["overlap"],
            "png_count": entry["png_count"],
            "dir_chapters": entry["dir_chapters"],
        }
        used_dirs.add(dir_path)

    # Collect unmatched
    unmatched = {}
    for book in books:
        upload_id = book.get("upload_id")
        output_info = output_index.get(upload_id)
        if not output_info:
            continue
        slug = output_info["slug"]
        if slug not in assignments:
            unmatched[slug] = {
                "book_id": book.get("book_id"),
                "candidates": candidates_by_book.get(slug, []),
            }

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sources": assignments,
        "unmatched": unmatched,
        "onedrive_dirs": onedrive_dirs,
    }


def main() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    books = load_manifest()
    output_index = load_output_index()
    onedrive_dirs = list_onedrive_dirs()

    result = resolve_sources(books, output_index, onedrive_dirs)

    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Wrote {CONFIG_PATH}")
    print(f"Assigned: {len(result['sources'])}")
    print(f"Unmatched: {len(result['unmatched'])}")

    if result["unmatched"]:
        print("Unmatched books:")
        for slug, info in result["unmatched"].items():
            print(f"  - {slug} ({info.get('book_id')})")


if __name__ == "__main__":
    main()





