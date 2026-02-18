#!/usr/bin/env python3
"""
Scan all MBO books declared in `books/manifest.json` and produce a deterministic inventory + overlap report.

Primary goals (fast, deterministic):
- Extract chapter/paragraph/subparagraph headings from each book's canonical IDML snapshot in `_source_exports/`.
- Summarize per-book structure (chapters, headings count, top topic tokens).
- Compute pairwise overlap metrics across books (Jaccard over top tokens; shared heading titles).

Outputs (written under `output/reports/`):
- `mbo_books_inventory.json`
- `mbo_books_overlap.csv`
- `mbo_books_shared_headings.csv`

Usage:
  python3 scripts/scan-mbo-books.py
"""

from __future__ import annotations

import csv
import json
import os
import re
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "books" / "manifest.json"


@dataclass(frozen=True)
class ParaKey:
    chapter: int
    paragraph: int
    subparagraph: Optional[int]

    def to_str(self) -> str:
        if self.subparagraph is None:
            return f"{self.chapter}.{self.paragraph}"
        return f"{self.chapter}.{self.paragraph}.{self.subparagraph}"


def clean_text(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"<\?ACE\s*\d*\s*\?>", "", s, flags=re.I)
    s = s.replace("\uFFFC", "")
    s = re.sub(r"[\u0000-\u001F\u007F]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_heading_number(text: str) -> Optional[ParaKey]:
    t = clean_text(text)
    m3 = re.match(r"^(\d+)\.(\d+)\.(\d+)\b", t)
    if m3:
        return ParaKey(int(m3.group(1)), int(m3.group(2)), int(m3.group(3)))
    m2 = re.match(r"^(\d+)\.(\d+)\b", t)
    if m2:
        return ParaKey(int(m2.group(1)), int(m2.group(2)), None)
    return None


def extract_heading_keys_from_idml(idml_path: Path) -> Dict[str, str]:
    """
    Deterministic extraction of numbered headings (1.1 / 1.1.1 / ...) from all Stories/*.xml in an IDML zip.
    Returns map: key_str -> representative header_text
    """
    with zipfile.ZipFile(str(idml_path), "r") as z:
        story_files = [n for n in z.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        if not story_files:
            raise RuntimeError("No Stories/*.xml found in IDML")

        para_range_re = re.compile(
            r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="([^"]*)"[^>]*>([\s\S]*?)</ParagraphStyleRange>',
            re.I,
        )
        content_re = re.compile(r"<Content>([\s\S]*?)</Content>", re.I)

        key_to_text: Dict[str, str] = {}
        for story_name in story_files:
            xml = z.read(story_name).decode("utf-8", errors="ignore")
            for m in para_range_re.finditer(xml):
                inner = m.group(2) or ""
                text = ""
                for cm in content_re.finditer(inner):
                    text += cm.group(1) or ""
                text = clean_text(text)
                if not text:
                    continue
                k = parse_heading_number(text)
                if not k or k.paragraph <= 0:
                    continue
                ks = k.to_str()
                if ks not in key_to_text:
                    key_to_text[ks] = text
    return key_to_text


def sort_key_str(ks: str) -> Tuple[int, int, int]:
    parts = ks.split(".")
    c = int(parts[0]) if len(parts) > 0 else 0
    p = int(parts[1]) if len(parts) > 1 else 0
    s = int(parts[2]) if len(parts) > 2 else -1
    return (c, p, s)


_STOP = {
    # NL stopwords (minimal, deterministic)
    "de",
    "het",
    "een",
    "en",
    "van",
    "voor",
    "in",
    "op",
    "met",
    "naar",
    "bij",
    "tot",
    "als",
    "zijn",
    "is",
    "worden",
    "door",
    "over",
    "uit",
    "te",
    "of",
    "dat",
    "die",
    "dit",
    "dus",
    "je",
    "jouw",
    "we",
    "wij",
}


def tokenize_heading(text: str) -> List[str]:
    # Strip leading numbering (e.g. "1.2.3 ")
    t = clean_text(text)
    t = re.sub(r"^\d+\.\d+(?:\.\d+)?\s*", "", t)
    t = t.lower()
    t = re.sub(r"[^a-z0-9à-ÿ]+", " ", t, flags=re.I)
    toks = [x for x in t.split() if x and x not in _STOP and len(x) >= 3]
    return toks


