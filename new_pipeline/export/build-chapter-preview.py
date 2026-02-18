#!/usr/bin/env python3
"""
Build a deterministic "chapter preview" JSON for fast human review.

Why this exists:
- Starting TypeScript runners can sometimes be slow / look stuck with no output.
- This Python version starts fast and prints progress for dopamine-friendly monitoring.

What it does:
- Slice a canonical Prince JSON down to a single chapter, and optionally up to a section number
  (useful for "first half of chapter" previews).
- Apply a tiny deterministic "flow polish" pass:
  - Split overlong text blocks by inserting blank lines "\\n\\n" at sentence boundaries
  - Fix trailing colons that look like list-intros when no list follows (":" -> ".")

Usage:
  python3 -u new_pipeline/export/build-chapter-preview.py <input.json> \
    --out <out.json> --chapter 1 --until-section 1.2 \
    --max-words 80 --target-words 55 --min-words 35 \
    --progress-every 10 --status-file <status.txt>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


MICRO_RE = re.compile(r"<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>", re.UNICODE)
BOLD_RE = re.compile(r"<<BOLD_START>>|<<BOLD_END>>")
MICRO_SPLIT_RE = re.compile(r"(<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>)", re.UNICODE)


def norm_ws(s: str) -> str:
    return str(s or "").replace("\r", "\n")


def parse_num_parts(s: str) -> List[int]:
    parts: List[int] = []
    for p in str(s or "").strip().split("."):
        if not p:
            continue
        try:
            parts.append(int(p, 10))
        except Exception:
            pass
    return parts


def cmp_num_parts(a: List[int], b: List[int]) -> int:
    n = max(len(a), len(b))
    for i in range(n):
        av = a[i] if i < len(a) else 0
        bv = b[i] if i < len(b) else 0
        if av < bv:
            return -1
        if av > bv:
            return 1
    return 0


def word_count(s: str) -> int:
    t = norm_ws(s)
    t = BOLD_RE.sub("", t)
    t = MICRO_RE.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return 0
    return len(t.split(" "))


def cut_index_after_n_words(s: str, n: int) -> int:
    # Returns a character index just after the nth non-whitespace token.
    if n <= 0:
        return 0
    it = re.finditer(r"\S+", s)
    count = 0
    for m in it:
        count += 1
        if count >= n:
            return m.end()
    return len(s)


def split_long_segment(seg: str, max_words: int, target_words: int, min_words: int) -> List[str]:
    s = norm_ws(seg).strip()
    if not s:
        return []
    out: List[str] = []

    boundary_re = re.compile(r"([.!?])\s+")
    while word_count(s) > max_words:
        candidates: List[Tuple[int, int]] = []  # (score, cut_idx)
        for m in boundary_re.finditer(s):
            cut_idx = m.start(1) + 1  # include punctuation
            before = s[:cut_idx]
            wc = word_count(before)
            if wc < min_words or wc > max_words:
                continue
            score = abs(wc - target_words) * 10 + (max_words - wc)  # close to target; slightly prefer longer
            candidates.append((score, cut_idx))

        if candidates:
            candidates.sort(key=lambda x: x[0])
            cut_idx = candidates[0][1]
        else:
            cut_idx = cut_index_after_n_words(s, max_words)
            if cut_idx <= 0 or cut_idx >= len(s):
                # Safety: avoid infinite loop
                break

        before = s[:cut_idx].strip()
        if before:
            out.append(before)
        s = s[cut_idx:].strip()

        # Safety: if we didn't make progress, stop
        if not s:
            break

    if s:
        out.append(s)
    return out


def flow_polish_basis(raw: str, max_words: int, target_words: int, min_words: int) -> Tuple[str, int]:
    """
    Split long text while preserving micro-title markers as atomic tokens.
    Returns (new_basis, splits_inserted_count).
    """
    s = norm_ws(raw)
    tokens = [t for t in MICRO_SPLIT_RE.split(s) if t != ""]

    out_parts: List[str] = []
    splits = 0
    for tok in tokens:
        if tok.startswith("<<MICRO_TITLE>>"):
            out_parts.append(tok.strip())
            continue
        parts = split_long_segment(tok, max_words=max_words, target_words=target_words, min_words=min_words)
        if len(parts) > 1:
            splits += (len(parts) - 1)
        out_parts.extend([p.strip() for p in parts if p.strip()])

    # Join with blank lines to create separate blocks for the renderer.
    out = "\n\n".join(out_parts)
    out = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", out).strip()
    return out, splits


def is_semicolon_list_paragraph(block: Dict[str, Any]) -> bool:
    if str(block.get("type", "")) != "paragraph":
        return False
    hint = str(block.get("styleHint", "") or "").lower()
    if "bullets" not in hint and "bullet" not in hint and "numbered" not in hint:
        return False
    raw = str(block.get("basis", "") or "")
    if ";" not in raw:
        return False
    items = [x.strip() for x in raw.split(";") if x.strip()]
    return len(items) >= 2


def iter_paragraph_blocks(chapter_obj: Dict[str, Any]) -> List[Tuple[Dict[str, Any], Optional[Dict[str, Any]]]]:
    """
    Returns list of (block, next_block) for paragraph blocks in reading order within the chapter.
    """
    pairs: List[Tuple[Dict[str, Any], Optional[Dict[str, Any]]]] = []
    for sec in chapter_obj.get("sections", []) or []:
        for sp in sec.get("content", []) or []:
            if sp.get("type") != "subparagraph":
                continue
            content = sp.get("content", []) or []
            for i, b in enumerate(content):
                if not isinstance(b, dict):
                    continue
                if b.get("type") != "paragraph":
                    continue
                nxt = content[i + 1] if i + 1 < len(content) and isinstance(content[i + 1], dict) else None
                pairs.append((b, nxt))
    return pairs


def write_status(status_file: Optional[Path], text: str) -> None:
    if not status_file:
        return
    try:
        status_file.parent.mkdir(parents=True, exist_ok=True)
        status_file.write_text(text, encoding="utf-8")
    except Exception:
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input_json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--chapter", required=True)
    ap.add_argument("--until-section", default="")
    ap.add_argument("--max-words", type=int, default=80)
    ap.add_argument("--target-words", type=int, default=55)
    ap.add_argument("--min-words", type=int, default=35)
    ap.add_argument("--progress-every", type=int, default=10)
    ap.add_argument("--status-file", default="")
    args = ap.parse_args()

    in_path = Path(args.input_json).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    status_file = Path(args.status_file).expanduser().resolve() if args.status_file else None

    chapter = str(args.chapter).strip()
    until = str(args.until_section).strip()
    until_parts = parse_num_parts(until) if until else None

    max_words = max(30, int(args.max_words))
    target_words = max(20, int(args.target_words))
    min_words = max(15, int(args.min_words))
    progress_every = max(1, int(args.progress_every))

    t0 = time.time()
    write_status(status_file, f"Starting preview build...\ninput: {in_path}\n")
    print(f"📘 input: {in_path}")

    book = json.loads(in_path.read_text(encoding="utf-8"))
    ch = None
    for c in book.get("chapters", []) or []:
        if str(c.get("number", "")).strip() == chapter:
            ch = c
            break
    if not ch:
        raise SystemExit(f"Chapter not found: {chapter}")

    # Deep copy chapter (JSON-safe)
    ch_out = json.loads(json.dumps(ch))

    if until_parts is not None:
        secs = []
        for s in ch_out.get("sections", []) or []:
            s_num = str(s.get("number", "")).strip()
            if not s_num:
                continue
            if cmp_num_parts(parse_num_parts(s_num), until_parts) <= 0:
                secs.append(s)
        ch_out["sections"] = secs

    pairs = iter_paragraph_blocks(ch_out)
    total = len(pairs)

    stats = {"touched": 0, "splits": 0, "colons": 0}
    for idx, (b, nxt) in enumerate(pairs, start=1):
        basis = str(b.get("basis", "") or "")
        if not basis.strip():
            continue

        # Fix trailing colon if no list follows
        trimmed = basis.strip()
        if trimmed.endswith(":"):
            next_is_list = False
            if isinstance(nxt, dict):
                if nxt.get("type") in ("list", "steps"):
                    next_is_list = True
                elif is_semicolon_list_paragraph(nxt):
                    next_is_list = True
            if not next_is_list:
                basis = re.sub(r":\s*$", ".", trimmed) + "\n"
                stats["colons"] += 1

        polished, splits = flow_polish_basis(basis, max_words=max_words, target_words=target_words, min_words=min_words)
        if polished != str(b.get("basis", "")):
            stats["touched"] += 1
        stats["splits"] += splits
        b["basis"] = polished

        if idx % progress_every == 0 or idx == total:
            elapsed = time.time() - t0
            msg = f"progress {idx}/{total} | touched={stats['touched']} splits={stats['splits']} colons={stats['colons']} | {elapsed:.1f}s"
            print(msg)
            write_status(status_file, msg + "\n")

    out_book = dict(book)
    out_book["chapters"] = [ch_out]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_book, ensure_ascii=False, indent=2), encoding="utf-8")

    elapsed = time.time() - t0
    done_msg = (
        f"✅ preview built in {elapsed:.1f}s\n"
        f"out: {out_path}\n"
        f"stats: touched={stats['touched']} splits={stats['splits']} colons={stats['colons']}\n"
    )
    print(done_msg.strip())
    write_status(status_file, done_msg)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise
    except Exception as e:
        print(f"❌ build-chapter-preview.py failed: {e}", file=sys.stderr)
        sys.exit(1)
































