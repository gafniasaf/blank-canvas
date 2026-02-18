#!/usr/bin/env python3
"""
Fail if the PDF contains hyphenated line breaks inside headings/titles.

Why:
- Hyphenation inside headings looks unprofessional (e.g. "naslagw- erken").
- Even if the hyphenation is linguistically "valid", we want word-boundary breaks only for headings.

Heuristic:
- Use PyMuPDF span font sizes.
- A line is "heading-like" if its max span size is >= (body_size_pt + threshold_delta_pt).
- If a heading-like line ends with '-' and the next heading-like line begins with a letter,
  we flag it as a bad hyphenation in a heading.

Usage:
  python3 new_pipeline/validate/verify-no-heading-hyphenation.py <pdf_path> [--delta-pt 1.5]
"""

from __future__ import annotations

import argparse
import re
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


def line_text_and_size(line: dict) -> tuple[str, float]:
    spans = line.get("spans") or []
    max_size = 0.0
    parts = []
    for sp in spans:
        try:
            sz = float(sp.get("size") or 0.0)
        except Exception:
            sz = 0.0
        max_size = max(max_size, sz)
        t = str(sp.get("text") or "")
        parts.append(t)
    txt = "".join(parts)
    return txt, max_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=str, help="Path to PDF")
    ap.add_argument("--delta-pt", type=float, default=1.5, help="Heading threshold: body_size_pt + delta")
    args = ap.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        die(f"❌ PDF not found: {pdf_path}")

    try:
        import fitz  # type: ignore
    except Exception as e:
        die(f"❌ Missing dependency PyMuPDF (fitz): {e}")

    # Determine body font size from token CSS (fallback 10pt)
    tokens_css = Path(__file__).resolve().parent.parent / "templates" / "prince-af-two-column.tokens.css"
    vars_ = parse_css_vars(tokens_css)
    body_pt = parse_len_to_pt(vars_.get("--body-size", ""), 10.0)
    threshold = float(body_pt) + float(args.delta_pt)

    # Unicode-ish letter check
    starts_letter = re.compile(r"^\s*[A-Za-zÀ-ÖØ-öø-ÿ]")
    ends_with_hyphen = re.compile(r"-\s*$")

    doc = fitz.open(str(pdf_path))
    bad = []

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        d = page.get_text("dict") or {}
        blocks = d.get("blocks") or []
        for b in blocks:
            lines = b.get("lines") or []
            if len(lines) < 2:
                continue
            for i in range(len(lines) - 1):
                t1, s1 = line_text_and_size(lines[i])
                t2, s2 = line_text_and_size(lines[i + 1])
                if s1 < threshold or s2 < threshold:
                    continue
                if not ends_with_hyphen.search(t1 or ""):
                    continue
                if not starts_letter.search(t2 or ""):
                    continue
                # Likely hyphenated word break in a heading-like line.
                bad.append(
                    {
                        "page": page_idx + 1,
                        "line1": (t1 or "").strip(),
                        "line2": (t2 or "").strip(),
                        "size_pt": round(max(s1, s2), 2),
                    }
                )

    if bad:
        die(
            "❌ Heading hyphenation detected (hyphenated word breaks inside headings).\n"
            + f"   pdf: {pdf_path}\n"
            + f"   threshold: body({body_pt:.2f}pt)+{args.delta_pt:.2f}pt={threshold:.2f}pt\n"
            + "\n".join(
                [
                    f"   - page {r['page']} (size~{r['size_pt']}pt): \"{r['line1']}\" + \"{r['line2']}\""
                    for r in bad[:30]
                ]
            )
            + ("\n   ... more" if len(bad) > 30 else "")
        )

    print("✅ No heading hyphenation detected")
    print(f"   pdf: {pdf_path}")
    print(f"   threshold: {threshold:.2f}pt")


if __name__ == "__main__":
    main()
































