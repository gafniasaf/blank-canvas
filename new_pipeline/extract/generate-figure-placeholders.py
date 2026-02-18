#!/usr/bin/env python3
"""
generate-figure-placeholders.py

Creates placeholder PNGs for figures with the SAME pixel dimensions as the source figure images.
Placeholders include readable figure id + caption text rendered into the image.

Inputs:
- new_pipeline/extract/figure_manifest_ch<N>.json (per-chapter)
- new_pipeline/assets/figures/ch<N>/*.png (atomic figure exports referenced by the manifests)

Output (gitignored):
- output/figure_placeholders/<book_id>/<runId>/placeholders/ch<N>/<FigureId>.png
- output/figure_placeholders/<book_id>/<runId>/placeholders.manifest.json

Usage:
  python3 new_pipeline/extract/generate-figure-placeholders.py --book MBO_AF4_2024_COMMON_CORE

Options:
  --book <book_id>          Optional (default: first entry in books/manifest.json)
  --chapters "1,2,3"        Optional (default: all figure_manifest_ch*.json found)
  --out-dir <dir>           Optional (default: output/figure_placeholders/<book>/<runId>)
  --force                   Overwrite existing placeholder PNGs (default: skip existing)
"""

from __future__ import annotations

import argparse
import json
import re
import textwrap
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


RE_FIG = re.compile(r"^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)?)", re.IGNORECASE)


def run_id_stamp() -> str:
    d = datetime.now()
    return d.strftime("%Y%m%d_%H%M%S")


def parse_csv_ints(s: str) -> List[int]:
    s = (s or "").strip()
    if not s:
        return []
    out: List[int] = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            n = int(part)
            if n > 0:
                out.append(n)
        except Exception:
            pass
    return out


def normalize_ws(s: str) -> str:
    s = (s or "").replace("\u00ad", "")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def to_safe_filename(s: str) -> str:
    s = normalize_ws(s)
    s = s.replace(" ", "_")
    s = re.sub(r"[^A-Za-z0-9_.-]+", "", s)
    return s or "figure"


def split_caption(label: str, body: str, raw: str) -> Tuple[str, str]:
    label = normalize_ws(label or "")
    body = normalize_ws(body or "")
    raw = normalize_ws(raw or "")
    if label and body:
        if not label.endswith(":"):
            label = f"{label}:"
        return label, body
    if raw:
        m = re.match(r"^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)?)\s*:?\s*(.*)$", raw, flags=re.I)
        if m:
            lab = f"{m.group(1)} {m.group(2)}:"
            return lab, normalize_ws(m.group(3) or "")
        if ":" in raw:
            idx = raw.index(":")
            return normalize_ws(raw[: idx + 1]), normalize_ws(raw[idx + 1 :])
        return "", raw
    return label, body


def figure_id_from_label(label_or_raw: str, fallback_filename: str) -> str:
    t = normalize_ws(label_or_raw or "")
    if t:
        m = RE_FIG.match(t)
        if m:
            # Afbeelding 3.2: -> Afbeelding_3.2
            return to_safe_filename(f"{m.group(1)}_{m.group(2)}")
    base = Path(fallback_filename or "figure").stem
    return to_safe_filename(base)


def resolve_repo_root() -> Path:
    # script is at <repo>/new_pipeline/extract/generate-figure-placeholders.py
    return Path(__file__).resolve().parents[2]


def load_default_book_id(repo_root: Path) -> str:
    manifest_path = repo_root / "books" / "manifest.json"
    try:
        m = json.loads(manifest_path.read_text("utf-8"))
        books = m.get("books") or []
        if books and books[0].get("book_id"):
            return str(books[0]["book_id"])
    except Exception:
        pass
    return "BOOK"


