#!/usr/bin/env python3
"""
Generate per-book KD mapping skeleton files from canonical IDML snapshots.

Why:
- We need a deterministic, reviewable place to decide:
  - which sections are "basis" vs "verdieping"
  - which KD workprocess codes apply
  - which reusable didactic modules to use

This script produces *skeletons* (empty mappings) that humans/agents can fill iteratively.

Inputs:
- `books/manifest.json`
- `_source_exports/*.idml` (from manifest)

Outputs:
- `docs/kd/mappings/<book_id>.mapping.json`

Usage:
  python3 scripts/generate-kd-mapping-skeleton.py
  python3 scripts/generate-kd-mapping-skeleton.py --book MBO_AF4_2024_COMMON_CORE
"""

from __future__ import annotations

import argparse
import json
import re
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "books" / "manifest.json"
OUT_DIR = REPO_ROOT / "docs" / "kd" / "mappings"

HEADER_PATTERNS = [
    "_Chapter Header",
    "_Subchapter Header",
    "paragraafkop",
    "subparagraaf",
    "hoofdstukkop",
    "hoofdstuk kop",
    "kop1",
    "kop2",
    "kop3",
    "heading",
    "h1",
    "h2",
    "h3",
    "title",
    "hoofdstuk",
]


def clean_text(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"<\?ACE\s*\d*\s*\?>", "", s, flags=re.I)
    s = s.replace("\uFFFC", "")
    s = re.sub(r"[\u0000-\u001F\u007F]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_heading_number(text: str) -> Optional[Tuple[int, int, Optional[int]]]:
    t = clean_text(text)
    m3 = re.match(r"^(\d+)\.(\d+)\.(\d+)\b", t)
    if m3:
        return (int(m3.group(1)), int(m3.group(2)), int(m3.group(3)))
    m2 = re.match(r"^(\d+)\.(\d+)\b", t)
    if m2:
        return (int(m2.group(1)), int(m2.group(2)), None)
    return None


def sort_key_str(ks: str) -> Tuple[int, int, int]:
    parts = ks.split(".")
    c = int(parts[0]) if len(parts) > 0 else 0
    p = int(parts[1]) if len(parts) > 1 else 0
    s = int(parts[2]) if len(parts) > 2 else -1
    return (c, p, s)


def strip_numbering_prefix(text: str) -> str:
    t = clean_text(text)
    t = re.sub(r"^\d+\.\d+(?:\.\d+)?\s*", "", t).strip()
    # Strip footnote-like trailing digits glued to the last word (e.g., "De cel3")
    t = re.sub(r"(?<=[A-Za-zÀ-ÿ])\d+$", "", t).strip()
    # Strip trailing page-number-like suffix (e.g., "De cel 13")
    t = re.sub(r"\s+\d{1,3}$", "", t).strip()
    return t


def is_header_style(style_name: str) -> bool:
    s = str(style_name or "").lower()
    return any(p.lower() in s for p in HEADER_PATTERNS)


def score_candidate(text: str, style_name: str) -> Tuple[int, int]:
    """
    Higher score is better. Second value is length (shorter preferred on tie).
    """
    t = clean_text(text)
    s = 0

    if is_header_style(style_name):
        s += 100

    nums = re.findall(r"\d+\.\d+(?:\.\d+)?", t)
    if len(nums) == 1:
        s += 50
    elif len(nums) > 1:
        # TOC-like / concatenated headings often contain multiple numbering tokens.
        s -= 80 * (len(nums) - 1)

    # Penalize if the "title" part still contains another numbering token.
    title_part = re.sub(r"^\d+\.\d+(?:\.\d+)?\s*", "", t).strip()
    if re.search(r"\d+\.\d+", title_part):
        s -= 120

    # Prefer shorter strings (real headings are short).
    L = len(t)
    if L <= 80:
        s += 20
    elif L <= 140:
        s += 10
    else:
        s -= (L - 140) // 5

    # Mild penalty for page-number-like suffix
    if re.search(r"\s\d{1,3}$", t):
        s -= 10

    return s, L


def extract_numbered_headings_from_idml(idml_path: Path) -> Dict[str, str]:
    """
    Returns map key_str -> best full heading text (e.g. "1.2.3 De cel").
    We may see the same numbering key multiple times (TOC, running headers, etc.),
    so we pick the best candidate using a heuristic score.
    """
    candidates: Dict[str, List[Tuple[str, str]]] = {}  # key -> [(text, style_name)]
    with zipfile.ZipFile(str(idml_path), "r") as z:
        story_files = [n for n in z.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        if not story_files:
            raise RuntimeError("No Stories/*.xml found in IDML")

        para_range_re = re.compile(
            r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="([^"]*)"[^>]*>([\s\S]*?)</ParagraphStyleRange>',
            re.I,
        )
        content_re = re.compile(r"<Content>([\s\S]*?)</Content>", re.I)

        for story_name in story_files:
            xml = z.read(story_name).decode("utf-8", errors="ignore")
            for m in para_range_re.finditer(xml):
                raw_style = m.group(1) or ""
                style_name = raw_style.replace("ParagraphStyle/", "").replace("%20", " ")
                inner = m.group(2) or ""
                text = ""
                for cm in content_re.finditer(inner):
                    text += cm.group(1) or ""
                text = clean_text(text)
                if not text:
                    continue
                num = parse_heading_number(text)
                if not num:
                    continue
                ch, para, sub = num
                if para <= 0:
                    continue
                key = f"{ch}.{para}" if sub is None else f"{ch}.{para}.{sub}"
                candidates.setdefault(key, []).append((text, style_name))

    key_to_best: Dict[str, str] = {}
    for key, cands in candidates.items():
        best = None
        best_score = None
        for text, style_name in cands:
            sc = score_candidate(text, style_name)
            if best is None or best_score is None or sc > best_score:
                best = text
                best_score = sc
        if best:
            key_to_best[key] = best

    return key_to_best


