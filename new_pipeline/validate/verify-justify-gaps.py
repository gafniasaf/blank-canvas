#!/usr/bin/env python3
"""
Fail if body text contains extreme inter-word gaps caused by justification.

Why:
- In justified text, short lines can end up with huge spaces ("uitgesmeerde regels").
- InDesign's composer tends to avoid extreme gaps via better line-breaking + hyphenation;
  Prince can still produce outliers depending on content.

Heuristic (deterministic):
- Extract words + positions (PyMuPDF).
- Group words into lines (by block/line ids from get_text("words")).
- For each line that spans most of the column width (likely justified),
  compute max gap between adjacent words (skipping the bullet/step marker gap when present).
- Fail if max gap exceeds a threshold.

Usage:
  python3 new_pipeline/validate/verify-justify-gaps.py <pdf_path> \\
    [--max-gap-pt 18] [--min-span-ratio 0.85] [--ignore-first 2] [--ignore-last 1]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple


def die(msg: str, code: int = 2) -> None:
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=str, help="Path to PDF")
    ap.add_argument("--max-gap-pt", type=float, default=18.0, help="Max allowed inter-word gap in points")
    ap.add_argument("--min-span-ratio", type=float, default=0.85, help="Line must span this ratio of column width to be checked")
    ap.add_argument("--ignore-first", type=int, default=2, help="Ignore first N pages")
    ap.add_argument("--ignore-last", type=int, default=1, help="Ignore last N pages")
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

    def is_marker_token(t: str) -> bool:
        tt = (t or "").strip()
        if tt in ("•", "-", "–", "—"):
            return True
        # step number marker (e.g., "1", "2")
        if tt.isdigit():
            return True
        return False

    for i in range(len(doc)):
        page_no = i + 1
        if page_no <= args.ignore_first:
            continue
        if args.ignore_last and page_no > (len(doc) - args.ignore_last):
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

        body_w = max(1.0, body_x1 - body_x0)
        gap = max(0.0, min(col_gap, body_w * 0.5))
        col_w = max(1.0, (body_w - gap) / 2.0)

        left_x0 = body_x0
        left_x1 = body_x0 + col_w
        right_x0 = body_x0 + col_w + gap
        right_x1 = body_x1

        # words: x0,y0,x1,y1,word,block_no,line_no,word_no
        words_raw = page.get_text("words") or []
        # col -> (block,line) -> [word tuples]
        lines_by_col: Dict[int, Dict[Tuple[int, int], List[Tuple[float, float, float, float, str]]]] = {0: {}, 1: {}}

        for x0, y0, x1, y1, txt, bno, lno, _wno in words_raw:
            t = str(txt or "").strip()
            if not t:
                continue
            # body filter
            if float(y1) <= body_y0 or float(y0) >= body_y1:
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
                continue

            key = (int(bno), int(lno))
            lines_by_col[col].setdefault(key, []).append((float(x0), float(y0), float(x1), float(y1), t))

        for col, m in lines_by_col.items():
            for key, ws in m.items():
                if len(ws) < 2:
                    continue
                ws = sorted(ws, key=lambda r: r[0])
                tokens = [r[4] for r in ws]

                # Determine how much of the column width the line spans.
                line_span = (ws[-1][2] - ws[0][0]) if ws else 0.0
                span_ratio = (line_span / col_w) if col_w else 0.0
                if span_ratio < float(args.min_span_ratio):
                    continue

                # Compute gaps (optionally skip marker gap)
                start_idx = 1 if tokens and is_marker_token(tokens[0]) else 0
                gaps = []
                for j in range(start_idx, len(ws) - 1):
                    g = ws[j + 1][0] - ws[j][2]
                    if g > 0:
                        gaps.append(g)
                if not gaps:
                    continue

                max_gap = max(gaps)
                if max_gap > float(args.max_gap_pt):
                    line_txt = " ".join(tokens)
                    bad.append(
                        {
                            "page": page_no,
                            "col": col,
                            "max_gap_pt": round(max_gap, 1),
                            "span_ratio": round(span_ratio, 3),
                            "line": line_txt[:200],
                        }
                    )

    if bad:
        print(f"❌ Justify gap gate failed: {len(bad)} line(s) exceed max gap {args.max_gap_pt:.1f}pt", file=sys.stderr)
        print(f"   pdf: {pdf_path}", file=sys.stderr)
        print(f"   rule: line span >= {args.min_span_ratio:.2f} of column width, max inter-word gap > {args.max_gap_pt:.1f}pt", file=sys.stderr)
        for r in bad[:30]:
            col_lbl = "L" if r.get("col", 0) == 0 else "R"
            print(
                f"   - page {r['page']} col={col_lbl} span={r['span_ratio']} max_gap={r['max_gap_pt']} :: {r['line']}",
                file=sys.stderr,
            )
        if len(bad) > 30:
            print(f"   ... {len(bad) - 30} more", file=sys.stderr)
        raise SystemExit(2)

    print(f"✅ Justify gap gate passed (max_gap_pt={args.max_gap_pt:.1f}, min_span_ratio={args.min_span_ratio:.2f})")
    print(f"   pdf: {pdf_path}")


if __name__ == "__main__":
    main()
