def list_figure_manifests(extract_dir: Path, chapters_filter: List[int]) -> List[Tuple[int, Path]]:
    out: List[Tuple[int, Path]] = []
    for p in sorted(extract_dir.glob("figure_manifest_ch*.json")):
        m = re.match(r"^figure_manifest_ch(\d+)\.json$", p.name, flags=re.I)
        if not m:
            continue
        ch = int(m.group(1))
        if chapters_filter and ch not in chapters_filter:
            continue
        out.append((ch, p))
    out.sort(key=lambda x: x[0])
    return out


def decode_link_path(link_path: str) -> str:
    p = str(link_path or "").strip()
    if p.startswith("file:"):
        p = re.sub(r"^file:", "", p)
    try:
        from urllib.parse import unquote

        p = unquote(p)
    except Exception:
        p = p.replace("%20", " ")
    if p.startswith("//"):
        p = p[1:]
    return p


def load_chapter_image_map(repo_root: Path, chapter: int) -> Dict[str, str]:
    # new_pipeline/extract/chN-images-map.json is an array of {sourcePath, localPath}
    p = repo_root / "new_pipeline" / "extract" / f"ch{chapter}-images-map.json"
    if not p.exists():
        return {}
    try:
        raw = json.loads(p.read_text("utf-8"))
        m: Dict[str, str] = {}
        for it in raw or []:
            src = str((it or {}).get("sourcePath") or "").strip()
            loc = str((it or {}).get("localPath") or "").strip()
            if src and loc:
                m[src] = loc
        return m
    except Exception:
        return {}


def try_load_font(size: int) -> ImageFont.ImageFont:
    # Best-effort: use system fonts on macOS, fallback to PIL default.
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial.ttf",
        "/Library/Fonts/Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for fp in candidates:
        p = Path(fp)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size)
            except Exception:
                pass
    try:
        return ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()


def text_bbox(font: ImageFont.ImageFont, text: str) -> Tuple[int, int]:
    # returns (w, h)
    if not text:
        return (0, 0)
    try:
        b = font.getbbox(text)
        return (b[2] - b[0], b[3] - b[1])
    except Exception:
        # very old PIL fallback
        return font.getsize(text)


def wrap_text(font: ImageFont.ImageFont, text: str, max_width: int) -> List[str]:
    text = normalize_ws(text or "")
    if not text:
        return []
    words = text.split(" ")
    lines: List[str] = []
    cur: List[str] = []
    for w in words:
        cand = (" ".join(cur + [w])).strip()
        if not cand:
            continue
        if text_bbox(font, cand)[0] <= max_width:
            cur.append(w)
            continue
        if cur:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            # single long word; hard wrap
            lines.append(cand)
            cur = []
    if cur:
        lines.append(" ".join(cur))
    return lines


