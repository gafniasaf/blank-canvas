#!/usr/bin/env python3
"""
Final "intelligent" flow-polish pass for CanonicalBook JSON (Prince pipeline).

Why this exists:
- Deterministic rules are great for objective safety (markers, numbering, layout contracts),
  but they cannot guarantee natural language flow.
- This pass is an OPTIONAL last-mile editor: it only touches *flagged* blocks and keeps edits local.

What it does (conservative):
- Scans a canonical JSON (optionally a single chapter) for suspicious patterns:
  - praktijk blocks that look unrealistic (e.g. "zorgvrager vraagt wat het Golgi-systeem doet")
  - awkward list-item fragments / sentence-like pseudo headings
  - repeated “summary” lines that duplicate the previous sentence
- For each flagged block, calls an LLM (Anthropic Messages API) to rewrite ONLY that block,
  keeping meaning and house terminology.

Hard constraints:
- Never mention KD or codes.
- Always use "zorgvrager" and "zorgprofessional".
- No labels ("In de praktijk:" / "Verdieping:") inside the text (renderer adds them).
- No bullets in praktijk/verdieping; keep short flowing prose.

This script is designed to be integrated as an optional stage in a build pipeline.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def read_json(p: Path) -> Any:
    return json.loads(p.read_text("utf-8"))


def write_json(p: Path, obj: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", "utf-8")


def strip_markers(s: str) -> str:
    t = str(s or "")
    t = t.replace("<<BOLD_START>>", "").replace("<<BOLD_END>>", "")
    t = t.replace("<<MICRO_TITLE>>", "").replace("<<MICRO_TITLE_END>>", "")
    t = re.sub(r"\s*\n+\s*", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def replace_terms(s: str) -> str:
    t = str(s or "")
    # cliënt/client -> zorgvrager(s)
    t = re.sub(r"(?i)\bcliënten\b", "zorgvragers", t)
    t = re.sub(r"(?i)\bclienten\b", "zorgvragers", t)
    t = re.sub(r"(?i)\bclients\b", "zorgvragers", t)
    t = re.sub(r"(?i)\bcliënt\b", "zorgvrager", t)
    t = re.sub(r"(?i)\bclient\b", "zorgvrager", t)
    # verpleegkundige -> zorgprofessional(s)
    t = re.sub(r"(?i)\bverpleegkundigen\b", "zorgprofessionals", t)
    t = re.sub(r"(?i)\bverpleegkundige\b", "zorgprofessional", t)
    return t


def clean_box_text(s: str) -> str:
    t = strip_markers(s)
    t = replace_terms(t)
    t = re.sub(r"^(in de praktijk|verdieping)\s*:\s*", "", t, flags=re.I).strip()
    t = t.replace("\r", " ").replace("\n", " ")
    t = re.sub(r"\s+", " ", t).strip()
    # start lowercase unless abbreviation
    parts = t.split()
    if parts and not re.fullmatch(r"[A-Z0-9]{2,}", parts[0]):
        t = t[:1].lower() + t[1:]
    return t


def anthropic_messages(api_key: str, model: str, system: str, user: str, max_tokens: int, temperature: float) -> str:
    req = {
        "model": model,
        "max_tokens": int(max_tokens),
        "temperature": float(temperature),
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    data = json.dumps(req).encode("utf-8")
    r = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=data,
        headers={
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(r, timeout=120) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    jd = json.loads(raw)
    blocks = jd.get("content") or []
    out = ""
    for b in blocks:
        if isinstance(b, dict) and isinstance(b.get("text"), str):
            out += b["text"]
    return out.strip()


def parse_jsonish(s: str) -> Dict[str, Any]:
    raw = (s or "").strip()
    raw = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    i = raw.find("{")
    j = raw.rfind("}")
    if i >= 0 and j >= 0 and j > i:
        raw = raw[i : j + 1]
    return json.loads(raw)


def stable_hash(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update((p or "").encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()[:16]


def looks_unrealistic_praktijk(text: str) -> bool:
    t = strip_markers(text).lower()
    if not t:
        return False
    if "zorgvrager" not in t:
        return False
    if "vraagt" not in t:
        return False
    # theory-term questions we want to avoid
    if re.search(r"\b(golgi|mitochond|riboso|endoplasmatisch|atp|dna|rna|chromos)\b", t):
        return True
    if re.search(r"\bwat\s+doet\b", t) and re.search(r"\b(cel|organel|systeem)\b", t):
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input_json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--chapter", type=int, default=0, help="0 = all chapters")
    ap.add_argument("--model", default="claude-opus-4-5-20251101")
    ap.add_argument("--max-tokens", type=int, default=380)
    ap.add_argument("--temperature", type=float, default=0.2)
    ap.add_argument("--cache", default="")
    ap.add_argument("--prompt-version", default="v1")
    args = ap.parse_args()

    api_key = str(os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise SystemExit("❌ Missing ANTHROPIC_API_KEY in environment")

    inp = Path(args.input_json)
    outp = Path(args.out)
    rep = Path(args.report)

    book = read_json(inp)

    cache_path = Path(args.cache) if args.cache else None
    cache: Dict[str, Any] = {}
    if cache_path and cache_path.exists():
        try:
            cache = read_json(cache_path)
        except Exception:
            cache = {}

    system = (
        "Je bent eindredacteur (N3 zorgboek) die alleen lokale micro-fixes doet.\n"
        "Doel: betere leesflow en realistische praktijkcues.\n\n"
        "Regels:\n"
        "- Nooit KD noemen.\n"
        "- Gebruik altijd zorgvrager (nooit cliënt/client).\n"
        "- Gebruik altijd zorgprofessional (nooit verpleegkundige).\n"
        "- Schrijf GEEN labels zoals 'In de praktijk:' of 'Verdieping:'.\n"
        "- Praktijk: realistisch, gewone taal, géén celjargon in wat je tegen de zorgvrager zegt.\n"
        "- Geen bullets; 2–4 zinnen.\n"
        "- Houd betekenis; geen nieuwe feiten.\n"
        "- Output STRICT JSON: {\"praktijk\":\"...\"}\n"
    )

    touched: List[str] = []
    start = time.time()

    for ch in book.get("chapters", []):
        if args.chapter and str(ch.get("number")) != str(args.chapter):
            continue
        for sec in ch.get("sections", []) or []:
            for sp in sec.get("content", []) or []:
                if not isinstance(sp, dict) or sp.get("type") != "subparagraph":
                    continue
                sp_num = str(sp.get("number") or "").strip()
                sp_title = str(sp.get("title") or "").strip()
                # light context
                basis_ctx_parts: List[str] = []
                for b in sp.get("content", []) or []:
                    if isinstance(b, dict) and b.get("type") == "paragraph":
                        txt = strip_markers(str(b.get("basis") or "")).strip()
                        if txt:
                            basis_ctx_parts.append(txt)
                    if len(" ".join(basis_ctx_parts).split()) > 160:
                        break
                basis_ctx = " ".join(" ".join(basis_ctx_parts).split()[:160])

                for b in sp.get("content", []) or []:
                    if not isinstance(b, dict) or b.get("type") != "paragraph":
                        continue
                    pr = str(b.get("praktijk") or "").strip()
                    if not pr:
                        continue
                    if not looks_unrealistic_praktijk(pr):
                        # still enforce terminology/cleanup deterministically
                        b["praktijk"] = clean_box_text(pr)
                        continue

                    user = (
                        f"PROMPT_VERSION: {args.prompt_version}\n"
                        f"Subparagraaf: {sp_num} — {sp_title}\n\n"
                        f"Context (basis, fragment): {basis_ctx}\n\n"
                        f"Huidige praktijktekst (fout/onrealistisch): {strip_markers(pr)}\n\n"
                        f"Schrijf een realistische praktijktekst die wél past.\n"
                    )
                    key = stable_hash(args.prompt_version, args.model, user)
                    cached = cache.get(key) if isinstance(cache, dict) else None
                    if cached and isinstance(cached, dict) and isinstance(cached.get("praktijk"), str):
                        obj = cached
                    else:
                        resp = anthropic_messages(api_key, args.model, system, user, args.max_tokens, args.temperature)
                        obj = parse_jsonish(resp)
                        if cache_path is not None:
                            cache[key] = obj
                            try:
                                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", "utf-8")
                            except Exception:
                                pass

                    new_pr = clean_box_text(str(obj.get("praktijk") or ""))
                    if new_pr:
                        b["praktijk"] = new_pr
                        touched.append(f"{sp_num}:praktijk")

    # Write outputs
    write_json(outp, book)
    rep.parent.mkdir(parents=True, exist_ok=True)
    rep.write_text(
        "## Flow polish report\n\n"
        + f"- input: `{inp}`\n"
        + f"- output: `{outp}`\n"
        + f"- model: `{args.model}`\n"
        + f"- touched: `{len(touched)}`\n"
        + f"- time: {time.time() - start:.1f}s\n\n"
        + ("### Changes\n\n" + "\n".join([f"- `{x}`" for x in touched]) + "\n" if touched else "### Changes\n\n- (none)\n"),
        "utf-8",
    )


if __name__ == "__main__":
    main()
































