#!/usr/bin/env python3
"""
Verify that rewrites_for_indesign.json numbering (chapter/paragraph/subparagraph) is compatible with
the canonical N4 A&F book in Downloads (via an exported IDML snapshot).

This is a deterministic guardrail to prevent drift:
- JSON must only contain numbering keys that exist in the N4 source.
- (Optionally) JSON must include subparagraph_number field (even if null) so we can audit 1.1.1 etc.

Usage:
  python3 scripts/verify-json-numbering-vs-n4.py \
    --json /Users/asafgafni/Desktop/rewrites_for_indesign.json \
    --idml /Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml \
    --require-subfield true

Exit codes:
  0 = OK
  2 = validation failed
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


def clean_text(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"<\?ACE\s*\d*\s*\?>", "", s, flags=re.I)
    s = s.replace("\uFFFC", "")
    # Normalize control chars that sometimes appear in headings (e.g. \u0007)
    s = re.sub(r"[\u0000-\u001F\u007F]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_header_style(style_name: str) -> bool:
    header_patterns = [
        "_Chapter Header",
        "_Subchapter Header",
        "paragraafkop",
        "subparagraaf",
        "hoofdstukkop",
        "hoofdstuk kop",
        "kop1",
        "kop2",
        "kop3",
        "heading",
        "h1",
        "h2",
        "h3",
        "title",
        "hoofdstuk",
    ]
    s = (style_name or "").lower()
    return any(p.lower() in s for p in header_patterns)


@dataclass(frozen=True)
class ParaKey:
    chapter: int
    paragraph: int
    subparagraph: Optional[int]

    def to_str(self) -> str:
        if self.subparagraph is None:
            return f"{self.chapter}.{self.paragraph}"
        return f"{self.chapter}.{self.paragraph}.{self.subparagraph}"


def parse_heading_number(text: str) -> Optional[ParaKey]:
    t = clean_text(text)
    m3 = re.match(r"^(\d+)\.(\d+)\.(\d+)\b", t)
    if m3:
        return ParaKey(int(m3.group(1)), int(m3.group(2)), int(m3.group(3)))
    m2 = re.match(r"^(\d+)\.(\d+)\b", t)
    if m2:
        return ParaKey(int(m2.group(1)), int(m2.group(2)), None)
    return None


def extract_n4_keys_from_idml(idml_path: str) -> Tuple[List[Tuple[ParaKey, str]], Dict[str, str]]:
    """
    Extract heading keys (chapter.paragraph[.sub]) from ALL Stories in the IDML.

    Why ALL stories?
    - Some books split content across multiple stories (front matter, separate flows, etc.).
    - Choosing only the largest story can miss early chapters and create false negatives.

    Returns:
      - ordered list (numeric order) of (ParaKey, header_text)
      - map: key_str -> representative header_text (first seen)
    """
    with zipfile.ZipFile(idml_path, "r") as z:
        story_files = [n for n in z.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        if not story_files:
            raise RuntimeError("No Stories/*.xml found in IDML")

        para_range_re = re.compile(
            r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="([^"]*)"[^>]*>([\s\S]*?)</ParagraphStyleRange>',
            re.I,
        )
        content_re = re.compile(r"<Content>([\s\S]*?)</Content>", re.I)

        key_to_text: Dict[str, str] = {}

        for story_name in story_files:
            xml = z.read(story_name).decode("utf-8", errors="ignore")

            for m in para_range_re.finditer(xml):
                raw_style = m.group(1) or ""
                style_name = raw_style.replace("ParagraphStyle/", "").replace("%20", " ")
                inner = m.group(2) or ""

                # Heuristic: prefer explicit header styles, but also accept numbered headers even if style is unexpected.
                if not is_header_style(style_name):
                    # Still allow if the paragraph text begins with a numbering token (e.g. "1.4.2")
                    pass

                text = ""
                for cm in content_re.finditer(inner):
                    text += cm.group(1) or ""
                text = clean_text(text)
                if not text:
                    continue

                k = parse_heading_number(text)
                if not k:
                    continue
                if k.paragraph <= 0:
                    continue

                ks = k.to_str()
                if ks not in key_to_text:
                    key_to_text[ks] = text

    # Build a deterministic numeric ordering for printing/debugging
    def sort_key(ks: str) -> Tuple[int, int, int]:
        parts = ks.split(".")
        c = int(parts[0]) if len(parts) > 0 else 0
        p = int(parts[1]) if len(parts) > 1 else 0
        s = int(parts[2]) if len(parts) > 2 else -1  # subparagraph: -1 sorts before 1,2,...
        return (c, p, s)

    ordered_keys = sorted(key_to_text.keys(), key=sort_key)
    ordered: List[Tuple[ParaKey, str]] = []
    for ks in ordered_keys:
        parts = ks.split(".")
        ch = int(parts[0])
        pn = int(parts[1])
        sub = int(parts[2]) if len(parts) > 2 else None
        ordered.append((ParaKey(chapter=ch, paragraph=pn, subparagraph=sub), key_to_text[ks]))

    return ordered, key_to_text


def load_json_keys(json_path: str, require_subfield: bool) -> Tuple[List[ParaKey], List[str]]:
    data = json.loads(open(json_path, "r", encoding="utf-8").read())
    paras = data.get("paragraphs") or []
    keys: List[ParaKey] = []
    errs: List[str] = []

    for p in paras:
        ch_raw = p.get("chapter")
        para_raw = p.get("paragraph_number")
        if ch_raw is None or para_raw is None:
            errs.append(f"Missing chapter/paragraph_number on paragraph_id={p.get('paragraph_id')}")
            continue
        try:
            ch = int(str(ch_raw))
        except Exception:
            errs.append(f"Non-integer chapter='{ch_raw}' on paragraph_id={p.get('paragraph_id')}")
            continue
        try:
            pn = int(para_raw)
        except Exception:
            errs.append(f"Non-integer paragraph_number='{para_raw}' on paragraph_id={p.get('paragraph_id')}")
            continue

        if "subparagraph_number" not in p:
            if require_subfield:
                errs.append(
                    f"Missing subparagraph_number field on paragraph_id={p.get('paragraph_id')} (required for audit)"
                )
            sub = None
        else:
            sub_raw = p.get("subparagraph_number")
            sub = None
            if sub_raw is not None:
                try:
                    sub = int(sub_raw)
                except Exception:
                    errs.append(
                        f"Non-integer subparagraph_number='{sub_raw}' on paragraph_id={p.get('paragraph_id')}"
                    )
                    sub = None

        keys.append(ParaKey(chapter=ch, paragraph=pn, subparagraph=sub))

    return keys, errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--idml", required=True)
    ap.add_argument("--require-subfield", default="true")
    args = ap.parse_args()

    require_subfield = str(args.require_subfield).lower() in ("1", "true", "yes", "y")

    ordered, n4_key_to_text = extract_n4_keys_from_idml(args.idml)
    json_keys, json_errs = load_json_keys(args.json, require_subfield=require_subfield)

    print(f"N4 IDML headings extracted: {len(ordered)}")
    if ordered:
        print(f"First heading: {ordered[0][0].to_str()} :: {ordered[0][1][:80]}")
        print(f"Last  heading: {ordered[-1][0].to_str()} :: {ordered[-1][1][:80]}")

    # Unique keys used by JSON
    uniq_json_keys = []
    seen = set()
    for k in json_keys:
        ks = k.to_str()
        if ks in seen:
            continue
        seen.add(ks)
        uniq_json_keys.append(k)

    missing: List[str] = []
    for k in uniq_json_keys:
        ks = k.to_str()
        if ks not in n4_key_to_text:
            missing.append(ks)

    # Order sanity: JSON keys should be monotonic in numeric order (chapter, paragraph, subparagraph).
    # This is independent of story ordering inside IDML.
    order_violations = 0
    last_tup: Tuple[int, int, int] = (-1, -1, -2)
    for k in json_keys:
        ks = k.to_str()
        parts = ks.split(".")
        tup = (int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else -1)
        if tup < last_tup:
            order_violations += 1
            if order_violations <= 5:
                print(f"ORDER VIOLATION: {ks} came after {last_tup[0]}.{last_tup[1]}.{last_tup[2]}")
        last_tup = tup

    print("")
    print(f"JSON paragraphs: {len(json_keys)}")
    print(f"JSON unique numbering keys: {len(uniq_json_keys)}")
    print(f"JSON parse errors: {len(json_errs)}")
    print(f"Missing keys (not in N4): {len(missing)}")
    print(f"Order violations: {order_violations}")

    if json_errs:
        print("\n--- JSON FIELD ERRORS (first 10) ---")
        for e in json_errs[:10]:
            print(" - " + e)

    if missing:
        print("\n--- MISSING NUMBERING KEYS (first 20) ---")
        for k in missing[:20]:
            print(" - " + k)

    if json_errs or missing or order_violations:
        print("\n❌ NUMBERING VERIFICATION FAILED")
        return 2

    print("\n✅ NUMBERING VERIFICATION PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


