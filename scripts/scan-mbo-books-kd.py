#!/usr/bin/env python3
"""
KD-projection scan across all MBO books in `books/manifest.json`.

Goal:
- For each book (IDML snapshot), estimate which KD 2025 workprocesses it is *likely* aligned with
  by searching for KD keyword signals in the book's text.

Important:
- This is NOT a validated KD coverage mapping.
- It is a deterministic *signal scan* to guide restructuring and human mapping work.

Inputs:
- `books/manifest.json` (book list + canonical IDML snapshot paths)
- `_source_exports/*.idml` (IDML snapshots)
- `docs/kd/kd_2025_workprocesses_detailed.json` (keywords/explanations/examples; user-provided)

Outputs (written under `output/reports/`):
- `mbo_books_kd_projection.json`
- `mbo_books_kd_projection.csv`

Usage:
  python3 scripts/scan-mbo-books-kd.py
"""

from __future__ import annotations

import csv
import html
import json
import re
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "books" / "manifest.json"
KD_DETAILED_PATH = REPO_ROOT / "docs" / "kd" / "kd_2025_workprocesses_detailed.json"


def clean_text(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"<\?ACE\s*\d*\s*\?>", "", s, flags=re.I)
    s = s.replace("\uFFFC", "")
    s = re.sub(r"[\u0000-\u001F\u007F]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_for_search(s: str) -> str:
    # Normalize for keyword matching: lowercase, normalize punctuation, collapse whitespace.
    t = clean_text(s)
    t = t.replace("’", "'").replace("`", "'")
    t = t.lower()
    # keep letters/digits and a few separators; everything else -> space
    t = re.sub(r"[^0-9a-zà-ÿ]+", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def keyword_to_regex(kw: str) -> re.Pattern:
    """
    Create a safe regex that matches a keyword/phrase as whole words.
    """
    k = normalize_for_search(kw)
    if not k:
        return re.compile(r"^$a")  # never matches
    parts = k.split()
    if len(parts) == 1:
        return re.compile(rf"\b{re.escape(parts[0])}\b", flags=re.I)
    # multi-word phrase: allow flexible whitespace
    inner = r"\s+".join(re.escape(p) for p in parts)
    return re.compile(rf"\b{inner}\b", flags=re.I)


def extract_plain_text_from_idml(idml_path: Path) -> str:
    """
    Extract all <Content>...</Content> strings from all Stories/*.xml in the IDML zip.
    Deterministic and fast.
    """
    chunks: List[str] = []
    with zipfile.ZipFile(str(idml_path), "r") as z:
        story_files = [n for n in z.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        if not story_files:
            raise RuntimeError("No Stories/*.xml found in IDML")

        content_re = re.compile(r"<Content>([\s\S]*?)</Content>", re.I)
        for story_name in story_files:
            xml = z.read(story_name).decode("utf-8", errors="ignore")
            for m in content_re.finditer(xml):
                raw = m.group(1) or ""
                chunks.append(html.unescape(raw))

    return clean_text(" ".join(chunks))


def main() -> None:
    out_dir = REPO_ROOT / "output" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
    books = manifest.get("books") or []

    kd = json.loads(KD_DETAILED_PATH.read_text("utf-8"))
    kd_items = kd.get("workprocesses") or []

    compiled_kd: List[Dict[str, Any]] = []
    for wp in kd_items:
        kws = wp.get("keywords") or []
        compiled_kd.append(
            {
                "code": wp.get("code"),
                "title": wp.get("title"),
                "kerntaak_code": wp.get("kerntaak_code"),
                "kerntaak_title": wp.get("kerntaak_title"),
                "kd_part": wp.get("kd_part"),
                "track": wp.get("track"),
                "levels": wp.get("levels") or [],
                "keywords": kws,
                "kw_res": [(k, keyword_to_regex(k)) for k in kws if str(k).strip()],
            }
        )

    results: List[Dict[str, Any]] = []
    rows: List[List[str]] = []

    for b in books:
        book_id = str(b.get("book_id") or "").strip()
        idml_rel = str(b.get("canonical_n4_idml_path") or "").strip()
        if not book_id or not idml_rel:
            continue
        idml_path = (REPO_ROOT / idml_rel).resolve()

        entry: Dict[str, Any] = {
            "book_id": book_id,
            "idml_path": str(idml_path),
            "idml_exists": idml_path.exists(),
        }

        if not idml_path.exists():
            results.append(entry)
            continue

        t0 = time.time()
        text = extract_plain_text_from_idml(idml_path)
        norm = normalize_for_search(text)
        entry["text_chars"] = len(text)
        entry["extract_seconds"] = round(time.time() - t0, 3)

        per_wp: List[Dict[str, Any]] = []
        for wp in compiled_kd:
            found: List[str] = []
            for kw, rx in wp["kw_res"]:
                if rx.search(norm):
                    found.append(str(kw))

            item = {
                "code": wp["code"],
                "title": wp["title"],
                "kerntaak_code": wp["kerntaak_code"],
                "kerntaak_title": wp["kerntaak_title"],
                "kd_part": wp["kd_part"],
                "track": wp["track"],
                "levels": wp["levels"],
                "keywords_total": len(wp["kw_res"]),
                "keywords_found": found,
                "hit_count": len(found),
                "hit_ratio": round((len(found) / len(wp["kw_res"])) if wp["kw_res"] else 0.0, 3),
            }
            per_wp.append(item)

            rows.append(
                [
                    book_id,
                    str(item["code"]),
                    str(item["kd_part"]),
                    str(item["track"]),
                    "|".join(str(x) for x in item["levels"]),
                    str(item["hit_count"]),
                    str(item["keywords_total"]),
                    str(item["hit_ratio"]),
                    "|".join(item["keywords_found"][:30]),
                ]
            )

        per_wp.sort(key=lambda x: (-int(x["hit_count"]), str(x["code"])))
        entry["top_workprocesses"] = per_wp[:8]
        entry["workprocesses"] = per_wp
        results.append(entry)

    out_json = out_dir / "mbo_books_kd_projection.json"
    out_json.write_text(
        json.dumps(
            {
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "notes": [
                    "Deterministic keyword-based signal scan (not a validated KD coverage mapping).",
                    "Keywords come from docs/kd/kd_2025_workprocesses_detailed.json (user-provided summaries).",
                ],
                "books": results,
            },
            indent=2,
            ensure_ascii=False,
        ),
        "utf-8",
    )

    out_csv = out_dir / "mbo_books_kd_projection.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "book_id",
                "workprocess_code",
                "kd_part",
                "track",
                "levels",
                "hit_count",
                "keywords_total",
                "hit_ratio",
                "keywords_found_sample",
            ]
        )
        w.writerows(rows)

    print("✅ KD projection scan complete")
    print(f"- {out_json}")
    print(f"- {out_csv}")


if __name__ == "__main__":
    main()
































