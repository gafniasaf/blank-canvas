#!/usr/bin/env python3
"""
Scan a Prince-generated PDF for hyphenations at line breaks and flag those that
are invalid according to Dutch hyphenation patterns (pyphen nl_NL).
 
Usage:
  python3 new_pipeline/validate/scan-hyphenation.py <pdf_path> [--json]
 
Outputs:
  - default: human-readable summary + invalid list
  - --json: a single JSON object to stdout
 
Dependencies (local user install is fine):
  python3 -m pip install --user pyphen==0.17.2
  PyMuPDF (`fitz`) must be installed (already present on most setups here).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        die("Usage: python3 new_pipeline/validate/scan-hyphenation.py <pdf_path> [--json]")

    pdf_path = Path(sys.argv[1]).expanduser().resolve()
    as_json = "--json" in sys.argv

    try:
        import fitz  # type: ignore
    except Exception as e:
        die(f"❌ Missing dependency PyMuPDF (fitz): {e}")

    try:
        import pyphen  # type: ignore
    except Exception as e:
        die(
            "❌ Missing dependency pyphen.\n"
            "Install:\n"
            "  python3 -m pip install --user pyphen==0.17.2\n"
            f"Error: {e}"
        )

    if not pdf_path.exists():
        die(f"❌ PDF not found: {pdf_path}")

    dic = pyphen.Pyphen(lang="nl_NL")

    # Unicode letters/digits (no underscore). Works with Python's stdlib `re`.
    left_word_re = re.compile(r"([^\W_]+)-\s*$", re.UNICODE)
    right_word_re = re.compile(r"^\s*([^\W_]+)", re.UNICODE)

    doc = fitz.open(str(pdf_path))
    all_hyph = []
    invalid = []

    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text("text")
        lines = text.splitlines()
        for i in range(len(lines) - 1):
            line = lines[i]
            nxt = lines[i + 1]

            mL = left_word_re.search(line)
            if not mL:
                continue
            left = mL.group(1)

            mR = right_word_re.match(nxt)
            if not mR:
                continue
            right = mR.group(1)

            if len(left) < 2 or len(right) < 2:
                continue

            full = left + right

            hyphened = dic.inserted(full)
            allowed = set()
            pos = 0
            for ch in hyphened:
                if ch == "-":
                    allowed.add(pos)
                else:
                    pos += 1

            break_pos = len(left)

            rec = {
                "page": page_idx + 1,
                "left": left,
                "right": right,
                "full": full,
                "break_pos": break_pos,
                "allowed": hyphened,
            }
            all_hyph.append(rec)
            if break_pos not in allowed:
                invalid.append(rec)

    # Deduplicate invalid by (full_lower, break_pos) keeping earliest page
    seen = set()
    dedup = []
    for r in sorted(invalid, key=lambda x: (x["page"], x["full"].lower(), x["break_pos"])):
        k = (r["full"].lower(), int(r["break_pos"]))
        if k in seen:
            continue
        seen.add(k)
        dedup.append(r)

    payload = {
        "pdf": str(pdf_path),
        "pages": len(doc),
        "hyphenated_linebreaks": len(all_hyph),
        "invalid_count": len(dedup),
        "invalid": dedup,
    }

    if as_json:
        print(json.dumps(payload, ensure_ascii=False))
        return

    print(f"PDF: {pdf_path.name}")
    print(f"pages: {payload['pages']}")
    print(f"hyphenated line-breaks found: {payload['hyphenated_linebreaks']}")
    print(f"invalid by nl_NL patterns: {payload['invalid_count']}")
    for r in payload["invalid"]:
        print(
            f"- p{r['page']}: {r['left']}- | {r['right']} => {r['full']} (allowed: {r['allowed']})"
        )


if __name__ == "__main__":
    main()
































