#!/usr/bin/env python3
"""
Fail if Praktijk/Verdieping box first lines contain extreme inter-word gaps.

Why:
Prince justification can create huge spaces on short first lines like:
  "In de praktijk: Bij            een"
This check detects those cases in the generated PDF and hard-fails the pipeline.

Heuristic (deterministic):
- Extract words with positions (PyMuPDF).
- Build line clusters by y-position (robust even when gaps are huge).
- For any line containing the word 'praktijk:' or 'verdieping:', compute the maximum
  gap between adjacent words.
- Fail if max gap exceeds a threshold.

Usage:
  python3 new_pipeline/validate/verify-box-justify-gaps.py <pdf_path> \\
    [--max-gap-pt 12] [--ignore-first 2]

Dependencies:
  PyMuPDF (`fitz`)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def mm_to_pt(mm: float) -> float:
    return mm * (72.0 / 25.4)


def parse_css_vars(tokens_css_path: Path) -> Dict[str, str]:
    if not tokens_css_path.exists():
        return {}
    css = tokens_css_path.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r":root\\s*\\{([\\s\\S]*?)\\}", css, re.MULTILINE)
    if not m:
        return {}
    inner = m.group(1)
    out: Dict[str, str] = {}
    for line in inner.splitlines():
        mm = re.match(r"\\s*(--[a-zA-Z0-9_-]+)\\s*:\\s*([^;]+);", line)
        if mm:
            out[mm.group(1).strip()] = mm.group(2).strip()
    return out


def parse_len_to_pt(v: str, default_pt: float) -> float:
    if not v:
        return default_pt
    v = v.strip()
    m = re.match(r"^([0-9.]+)\\s*mm$", v)
    if m:
        return mm_to_pt(float(m.group(1)))
    m = re.match(r"^([0-9.]+)\\s*pt$", v)
    if m:
        return float(m.group(1))
    return default_pt


def cluster_lines(words: List[Tuple[float, float, float, float, str]], tol: float = 0.8):
    """
    Group words into line clusters by y0 with tolerance.
    Returns list of (y_key, words_in_line) where words_in_line are sorted by x0.
    """
    # Sort by y, then x
    words_sorted = sorted(words, key=lambda w: (w[1], w[0]))
    clusters: List[Dict] = []
    for x0, y0, x1, y1, txt in words_sorted:
        placed = False
        for c in clusters:
            if abs(y0 - c["y"]) <= tol:
                c["words"].append((x0, y0, x1, y1, txt))
                # update representative y (running average)
                c["y"] = (c["y"] * c["n"] + y0) / (c["n"] + 1)
                c["n"] += 1
                placed = True
                break
        if not placed:
            clusters.append({"y": y0, "n": 1, "words": [(x0, y0, x1, y1, txt)]})

    out = []
    for c in clusters:
        ws = sorted(c["words"], key=lambda w: w[0])
        out.append((c["y"], ws))
    # Preserve top-to-bottom order
    out.sort(key=lambda t: t[0])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=str, help="Path to PDF")
    ap.add_argument("--max-gap-pt", type=float, default=12.0, help="Max allowed inter-word gap in points")
    ap.add_argument("--ignore-first", type=int, default=2, help="Ignore first N pages")
    args = ap.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        die(f"❌ PDF not found: {pdf_path}")

    try:
        import fitz  # type: ignore
    except Exception as e:
        die(f"❌ Missing dependency PyMuPDF (fitz): {e}")

    tokens_css = Path(__file__).resolve().parent.parent / "templates" / "prince-af-two-column.tokens.css"
    vars_ = parse_css_vars(tokens_css)

    margin_top = parse_len_to_pt(vars_.get("--margin-top", ""), mm_to_pt(20))
    margin_bottom = parse_len_to_pt(vars_.get("--margin-bottom", ""), mm_to_pt(20))
    margin_inner = parse_len_to_pt(vars_.get("--margin-inner", ""), mm_to_pt(15))
    margin_outer = parse_len_to_pt(vars_.get("--margin-outer", ""), mm_to_pt(15))
    col_gap = parse_len_to_pt(vars_.get("--col-gap", ""), mm_to_pt(9))

    doc = fitz.open(str(pdf_path))
    bad = []

    for i in range(len(doc)):
        page_no = i + 1
        if page_no <= args.ignore_first:
            continue

        page = doc[i]
        rect = page.rect
        w = float(rect.width)
        h = float(rect.height)
        if w <= 0 or h <= 0:
            continue

        # Facing pages: :right is odd pages, :left is even pages.
        is_left_page = (page_no % 2 == 0)
        left_margin = margin_outer if is_left_page else margin_inner
        right_margin = margin_inner if is_left_page else margin_outer

        body_x0 = left_margin
        body_x1 = max(body_x0, w - right_margin)
        body_y0 = margin_top
        body_y1 = max(body_y0, h - margin_bottom)

        # Column boxes (two-column layout)
        body_w = max(1.0, body_x1 - body_x0)
        gap = max(0.0, min(col_gap, body_w * 0.5))
        col_w = max(1.0, (body_w - gap) / 2.0)
        left_x0 = body_x0
        left_x1 = body_x0 + col_w
        right_x0 = body_x0 + col_w + gap
        right_x1 = body_x1

        # Collect words in body area
        words_raw = page.get_text("words") or []
        # words per column (0=left, 1=right)
        words_by_col: Dict[int, List[Tuple[float, float, float, float, str]]] = {0: [], 1: []}
        for x0, y0, x1, y1, txt, *_rest in words_raw:
            t = str(txt or "").strip()
            if not t:
                continue
            # body filter
            if y1 <= body_y0 or y0 >= body_y1:
                continue
            xc = (float(x0) + float(x1)) / 2.0
            if xc < body_x0 or xc > body_x1:
                continue

            col = None
            if left_x0 <= xc <= left_x1:
                col = 0
            elif right_x0 <= xc <= right_x1:
                col = 1
            else:
                # gutter/outside; ignore
                continue

            words_by_col[col].append((float(x0), float(y0), float(x1), float(y1), t))

        # Scan each column separately to avoid false positives across the gutter
        for col, words in words_by_col.items():
            for y, ws in cluster_lines(words, tol=0.9):
                tokens = [w[4] for w in ws]
                tokens_l = [t.lower() for t in tokens]
                if "praktijk:" not in tokens_l and "verdieping:" not in tokens_l:
                    continue
                if len(ws) < 2:
                    continue
                gaps = [ws[j + 1][0] - ws[j][2] for j in range(len(ws) - 1)]
                max_gap = max(gaps) if gaps else 0.0
                if max_gap > args.max_gap_pt:
                    bad.append(
                        {
                            "page": page_no,
                            "col": col,
                            "y": round(y, 1),
                            "max_gap_pt": round(max_gap, 1),
                            "line": " ".join(tokens),
                        }
                    )

    if bad:
        print(f"❌ Box justification gap gate failed: {len(bad)} line(s) exceed max gap {args.max_gap_pt:.1f}pt", file=sys.stderr)
        print(f"   pdf: {pdf_path}", file=sys.stderr)
        for r in bad[:30]:
            col_lbl = "L" if r.get("col", 0) == 0 else "R"
            print(f"   - page {r['page']} col={col_lbl} y={r['y']}: max_gap={r['max_gap_pt']} :: {r['line']}", file=sys.stderr)
        if len(bad) > 30:
            print(f"   ... {len(bad) - 30} more", file=sys.stderr)
        raise SystemExit(2)

    print(f"✅ Box justification gap gate passed (max_gap_pt={args.max_gap_pt:.1f}, ignored first {args.ignore_first} page(s))")
    print(f"   pdf: {pdf_path}")


if __name__ == "__main__":
    main()


