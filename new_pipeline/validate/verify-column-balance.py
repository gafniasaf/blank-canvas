#!/usr/bin/env python3
"""
Detect pages where a two-column layout is effectively using only one column,
causing large "half-page white" areas (typically the right column is empty).

This is a *layout QA* gate, not a Prince error log check.

Heuristic (deterministic):
- Use PyMuPDF text blocks (no pixel rendering).
- Split the page at mid-x.
- Measure **column utilization** inside the real body columns:
  - bottom reach (max Y) is not enough (a single line at the bottom can look "95% used").
  - we use vertical coverage (union of block y-intervals) + optional block count.
- Flag pages where one column is significantly under-utilized compared to the other.

Usage:
  python3 new_pipeline/validate/verify-column-balance.py <pdf_path> [--ignore-first N]
  python3 new_pipeline/validate/verify-column-balance.py <pdf_path> [--ignore-before-level1]
  python3 new_pipeline/validate/verify-column-balance.py <pdf_path> [--ignore-before-first-chapter]

Defaults are conservative; tune as we learn which pages are legitimately single-column.
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
    ap.add_argument("--ignore-first", type=int, default=2, help="Ignore first N pages")
    ap.add_argument("--ignore-last", type=int, default=0, help="Ignore last N pages (useful for end-of-book)")
    ap.add_argument(
        "--ignore-before-level1",
        action="store_true",
        help="Ignore the page immediately before each level-1 PDF bookmark (chapter start). Useful for whole-book runs where the last page of a chapter can be naturally sparse/one-column.",
    )
    ap.add_argument(
        "--ignore-before-first-chapter",
        action="store_true",
        help="Ignore ALL pages before the first level-1 PDF bookmark that looks like a numbered chapter (e.g. '1. ...'). Useful when frontmatter exists and shouldn't be gated for column-balance.",
    )
    ap.add_argument("--min-full-coverage", type=float, default=0.65, help="Min vertical coverage for the 'full' column (0..1)")
    ap.add_argument("--max-sparse-coverage", type=float, default=0.40, help="Max vertical coverage for the 'sparse' column (0..1)")
    ap.add_argument("--min-coverage-diff", type=float, default=0.25, help="Min coverage gap between columns to flag imbalance (0..1)")
    ap.add_argument("--min-full-blocks", type=int, default=4, help="Min text blocks in the fuller column to avoid false positives")
    args = ap.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        die(f"❌ PDF not found: {pdf_path}")

    try:
        import fitz  # type: ignore
    except Exception as e:
        die(f"❌ Missing dependency PyMuPDF (fitz): {e}")

    # Read our layout metrics from the generated token CSS so we can ignore
    # running headers/footers and measure balance within the actual columns.
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
    col_gap = parse_len_to_pt(vars_.get("--col-gap", ""), mm_to_pt(9))

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

        # Column rects (2-column layout)
        gap = max(0.0, min(col_gap, body_w * 0.5))
        col_w = max(1.0, (body_w - gap) / 2.0)

        left_x0 = body_x0
        left_x1 = body_x0 + col_w
        right_x0 = body_x0 + col_w + gap
        right_x1 = body_x1

        blocks = page.get_text("blocks") or []

        left_blocks = 0
        right_blocks = 0
        left_intervals = []
        right_intervals = []

        for b in blocks:
            if not b or len(b) < 5:
                continue
            x0, y0, x1, y1 = map(float, b[:4])
            txt = (b[4] or "").strip()
            if not txt:
                continue
            bw = max(0.0, x1 - x0)
            bh = max(0.0, y1 - y0)
            # ignore tiny noise blocks
            if bw * bh < 200:
                continue
            # ignore running header/footer (outside body)
            if y1 <= body_y0 or y0 >= body_y1:
                continue
            # ignore spanning blocks (e.g., full-width headings) so they don't mask imbalance
            if bw > col_w * 1.10:
                continue

            xc = (x0 + x1) / 2.0
            if left_x0 <= xc <= left_x1:
                left_blocks += 1
                left_intervals.append((max(body_y0, y0), min(body_y1, y1)))
            elif right_x0 <= xc <= right_x1:
                right_blocks += 1
                right_intervals.append((max(body_y0, y0), min(body_y1, y1)))
            else:
                # gutter/outside: ignore
                continue

        def union_len(intervals):
            ints = [(a, b) for (a, b) in intervals if b > a]
            if not ints:
                return 0.0
            ints.sort()
            total = 0.0
            cur_a, cur_b = ints[0]
            for a, b in ints[1:]:
                if a <= cur_b:
                    cur_b = max(cur_b, b)
                else:
                    total += (cur_b - cur_a)
                    cur_a, cur_b = a, b
            total += (cur_b - cur_a)
            return total

        left_cov = union_len(left_intervals) / body_h if body_h else 1.0
        right_cov = union_len(right_intervals) / body_h if body_h else 1.0
        left_cov = max(0.0, min(1.0, left_cov))
        right_cov = max(0.0, min(1.0, right_cov))

        # If a column contains an image, don't treat it as "empty" (images occupy the column area).
        left_has_image = False
        right_has_image = False
        for img in page.get_images(full=True) or []:
            xref = img[0]
            for r in page.get_image_rects(xref):
                x0, y0, x1, y1 = float(r.x0), float(r.y0), float(r.x1), float(r.y1)
                if y1 <= body_y0 or y0 >= body_y1:
                    continue
                # Intersects left column?
                if x1 > left_x0 and x0 < left_x1:
                    left_has_image = True
                # Intersects right column?
                if x1 > right_x0 and x0 < right_x1:
                    right_has_image = True
            if left_has_image and right_has_image:
                break

        # Decide which side is "full" vs "sparse"
        if left_cov >= right_cov:
            full_side = "left"
            full_cov, sparse_cov = left_cov, right_cov
            full_blocks, sparse_blocks = left_blocks, right_blocks
            sparse_has_image = right_has_image
        else:
            full_side = "right"
            full_cov, sparse_cov = right_cov, left_cov
            full_blocks, sparse_blocks = right_blocks, left_blocks
            sparse_has_image = left_has_image

        if (
            full_cov >= args.min_full_coverage
            and full_blocks >= args.min_full_blocks
            and sparse_cov <= args.max_sparse_coverage
            and (full_cov - sparse_cov) >= args.min_coverage_diff
            and not sparse_has_image
        ):
            bad.append(
                {
                    "page": page_no,
                    "full_side": full_side,
                    "left_blocks": left_blocks,
                    "right_blocks": right_blocks,
                    "left_coverage": round(left_cov, 3),
                    "right_coverage": round(right_cov, 3),
                }
            )

    if bad:
        print(f"❌ Column balance gate failed: {len(bad)} page(s) with a severely under-utilized column.", file=sys.stderr)
        print(f"   pdf: {pdf_path}", file=sys.stderr)
        print(
            f"   rule: full_coverage >= {args.min_full_coverage:.2f} and sparse_coverage <= {args.max_sparse_coverage:.2f} and diff >= {args.min_coverage_diff:.2f}",
            file=sys.stderr,
        )
        for r in bad[:30]:
            print(
                f"   - page {r['page']}: left_cov={r['left_coverage']} right_cov={r['right_coverage']} left_blocks={r['left_blocks']} right_blocks={r['right_blocks']} full_side={r['full_side']}",
                file=sys.stderr,
            )
        if len(bad) > 30:
            print(f"   ... {len(bad) - 30} more", file=sys.stderr)
        raise SystemExit(2)

    print("✅ Column balance gate passed (no empty-right-column pages detected)")
    print(f"   pdf: {pdf_path}")


if __name__ == "__main__":
    main()


