#!/usr/bin/env python3
"""
Generate a deterministic layout report (JSON + TSV) for a Prince-rendered PDF.

This is "report mode": it does NOT fail the build by default, but it can compute
the same metrics used by our layout gates (page fill + column balance).

Why:
- Track layout regressions over time
- Provide exact page numbers + metrics for review

Usage:
  python3 new_pipeline/validate/report-layout.py <pdf_path> \\
    --out-json <out.json> --out-tsv <out.tsv> \\
    [--min-used 0.60] [--ignore-first 2]

Dependencies:
  PyMuPDF (`fitz`)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=str, help="Path to PDF")
    ap.add_argument("--out-json", type=str, required=True, help="Output JSON path")
    ap.add_argument("--out-tsv", type=str, required=True, help="Output TSV path")
    ap.add_argument("--min-used", type=float, default=0.60, help="Used-height threshold (same as page-fill gate)")
    ap.add_argument("--ignore-first", type=int, default=2, help="Ignore first N pages for gate-style summaries")
    ap.add_argument("--min-full-coverage", type=float, default=0.65, help="Column-balance gate: min vertical coverage for fuller column")
    ap.add_argument("--max-sparse-coverage", type=float, default=0.40, help="Column-balance gate: max vertical coverage for sparse column")
    ap.add_argument("--min-coverage-diff", type=float, default=0.25, help="Column-balance gate: min coverage gap between columns")
    ap.add_argument("--min-full-blocks", type=int, default=4, help="Column-balance gate: min text blocks in fuller column")
    args = ap.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        raise SystemExit(f"❌ PDF not found: {pdf_path}")

    try:
        import fitz  # type: ignore
    except Exception as e:
        raise SystemExit(f"❌ Missing dependency PyMuPDF (fitz): {e}")

    # Parse page geometry from token CSS so report matches our gates (ignore headers/footers, compute columns).
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

    pages: List[Dict[str, Any]] = []
    pagefill_fail: List[int] = []
    colbalance_fail: List[int] = []

    for i in range(len(doc)):
        page_no = i + 1
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

        blocks = page.get_text("blocks") or []
        left_blocks = 0
        right_blocks = 0
        left_ymax = body_y0
        right_ymax = body_y0
        left_intervals = []
        right_intervals = []
        left_area_sum = 0.0
        right_area_sum = 0.0
        y_max_any = body_y0

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
            # Ignore header/footer outside body
            if y1 <= body_y0 or y0 >= body_y1:
                continue

            # Measure overall used height (include wide blocks too)
            y_max_any = max(y_max_any, min(y1, body_y1))

            # For column metrics, ignore spanning blocks (e.g., full-width headings)
            if bw > col_w * 1.10:
                continue

            xc = (x0 + x1) / 2.0
            if left_x0 <= xc <= left_x1:
                left_blocks += 1
                left_ymax = max(left_ymax, min(y1, body_y1))
                left_intervals.append((max(body_y0, y0), min(body_y1, y1)))
                left_area_sum += bw * bh
            elif right_x0 <= xc <= right_x1:
                right_blocks += 1
                right_ymax = max(right_ymax, min(y1, body_y1))
                right_intervals.append((max(body_y0, y0), min(body_y1, y1)))
                right_area_sum += bw * bh

        # Include images in "used height" and balance context (helps distinguish real blank from image-filled)
        images = page.get_images(full=True)
        img_rects = []
        img_ymax = 0.0
        img_left = False
        img_right = False
        for img in images:
            xref = img[0]
            for r in page.get_image_rects(xref):
                img_rects.append([float(r.x0), float(r.y0), float(r.x1), float(r.y1)])
                # ignore header/footer outside body
                if float(r.y1) <= body_y0 or float(r.y0) >= body_y1:
                    continue
                img_ymax = max(img_ymax, min(float(r.y1), body_y1))
                y_max_any = max(y_max_any, min(float(r.y1), body_y1))

                # Determine which side(s) the image occupies (based on intersection)
                if float(r.x0) < left_x1 and float(r.x1) > left_x0:
                    img_left = True
                if float(r.x0) < right_x1 and float(r.x1) > right_x0:
                    img_right = True

        used_ratio = (y_max_any - body_y0) / body_h if body_h else 1.0
        left_bottom = (left_ymax - body_y0) / body_h if body_h else 1.0
        right_bottom = (right_ymax - body_y0) / body_h if body_h else 1.0

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

        left_coverage = union_len(left_intervals) / body_h if body_h else 1.0
        right_coverage = union_len(right_intervals) / body_h if body_h else 1.0
        col_area = max(1.0, col_w * body_h)
        left_area_ratio = left_area_sum / col_area
        right_area_ratio = right_area_sum / col_area

        # Clamp to [0, 1] for stable reporting
        used_ratio = max(0.0, min(1.0, used_ratio))
        left_bottom = max(0.0, min(1.0, left_bottom))
        right_bottom = max(0.0, min(1.0, right_bottom))
        left_coverage = max(0.0, min(1.0, left_coverage))
        right_coverage = max(0.0, min(1.0, right_coverage))
        left_area_ratio = max(0.0, min(1.0, left_area_ratio))
        right_area_ratio = max(0.0, min(1.0, right_area_ratio))

        # Gate-style flags (for reporting)
        ignore = page_no <= args.ignore_first
        pagefill_ok = True if ignore else (used_ratio >= args.min_used)
        colbalance_ok = True
        if not ignore:
            # Under-utilized column check based on coverage (matches verify-column-balance.py intent)
            if left_coverage >= right_coverage:
                full_cov, sparse_cov = left_coverage, right_coverage
                full_blocks = left_blocks
                sparse_has_image = bool(img_right)
            else:
                full_cov, sparse_cov = right_coverage, left_coverage
                full_blocks = right_blocks
                sparse_has_image = bool(img_left)

            if (
                full_cov >= args.min_full_coverage
                and full_blocks >= args.min_full_blocks
                and sparse_cov <= args.max_sparse_coverage
                and (full_cov - sparse_cov) >= args.min_coverage_diff
                and not sparse_has_image
            ):
                colbalance_ok = False

        if not pagefill_ok:
            pagefill_fail.append(page_no)
        if not colbalance_ok:
            colbalance_fail.append(page_no)

        pages.append(
            {
                "page": page_no,
                "width_pt": round(w, 1),
                "height_pt": round(h, 1),
                "used_ratio": round(used_ratio, 3),
                "text": {
                    "left_blocks": left_blocks,
                    "right_blocks": right_blocks,
                    "left_bottom": round(left_bottom, 3),
                    "right_bottom": round(right_bottom, 3),
                    "left_coverage": round(left_coverage, 3),
                    "right_coverage": round(right_coverage, 3),
                    "left_area_ratio": round(left_area_ratio, 3),
                    "right_area_ratio": round(right_area_ratio, 3),
                },
                "images": {
                    "count": len(images),
                    "ymax_ratio": round((img_ymax / h) if h else 0.0, 3),
                    "has_left": bool(img_left),
                    "has_right": bool(img_right),
                    "rects": img_rects[:20],  # keep report bounded
                },
                "gates": {
                    "ignored": ignore,
                    "pagefill_ok": bool(pagefill_ok),
                    "colbalance_ok": bool(colbalance_ok),
                },
            }
        )

    report: Dict[str, Any] = {
        "pdf": str(pdf_path),
        "pages_total": len(doc),
        "settings": {
            "ignore_first": args.ignore_first,
            "min_used": args.min_used,
            "colbalance": {
                "min_full_coverage": args.min_full_coverage,
                "max_sparse_coverage": args.max_sparse_coverage,
                "min_coverage_diff": args.min_coverage_diff,
                "min_full_blocks": args.min_full_blocks,
            },
        },
        "summary": {
            "pagefill_fail_pages": pagefill_fail,
            "colbalance_fail_pages": colbalance_fail,
        },
        "pages": pages,
    }

    out_json = Path(args.out_json).expanduser().resolve()
    out_tsv = Path(args.out_tsv).expanduser().resolve()
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_tsv.parent.mkdir(parents=True, exist_ok=True)

    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # TSV (one line per page)
    header = [
        "page",
        "used_ratio",
        "text_left_blocks",
        "text_right_blocks",
        "text_left_bottom",
        "text_right_bottom",
        "text_left_coverage",
        "text_right_coverage",
        "text_left_area_ratio",
        "text_right_area_ratio",
        "images_count",
        "images_has_right",
        "pagefill_ok",
        "colbalance_ok",
        "ignored",
    ]
    lines = ["\t".join(header)]
    for p in pages:
        lines.append(
            "\t".join(
                [
                    str(p["page"]),
                    str(p["used_ratio"]),
                    str(p["text"]["left_blocks"]),
                    str(p["text"]["right_blocks"]),
                    str(p["text"]["left_bottom"]),
                    str(p["text"]["right_bottom"]),
                    str(p["text"]["left_coverage"]),
                    str(p["text"]["right_coverage"]),
                    str(p["text"]["left_area_ratio"]),
                    str(p["text"]["right_area_ratio"]),
                    str(p["images"]["count"]),
                    "1" if p["images"]["has_right"] else "0",
                    "1" if p["gates"]["pagefill_ok"] else "0",
                    "1" if p["gates"]["colbalance_ok"] else "0",
                    "1" if p["gates"]["ignored"] else "0",
                ]
            )
        )
    out_tsv.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"✅ Layout report written")
    print(f"   pdf: {pdf_path}")
    print(f"   json: {out_json}")
    print(f"   tsv: {out_tsv}")


if __name__ == "__main__":
    main()


