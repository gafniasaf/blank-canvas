#!/usr/bin/env python3
"""
Fail if the PDF contains pages that are "too empty" (e.g. ~50% filled).

This is a layout QA gate to catch cases where content is pushed to the next page
and we end up with a large blank area.

Heuristic (deterministic, no image diff):
- For each page, compute the bottom-most y of *any* content blocks (text, images).
- Compare it to the page height. If the "used height" is below a threshold, flag.

Why not pixel-based?
- Pixel-based "whiteness" is slower and brittle with backgrounds/tints.

Usage:
  python3 new_pipeline/validate/verify-page-fill.py <pdf_path> [--min-used 0.60] [--ignore-first N]
  python3 new_pipeline/validate/verify-page-fill.py <pdf_path> [--ignore-before-level1]
  python3 new_pipeline/validate/verify-page-fill.py <pdf_path> [--ignore-before-first-chapter]

Defaults:
  --min-used 0.60     (page must have content reaching at least 60% of page height)
  --ignore-first 2    (ignore cover/TOC pages; tune as needed)

Dependencies:
  PyMuPDF (`fitz`) must be installed (already used by scan-hyphenation.py).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=str, help="Path to PDF")
    ap.add_argument("--min-used", type=float, default=0.60, help="Min used-height ratio (0..1)")
    ap.add_argument("--ignore-first", type=int, default=2, help="Ignore first N pages")
    ap.add_argument("--ignore-last", type=int, default=0, help="Ignore last N pages (useful for end-of-book)")
    ap.add_argument(
        "--ignore-before-level1",
        action="store_true",
        help="Ignore the page immediately before each level-1 PDF bookmark (chapter start). Useful for whole-book runs where the last page of a chapter can be naturally short.",
    )
    ap.add_argument(
        "--ignore-before-first-chapter",
        action="store_true",
        help="Ignore ALL pages before the first level-1 PDF bookmark that looks like a numbered chapter (e.g. '1. ...'). Useful when frontmatter exists (voorwoord/colofon) and shouldn't be gated for page-fill/column-balance.",
    )
    args = ap.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        die(f"❌ PDF not found: {pdf_path}")

    try:
        import fitz  # type: ignore
    except Exception as e:
        die(f"❌ Missing dependency PyMuPDF (fitz): {e}")

    if args.min_used <= 0 or args.min_used > 1:
        die("❌ --min-used must be in (0, 1].")

    # Read our layout metrics from the generated token CSS so we can ignore
    # running headers/footers and measure fill within the actual content area.
    def mm_to_pt(mm: float) -> float:
        return mm * (72.0 / 25.4)

    def parse_css_vars(tokens_css_path: Path) -> dict:
        import re

        if not tokens_css_path.exists():
            return {}

        css = tokens_css_path.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r":root\s*\{([\s\S]*?)\}", css, re.MULTILINE)
        if not m:
            return {}
        inner = m.group(1)
        out = {}
        for line in inner.splitlines():
            mm = re.match(r"\s*(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);", line)
            if not mm:
                continue
            out[mm.group(1).strip()] = mm.group(2).strip()
        return out

    def parse_len_to_pt(v: str, default_pt: float) -> float:
        import re

        if not v:
            return default_pt
        v = v.strip()
        m = re.match(r"^([0-9.]+)\s*mm$", v)
        if m:
            return mm_to_pt(float(m.group(1)))
        m = re.match(r"^([0-9.]+)\s*pt$", v)
        if m:
            return float(m.group(1))
        return default_pt

    tokens_css = Path(__file__).resolve().parent.parent / "templates" / "prince-af-two-column.tokens.css"
    vars_ = parse_css_vars(tokens_css)

    margin_top = parse_len_to_pt(vars_.get("--margin-top", ""), mm_to_pt(20))
    margin_bottom = parse_len_to_pt(vars_.get("--margin-bottom", ""), mm_to_pt(20))
    margin_inner = parse_len_to_pt(vars_.get("--margin-inner", ""), mm_to_pt(15))
    margin_outer = parse_len_to_pt(vars_.get("--margin-outer", ""), mm_to_pt(15))

    doc = fitz.open(str(pdf_path))
    bad = []

    import re

    ignore_pages = set()
    if args.ignore_before_first_chapter:
        try:
            toc = doc.get_toc() or []  # [level, title, page]
            first_chapter_page = None
            for lvl, title, page in toc:
                if int(lvl) != 1:
                    continue
                t = str(title or "").strip()
                if re.match(r"^[0-9]+\.", t):
                    first_chapter_page = int(page)
                    break
            if first_chapter_page and first_chapter_page > 1:
                for p in range(1, first_chapter_page):
                    ignore_pages.add(p)
        except Exception:
            # ignore; fall back to ignore-first only
            pass
    if args.ignore_before_level1:
        try:
            toc = doc.get_toc() or []  # [level, title, page]
            for lvl, _title, page in toc:
                if int(lvl) != 1:
                    continue
                p = int(page)
                if p > 1:
                    ignore_pages.add(p - 1)
        except Exception:
            ignore_pages = set()

    total_pages = len(doc)
    for i in range(total_pages):
        page_no = i + 1
        if page_no <= args.ignore_first:
            continue
        if args.ignore_last and page_no > (total_pages - args.ignore_last):
            continue
        if page_no in ignore_pages:
            continue

        page = doc[i]
        rect = page.rect
        page_w = float(rect.width) if rect else 0.0
        page_h = float(rect.height) if rect else 0.0
        if page_w <= 0 or page_h <= 0:
            continue

        # Facing pages: :right is odd pages, :left is even pages.
        is_left_page = (page_no % 2 == 0)
        left_margin = margin_outer if is_left_page else margin_inner
        right_margin = margin_inner if is_left_page else margin_outer

        body_x0 = left_margin
        body_x1 = max(body_x0, page_w - right_margin)
        body_y0 = margin_top
        body_y1 = max(body_y0, page_h - margin_bottom)

        body_h = max(1.0, body_y1 - body_y0)

        def in_body(x0: float, y0: float, x1: float, y1: float) -> bool:
            # A loose intersection check; avoids counting running header/footer.
            if y1 <= body_y0 or y0 >= body_y1:
                return False
            xc = (x0 + x1) / 2.0
            return body_x0 <= xc <= body_x1

        # get_text("blocks") returns: x0,y0,x1,y1,"text",block_no,block_type
        blocks = page.get_text("blocks") or []
        y_max = body_y0

        for b in blocks:
            if not b or len(b) < 5:
                continue
            x0, y0, x1, y1 = map(float, b[:4])
            txt = (b[4] or "").strip()
            if not txt:
                continue
            bw = max(0.0, x1 - x0)
            bh = max(0.0, y1 - y0)
            if bw * bh < 200:
                continue
            if not in_body(x0, y0, x1, y1):
                continue
            y_max = max(y_max, min(y1, body_y1))

        # Include images in "used height"
        for img in page.get_images(full=True) or []:
            xref = img[0]
            for r in page.get_image_rects(xref):
                x0, y0, x1, y1 = float(r.x0), float(r.y0), float(r.x1), float(r.y1)
                if not in_body(x0, y0, x1, y1):
                    continue
                y_max = max(y_max, min(y1, body_y1))

        used_ratio = (y_max - body_y0) / body_h if body_h else 1.0

        if used_ratio < args.min_used:
            bad.append(
                {
                    "page": page_no,
                    "used_ratio": round(used_ratio, 3),
                    "y_max": round(y_max, 1),
                    "body_y0": round(body_y0, 1),
                    "body_y1": round(body_y1, 1),
                }
            )

    if bad:
        print(f"❌ Page fill gate failed: {len(bad)} page(s) below used-height ratio {args.min_used:.2f}", file=sys.stderr)
        print(f"   pdf: {pdf_path}", file=sys.stderr)
        for r in bad[:20]:
            print(
                f"   - page {r['page']}: used={r['used_ratio']} (y_max={r['y_max']} in body [{r['body_y0']}..{r['body_y1']}])",
                file=sys.stderr,
            )
        if len(bad) > 20:
            print(f"   ... {len(bad) - 20} more", file=sys.stderr)
        raise SystemExit(2)

    print(f"✅ Page fill gate passed (min-used={args.min_used:.2f}, ignored first {args.ignore_first} page(s))")
    print(f"   pdf: {pdf_path}")


if __name__ == "__main__":
    main()