def build_mapping(book_id: str, idml_path: Path) -> Dict[str, object]:
    key_to_text = extract_numbered_headings_from_idml(idml_path)
    keys = sorted(key_to_text.keys(), key=sort_key_str)

    entries: List[Dict[str, object]] = []
    for k in keys:
        parts = k.split(".")
        ch = int(parts[0])
        pn = int(parts[1])
        sub = int(parts[2]) if len(parts) > 2 else None
        kind = "subparagraph" if sub is not None else "paragraph"
        full = key_to_text[k]
        title = strip_numbering_prefix(full)
        entries.append(
            {
                "key": k,
                "kind": kind,
                "chapter": ch,
                "paragraph": pn,
                "subparagraph": sub,
                "title": title,
                "source_heading_text": full,
                "difficulty": "unknown",
                "kd_workprocesses": [],
                "modules": [],
                "notes": ""
            }
        )

    return {
        "version": 1,
        "book_id": book_id,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": {
            "idml_path": str(idml_path),
            "note": "Skeleton generated from numbered headings in canonical IDML snapshot."
        },
        "entries": entries,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default="", help="Optional book_id to generate only one mapping")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
    books = manifest.get("books") or []

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    generated = 0
    for b in books:
        book_id = str(b.get("book_id") or "").strip()
        if not book_id:
            continue
        if args.book and args.book != book_id:
            continue
        idml_rel = str(b.get("canonical_n4_idml_path") or "").strip()
        if not idml_rel:
            continue
        idml_path = (REPO_ROOT / idml_rel).resolve()
        if not idml_path.exists():
            print(f"⚠️  skipping {book_id}: IDML not found at {idml_path}")
            continue

        mapping = build_mapping(book_id, idml_path)
        out_path = OUT_DIR / f"{book_id}.mapping.json"
        out_path.write_text(json.dumps(mapping, indent=2, ensure_ascii=False), "utf-8")
        print(f"✅ wrote {out_path}")
        generated += 1

    if generated == 0:
        raise SystemExit("No mappings generated (check --book or manifest).")


if __name__ == "__main__":
    main()


