#!/usr/bin/env python3
"""
Fail if a bullet list appears to split across columns leaving a single bullet item
in one column and the rest in the other.

Why:
- It's visually ugly and reads like a layout mistake.
- Common failure mode in two-column layouts: one orphan bullet at bottom of left column,
  remaining bullets at top of right column.

Heuristic:
- Use token CSS margins + column gap to compute the two body column rectangles.
- Find text lines that start with '•' (bullet glyph).
- Count bullets per column.
- Flag pages where:
  - both columns contain bullet lines, AND
  - min(count_left, count_right) == 1 AND max(count_left, count_right) >= 3, AND
  - the single bullet is near the bottom of its column and the other column's bullets are near the top
    (suggesting a continuation across the column break).

Usage:
  python3 new_pipeline/validate/verify-bullet-orphan-split.py <pdf_path>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def die(msg: str, code: int = 2) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def mm_to_pt(mm: float) -> float:
    return mm * (72.0 / 25.4)


def parse_css_vars(tokens_css_path: Path) -> dict:
    import re as _re

    if not tokens_css_path.exists():
        return {}
    css = tokens_css_path.read_text(encoding="utf-8", errors="ignore")
    m = _re.search(r":root\s*\{([\s\S]*?)\}", css, _re.MULTILINE)
    if not m:
        return {}
    inner = m.group(1)
    out = {}
    for line in inner.splitlines():
        mm = _re.match(r"\s*(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);", line)
        if not mm:
            continue
        out[mm.group(1).strip()] = mm.group(2).strip()
    return out


def parse_len_to_pt(v: str, default_pt: float) -> float:
    import re as _re

    if not v:
        return default_pt
    v = v.strip()
    m = _re.match(r"^([0-9.]+)\s*mm$", v)
    if m:
        return mm_to_pt(float(m.group(1)))
    m = _re.match(r"^([0-9.]+)\s*pt$", v)
    if m:
        return float(m.group(1))
    return default_pt


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=str, help="Path to PDF")
    ap.add_argument("--ignore-first", type=int, default=0, help="Ignore first N pages")
    ap.add_argument("--ignore-last", type=int, default=0, help="Ignore last N pages")
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
        body_h = max(1.0, body_y1 - body_y0)

        gap = max(0.0, min(col_gap, body_w * 0.5))
        col_w = max(1.0, (body_w - gap) / 2.0)

        left_x0 = body_x0
        left_x1 = body_x0 + col_w
        right_x0 = body_x0 + col_w + gap
        right_x1 = body_x1

        d = page.get_text("dict") or {}
        blocks = d.get("blocks") or []

        left_ys = []
        right_ys = []

        for b in blocks:
            for ln in (b.get("lines") or []):
                bbox = ln.get("bbox") or None
                spans = ln.get("spans") or []
                if not bbox or len(bbox) < 4:
                    continue
                x0, y0, x1, y1 = map(float, bbox[:4])
                if y1 <= body_y0 or y0 >= body_y1:
                    continue
                # Combine text from spans
                txt = "".join([str(sp.get("text") or "") for sp in spans]).strip()
                if not txt:
                    continue
                if not txt.lstrip().startswith("•"):
                    continue
                xc = (x0 + x1) / 2.0
                yc = (y0 + y1) / 2.0
                if left_x0 <= xc <= left_x1:
                    left_ys.append(yc)
                elif right_x0 <= xc <= right_x1:
                    right_ys.append(yc)

        lc = len(left_ys)
        rc = len(right_ys)
        if lc == 0 or rc == 0:
            continue

        small = min(lc, rc)
        big = max(lc, rc)
        if not (small == 1 and big >= 3):
            continue

        # Continuation shape: singleton near bottom, other column bullets near top
        left_max = max(left_ys) if left_ys else body_y0
        right_min = min(right_ys) if right_ys else body_y1

        # Normalize to body ratios
        left_max_r = (left_max - body_y0) / body_h
        right_min_r = (right_min - body_y0) / body_h

        # If the singleton is on the left, expect it near bottom; right bullets near top.
        # If singleton is on the right, expect right near bottom; left near top.
        if lc == 1:
            singleton_bottom = left_max_r
            other_top = right_min_r
            singleton_col = "left"
        else:
            singleton_bottom = (max(right_ys) - body_y0) / body_h
            other_top = (min(left_ys) - body_y0) / body_h
            singleton_col = "right"

        if singleton_bottom >= 0.65 and other_top <= 0.40:
            bad.append(
                {
                    "page": page_no,
                    "left_bullets": lc,
                    "right_bullets": rc,
                    "singleton_col": singleton_col,
                    "singleton_bottom_ratio": round(singleton_bottom, 3),
                    "other_top_ratio": round(other_top, 3),
                }
            )

    if bad:
        lines = [
            "❌ Bullet list orphan split across columns detected.",
            f"   pdf: {pdf_path}",
            "   rule: one column has exactly 1 bullet line and the other has >=3, and it looks like a continuation across the column break.",
        ]
        for r in bad[:30]:
            lines.append(
                f"   - page {r['page']}: left={r['left_bullets']} right={r['right_bullets']} singleton={r['singleton_col']} "
                f"singleton_bottom={r['singleton_bottom_ratio']} other_top={r['other_top_ratio']}"
            )
        if len(bad) > 30:
            lines.append(f"   ... {len(bad) - 30} more")
        die("\n".join(lines))

    print("✅ No bullet orphan splits across columns detected")
    print(f"   pdf: {pdf_path}")


if __name__ == "__main__":
    main()
































