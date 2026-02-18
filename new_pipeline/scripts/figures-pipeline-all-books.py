#!/usr/bin/env python3
"""
All-books figures pipeline:
1) Extract captions from IDML
2) Ingest OneDrive images into assets/figures/<book_slug>
3) Build figure manifest
4) Inject ordered figures into canonical JSON
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Dict, List

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "books" / "manifest.json"
OUTPUT_ROOT = REPO_ROOT / "new_pipeline" / "output"
CONFIG_PATH = REPO_ROOT / "new_pipeline" / "config" / "figure_sources.json"
FIGURES_ROOT = REPO_ROOT / "new_pipeline" / "assets" / "figures"
EXTRACT_ROOT = REPO_ROOT / "new_pipeline" / "extract"


FOTOBIJSCHRIFT_PATTERN = re.compile(
    r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/•Fotobijschrift(?!_credit)[^"]*"[^>]*>(.*?)</ParagraphStyleRange>',
    re.DOTALL,
)
PARAGRAPH_STYLE_PATTERN = re.compile(
    r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/([^"]+)"[^>]*>(.*?)</ParagraphStyleRange>',
    re.DOTALL,
)
CONTENT_PATTERN = re.compile(r"<Content>([^<]*)</Content>")
FIG_PATTERN = re.compile(r"(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)\s*(.*)")


def load_manifest() -> List[dict]:
    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        return json.load(f).get("books", [])


def load_output_index() -> Dict[str, dict]:
    index: Dict[str, dict] = {}
    for json_file in OUTPUT_ROOT.rglob("*_full_rewritten.with_openers.with_figures.json"):
        try:
            with json_file.open("r", encoding="utf-8") as f:
                data = json.load(f)
            upload_id = data.get("meta", {}).get("id")
            if not upload_id:
                continue
            index[upload_id] = {
                "slug": json_file.parent.name,
                "json_path": json_file,
                "title": data.get("meta", {}).get("title", ""),
            }
        except Exception:
            continue
    return index


def normalize_caption(text: str) -> str:
    cleaned = text.replace("\u00ad", "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def extract_captions(idml_path: Path) -> Dict[str, str]:
    captions: Dict[str, str] = {}
    with zipfile.ZipFile(idml_path, "r") as zf:
        story_files = [n for n in zf.namelist() if n.startswith("Stories/") and n.endswith(".xml")]
        for name in story_files:
            content = zf.read(name).decode("utf-8", errors="ignore")
            matches = FOTOBIJSCHRIFT_PATTERN.findall(content)
            for match in matches:
                contents = CONTENT_PATTERN.findall(match)
                full_text = "".join(contents).strip()
                fig_match = FIG_PATTERN.match(full_text)
                if not fig_match:
                    continue
                fig_num = fig_match.group(1)
                caption = normalize_caption(fig_match.group(2))
                if caption and fig_num not in captions:
                    captions[fig_num] = caption

            # Fallback: scan caption-like paragraph styles that start with Afbeelding/Figuur
            para_matches = PARAGRAPH_STYLE_PATTERN.findall(content)
            for style_name, match in para_matches:
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
    return captions


def fig_sort_key(fig_num_str: str) -> tuple:
    parts = fig_num_str.split(".")
    return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)


def parse_fig_num(filename: str) -> str | None:
    # Expect names like "Chapter 33.1.png"
    m = re.search(r"(\d+\.\d+)", filename)
    return m.group(1) if m else None


def collect_onedrive_images(onedrive_dir: Path) -> Dict[str, Path]:
    figure_sources: Dict[str, Dict[str, Path]] = {}
    for chapter_dir in onedrive_dir.iterdir():
        if not chapter_dir.is_dir():
            continue
        if not chapter_dir.name.lower().startswith("chapter"):
            continue

        # Prefer "with Labels", fallback to "without Labels"
        subdirs = list(chapter_dir.iterdir())
        with_label = next((p for p in subdirs if p.is_dir() and p.name.lower() == "with labels"), None)
        without_label = next((p for p in subdirs if p.is_dir() and p.name.lower() == "without labels"), None)
        folders = [with_label, without_label]

        for folder in folders:
            if not folder or not folder.exists():
                continue
            for img in folder.glob("*.png"):
                fig_num = parse_fig_num(img.name)
                if not fig_num:
                    continue
                if fig_num not in figure_sources:
                    figure_sources[fig_num] = {}
                key = "with" if folder.name.lower() == "with labels" else "without"
                figure_sources[fig_num][key] = img

    # Resolve to preferred image per figure
    resolved: Dict[str, Path] = {}
    for fig_num, sources in figure_sources.items():
        resolved[fig_num] = sources.get("with") or sources.get("without")
    return resolved


def prepare_target_dir(book_slug: str) -> Path:
    target_dir = FIGURES_ROOT / book_slug
    target_dir.mkdir(parents=True, exist_ok=True)
    # Clear existing PNGs
    for png in target_dir.glob("*.png"):
        png.unlink()
    return target_dir


def flatten_images(target_dir: Path) -> None:
    for img in target_dir.glob("*.png"):
        subprocess.run(
            ["magick", str(img), "-background", "white", "-flatten", str(img)],
            check=False,
            capture_output=True,
        )


def inject_figures(book_json: dict, figures: List[dict]) -> dict:
    # Remove previously injected figure-only blocks
    for chapter in book_json.get("chapters", []):
        for section in chapter.get("sections", []):
            content = section.get("content", [])
            filtered = []
            for block in content:
                if (
                    block.get("type") == "paragraph"
                    and block.get("role") == "body"
                    and not block.get("text")
                    and block.get("images")
                ):
                    images = block.get("images", [])
                    if (
                        len(images) == 1
                        and images[0].get("figureNumber")
                        and re.match(r"^(Afbeelding|Figuur)\s+\d+(?:\.\d+)+", images[0]["figureNumber"])
                    ):
                        continue
                filtered.append(block)
            section["content"] = filtered

    # Group figures by chapter
    figures_by_chapter: Dict[int, List[dict]] = {}
    for fig in figures:
        ch = fig["chapter"]
        figures_by_chapter.setdefault(ch, []).append(fig)

    for ch in figures_by_chapter:
        figures_by_chapter[ch].sort(
            key=lambda f: fig_sort_key(f["figureNumber"].replace("Afbeelding ", "").replace(":", ""))
        )

    total_injected = 0
    for chapter in book_json.get("chapters", []):
        ch_num = chapter.get("number")
        ch_num_int = int(ch_num) if isinstance(ch_num, str) else ch_num
        if ch_num_int not in figures_by_chapter:
            continue
        figs = figures_by_chapter[ch_num_int]
        sections = chapter.get("sections", [])
        if not sections:
            continue

        figs_per_section = max(1, len(figs) // len(sections))
        fig_idx = 0

        for sec_idx, section in enumerate(sections):
            remaining = len(figs) - fig_idx
            count = figs_per_section if sec_idx < len(sections) - 1 else remaining
            if count <= 0:
                continue

            section_figs = figs[fig_idx : fig_idx + count]
            fig_idx += count

            content = section.get("content", [])
            insert_base = min(1, len(content))
            for i, fig in enumerate(section_figs):
                content.insert(
                    insert_base + i,
                    {
                        "type": "paragraph",
                        "role": "body",
                        "text": "",
                        "images": [
                            {
                                "src": fig["src"],
                                "alt": fig["alt"],
                                "figureNumber": fig["figureNumber"],
                                "caption": fig["caption"],
                            }
                        ],
                    },
                )
                total_injected += 1
            section["content"] = content

    return book_json, total_injected


def main() -> None:
    if not CONFIG_PATH.exists():
        raise SystemExit(f"Missing config: {CONFIG_PATH}")

    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        config = json.load(f)
    sources = config.get("sources", {})

    books = load_manifest()
    output_index = load_output_index()
    report = {}

    for book in books:
        upload_id = book.get("upload_id")
        output_info = output_index.get(upload_id)
        if not output_info:
            continue
        book_slug = output_info["slug"]
        if book_slug not in sources:
            report[book_slug] = {"status": "skipped", "reason": "no onedrive source"}
            continue

        onedrive_dir = Path(sources[book_slug]["onedrive_dir"])
        idml_path = (REPO_ROOT / book.get("canonical_n4_idml_path", "")).resolve()
        json_path = output_info["json_path"]

        if not idml_path.exists():
            report[book_slug] = {"status": "skipped", "reason": f"missing idml: {idml_path}"}
            continue

        # Extract captions
        captions = extract_captions(idml_path)
        captions_path = EXTRACT_ROOT / f"{book_slug}_captions.json"
        with captions_path.open("w", encoding="utf-8") as f:
            json.dump(captions, f, indent=2, ensure_ascii=False)

        # Ingest images
        target_dir = prepare_target_dir(book_slug)
        sources_map = collect_onedrive_images(onedrive_dir)

        for fig_num, src in sources_map.items():
            if not src:
                continue
            target_path = target_dir / f"Afbeelding_{fig_num}.png"
            shutil.copy2(src, target_path)

        flatten_images(target_dir)

        # Build manifest
        figures = []
        for img in target_dir.glob("Afbeelding_*.png"):
            fig_num = img.stem.replace("Afbeelding_", "")
            parts = fig_num.split(".")
            if len(parts) < 2:
                continue
            figures.append(
                {
                    "chapter": int(parts[0]),
                    "figureNumber": f"Afbeelding {fig_num}:",
                    "src": f"new_pipeline/assets/figures/{book_slug}/Afbeelding_{fig_num}.png",
                    "alt": f"Afbeelding {fig_num}",
                    "caption": captions.get(fig_num, ""),
                }
            )

        figures.sort(key=lambda f: fig_sort_key(f["figureNumber"].replace("Afbeelding ", "").replace(":", "")))

        manifest_path = EXTRACT_ROOT / f"{book_slug}_figure_manifest.json"
        with manifest_path.open("w", encoding="utf-8") as f:
            json.dump({"figures": figures}, f, indent=2, ensure_ascii=False)

        # Inject figures
        with json_path.open("r", encoding="utf-8") as f:
            book_json = json.load(f)

        book_json, total_injected = inject_figures(book_json, figures)
        output_dir = OUTPUT_ROOT / book_slug
        output_dir.mkdir(parents=True, exist_ok=True)
        injected_path = output_dir / f"{book_slug}_with_all_figures.json"
        with injected_path.open("w", encoding="utf-8") as f:
            json.dump(book_json, f, indent=2, ensure_ascii=False)

        report[book_slug] = {
            "status": "processed",
            "onedrive_dir": str(onedrive_dir),
            "images": len(figures),
            "captions": len([c for c in figures if c["caption"]]),
            "captions_missing": len([c for c in figures if not c["caption"]]),
            "injected": total_injected,
            "captions_path": str(captions_path),
            "manifest_path": str(manifest_path),
            "output_json": str(injected_path),
        }

    report_path = OUTPUT_ROOT / "figure_pipeline_report.json"
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"Wrote report: {report_path}")


if __name__ == "__main__":
    main()