def main() -> None:
    out_dir = REPO_ROOT / "output" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
    books = manifest.get("books") or []

    inventory: List[Dict[str, object]] = []
    per_book_tokens: Dict[str, List[str]] = {}
    per_book_heading_titles: Dict[str, List[str]] = {}

    for b in books:
        book_id = str(b.get("book_id") or "").strip()
        idml_rel = str(b.get("canonical_n4_idml_path") or "").strip()
        if not book_id or not idml_rel:
            continue
        idml_path = (REPO_ROOT / idml_rel).resolve()
        exists = idml_path.exists()

        entry: Dict[str, object] = {
            "book_id": book_id,
            "idml_path": str(idml_path),
            "idml_exists": bool(exists),
            "chapters_declared": b.get("chapters") or [],
        }

        if not exists:
            inventory.append(entry)
            continue

        t0 = time.time()
        key_to_text = extract_heading_keys_from_idml(idml_path)
        elapsed = time.time() - t0

        ordered_keys = sorted(key_to_text.keys(), key=sort_key_str)
        chapters = sorted({int(k.split(".")[0]) for k in ordered_keys if "." in k})
        entry.update(
            {
                "headings_total": len(ordered_keys),
                "chapters_found": chapters,
                "chapters_found_count": len(chapters),
                "extract_seconds": round(elapsed, 3),
            }
        )

        # Collect heading titles (without numbering) and tokens
        titles: List[str] = []
        toks: List[str] = []
        for ks in ordered_keys:
            txt = key_to_text[ks]
            titles.append(clean_text(txt))
            toks.extend(tokenize_heading(txt))

        # Top tokens
        from collections import Counter

        c = Counter(toks)
        top = [w for w, _n in c.most_common(60)]
        entry["top_tokens"] = top[:40]

        per_book_tokens[book_id] = top
        per_book_heading_titles[book_id] = titles
        inventory.append(entry)

    # Write inventory
    inv_path = out_dir / "mbo_books_inventory.json"
    inv_path.write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "books": inventory}, indent=2), "utf-8")

    # Overlap matrix (Jaccard over top tokens)
    book_ids = [e["book_id"] for e in inventory if e.get("idml_exists")]  # type: ignore
    book_ids = [str(x) for x in book_ids]

    overlap_path = out_dir / "mbo_books_overlap.csv"
    with overlap_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["book_a", "book_b", "jaccard_top_tokens", "shared_top_tokens"])
        for i in range(len(book_ids)):
            for j in range(i + 1, len(book_ids)):
                a = book_ids[i]
                b = book_ids[j]
                sa = set(per_book_tokens.get(a, [])[:60])
                sb = set(per_book_tokens.get(b, [])[:60])
                inter = sa & sb
                uni = sa | sb
                jac = (len(inter) / len(uni)) if uni else 0.0
                w.writerow([a, b, f"{jac:.3f}", "|".join(sorted(inter)[:30])])

    # Shared identical headings (exact text match)
    shared_path = out_dir / "mbo_books_shared_headings.csv"
    with shared_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["heading_text", "books_count", "books"])

        # build inverted index
        inv: Dict[str, List[str]] = {}
        for bid, titles in per_book_heading_titles.items():
            for t in titles:
                inv.setdefault(t, [])
                if bid not in inv[t]:
                    inv[t].append(bid)

        # emit only headings shared by >=2 books (and not just generic ones)
        for t, bids in sorted(inv.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            if len(bids) < 2:
                continue
            # skip overly generic headings
            low = t.lower()
            if re.match(r"^\d+\.\d+(\.\d+)?\s*inleiding\b", low):
                continue
            w.writerow([t, len(bids), "|".join(sorted(bids))])

    print("✅ Multi-book scan complete")
    print(f"- inventory: {inv_path}")
    print(f"- overlap:   {overlap_path}")
    print(f"- shared:    {shared_path}")


if __name__ == "__main__":
    main()
































