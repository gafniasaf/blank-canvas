#!/usr/bin/env python3
"""
Apply a deterministic Praktijk/Verdieping layer to a canonical chapter JSON for Prince rendering.

This is student-facing and must remain KD-free in output (no "KD", codes, or workprocess names in the box copy).

Goals:
- Add many Praktijk/Verdieping boxes as a core differentiator (student book).
- Keep output deterministic and safe; (optional) mixed-subparagraph simplification can be enabled explicitly.

Notes:
- The optional "mixed" concept can come from an internal mapping file, but the output must remain KD-free.
- This script does NOT call an LLM; pair it with `humanize-kd-boxes.py` if you want natural-sounding box copy.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


MICRO_START = "<<MICRO_TITLE>>"
MICRO_END = "<<MICRO_TITLE_END>>"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", "utf-8")


def word_count(s: str) -> int:
    return len([w for w in re.split(r"\s+", (s or "").strip()) if w])


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def split_sentences(text: str) -> List[str]:
    t = normalize_ws(text)
    if not t:
        return []
    # Simple sentence split; good enough for Dutch POC.
    parts = re.split(r"(?<=[.!?])\s+", t)
    return [p.strip() for p in parts if p.strip()]


@dataclass
class MicroSection:
    title: str
    body: str


def extract_micro_sections(text: str) -> Tuple[str, List[MicroSection]]:
    """
    Returns (preamble_before_first_micro, sections[]).
    Keeps raw body text per section (still contains regular text, no markers).
    """
    raw = text or ""
    first = raw.find(MICRO_START)
    if first < 0:
        return raw, []

    preamble = raw[:first].strip()
    sections: List[MicroSection] = []
    pos = first
    while True:
        s = raw.find(MICRO_START, pos)
        if s < 0:
            break
        e = raw.find(MICRO_END, s)
        if e < 0:
            # malformed; treat rest as body
            break
        title = raw[s + len(MICRO_START) : e].strip()
        next_s = raw.find(MICRO_START, e + len(MICRO_END))
        body = raw[e + len(MICRO_END) : (next_s if next_s >= 0 else len(raw))].strip()
        if title and body:
            sections.append(MicroSection(title=title, body=body))
        pos = next_s if next_s >= 0 else len(raw)
        if next_s < 0:
            break

    return preamble, sections


def summarize_text(text: str, max_sentences: int = 2, max_words: int = 42) -> str:
    sents = split_sentences(text)
    if not sents:
        return ""
    chosen: List[str] = []
    for s in sents:
        chosen.append(s)
        if len(chosen) >= max_sentences:
            break
    out = normalize_ws(" ".join(chosen))
    words = out.split()
    if len(words) > max_words:
        out = " ".join(words[:max_words]).rstrip(",;:") + "…"
    return out


def to_box_snippet(title: str, body: str) -> str:
    """
    Box content is rendered as a single paragraph; we emulate micro-titles via BOLD markers.
    """
    t = normalize_ws(title)
    b = summarize_text(body, max_sentences=2, max_words=44)
    if not t or not b:
        return ""
    return f"<<BOLD_START>>{t}<<BOLD_END>> {b}"


def is_bulletish(block: Dict[str, Any]) -> bool:
    hint = str(block.get("styleHint") or "")
    role = str(block.get("role") or "")
    if hint.startswith("_"):
        return True
    if "bullet" in role.lower():
        return True
    if "step" in role.lower():
        return True
    return False


def find_host_paragraph(subp: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Prefer last body paragraph that doesn't end with ':'.
    paras = [b for b in subp.get("content", []) if isinstance(b, dict) and b.get("type") == "paragraph"]
    for b in reversed(paras):
        if str(b.get("role") or "") == "body":
            basis = str(b.get("basis") or "").strip()
            if basis and not basis.endswith(":"):
                return b
    # Otherwise any body paragraph
    for b in reversed(paras):
        if str(b.get("role") or "") == "body":
            return b
    # Otherwise last paragraph
    return paras[-1] if paras else None


def cap_boxes_per_subparagraph(subp: Dict[str, Any]) -> None:
    seen_p = False
    seen_v = False
    for b in subp.get("content", []):
        if not isinstance(b, dict) or b.get("type") != "paragraph":
            continue
        pr = str(b.get("praktijk") or "").strip()
        vd = str(b.get("verdieping") or "").strip()
        if pr:
            if seen_p:
                b["praktijk"] = ""
            else:
                seen_p = True
        if vd:
            if seen_v:
                b["verdieping"] = ""
            else:
                seen_v = True


def make_praktijk_text(subp_key: str, title: str, basis_sample: str) -> str:
    """
    Deterministic practice text. Must start lowercase (repo rule after label colon).
    """
    t = (title or "").strip().lower()
    # Slightly tailored heuristics for Chapter 1 topics.
    if any(k in t for k in ["osmose", "diffusie", "transport", "celmembraan"]):
        return "bij een zorgvrager met uitdroging of oedeem let je op vochtbalans. veranderingen in zout en water in het lichaam hebben invloed op het verplaatsen van water tussen cellen en bloed."
    if any(k in t for k in ["mitochond", "dissimilatie", "energie", "atp"]):
        return "bij een zorgvrager die benauwd of uitgeput is, let je op vermoeidheid en herstel. als er minder zuurstof is, kan het lichaam minder energie maken en kan iemand sneller uitgeput raken."
    if any(k in t for k in ["enzym", "eiwit", "vertering"]):
        return "bij een zorgvrager met misselijkheid of spijsverteringsklachten let je op wat iemand verdraagt. enzymen helpen bij het afbreken van voedingsstoffen, dus verstoringen kunnen invloed hebben op voeding en energie."
    if any(k in t for k in ["celkern", "chromos", "celcyclus"]):
        return "bij wondgenezing of herstel na een operatie is celdeling belangrijk. je kunt uitleggen dat het lichaam nieuwe cellen maakt om weefsel te herstellen en dat dit tijd nodig heeft."
    # Fallback: tie to basis first sentence
    first = summarize_text(basis_sample, max_sentences=1, max_words=18)
    if first:
        return f"bij de zorg leg je in eenvoudige woorden uit: {first.lower()}"
    return "bij de zorg koppel je de theorie aan een herkenbare situatie uit de praktijk en leg je kort uit waarom dit belangrijk is."


def make_verdieping_text(title: str, basis_sample: str) -> str:
    """
    Deterministic placeholder verdieping text.
    - Must start lowercase (repo rule after label colon).
    - Must not include the label itself.
    The LLM humanizer can turn this into richer "verdieping" prose later.
    """
    t = (title or "").strip()
    first = summarize_text(basis_sample or "", max_sentences=2, max_words=26)
    if first:
        # Ensure lower-case start (unless abbreviation-like token)
        out = f"extra uitleg: {first}"
        out = out.strip()
        if out and not re.fullmatch(r"[A-Z0-9]{2,}", out.split()[0]):
            out = out[:1].lower() + out[1:]
        return out
    out = "extra uitleg: lees deze verdieping als je meer achtergrond wilt bij dit onderwerp."
    return out


def apply_mixed_subparagraph_simplification(subp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns stats for report.
    """
    stats = {"micro_sections": 0, "bullet_blocks_removed": 0, "verdieping_added": False}
    verd_parts: List[str] = []

    new_content: List[Dict[str, Any]] = []
    for block in subp.get("content", []):
        if not isinstance(block, dict) or block.get("type") != "paragraph":
            if isinstance(block, dict):
                new_content.append(block)
            continue

        basis = str(block.get("basis") or "")
        if is_bulletish(block):
            # Extract micro sections if present; else summarize whole.
            pre, sections = extract_micro_sections(basis)
            if sections:
                for sec in sections:
                    snip = to_box_snippet(sec.title, sec.body)
                    if snip:
                        verd_parts.append(snip)
                stats["micro_sections"] += len(sections)
            else:
                summ = summarize_text(basis, max_sentences=2, max_words=44)
                if summ:
                    verd_parts.append(summ)
            stats["bullet_blocks_removed"] += 1
            # Drop the bullet-ish block from running text to reduce cognitive load.
            continue

        preamble, sections = extract_micro_sections(basis)
        if sections:
            for sec in sections:
                snip = to_box_snippet(sec.title, sec.body)
                if snip:
                    verd_parts.append(snip)
            stats["micro_sections"] += len(sections)

            keep = preamble.strip()
            if not keep:
                # Keep a minimal basis sentence so the paragraph doesn't disappear.
                keep = summarize_text(sections[0].body, max_sentences=1, max_words=22)
            block["basis"] = keep

        # Keep the block if it has text or images (avoid losing figures)
        if str(block.get("basis") or "").strip() or (block.get("images") and len(block.get("images")) > 0):
            new_content.append(block)

    subp["content"] = new_content

    # Attach a single Verd ieping box if we extracted anything and none exists already.
    existing_v = any(
        isinstance(b, dict)
        and b.get("type") == "paragraph"
        and str(b.get("verdieping") or "").strip()
        for b in subp.get("content", [])
    )
    if verd_parts and not existing_v:
        host = find_host_paragraph(subp)
        if host is not None:
            host["verdieping"] = normalize_ws(" ".join([p for p in verd_parts if p]))
            stats["verdieping_added"] = True
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input_json", help="Canonical chapter JSON used for Prince rendering")
    ap.add_argument("--out", required=True, help="Output JSON path")
    ap.add_argument("--report", required=True, help="Output markdown report path")
    ap.add_argument("--book-id", default="MBO_AF4_2024_COMMON_CORE", help="Book id used in KD mapping filename")
    ap.add_argument("--kd-mapping", default="", help="Optional explicit mapping file path (overrides --book-id)")
    ap.add_argument(
        "--box-overrides",
        default="",
        help="Optional JSON file with per-subparagraph box text overrides: { praktijk: {\"1.1.2\": \"...\"}, verdieping: {...} }",
    )
    ap.add_argument("--chapter", type=int, default=1, help="Chapter number to apply (POC default: 1)")
    ap.add_argument("--praktijk-every", type=int, default=2, help="Target praktijk frequency (per N subparagraphs)")
    ap.add_argument("--verdieping-every", type=int, default=3, help="Target verdieping frequency (per N subparagraphs; 0=disable fill)")
    ap.add_argument(
        "--simplify-mixed",
        action="store_true",
        help="Optional: simplify mapped 'mixed' subparagraphs by moving bullet-ish/micro detail into a single Verdieping box (can change running text).",
    )
    args = ap.parse_args()

    inp = Path(args.input_json)
    out = Path(args.out)
    rep = Path(args.report)

    mapping_path = Path(args.kd_mapping) if args.kd_mapping else Path(
        f"/Users/asafgafni/Desktop/InDesign/TestRun/docs/kd/mappings/{args.book_id}.mapping.json"
    )

    book = read_json(inp)
    mapping = {}
    if mapping_path.exists():
        try:
            mapping = read_json(mapping_path)
        except Exception:
            mapping = {}

    # Optional: per-subparagraph box text overrides
    overrides_path = Path(args.box_overrides) if args.box_overrides else None
    overrides = {}
    if overrides_path and overrides_path.exists():
        try:
            overrides = read_json(overrides_path)
        except Exception:
            overrides = {}
    praktijk_overrides = {}
    verdieping_overrides = {}
    try:
        praktijk_overrides = overrides.get("praktijk", {}) or {}
        verdieping_overrides = overrides.get("verdieping", {}) or {}
    except Exception:
        praktijk_overrides = {}
        verdieping_overrides = {}

    mixed_keys = set()
    try:
        mixed_keys = {
            str(e.get("key"))
            for e in (mapping.get("entries", []) or [])
            if e.get("chapter") == args.chapter and e.get("kind") == "subparagraph" and e.get("difficulty") == "mixed"
        }
    except Exception:
        mixed_keys = set()

    # Locate chapter
    chapters = book.get("chapters", [])
    ch_obj = None
    for ch in chapters:
        if str(ch.get("number")) == str(args.chapter):
            ch_obj = ch
            break
    if ch_obj is None:
        raise SystemExit(f"Chapter {args.chapter} not found in {inp}")

    # Collect subparagraphs in order
    ordered_subps: List[Dict[str, Any]] = []
    for sec in ch_obj.get("sections", []):
        for item in sec.get("content", []):
            if isinstance(item, dict) and item.get("type") == "subparagraph":
                ordered_subps.append(item)

    # Optional: simplify mixed subparagraphs (can change running text; off by default)
    mixed_stats: Dict[str, Any] = {}
    if args.simplify_mixed and mixed_keys:
        for sp in ordered_subps:
            key = str(sp.get("number") or "")
            if key in mixed_keys:
                mixed_stats[key] = apply_mixed_subparagraph_simplification(sp)

    # Cap existing boxes per subparagraph (max 1 praktijk, max 1 verdieping)
    for sp in ordered_subps:
        cap_boxes_per_subparagraph(sp)

    # Determine current praktijk coverage per subparagraph
    def has_praktijk(sp: Dict[str, Any]) -> bool:
        for b in sp.get("content", []):
            if isinstance(b, dict) and b.get("type") == "paragraph" and str(b.get("praktijk") or "").strip():
                return True
        return False

    def has_verdieping(sp: Dict[str, Any]) -> bool:
        for b in sp.get("content", []):
            if isinstance(b, dict) and b.get("type") == "paragraph" and str(b.get("verdieping") or "").strip():
                return True
        return False

    total_subps = len(ordered_subps)
    target_praktijk_subps = int(math.ceil(total_subps / max(1, int(args.praktijk_every))))
    vd_every = int(args.verdieping_every)
    target_verdieping_subps = int(math.ceil(total_subps / vd_every)) if vd_every > 0 else 0

    before_praktijk = sum(1 for sp in ordered_subps if has_praktijk(sp))
    before_verdieping = sum(1 for sp in ordered_subps if has_verdieping(sp))

    # Add praktijk to hit target coverage; avoid mixed subparagraphs (they already get verdieping)
    added_praktijk: List[str] = []
    non_mixed = [sp for sp in ordered_subps if str(sp.get("number") or "") not in mixed_keys]

    # Prefer every-other non-mixed subparagraph for even spacing
    for i, sp in enumerate(non_mixed):
        if sum(1 for x in ordered_subps if has_praktijk(x)) >= target_praktijk_subps:
            break
        if i % int(args.praktijk_every) != 0:
            continue
        if has_praktijk(sp):
            continue
        host = find_host_paragraph(sp)
        if host is None:
            continue
        sp_key = str(sp.get("number") or "")
        override = str(praktijk_overrides.get(sp_key) or "").strip()
        sample = ""
        for b in sp.get("content", []):
            if isinstance(b, dict) and b.get("type") == "paragraph":
                txt = str(b.get("basis") or "").strip()
                if txt:
                    sample = txt
                    break
        host["praktijk"] = normalize_ws(override) if override else make_praktijk_text(sp_key, str(sp.get("title") or ""), sample)
        added_praktijk.append(sp_key)

    # Fill remaining if still below target
    for sp in non_mixed:
        if sum(1 for x in ordered_subps if has_praktijk(x)) >= target_praktijk_subps:
            break
        if has_praktijk(sp):
            continue
        host = find_host_paragraph(sp)
        if host is None:
            continue
        sp_key = str(sp.get("number") or "")
        override = str(praktijk_overrides.get(sp_key) or "").strip()
        sample = ""
        for b in sp.get("content", []):
            if isinstance(b, dict) and b.get("type") == "paragraph":
                txt = str(b.get("basis") or "").strip()
                if txt:
                    sample = txt
                    break
        host["praktijk"] = normalize_ws(override) if override else make_praktijk_text(sp_key, str(sp.get("title") or ""), sample)
        added_praktijk.append(sp_key)

    after_praktijk = sum(1 for sp in ordered_subps if has_praktijk(sp))
    after_verdieping = sum(1 for sp in ordered_subps if has_verdieping(sp))

    # Add deterministic verdieping boxes to hit target coverage (KD-free; no label text).
    added_verdieping: List[str] = []
    if target_verdieping_subps > 0:
        def first_basis_sentence(sp: Dict[str, Any]) -> str:
            for b in sp.get("content", []) or []:
                if isinstance(b, dict) and b.get("type") == "paragraph":
                    txt = str(b.get("basis") or "").strip()
                    if txt:
                        return txt
            return ""

        # Prefer a different cadence than praktijk so we don't always stack both on the same subparagraphs.
        for i, sp in enumerate(ordered_subps):
            if sum(1 for x in ordered_subps if has_verdieping(x)) >= target_verdieping_subps:
                break
            if vd_every <= 0:
                break
            # Offset by 1 to reduce overlap with praktijk's i%praktijk_every==0
            if i % vd_every != 1:
                continue
            if has_verdieping(sp):
                continue
            host = find_host_paragraph(sp)
            if host is None:
                continue
            sp_key = str(sp.get("number") or "")
            override = str(verdieping_overrides.get(sp_key) or "").strip()
            sample = first_basis_sentence(sp)
            host["verdieping"] = normalize_ws(override) if override else make_verdieping_text(str(sp.get("title") or ""), sample)
            added_verdieping.append(sp_key)

        # Fill remaining (if still below target)
        for sp in ordered_subps:
            if sum(1 for x in ordered_subps if has_verdieping(x)) >= target_verdieping_subps:
                break
            if has_verdieping(sp):
                continue
            host = find_host_paragraph(sp)
            if host is None:
                continue
            sp_key = str(sp.get("number") or "")
            override = str(verdieping_overrides.get(sp_key) or "").strip()
            sample = first_basis_sentence(sp)
            host["verdieping"] = normalize_ws(override) if override else make_verdieping_text(str(sp.get("title") or ""), sample)
            added_verdieping.append(sp_key)

        after_verdieping = sum(1 for sp in ordered_subps if has_verdieping(sp))

    # Write outputs
    write_json(out, book)

    rep.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    lines.append(f"## Praktijk/Verdieping layer report — Chapter {args.chapter}\n")
    lines.append(f"- input: `{inp}`")
    lines.append(f"- output: `{out}`")
    lines.append(f"- mapping: `{mapping_path}`")
    lines.append("")
    lines.append("### Policy\n")
    lines.append(f"- **mixed subparagraphs** (from mapping): `{len(mixed_keys)}`")
    lines.append(f"- **praktijk target**: ~1 per `{args.praktijk_every}` subparagraphs ⇒ `{target_praktijk_subps}` subparagraphs with praktijk")
    lines.append(f"- **verdieping target**: ~1 per `{vd_every}` subparagraphs ⇒ `{target_verdieping_subps}` subparagraphs with verdieping" if vd_every > 0 else "- **verdieping**: disabled (verdieping-every=0)")
    lines.append(f"- **cap**: max 1 praktijk + max 1 verdieping per subparagraph\n")
    lines.append("### Before → After\n")
    lines.append(f"- subparagraphs with praktijk: **{before_praktijk} → {after_praktijk}**")
    lines.append(f"- subparagraphs with verdieping: **{before_verdieping} → {after_verdieping}**\n")
    lines.append("### Mixed subparagraphs simplified\n")
    if args.simplify_mixed and mixed_keys:
        for k in sorted(mixed_keys, key=lambda x: [int(p) for p in x.split('.')]):
            st = mixed_stats.get(k) or {}
            lines.append(
                f"- `{k}`: micro_sections={st.get('micro_sections',0)}, bullet_blocks_removed={st.get('bullet_blocks_removed',0)}, verdieping_added={st.get('verdieping_added',False)}"
            )
    else:
        lines.append("- (skipped; run with --simplify-mixed to enable)")
    lines.append("")
    lines.append("### Praktijk added (new)\n")
    if added_praktijk:
        for k in added_praktijk:
            lines.append(f"- `{k}`")
    else:
        lines.append("- (none)")
    lines.append("")
    lines.append("### Verdieping added (new)\n")
    if added_verdieping:
        for k in added_verdieping:
            lines.append(f"- `{k}`")
    else:
        lines.append("- (none)")
    lines.append("")

    rep.write_text("\n".join(lines).rstrip() + "\n", "utf-8")


if __name__ == "__main__":
    main()