def draw_placeholder(
    size: Tuple[int, int],
    figure_label: str,
    figure_id: str,
    caption: str,
) -> Image.Image:
    w, h = size
    w = max(8, int(w))
    h = max(8, int(h))

    # Background + border
    bg = (245, 245, 245, 255)
    border = (170, 170, 170, 255)
    ink = (40, 40, 40, 255)
    ink2 = (80, 80, 80, 255)
    diag = (220, 220, 220, 255)

    img = Image.new("RGBA", (w, h), bg)
    d = ImageDraw.Draw(img)

    bw = max(2, int(min(w, h) * 0.006))
    for i in range(bw):
        d.rectangle([i, i, w - 1 - i, h - 1 - i], outline=border)

    # Diagonal cross (helps spot aspect ratio quickly)
    d.line([0, 0, w - 1, h - 1], fill=diag, width=max(2, bw))
    d.line([0, h - 1, w - 1, 0], fill=diag, width=max(2, bw))

    # Font sizes relative to image size
    base = max(14, int(min(w, h) * 0.05))
    title_size = max(18, min(92, int(base * 1.35)))
    body_size = max(14, min(64, int(base * 0.95)))
    small_size = max(12, min(44, int(base * 0.75)))

    f_title = try_load_font(title_size)
    f_body = try_load_font(body_size)
    f_small = try_load_font(small_size)

    margin = max(24, int(min(w, h) * 0.06))
    max_text_w = max(200, w - margin * 2)

    fig_label_norm = normalize_ws(figure_label or "")
    fig_id_norm = normalize_ws(figure_id or "")
    cap_norm = normalize_ws(caption or "")

    # Compose lines
    top_left = "PLACEHOLDER"
    header = fig_label_norm.rstrip(":") if fig_label_norm else fig_id_norm.replace("_", " ")
    sub = f"ID: {fig_id_norm}" if fig_id_norm else ""

    cap_lines = wrap_text(f_body, cap_norm, max_text_w)[:6]  # avoid huge blocks

    lines: List[Tuple[str, ImageFont.ImageFont, Tuple[int, int, int, int]]] = []
    lines.append((header, f_title, ink))
    if sub:
        lines.append((sub, f_small, ink2))
    for cl in cap_lines:
        lines.append((cl, f_body, ink))

    # Compute total height
    spacing = max(6, int(body_size * 0.35))
    heights = [text_bbox(font, txt)[1] for (txt, font, _c) in lines if txt]
    total_h = sum(heights) + spacing * max(0, len(heights) - 1)

    y0 = max(margin, int((h - total_h) / 2))
    y = y0
    for (txt, font, color) in lines:
        if not txt:
            continue
        tw, th = text_bbox(font, txt)
        x = int((w - tw) / 2)
        d.text((x, y), txt, font=font, fill=color)
        y += th + spacing

    # Top-left mark
    d.text((margin // 2, margin // 3), top_left, font=f_small, fill=ink2)

    return img.convert("RGB")  # keep PNG smaller; no alpha needed


def main() -> None:
    repo_root = resolve_repo_root()
    default_book = load_default_book_id(repo_root)

    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default=default_book)
    ap.add_argument("--chapters", default="")
    ap.add_argument("--out-dir", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    book_id = str(args.book).strip() or default_book
    chapters_filter = parse_csv_ints(str(args.chapters))

    extract_dir = repo_root / "new_pipeline" / "extract"
    manifests = list_figure_manifests(extract_dir, chapters_filter)
    if not manifests:
        raise SystemExit(f"No figure manifests found in {extract_dir} (expected figure_manifest_ch<N>.json)")

    run_id = run_id_stamp()
    out_root = Path(args.out_dir).expanduser() if args.out_dir else (repo_root / "output" / "figure_placeholders" / book_id / run_id)
    out_root.mkdir(parents=True, exist_ok=True)
    out_placeholders = out_root / "placeholders"
    out_placeholders.mkdir(parents=True, exist_ok=True)

    results: List[Dict[str, Any]] = []
    rendered = 0
    skipped_exists = 0
    missing_source = 0
    errors: List[Dict[str, str]] = []

    chapter_maps: Dict[int, Dict[str, str]] = {}

    for (ch, mf_path) in manifests:
        data = json.loads(mf_path.read_text("utf-8"))
        figures = data.get("figures") or []
        if ch not in chapter_maps:
            chapter_maps[ch] = load_chapter_image_map(repo_root, ch)

        ch_dir = out_placeholders / f"ch{ch}"
        ch_dir.mkdir(parents=True, exist_ok=True)

        for fig in figures:
            # Resolve source image path (for dimensions):
            # 1) asset.path / image.atomicPath (repo-relative) if present
            # 2) image.linkPath mapped via chN-images-map.json (repo-relative)
            # 3) image.linkPath direct on disk (decoded)
            asset_rel = (fig.get("asset") or {}).get("path") or (fig.get("image") or {}).get("atomicPath") or ""
            asset_rel = str(asset_rel or "").strip()

            cap_obj = fig.get("caption") or {}
            label, body = split_caption(cap_obj.get("label") or "", cap_obj.get("body") or "", cap_obj.get("raw") or "")
            img_obj = fig.get("image") or {}
            fallback_filename = Path(asset_rel).name if asset_rel else str(img_obj.get("linkName") or "figure.png")
            figure_id = figure_id_from_label(label or cap_obj.get("raw") or "", fallback_filename)

            asset_abs: Optional[Path] = None
            asset_rel_for_manifest = ""
            if asset_rel:
                p = (repo_root / asset_rel) if not Path(asset_rel).is_absolute() else Path(asset_rel)
                if p.exists() and p.is_file():
                    asset_abs = p
                    asset_rel_for_manifest = asset_rel
            if asset_abs is None:
                img = fig.get("image") or {}
                link_path = str(img.get("linkPath") or "").strip()
                if link_path:
                    decoded = decode_link_path(link_path)
                    # map to local copy if present
                    local = chapter_maps.get(ch, {}).get(decoded)
                    if local:
                        p2 = (repo_root / local)
                        if p2.exists() and p2.is_file():
                            asset_abs = p2
                            asset_rel_for_manifest = str(local).replace("\\", "/")
                    if asset_abs is None:
                        p3 = Path(decoded)
                        if p3.exists() and p3.is_file():
                            asset_abs = p3
                            asset_rel_for_manifest = str(p3)
            if asset_abs is None:
                # last resort: derive from figure_id (matches atomic export naming when available)
                guess = repo_root / "new_pipeline" / "assets" / "figures" / f"ch{ch}" / f"{figure_id}.png"
                if guess.exists() and guess.is_file():
                    asset_abs = guess
                    asset_rel_for_manifest = str(guess.relative_to(repo_root)).replace("\\", "/")

            out_abs = ch_dir / f"{figure_id}.png"
            if out_abs.exists() and not args.force:
                skipped_exists += 1
                results.append(
                    {
                        "book_id": book_id,
                        "chapter": str(ch),
                        "figure_id": figure_id,
                        "label": label,
                        "caption": body,
                        "source_asset_path": asset_rel_for_manifest or asset_rel.replace("\\", "/"),
                        "source_asset_abs": str(asset_abs) if asset_abs else "",
                        "placeholder_path": str(out_abs.relative_to(repo_root)).replace("\\", "/"),
                        "placeholder_abs": str(out_abs),
                        "skipped": True,
                    }
                )
                continue

            if asset_abs is None or not asset_abs.exists() or not asset_abs.is_file():
                missing_source += 1
                errors.append({"chapter": str(ch), "figure_id": figure_id, "error": f"missing source image: {asset_abs}"})
                continue

            try:
                with Image.open(asset_abs) as im:
                    w, h = im.size
                ph = draw_placeholder((w, h), label, figure_id, body)
                ph.save(out_abs, format="PNG", optimize=True)
                rendered += 1
                results.append(
                    {
                        "book_id": book_id,
                        "chapter": str(ch),
                        "figure_id": figure_id,
                        "label": label,
                        "caption": body,
                        "source_asset_path": asset_rel_for_manifest or asset_rel.replace("\\", "/"),
                        "source_asset_abs": str(asset_abs),
                        "placeholder_path": str(out_abs.relative_to(repo_root)).replace("\\", "/"),
                        "placeholder_abs": str(out_abs),
                        "size": [w, h],
                    }
                )
            except Exception as e:
                errors.append({"chapter": str(ch), "figure_id": figure_id, "error": str(e)})

    manifest_out = {
        "book_id": book_id,
        "run_id": run_id,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "output_dir": str(out_root.relative_to(repo_root)).replace("\\", "/"),
        "rendered": rendered,
        "skipped_exists": skipped_exists,
        "missing_source": missing_source,
        "errors": errors[:200],
        "figures": results,
    }
    (out_root / "placeholders.manifest.json").write_text(json.dumps(manifest_out, indent=2, ensure_ascii=False), "utf-8")

    print(f"✅ Placeholders done: rendered={rendered} skipped_exists={skipped_exists} missing_source={missing_source}")
    print(f"Output folder: {out_root}")
    print(f"Manifest:      {out_root / 'placeholders.manifest.json'}")


if __name__ == "__main__":
    main()


