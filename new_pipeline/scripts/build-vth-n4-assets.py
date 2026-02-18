#!/usr/bin/env python3
"""
Build VTH N4 assets bundle:
- Figures from latest OneDrive download (Chapter X.Y.png)
- Captions extracted from VTH N4 IDMLs
- Chapter titles from IDMLs
- Chapter opener images from InDesign Links
- Cover front/back from covers_highres
- Original hires PDF
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

ONEDRIVE_DIR = Path("/Users/asafgafni/Downloads/OneDrive_1_1-15-2026-4")
VTH_LINKS_DIR = Path("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/Links")
IDML_DIR = Path("/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4")
COVERS_DIR = Path("/Users/asafgafni/Desktop/InDesign/TestRun/output/covers_highres")
ORIGINAL_PDF = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/MBO_VTH_nivo_4_ORIGINAL_HIRES.pdf")

OUTPUT_DIR = REPO_ROOT / "new_pipeline" / "output" / "vth_n4_assets"
FIGURES_DIR = OUTPUT_DIR / "figures"
CAPTIONS_PATH = OUTPUT_DIR / "captions.json"
MANIFEST_PATH = OUTPUT_DIR / "figure_manifest.json"
CHAPTER_TITLES_PATH = OUTPUT_DIR / "chapter_titles.json"
CHAPTER_OPENERS_DIR = OUTPUT_DIR / "chapter_openers"
CHAPTER_OPENERS_MAP = OUTPUT_DIR / "chapter_openers_mapping.json"
COVERS_OUT_DIR = OUTPUT_DIR / "covers"
MAPPING_PATH = OUTPUT_DIR / "VTH_N4_MAPPING.json"
ORIGINAL_PDF_OUT = OUTPUT_DIR / "original_pdf" / "MBO_VTH_nivo_4_ORIGINAL_HIRES.pdf"
FIGURE_MAP_PATH = OUTPUT_DIR / "figures_mapping.json"

CONTENT_PATTERN = re.compile(r"<Content>([^<]*)</Content>")
PARAGRAPH_STYLE_PATTERN = re.compile(
    r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/([^"]+)"[^>]*>(.*?)</ParagraphStyleRange>',
    re.DOTALL,
)
FIG_PATTERN = re.compile(r"(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)\s*(.*)")


def normalize_caption(text: str) -> str:
    cleaned = text.replace("\u00ad", "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def parse_fig_id(filename: str) -> str | None:
    name = Path(filename).stem
    name = re.sub(r"^Chapter\\s*", "", name, flags=re.IGNORECASE)
    return name.strip() if name else None


def fig_sort_key(fig_id: str) -> tuple:
    # Supports e.g. 13.3-1 -> (13, 3, 1)
    parts = re.split(r"[.-]", fig_id)
    nums = []
    for part in parts:
        if part.isdigit():
            nums.append(int(part))
        else:
            # fallback: try to extract leading digits
            m = re.match(r"(\\d+)", part)
            nums.append(int(m.group(1)) if m else 0)
    return tuple(nums + [0] * (4 - len(nums)))


def extract_captions_from_idml(idml_path: Path) -> dict:
    captions: dict = {}
    try:
        with zipfile.ZipFile(idml_path, "r") as zf:
            story_files = [n for n in zf.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
            for name in story_files:
                content = zf.read(name).decode("utf-8", errors="ignore")
                for style_name, match in PARAGRAPH_STYLE_PATTERN.findall(content):
                    style_lower = style_name.lower()
                    if "credit" in style_lower:
                        continue
                    if not any(token in style_lower for token in ("fotobijschrift", "bijschrift", "annotation", "caption")):
                        continue
                    contents = CONTENT_PATTERN.findall(match)
                    full_text = "".join(contents).strip()
                    fig_match = FIG_PATTERN.match(full_text)
                    if not fig_match:
                        continue
                    fig_num = fig_match.group(1)
                    caption = normalize_caption(fig_match.group(2))
                    if caption and fig_num not in captions:
                        captions[fig_num] = caption
    except zipfile.BadZipFile:
        return captions
    return captions


def extract_chapter_title(idml_path: Path) -> str | None:
    try:
        with zipfile.ZipFile(idml_path, "r") as zf:
            story_files = [n for n in zf.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
            for name in story_files:
                content = zf.read(name).decode("utf-8", errors="ignore")
                for style_name, match in PARAGRAPH_STYLE_PATTERN.findall(content):
                    if "hoofdstuktitel" not in style_name.lower():
                        continue
                    contents = CONTENT_PATTERN.findall(match)
                    title = "".join(contents).strip()
                    if title:
                        return normalize_caption(title)
    except zipfile.BadZipFile:
        return None
    return None


def load_idml_captions_and_titles() -> tuple[dict, dict]:
    captions: dict = {}
    titles: dict = {}
    for idml in sorted(IDML_DIR.glob("*.idml")):
        if "SMOKE" in idml.name:
            continue
        chapter_match = re.match(r"(\\d+)-", idml.name)
        chapter_num = chapter_match.group(1) if chapter_match else None
        if chapter_num:
            title = extract_chapter_title(idml)
            if title:
                titles[chapter_num.lstrip("0")] = title
        captions.update(extract_captions_from_idml(idml))
    return captions, titles


def copy_figures() -> tuple[list, dict]:
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    figure_map = {}
    figures = []
    for chapter_dir in sorted(ONEDRIVE_DIR.glob("Chapter *")):
        if not chapter_dir.is_dir():
            continue
        with_labels = chapter_dir / "With Labels"
        without_labels = chapter_dir / "Without Labels"
        without_lables = chapter_dir / "Without Lables"
        src_dir = with_labels if with_labels.exists() else (without_labels if without_labels.exists() else without_lables)
        if not src_dir or not src_dir.exists():
            continue
        for img in sorted(src_dir.glob("*.png")):
            fig_id = parse_fig_id(img.name)
            if not fig_id:
                continue
            target_name = f"Afbeelding_{fig_id}.png"
            target_path = FIGURES_DIR / target_name
            shutil.copy2(img, target_path)
            figure_map[str(img)] = str(target_path)
            figures.append(fig_id)

    # Flatten images (white background)
    for img in FIGURES_DIR.glob("*.png"):
        subprocess.run(
            ["magick", str(img), "-background", "white", "-flatten", str(img)],
            check=False,
            capture_output=True,
        )

    return figures, figure_map


def copy_openers() -> dict:
    CHAPTER_OPENERS_DIR.mkdir(parents=True, exist_ok=True)
    opener_map = {}
    for f in VTH_LINKS_DIR.iterdir():
        if not f.is_file():
            continue
        m = re.search(r"Deel(\\d+)_0Deel(\\d+)", f.name)
        if not m:
            continue
        chapter = m.group(2).lstrip("0") or m.group(2)
        target = CHAPTER_OPENERS_DIR / f"chapter_{chapter}.{f.suffix.lstrip('.')}"
        shutil.copy2(f, target)
        opener_map[chapter] = str(target)
    return opener_map


def copy_covers() -> dict:
    COVERS_OUT_DIR.mkdir(parents=True, exist_ok=True)
    front = next(COVERS_DIR.glob("*_9789083412054_FRONT.png"), None)
    back = next(COVERS_DIR.glob("*_9789083412054_BACK.png"), None)
    out = {}
    if front:
        target = COVERS_OUT_DIR / "front.png"
        shutil.copy2(front, target)
        out["front"] = str(target)
    if back:
        target = COVERS_OUT_DIR / "back.png"
        shutil.copy2(back, target)
        out["back"] = str(target)
    return out


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    captions, titles = load_idml_captions_and_titles()

    CAPTIONS_PATH.write_text(json.dumps(captions, indent=2, ensure_ascii=False), encoding="utf-8")
    CHAPTER_TITLES_PATH.write_text(json.dumps(titles, indent=2, ensure_ascii=False), encoding="utf-8")

    figures, figure_map = copy_figures()
    figures_sorted = sorted(set(figures), key=fig_sort_key)

    manifest = []
    for fig_id in figures_sorted:
        caption = captions.get(fig_id)
        if not caption and "-" in fig_id:
            base = fig_id.split("-")[0]
            caption = captions.get(base, "")
        manifest.append(
            {
                "figureNumber": f"Afbeelding {fig_id}:",
                "caption": caption or "",
                "src": f"vth_n4_assets/figures/Afbeelding_{fig_id}.png",
            }
        )

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    FIGURE_MAP_PATH.write_text(json.dumps(figure_map, indent=2, ensure_ascii=False), encoding="utf-8")

    opener_map = copy_openers()
    CHAPTER_OPENERS_MAP.write_text(json.dumps(opener_map, indent=2, ensure_ascii=False), encoding="utf-8")

    cover_map = copy_covers()

    # Copy original PDF
    ORIGINAL_PDF_OUT.parent.mkdir(parents=True, exist_ok=True)
    if ORIGINAL_PDF.exists():
        shutil.copy2(ORIGINAL_PDF, ORIGINAL_PDF_OUT)

    mapping = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "onedrive_dir": str(ONEDRIVE_DIR),
        "figures_count": len(figures_sorted),
        "captions_count": len([m for m in manifest if m["caption"]]),
        "covers": cover_map,
        "chapter_openers": opener_map,
        "chapter_titles_count": len(titles),
        "original_pdf": str(ORIGINAL_PDF_OUT),
    }
    MAPPING_PATH.write_text(json.dumps(mapping, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"VTH N4 assets written to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

