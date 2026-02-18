#!/usr/bin/env python3
"""
Gate: verify Praktijk/Verdieping layer exists and is well-formed in a canonical chapter JSON.

This is a *text structure* gate (not layout):
- Ensures we actually produced enough Praktijk/Verdieping boxes (core differentiator).
- Ensures labels did NOT leak inline into basis text (boxes must be in dedicated fields).
- Ensures box text is KD-free and follows basic house style constraints.

Usage:
  python3 new_pipeline/validate/verify-box-layer.py <canonical.json> --chapter 1 --praktijk-every 2 --verdieping-every 3
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path


def die(msg: str, code: int = 1) -> None:
    print(f"❌ {msg}", file=sys.stderr)
    raise SystemExit(code)


def is_abbrev_token(tok: str) -> bool:
    return bool(re.fullmatch(r"[A-Z0-9]{2,}", tok or ""))


def starts_lowercase_ok(s: str) -> bool:
    t = (s or "").strip()
    if not t:
        return True
    first = t.split()[0] if t.split() else ""
    if is_abbrev_token(first):
        return True
    # allow quotes/parentheses before first letter
    m = re.match(r'^([\s"“‘(]*)([A-Za-zÀ-ÿ])', t)
    if not m:
        return True
    ch = m.group(2)
    return ch.islower()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("canonical_json", type=str)
    ap.add_argument("--chapter", type=int, required=True)
    ap.add_argument("--praktijk-every", type=int, default=2)
    ap.add_argument("--verdieping-every", type=int, default=3)
    ap.add_argument("--min-praktijk", type=int, default=-1, help="Override expected min praktijk subparagraphs (default: ceil(N/praktijk-every))")
    ap.add_argument("--min-verdieping", type=int, default=-1, help="Override expected min verdieping subparagraphs (default: ceil(N/verdieping-every))")
    args = ap.parse_args()

    p = Path(args.canonical_json).expanduser().resolve()
    if not p.exists():
        die(f"Canonical JSON not found: {p}")

    book = json.loads(p.read_text("utf-8"))

    # Locate chapter object
    ch_obj = None
    for ch in book.get("chapters", []) or []:
        if str(ch.get("number")) == str(args.chapter):
            ch_obj = ch
            break
    if ch_obj is None:
        die(f"Chapter {args.chapter} not found in {p}")

    # Collect subparagraphs
    subps = []
    for sec in ch_obj.get("sections", []) or []:
        for item in sec.get("content", []) or []:
            if isinstance(item, dict) and item.get("type") == "subparagraph":
                subps.append(item)

    total_subps = len(subps)
    if total_subps == 0:
        die(f"Chapter {args.chapter} has 0 subparagraphs (unexpected)")

    praktijk_subps = 0
    verdieping_subps = 0

    inline_label_leaks = []
    kd_leaks = []
    bad_box_labels = []
    bad_box_case = []
    term_leaks = []

    def scan_text(label: str, sp_num: str, pid: str | None, text: str) -> None:
        t = text or ""
        # Must be KD-free for students
        if re.search(r"(?i)\bkd\b", t):
            kd_leaks.append((label, sp_num, pid, "contains 'KD'"))
        # House terms (student-facing)
        if re.search(r"(?i)\bcliënt\b|\bclient\b|\bclienten\b|\bcliënten\b", t):
            term_leaks.append((label, sp_num, pid, "contains cliënt/client"))
        if re.search(r"(?i)\bverpleegkundige\b|\bverpleegkundigen\b", t):
            term_leaks.append((label, sp_num, pid, "contains verpleegkundige"))

    for sp in subps:
        sp_num = str(sp.get("number") or "").strip()
        has_p = False
        has_v = False

        for b in sp.get("content", []) or []:
            if not isinstance(b, dict) or b.get("type") != "paragraph":
                continue
            pid = str(b.get("id") or "") or None
            basis = str(b.get("basis") or "")
            pr = str(b.get("praktijk") or "")
            vd = str(b.get("verdieping") or "")

            # Inline label leaks inside basis are forbidden (must be in box fields).
            if re.search(r"<<BOLD_START>>(In de praktijk:|Verdieping:)<<BOLD_END>>", basis):
                inline_label_leaks.append((sp_num, pid, "marker label leaked into basis"))
            if re.search(r"(?i)\bIn de praktijk\s*:\b", basis) or re.search(r"(?i)\bVerdieping\s*:\b", basis):
                inline_label_leaks.append((sp_num, pid, "plain label leaked into basis"))

            # Box fields must NOT include their own labels.
            if re.search(r"(?i)\bIn de praktijk\s*:", pr) or re.search(r"(?i)\bVerdieping\s*:", pr):
                bad_box_labels.append((sp_num, pid, "praktijk contains label"))
            if re.search(r"(?i)\bIn de praktijk\s*:", vd) or re.search(r"(?i)\bVerdieping\s*:", vd):
                bad_box_labels.append((sp_num, pid, "verdieping contains label"))

            if pr.strip():
                has_p = True
                scan_text("praktijk", sp_num, pid, pr)
                if not starts_lowercase_ok(pr):
                    bad_box_case.append((sp_num, pid, "praktijk does not start lowercase"))
            if vd.strip():
                has_v = True
                scan_text("verdieping", sp_num, pid, vd)
                if not starts_lowercase_ok(vd):
                    bad_box_case.append((sp_num, pid, "verdieping does not start lowercase"))

        if has_p:
            praktijk_subps += 1
        if has_v:
            verdieping_subps += 1

    exp_pr = args.min_praktijk if args.min_praktijk >= 0 else int(math.ceil(total_subps / max(1, int(args.praktijk_every))))
    exp_vd = args.min_verdieping if args.min_verdieping >= 0 else (
        int(math.ceil(total_subps / int(args.verdieping_every))) if int(args.verdieping_every) > 0 else 0
    )

    # Fail conditions
    if praktijk_subps < exp_pr:
        die(f"Praktijk density too low: {praktijk_subps}/{total_subps} subparagraphs (expected >= {exp_pr}).")
    if exp_vd > 0 and verdieping_subps < exp_vd:
        die(f"Verdieping density too low: {verdieping_subps}/{total_subps} subparagraphs (expected >= {exp_vd}).")
    if inline_label_leaks:
        die(f"Inline label leaks in basis text: {len(inline_label_leaks)} occurrence(s). Sample: {inline_label_leaks[0]}")
    if bad_box_labels:
        die(f"Box fields contain labels (should not): {len(bad_box_labels)} occurrence(s). Sample: {bad_box_labels[0]}")
    if kd_leaks:
        die(f"KD leakage in student boxes: {len(kd_leaks)} occurrence(s). Sample: {kd_leaks[0]}")
    if term_leaks:
        die(f"Terminology leakage in boxes: {len(term_leaks)} occurrence(s). Sample: {term_leaks[0]}")
    if bad_box_case:
        die(f"Box text casing issue (should start lowercase): {len(bad_box_case)} occurrence(s). Sample: {bad_box_case[0]}")

    print(
        f"✅ Box layer OK: chapter={args.chapter} subparagraphs={total_subps} praktijk_subps={praktijk_subps} verdieping_subps={verdieping_subps}"
    )


if __name__ == "__main__":
    main()






























