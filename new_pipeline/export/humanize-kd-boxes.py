#!/usr/bin/env python3
"""
Humanize KD-differentiation boxes (praktijk/verdieping) using an LLM, before scaling to the whole book.

Strategy (Chapter 1 POC):
- Only rewrite boxes that were *introduced by the KD-differentiation step*:
  - praktijk: present in current JSON but absent in base JSON
  - verdieping: present in current JSON but absent in base JSON
- Keep student-facing content KD-free: never mention "KD", codes, or workprocess names in the box copy.
- Enforce house rules:
  - Do NOT include "In de praktijk:" / "Verdieping:" labels (renderer adds them)
  - Text starts lowercase after label (except abbreviation-like tokens like DNA/ATP)
  - No bullet lists; just short flowing prose

Requires:
- ANTHROPIC_API_KEY in environment (Anthropic Messages API)
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


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULES_PATH = REPO_ROOT / "docs" / "kd" / "modules" / "module_registry.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", "utf-8")


def strip_markers(s: str) -> str:
    t = str(s or "")
    t = t.replace("<<BOLD_START>>", "").replace("<<BOLD_END>>", "")
    t = t.replace("<<MICRO_TITLE>>", "").replace("<<MICRO_TITLE_END>>", "")
    t = re.sub(r"\s*\n+\s*", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def replace_client_terms(s: str) -> str:
    """
    House style: use 'zorgvrager' (never cliënt/client).
    Handles singular/plural and preserves capitalization.
    """
    t = str(s or "")

    # Match boundaries in a Unicode-ish way (covers accented characters used in Dutch).
    # We capture the prefix to preserve it.
    re_client = re.compile(r"(^|[^0-9A-Za-zÀ-ÿ])(cliënten|clienten|cliënt|client|clients)(?![0-9A-Za-zÀ-ÿ])", re.I)

    def repl(m: re.Match) -> str:
        pre = m.group(1) or ""
        tok = m.group(2) or ""
        low = tok.lower()
        is_plural = low in ("cliënten", "clienten", "clients")
        # Capitalization: if token starts with uppercase, use Zorgvrager(s)
        cap = tok[:1].isupper()
        base = "Zorgvrager" if cap else "zorgvrager"
        if is_plural:
            base = base + "s"
        return pre + base

    return re_client.sub(repl, t)


def replace_nurse_terms(s: str) -> str:
    """
    House style: use 'zorgprofessional' (never verpleegkundige).
    Handles singular/plural and preserves capitalization.
    """
    t = str(s or "")

    re_nurse = re.compile(r"(^|[^0-9A-Za-zÀ-ÿ])(verpleegkundigen|verpleegkundige)(?![0-9A-Za-zÀ-ÿ])", re.I)

    def repl(m: re.Match) -> str:
        pre = m.group(1) or ""
        tok = m.group(2) or ""
        low = tok.lower()
        is_plural = low == "verpleegkundigen"
        cap = tok[:1].isupper()
        base = "Zorgprofessional" if cap else "zorgprofessional"
        if is_plural:
            base = base + "s"
        return pre + base

    return re_nurse.sub(repl, t)


def starts_with_abbrev_token(s: str) -> bool:
    first = (s or "").strip().split()
    if not first:
        return False
    w = first[0]
    # Treat 2+ upper letters/digits as abbreviation-like
    return bool(re.fullmatch(r"[A-Z0-9]{2,}", w))


def lowercase_first_letter_if_needed(s: str) -> str:
    t = (s or "").strip()
    if not t:
        return ""
    if starts_with_abbrev_token(t):
        return t
    m = re.match(r'^([\s"“‘(]*)([A-Za-zÀ-ÿ])', t)
    if not m:
        return t
    pre = m.group(1)
    ch = m.group(2)
    return pre + ch.lower() + t[len(pre) + 1 :]


def clean_box_text(s: str) -> str:
    t = strip_markers(s)
    t = replace_client_terms(t)
    t = replace_nurse_terms(t)
    # Remove accidental labels
    t = re.sub(r"^(in de praktijk|verdieping)\s*:\s*", "", t, flags=re.I)
    # Remove leading dash/bullet artifacts
    t = re.sub(r"^[-•\u2022]+\s*", "", t).strip()
    # No newlines/bullets
    t = t.replace("\r", " ").replace("\n", " ")
    t = re.sub(r"\s+", " ", t).strip()
    # Ensure lowercase start
    t = lowercase_first_letter_if_needed(t)
    return t


def clamp_words(s: str, min_words: int, max_words: int) -> str:
    words = [w for w in re.split(r"\s+", (s or "").strip()) if w]
    if not words:
        return ""
    if len(words) > max_words:
        s = " ".join(words[:max_words]).rstrip(",;:") + "…"
    # If too short, we leave as-is (LLM should respect min)
    return s


def extract_subparagraphs(book: Dict[str, Any], chapter: int) -> Dict[str, Dict[str, Any]]:
    """
    Map: subparagraph_number -> {
      title, paragraphs(list of paragraph blocks), all_basis_text
    }
    """
    out: Dict[str, Dict[str, Any]] = {}
    for ch in book.get("chapters", []):
        if str(ch.get("number")) != str(chapter):
            continue
        for sec in ch.get("sections", []):
            for sp in sec.get("content", []):
                if not isinstance(sp, dict) or sp.get("type") != "subparagraph":
                    continue
                num = str(sp.get("number") or "").strip()
                if not num:
                    continue
                paras = [p for p in (sp.get("content") or []) if isinstance(p, dict) and p.get("type") == "paragraph"]
                basis_text = " ".join([strip_markers(str(p.get("basis") or "")) for p in paras if str(p.get("basis") or "").strip()])
                out[num] = {
                    "title": str(sp.get("title") or "").strip(),
                    "paragraphs": paras,
                    "all_basis_text": basis_text.strip(),
                }
    return out


def find_box_host(paras: List[Dict[str, Any]], field: str) -> Optional[Dict[str, Any]]:
    for p in paras:
        if str(p.get(field) or "").strip():
            return p
    return None


@dataclass
class Module:
    module_id: str
    title: str
    kind: str
    intent: str


def load_modules() -> Dict[str, Module]:
    reg = read_json(MODULES_PATH)
    out: Dict[str, Module] = {}
    for m in reg.get("modules") or []:
        mid = str(m.get("module_id") or "").strip()
        if not mid:
            continue
        out[mid] = Module(
            module_id=mid,
            title=str(m.get("title") or "").strip(),
            kind=str(m.get("kind") or "").strip(),
            intent=str(m.get("intent") or "").strip(),
        )
    return out


def classify_praktijk_module(text: str) -> str:
    t = strip_markers(text).lower()
    if re.search(r"\b(acuut|reanimat|bls|protocol|spoed|bewusteloos)\b", t):
        return "PRAKTIJK_ACUTE_PROTOCOL_BLS"
    if re.search(r"\b(mantelzorg|naasten|familie|overbelasting)\b", t):
        return "PRAKTIJK_MANTELZORG_ALIGN"
    if re.search(r"\b(sbar|rapporteer|rapportage|rapporteren|observeer|observatie|signaleer|signaleren|meet|meten|noteer|noteren|meld|melden|bijhouden)\b", t):
        return "PRAKTIJK_OBSERVE_SIGNAL_REPORT_SBAR"
    return "PRAKTIJK_INFO_ADVICE_HEALTH"


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
    texts: List[str] = []
    for b in blocks:
        if isinstance(b, dict) and isinstance(b.get("text"), str):
            texts.append(b["text"])
    return "".join(texts).strip()


def parse_jsonish_object(s: str) -> Dict[str, Any]:
    raw = (s or "").strip()
    # Strip markdown fences
    raw = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    # Find JSON object
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="Base canonical JSON (before KD differentiation)")
    ap.add_argument("--current", required=True, help="Current canonical JSON (after KD differentiation)")
    ap.add_argument("--out", required=True, help="Output JSON path")
    ap.add_argument("--report", required=True, help="Report markdown path")
    ap.add_argument("--chapter", type=int, default=1)
    ap.add_argument("--model", default="claude-opus-4-5-20251101")
    ap.add_argument("--max-tokens", type=int, default=420)
    ap.add_argument("--temperature", type=float, default=0.25)
    ap.add_argument("--cache", default="", help="Optional cache JSON path (to avoid re-calling LLM)")
    ap.add_argument("--prompt-version", default="v1", help="Bump to invalidate cache when prompt rules change")
    args = ap.parse_args()

    api_key = str(os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise SystemExit("❌ Missing ANTHROPIC_API_KEY in environment")

    base_path = Path(args.base)
    cur_path = Path(args.current)
    out_path = Path(args.out)
    report_path = Path(args.report)

    base_book = read_json(base_path)
    cur_book = read_json(cur_path)

    base_subs = extract_subparagraphs(base_book, args.chapter)
    cur_subs = extract_subparagraphs(cur_book, args.chapter)

    modules = load_modules()

    cache_path = Path(args.cache) if args.cache else None
    cache: Dict[str, Any] = {}
    if cache_path and cache_path.exists():
        try:
            cache = read_json(cache_path)
        except Exception:
            cache = {}

    changed_praktijk: List[str] = []
    changed_verdieping: List[str] = []

    # Identify new boxes per subparagraph (present in current but absent in base)
    targets: List[Tuple[str, bool, bool]] = []
    for num, cur in cur_subs.items():
        base = base_subs.get(num) or {}
        cur_paras = cur.get("paragraphs") or []
        base_paras = base.get("paragraphs") or []

        cur_pr_host = find_box_host(cur_paras, "praktijk")
        cur_vd_host = find_box_host(cur_paras, "verdieping")
        base_pr_host = find_box_host(base_paras, "praktijk") if base_paras else None
        base_vd_host = find_box_host(base_paras, "verdieping") if base_paras else None

        pr_new = bool(cur_pr_host and str(cur_pr_host.get("praktijk") or "").strip() and not (base_pr_host and str(base_pr_host.get("praktijk") or "").strip()))
        vd_new = bool(cur_vd_host and str(cur_vd_host.get("verdieping") or "").strip() and not (base_vd_host and str(base_vd_host.get("verdieping") or "").strip()))

        if pr_new or vd_new:
            targets.append((num, pr_new, vd_new))

    # LLM prompts
    system = (
        "Je bent redacteur voor een Nederlands MBO-zorgboek (studentvriendelijk, N3-route).\n"
        "Je schrijft korte, natuurlijk klinkende tekst voor twee gekleurde kaders:\n"
        "- PRAKTIJK: herkenbare zorgsituatie + wat de student praktisch doet/let op/zegt.\n"
        "- VERDIEPING: extra uitleg die je mag overslaan; iets dieper, maar nog steeds helder.\n\n"
        "Belangrijk:\n"
        "- Nooit 'KD', werkprocescodes of beleidstaal noemen.\n"
        "- Gebruik altijd het woord 'zorgvrager' (nooit cliënt/client).\n"
        "- Gebruik altijd het woord 'zorgprofessional' (nooit verpleegkundige).\n"
        "- Praktijk moet realistisch zijn: schrijf niet dat een zorgvrager vraagt naar theorie-termen (zoals Golgi-systeem).\n"
        "  Start vanuit een herkenbare zorgsituatie (klacht/observatie/handeling/medicatie/vochtbalans/wondzorg) en koppel dan kort aan het begrip.\n"
        "- Kies geen complexe of zeldzame aandoeningen. Gebruik veilige, algemene voorbeelden (wondzorg, uitdroging, benauwdheid, vermoeidheid, medicatie, infectie).\n"
        "- PRAKTIJK moet in gewone taal: noem geen celonderdelen of vakjargon als uitleg aan de zorgvrager. Als je theorie noemt, doe dat als kennis voor de student, heel kort.\n"
        "- Schrijf GEEN label zoals 'In de praktijk:' of 'Verdieping:' (die staat al in de layout).\n"
        "- Geen opsommingen of bullets; één vloeiende alinea per veld.\n"
        "- Start met een klein letter (behalve bij afkortingen zoals DNA/ATP).\n"
        "- Gebruik eenvoudige zinnen, maar niet kinderachtig.\n"
    )

    def build_user_prompt(num: str, title: str, basis_context: str, pr_need: bool, vd_need: bool, pr_module: Optional[Module], pr_current: str, vd_current: str) -> str:
        parts: List[str] = []
        parts.append(f"PROMPT_VERSION: {args.prompt_version}")
        parts.append(f"Subparagraaf: {num} — {title}".strip())
        parts.append("")
        parts.append("Context (basis, fragment):")
        parts.append(basis_context)
        parts.append("")
        if pr_need:
            parts.append("Je taak: schrijf een PRAKTIJK-tekst (2–4 zinnen, 35–65 woorden).")
            parts.append("Extra: schrijf praktijkgericht in gewone taal; noem geen celonderdelen/vakjargon in wat je tegen de zorgvrager zegt.")
            if pr_module:
                parts.append(f"Praktijk-module intent (intern): {pr_module.intent}")
            if pr_current:
                parts.append(f"Huidige (te template-achtige) praktijktekst:\n{pr_current}")
            parts.append("")
        else:
            parts.append("Je taak: PRAKTIJK leeg laten.")
            parts.append("")
        if vd_need:
            parts.append("Je taak: schrijf een VERDIEPING-tekst (5–9 zinnen, 90–160 woorden).")
            if vd_current:
                parts.append(f"Huidige (te template-achtige) verdiepingtekst:\n{vd_current}")
            parts.append("")
        else:
            parts.append("Je taak: VERDIEPING leeg laten.")
            parts.append("")
        parts.append("Output: geef STRICT JSON met precies deze keys: praktijk, verdieping.")
        parts.append('Voorbeeld: {"praktijk":"...","verdieping":""}')
        return "\n".join(parts).strip() + "\n"

    start = time.time()
    for idx, (num, pr_need, vd_need) in enumerate(targets, start=1):
        cur = cur_subs[num]
        title = cur.get("title") or ""
        basis_full = str((base_subs.get(num) or {}).get("all_basis_text") or cur.get("all_basis_text") or "")
        # Clamp context to ~220 words
        ctx_words = basis_full.split()
        basis_context = " ".join(ctx_words[:220]).strip()
        if len(ctx_words) > 220:
            basis_context += " …"

        cur_paras = cur.get("paragraphs") or []
        pr_host = find_box_host(cur_paras, "praktijk")
        vd_host = find_box_host(cur_paras, "verdieping")
        pr_current = strip_markers(str(pr_host.get("praktijk") or "")) if (pr_host and pr_need) else ""
        vd_current = strip_markers(str(vd_host.get("verdieping") or "")) if (vd_host and vd_need) else ""

        pr_mid = classify_praktijk_module(pr_current) if pr_need else ""
        pr_module = modules.get(pr_mid) if pr_mid else None

        user_prompt = build_user_prompt(num, title, basis_context, pr_need, vd_need, pr_module, pr_current, vd_current)
        cache_key = stable_hash(str(args.chapter), num, user_prompt, args.model)
        cached = cache.get(cache_key) if isinstance(cache, dict) else None

        print(f"[{idx}/{len(targets)}] Humanizing {num} (praktijk={pr_need}, verdieping={vd_need}) …")

        if cached and isinstance(cached, dict) and isinstance(cached.get("praktijk"), str) and isinstance(cached.get("verdieping"), str):
            out_obj = cached
        else:
            # Retry a few times for robustness
            last_err = None
            out_obj = None
            for attempt in range(1, 5):
                try:
                    resp = anthropic_messages(api_key, args.model, system, user_prompt, args.max_tokens, args.temperature)
                    out_obj = parse_jsonish_object(resp)
                    break
                except Exception as e:
                    last_err = e
                    time.sleep(1.5 * attempt)
            if out_obj is None:
                raise RuntimeError(f"LLM failed for {num}: {last_err}")
            if cache_path:
                cache[cache_key] = out_obj
                try:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", "utf-8")
                except Exception:
                    pass

        pr_new = clean_box_text(str(out_obj.get("praktijk") or "")) if pr_need else ""
        vd_new = clean_box_text(str(out_obj.get("verdieping") or "")) if vd_need else ""
        if pr_new:
            pr_new = clamp_words(pr_new, min_words=30, max_words=75)
        if vd_new:
            vd_new = clamp_words(vd_new, min_words=80, max_words=190)

        # Apply back to hosts
        if pr_need and pr_host is not None:
            pr_host["praktijk"] = pr_new
            changed_praktijk.append(num)
        if vd_need and vd_host is not None:
            vd_host["verdieping"] = vd_new
            changed_verdieping.append(num)

    # Write output JSON
    # Also enforce terminology globally so older (pre-existing) boxes can't regress.
    for ch in cur_book.get("chapters", []):
        for sec in ch.get("sections", []) or []:
            for sp in sec.get("content", []) or []:
                if not isinstance(sp, dict) or sp.get("type") != "subparagraph":
                    continue
                for p in sp.get("content", []) or []:
                    if not isinstance(p, dict) or p.get("type") != "paragraph":
                        continue
                    if isinstance(p.get("praktijk"), str):
                        p["praktijk"] = clean_box_text(p.get("praktijk") or "")
                    if isinstance(p.get("verdieping"), str):
                        p["verdieping"] = clean_box_text(p.get("verdieping") or "")

    write_json(out_path, cur_book)

    # Report
    took = time.time() - start
    lines: List[str] = []
    lines.append(f"## Humanize KD boxes report — Chapter {args.chapter}\n")
    lines.append(f"- base: `{base_path}`")
    lines.append(f"- input(current): `{cur_path}`")
    lines.append(f"- output: `{out_path}`")
    lines.append(f"- model: `{args.model}`")
    lines.append(f"- targets: `{len(targets)}` subparagraphs")
    lines.append(f"- praktijk rewritten: `{len(changed_praktijk)}`")
    lines.append(f"- verdieping rewritten: `{len(changed_verdieping)}`")
    lines.append(f"- time: {took:.1f}s\n")
    if changed_praktijk:
        lines.append("### Praktijk rewritten\n")
        for n in changed_praktijk:
            lines.append(f"- `{n}`")
        lines.append("")
    if changed_verdieping:
        lines.append("### Verdieping rewritten\n")
        for n in changed_verdieping:
            lines.append(f"- `{n}`")
        lines.append("")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines).rstrip() + "\n", "utf-8")

    print(f"✅ Done. Output: {out_path}")


if __name__ == "__main__":
    main()


