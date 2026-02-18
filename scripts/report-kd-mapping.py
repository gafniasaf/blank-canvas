#!/usr/bin/env python3
"""
Generate a human-friendly review report for a KD mapping file.

Outputs:
- Markdown summary (per chapter: counts, top KD codes, top modules)
- CSV table (one row per entry)

Usage:
  python3 scripts/report-kd-mapping.py --book MBO_AF4_2024_COMMON_CORE
  python3 scripts/report-kd-mapping.py --path docs/kd/mappings/MBO_AF4_2024_COMMON_CORE.mapping.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPINGS_DIR = REPO_ROOT / "docs" / "kd" / "mappings"
OUT_DIR = REPO_ROOT / "output" / "reports"


COMPLEX_HINTS = [
    "dna",
    "rna",
    "mrna",
    "trna",
    "rrna",
    "codon",
    "anticodon",
    "transcriptie",
    "translatie",
    "mitose",
    "interfase",
    "prometafase",
    "metafase",
    "anafase",
    "telofase",
    "osmot",
    "endocyt",
    "exocyt",
    "fagocyt",
    "pinocyt",
    "enzymatische pomp",
    "citroenzuur",
    "ebp",
    "klinisch redener",
    "diagnose",
]


def norm(s: str) -> str:
    t = str(s or "").lower()
    t = t.replace("’", "'")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def load_mapping(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text("utf-8"))


def guess_book_id_from_path(p: Path) -> str:
    n = p.name
    if n.endswith(".mapping.json"):
        return n[: -len(".mapping.json")]
    return p.stem


def is_subparagraph(e: Dict[str, Any]) -> bool:
    return str(e.get("kind") or "") == "subparagraph"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default="", help="book_id (uses docs/kd/mappings/<book_id>.mapping.json)")
    ap.add_argument("--path", default="", help="explicit mapping path")
    ap.add_argument(
        "--mode",
        default="final",
        choices=["final", "suggested"],
        help="Report mode: 'final' uses difficulty/kd_workprocesses/modules; 'suggested' uses suggested_* fields when present.",
    )
    ap.add_argument("--chapter", type=int, default=0, help="Optional chapter number filter (e.g. 1). 0 = all chapters.")
    args = ap.parse_args()

    if not args.book and not args.path:
        raise SystemExit("Provide --book <book_id> or --path <mapping.json>")

    if args.path:
        mp = Path(args.path).expanduser().resolve()
        book_id = guess_book_id_from_path(mp)
    else:
        book_id = str(args.book).strip()
        mp = (MAPPINGS_DIR / f"{book_id}.mapping.json").resolve()

    if not mp.exists():
        raise SystemExit(f"Mapping not found: {mp}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = load_mapping(mp)
    entries_all = data.get("entries") or []
    entries = [e for e in entries_all if args.chapter <= 0 or int(e.get("chapter") or 0) == int(args.chapter)]

    def get_fields(e: Dict[str, Any]) -> Tuple[str, List[str], List[str]]:
        if args.mode == "suggested":
            diff = str(e.get("suggested_difficulty") or e.get("difficulty") or "unknown")
            codes = e.get("suggested_kd_workprocesses")
            mods = e.get("suggested_modules")
            kd_codes = codes if isinstance(codes, list) else (e.get("kd_workprocesses") or [])
            modules = mods if isinstance(mods, list) else (e.get("modules") or [])
            return diff, [str(x) for x in kd_codes if str(x).strip()], [str(x) for x in modules if str(x).strip()]
        diff = str(e.get("difficulty") or "unknown")
        return diff, [str(x) for x in (e.get("kd_workprocesses") or []) if str(x).strip()], [
            str(x) for x in (e.get("modules") or []) if str(x).strip()
        ]

    # Stats
    diff_counts = Counter()
    code_counts = Counter()
    module_counts = Counter()
    chapter_counts = defaultdict(lambda: {"total": 0, "subparagraphs": 0, "basis": 0, "mixed": 0, "verdieping": 0, "unknown": 0})

    needs_review: List[Tuple[str, str, str]] = []  # (key, title, reason)

    for e in entries:
        key = str(e.get("key") or "")
        title = str(e.get("title") or "")
        chap = int(e.get("chapter") or 0)
        diff, kd_codes, modules = get_fields(e)

        chapter_counts[chap]["total"] += 1
        diff_counts[diff] += 1

        if is_subparagraph(e):
            chapter_counts[chap]["subparagraphs"] += 1
            if diff in ("basis", "mixed", "verdieping"):
                chapter_counts[chap][diff] += 1
            else:
                chapter_counts[chap]["unknown"] += 1

        for cc in kd_codes:
            code_counts[cc] += 1

        for mm in modules:
            module_counts[mm] += 1

        # Heuristic “review needed” list
        t = norm(title)
        if is_subparagraph(e) and diff == "basis":
            if any(h in t for h in COMPLEX_HINTS):
                needs_review.append((key, title, "Title contains technical/complex term; consider mixed/verdieping"))
        if is_subparagraph(e) and kd_codes == []:
            needs_review.append((key, title, "No KD workprocess codes assigned"))
        if is_subparagraph(e) and modules == []:
            needs_review.append((key, title, "No modules assigned (praktijk/verdieping cues missing)"))

    # Write CSV
    suffix = "_suggested" if args.mode == "suggested" else ""
    ch_suffix = f"_ch{int(args.chapter):02d}" if args.chapter > 0 else ""
    csv_path = OUT_DIR / f"{book_id}_kd_mapping_review{suffix}.csv"
    if ch_suffix:
        csv_path = OUT_DIR / f"{book_id}_kd_mapping_review{suffix}{ch_suffix}.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["key", "chapter", "kind", "title", "difficulty", "kd_workprocesses", "modules", "notes"])
        for e in entries:
            diff, kd_codes, modules = get_fields(e)
            w.writerow(
                [
                    e.get("key"),
                    e.get("chapter"),
                    e.get("kind"),
                    e.get("title"),
                    diff,
                    "|".join(kd_codes),
                    "|".join(modules),
                    str(e.get("notes") or ""),
                ]
            )

    # Write Markdown
    md_path = OUT_DIR / f"{book_id}_kd_mapping_review{suffix}.md"
    if ch_suffix:
        md_path = OUT_DIR / f"{book_id}_kd_mapping_review{suffix}{ch_suffix}.md"
    lines: List[str] = []
    lines.append(f"## KD mapping review — `{book_id}`")
    lines.append("")
    lines.append(f"- **mapping file**: `{mp}`")
    lines.append(f"- **generated**: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"- **mode**: `{args.mode}`")
    if args.chapter > 0:
        lines.append(f"- **chapter filter**: {int(args.chapter)}")
    lines.append(f"- **csv**: `{csv_path}`")
    lines.append("")

    lines.append("### Overall")
    lines.append(f"- **entries**: {len(entries)}")
    lines.append("- **difficulty**: " + ", ".join(f"{k}={v}" for k, v in diff_counts.most_common()))
    lines.append(f"- **KD codes used**: {sum(code_counts.values())} assignments across {len(code_counts)} codes")
    lines.append(f"- **modules used**: {sum(module_counts.values())} assignments across {len(module_counts)} modules")
    lines.append("")

    lines.append("### Per chapter (subparagraph-only)")
    for chap in sorted(chapter_counts.keys()):
        c = chapter_counts[chap]
        if c["subparagraphs"] == 0:
            continue
        lines.append(f"- **Chapter {chap}**: subparagraphs={c['subparagraphs']} | basis={c['basis']} mixed={c['mixed']} verdieping={c['verdieping']} unknown={c['unknown']}")
    lines.append("")

    lines.append("### Top KD workprocess codes (by assignment count)")
    for code, n in code_counts.most_common(12):
        lines.append(f"- **{code}**: {n}")
    if not code_counts:
        lines.append("- (none)")
    lines.append("")

    lines.append("### Top modules (by assignment count)")
    for mid, n in module_counts.most_common(12):
        lines.append(f"- **{mid}**: {n}")
    if not module_counts:
        lines.append("- (none)")
    lines.append("")

    lines.append("### Needs human review (heuristic shortlist)")
    for key, title, reason in needs_review[:80]:
        lines.append(f"- **{key}** — {title}  \n  - {reason}")
    if len(needs_review) > 80:
        lines.append(f"- ... and {len(needs_review) - 80} more")
    if not needs_review:
        lines.append("- (none)")
    lines.append("")

    md_path.write_text("\n".join(lines), "utf-8")

    print("✅ KD mapping review report written:")
    print(f"- {md_path}")
    print(f"- {csv_path}")


if __name__ == "__main__":
    main()


