#!/usr/bin/env python3
"""
Build a Desktop package of extracted high-res labeled figures, with documentation.

Creates:
  ~/Desktop/Updated images/
    - README.md
    - placements.json
    - placements.csv
    - assets.json
    - assets.csv
    - <book_folder>/
        - book_manifest.json
        - book_manifest.md
        - images/              (DEDUPED: one copy per unique image content for this book)
        - placements.json
        - placements.csv
        - assets.json
        - assets.csv
        - documents/
            - <doc_folder>/
                - manifest.json  (placements for this document; references book-level images/)
                - manifest.csv
                - missing.json   (missing crops vs metadata)

Also creates:
  ~/Desktop/Updated images.zip  (single zip containing the full folder + documentation)

Notes:
  - Source images come from: ~/Desktop/highres_labeled_figures/...
  - Canonical JSONs (if present) are referenced from: new_pipeline/output/**/canonical_book_with_figures.json
  - For MBO A&F 4 (MBO_AF4_2024_COMMON_CORE), we enrich with:
      - new_pipeline/extract/figure_manifest_ch*.json
      - new_pipeline/extract/figures_by_paragraph_all.json
      - new_pipeline/output/MBO_AF4_2024_COMMON_CORE/canonical_book_with_figures.json
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

try:
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover
    Image = None  # type: ignore


REPO_ROOT = Path("/Users/asafgafni/Desktop/InDesign/TestRun")
HIGHRES_BASE = Path.home() / "Desktop/highres_labeled_figures"
OUT_BASE = Path.home() / "Desktop/Updated images"

BOOKS_MANIFEST = REPO_ROOT / "books/manifest.json"
NEW_PIPELINE_OUTPUT = REPO_ROOT / "new_pipeline/output"

# AF4-only enrichment sources (if present)
AF4_BOOK_ID = "MBO_AF4_2024_COMMON_CORE"
AF4_CANONICAL_BOOK_JSON = REPO_ROOT / "new_pipeline/output/MBO_AF4_2024_COMMON_CORE/canonical_book_with_figures.json"
AF4_FIGURES_BY_PARA = REPO_ROOT / "new_pipeline/extract/figures_by_paragraph_all.json"
AF4_FIGURE_MANIFESTS_GLOB = REPO_ROOT / "new_pipeline/extract/figure_manifest_ch*.json"


UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _read_json_any_encoding(path: Path) -> Any:
    raw = path.read_bytes()
    last_err: Exception | None = None
    for enc in ("utf-8", "utf-8-sig", "mac_roman", "cp1252", "latin-1"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            last_err = e
            continue
    raise RuntimeError(f"Failed to decode/parse JSON: {path} ({last_err})")


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _safe_write_text(path: Path, text: str) -> None:
    _ensure_dir(path.parent)
    path.write_text(text, encoding="utf-8")


def _safe_write_json(path: Path, obj: Any) -> None:
    _ensure_dir(path.parent)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _sanitize_filename(name: str, max_len: int = 180) -> str:
    s = str(name)
    s = s.replace("\x00", "")
    # allow common characters, replace the rest
    s = "".join(c if (c.isalnum() or c in " ._()-") else "_" for c in s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        s = "file"
    if len(s) > max_len:
        s = s[:max_len].rstrip()
    return s


def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _iter_dirs(p: Path) -> list[Path]:
    if not p.exists():
        return []
    return sorted([d for d in p.iterdir() if d.is_dir()], key=lambda x: x.name.lower())


def _iter_pngs(p: Path) -> list[Path]:
    if not p.exists():
        return []
    return sorted([f for f in p.iterdir() if f.is_file() and f.suffix.lower() == ".png"], key=lambda x: x.name.lower())


FIG_OUT_RE = re.compile(r"^p(?P<page>[^_]+)_f(?P<fnum>\d{4})_(?P<rest>.+)\.(?P<ext>png|jpg|jpeg)$", re.IGNORECASE)


def _parse_fig_output_filename(filename: str) -> dict[str, Any] | None:
    m = FIG_OUT_RE.match(filename)
    if not m:
        return None
    return {
        "page": m.group("page"),
        "fnum": int(m.group("fnum")),
        "ext": "." + m.group("ext").lower(),
    }


def _guess_chapter_from_link_name(link_name: str) -> str | None:
    s = str(link_name or "")
    # Common patterns: MAF_Ch6_Img16, MAF_Ch01_Img2, chapter1-23_1, CH01, etc.
    for pat in (
        r"(?:^|[_\-\s])ch(?:apter)?\s*0*(\d{1,2})(?:[_\-\s]|$)",
        r"(?:^|[_\-\s])CH\s*0*(\d{1,2})(?:[_\-\s]|$)",
        r"(?:^|[_\-\s])chapter\s*0*(\d{1,2})(?:[_\-\s]|$)",
    ):
        m = re.search(pat, s, flags=re.IGNORECASE)
        if m:
            return str(int(m.group(1)))
    return None


def _guess_numbering_from_link_name(link_name: str) -> dict[str, Any] | None:
    """
    Best-effort parse of a chapter/paragraph(/subparagraph) key from link filenames.

    Examples seen in this repo:
      - "WBF_3.8_..."            -> chapter=3, paragraph=8, subparagraph=None
      - "Image_6.7_..."          -> chapter=6, paragraph=7, subparagraph=None
      - "Hoofdstuk1_1.11_..."    -> chapter=1, paragraph=11, subparagraph=None
      - "MAF_Ch6_Img6.25-EDIT"   -> chapter=6, paragraph=25, subparagraph=None (ambiguous; still useful)

    Returns:
      {
        "key": "6.7" or "6.7.1",
        "chapter_number": "6",
        "paragraph_number": "7",
        "subparagraph_number": "1" | None,
      }
    """
    s = str(link_name or "")
    # Prefer patterns that look like section/subsection numbering (X.Y or X.Y.Z)
    # Use digit-only boundaries (not \b) so we still match when followed by "_" etc.
    m = re.search(r"(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?(?!\d)", s)
    if not m:
        return None
    ch = str(int(m.group(1)))
    para = str(int(m.group(2)))
    sub = str(int(m.group(3))) if m.group(3) is not None else None
    key = f"{ch}.{para}" + (f".{sub}" if sub is not None else "")
    return {
        "key": key,
        "chapter_number": ch,
        "paragraph_number": para,
        "subparagraph_number": sub,
    }


def _load_done_doc_path(done_file: Path) -> str | None:
    if not done_file.exists():
        return None
    txt = done_file.read_text(encoding="utf-8", errors="replace")
    for line in txt.splitlines():
        if line.startswith("doc:"):
            return line.split("doc:", 1)[1].strip() or None
    return None


@dataclass(frozen=True)
class CanonicalBookInfo:
    book_id: str
    canonical_book_json: Path
    meta_title: str | None
    meta_id: str | None


def _load_books_manifest() -> dict[str, Any]:
    if not BOOKS_MANIFEST.exists():
        return {"version": 0, "books": []}
    return _read_json_any_encoding(BOOKS_MANIFEST)


def _index_canonical_books() -> list[CanonicalBookInfo]:
    infos: list[CanonicalBookInfo] = []
    for p in sorted(NEW_PIPELINE_OUTPUT.glob("*/canonical_book_with_figures.json"), key=lambda x: x.as_posix().lower()):
        book_id = p.parent.name
        try:
            head = _read_json_any_encoding(p)
            meta = head.get("meta") if isinstance(head, dict) else None
            meta_title = meta.get("title") if isinstance(meta, dict) else None
            meta_id = meta.get("id") if isinstance(meta, dict) else None
        except Exception:
            meta_title = None
            meta_id = None
        infos.append(
            CanonicalBookInfo(
                book_id=book_id,
                canonical_book_json=p,
                meta_title=str(meta_title) if meta_title is not None else None,
                meta_id=str(meta_id) if meta_id is not None else None,
            )
        )
    return infos


def _extract_isbn(s: str) -> str | None:
    m = re.search(r"\b(\d{13})\b", s)
    return m.group(1) if m else None


def _pick_canonical_book_for_folder(
    *,
    folder_name: str,
    canonical_infos: list[CanonicalBookInfo],
    doc_paths: list[str],
    books_manifest: dict[str, Any],
) -> CanonicalBookInfo | None:
    # 1) Direct match by manifest canonical INDD path
    doc_paths_set = {Path(p).as_posix() for p in doc_paths if p}
    for b in books_manifest.get("books", []) if isinstance(books_manifest, dict) else []:
        try:
            indd = str(b.get("canonical_n4_indd_path") or b.get("baseline_full_indd_path") or "")
            bid = str(b.get("book_id") or "")
            if indd and indd in doc_paths_set and bid:
                for info in canonical_infos:
                    if info.book_id == bid:
                        return info
        except Exception:
            continue

    # 2) Match by ISBN in folder name
    isbn = _extract_isbn(folder_name)
    if isbn:
        for info in canonical_infos:
            if isbn in info.book_id or isbn in info.canonical_book_json.as_posix():
                return info

    # 3) Match by meta title heuristics
    norm = folder_name.lower().replace("_", " ")
    norm = re.sub(r"\b978\d+\b", "", norm).strip()
    norm = norm.replace("  ", " ")
    for info in canonical_infos:
        if not info.meta_title:
            continue
        t = info.meta_title.lower()
        if t and t in norm:
            return info
    # 4) Special-case A&F 4 folder name
    if "a&f 4" in folder_name.lower() or "a&f_4" in folder_name.lower():
        for info in canonical_infos:
            if info.book_id == AF4_BOOK_ID:
                return info
    return None


def _is_uuid(s: Any) -> bool:
    return isinstance(s, str) and bool(UUID_RE.match(s))


def _build_paragraph_context(canonical_book_json: Path) -> dict[str, dict[str, Any]]:
    """
    Build mapping: paragraph_id(UUID) -> context info (chapter/section/subparagraph).
    """
    data = _read_json_any_encoding(canonical_book_json)
    if not isinstance(data, dict):
        return {}

    contexts: dict[str, dict[str, Any]] = {}

    def walk_content(content: Any, *, chapter_number: str | None, section_number: str | None, subparagraph_number: str | None) -> None:
        if not isinstance(content, list):
            return
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or "")
            item_id = item.get("id")
            if _is_uuid(item_id):
                contexts[str(item_id)] = {
                    "chapter_number": chapter_number,
                    "section_number": section_number,
                    "subparagraph_number": subparagraph_number,
                    "item_type": item_type,
                }

            # Some items nest content as well
            if item_type == "subparagraph":
                sp_num = item.get("number") or item.get("id")
                walk_content(
                    item.get("content"),
                    chapter_number=chapter_number,
                    section_number=section_number,
                    subparagraph_number=str(sp_num) if sp_num is not None else subparagraph_number,
                )
                continue

            if isinstance(item.get("content"), list):
                walk_content(
                    item.get("content"),
                    chapter_number=chapter_number,
                    section_number=section_number,
                    subparagraph_number=subparagraph_number,
                )

    for ch in data.get("chapters", []) if isinstance(data.get("chapters"), list) else []:
        if not isinstance(ch, dict):
            continue
        ch_num = str(ch.get("number") or "")
        for sec in ch.get("sections", []) if isinstance(ch.get("sections"), list) else []:
            if not isinstance(sec, dict):
                continue
            sec_num = str(sec.get("number") or "")
            walk_content(sec.get("content"), chapter_number=ch_num, section_number=sec_num, subparagraph_number=None)

    return contexts


def _build_number_index(canonical_book_json: Path) -> dict[str, set[str]]:
    """
    Build sets of known numbering keys from a canonical book JSON:
      - sections: {"1.1", "6.4", ...}
      - subparagraphs: {"1.1.1", "6.4.3", ...}
    """
    data = _read_json_any_encoding(canonical_book_json)
    if not isinstance(data, dict):
        return {"sections": set(), "subparagraphs": set()}

    sections: set[str] = set()
    subps: set[str] = set()

    def walk_content(content: Any) -> None:
        if not isinstance(content, list):
            return
        for item in content:
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "") == "subparagraph":
                n = item.get("number") or item.get("id")
                if isinstance(n, str) and n:
                    subps.add(n)
                walk_content(item.get("content"))
            elif isinstance(item.get("content"), list):
                walk_content(item.get("content"))

    for ch in data.get("chapters", []) if isinstance(data.get("chapters"), list) else []:
        if not isinstance(ch, dict):
            continue
        for sec in ch.get("sections", []) if isinstance(ch.get("sections"), list) else []:
            if not isinstance(sec, dict):
                continue
            n = sec.get("number")
            if isinstance(n, str) and n:
                sections.add(n)
            walk_content(sec.get("content"))

    return {"sections": sections, "subparagraphs": subps}


def _build_af4_linkname_mapping() -> dict[str, dict[str, Any]]:
    """
    linkName(lowercase) -> {figure_id, src_asset_path, figureNumber, caption, chapter, pageName}
    """
    mapping: dict[str, dict[str, Any]] = {}
    for p in sorted(AF4_FIGURE_MANIFESTS_GLOB.parent.glob(AF4_FIGURE_MANIFESTS_GLOB.name)):
        try:
            mf = _read_json_any_encoding(p)
        except Exception:
            continue
        if not isinstance(mf, dict):
            continue
        ch = str(mf.get("chapter") or "")
        figs = mf.get("figures")
        if not isinstance(figs, list):
            continue
        for fig in figs:
            if not isinstance(fig, dict):
                continue
            image = fig.get("image") if isinstance(fig.get("image"), dict) else {}
            caption = fig.get("caption") if isinstance(fig.get("caption"), dict) else {}
            asset = fig.get("asset") if isinstance(fig.get("asset"), dict) else {}
            page = fig.get("page") if isinstance(fig.get("page"), dict) else {}

            link_name = image.get("linkName")
            if not isinstance(link_name, str) or not link_name.strip():
                # Some figures are pageItems (Group) and won't have a linkName.
                continue
            link_key = link_name.strip().lower()

            src = None
            if isinstance(asset.get("path"), str) and asset.get("path"):
                src = asset.get("path")
            elif isinstance(image.get("atomicPath"), str) and image.get("atomicPath"):
                src = image.get("atomicPath")

            figure_id = None
            if isinstance(src, str) and src:
                figure_id = Path(src).stem
            else:
                lbl = caption.get("label")
                if isinstance(lbl, str) and lbl.strip():
                    figure_id = lbl.strip().rstrip(":").replace(" ", "_")

            mapping[link_key] = {
                "chapter": ch or None,
                "figure_id": figure_id,
                "src_asset_path": src,
                "figureNumber": caption.get("label"),
                "caption": caption.get("body"),
                "pageName": page.get("name"),
            }
    return mapping


def _invert_figures_by_paragraph(figs_by_para: dict[str, Any]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    src_to_para: dict[str, list[str]] = {}
    fig_num_to_para: dict[str, list[str]] = {}
    for para_id, figs in figs_by_para.items():
        if not _is_uuid(para_id):
            continue
        if not isinstance(figs, list):
            continue
        for f in figs:
            if not isinstance(f, dict):
                continue
            src = f.get("src")
            if isinstance(src, str) and src:
                src_to_para.setdefault(src, []).append(str(para_id))
            fn = f.get("figureNumber")
            if isinstance(fn, str) and fn:
                fig_num_to_para.setdefault(fn, []).append(str(para_id))
    return src_to_para, fig_num_to_para


def _copy_image(src: Path, dst: Path) -> None:
    _ensure_dir(dst.parent)
    shutil.copy2(src, dst)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _image_dimensions(path: Path) -> tuple[int | None, int | None]:
    if Image is None:
        return None, None
    try:
        with Image.open(path) as im:
            return int(im.size[0]), int(im.size[1])
    except Exception:
        return None, None


def _write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    _ensure_dir(path.parent)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fieldnames})


def main() -> int:
    if not HIGHRES_BASE.exists():
        raise SystemExit(f"Missing input folder: {HIGHRES_BASE}")

    # Backup existing output folder (avoid destructive deletes)
    if OUT_BASE.exists():
        backup = OUT_BASE.parent / f"{OUT_BASE.name} (backup { _now_stamp() })"
        OUT_BASE.rename(backup)

    _ensure_dir(OUT_BASE)

    books_manifest = _load_books_manifest()
    canonical_infos = _index_canonical_books()

    # AF4 enrichment (optional)
    af4_link_map: dict[str, dict[str, Any]] = {}
    af4_figs_by_para: dict[str, Any] = {}
    af4_src_to_para: dict[str, list[str]] = {}
    af4_fig_num_to_para: dict[str, list[str]] = {}
    af4_para_ctx: dict[str, dict[str, Any]] = {}
    if AF4_FIGURES_BY_PARA.exists() and AF4_CANONICAL_BOOK_JSON.exists():
        try:
            af4_link_map = _build_af4_linkname_mapping()
            af4_figs_by_para = _read_json_any_encoding(AF4_FIGURES_BY_PARA)
            if isinstance(af4_figs_by_para, dict):
                af4_src_to_para, af4_fig_num_to_para = _invert_figures_by_paragraph(af4_figs_by_para)
            af4_para_ctx = _build_paragraph_context(AF4_CANONICAL_BOOK_JSON)
        except Exception:
            # If enrichment fails, we still build the package without it
            af4_link_map = {}
            af4_figs_by_para = {}
            af4_src_to_para = {}
            af4_fig_num_to_para = {}
            af4_para_ctx = {}

    global_rows: list[dict[str, Any]] = []  # placements (one per exported crop)
    global_missing: list[dict[str, Any]] = []
    global_assets: list[dict[str, Any]] = []  # unique images (deduped within each book)

    # Iterate each book folder in highres output
    for book_dir in _iter_dirs(HIGHRES_BASE):
        if book_dir.name.startswith("_") and book_dir.name == "_run_log.txt":
            continue
        if book_dir.name == "_run_log.txt":
            continue
        if book_dir.name.startswith("_") and book_dir.is_file():
            continue

        # Collect doc paths for canonical matching
        doc_dirs = _iter_dirs(book_dir)
        doc_paths: list[str] = []
        for d in doc_dirs:
            dp = _load_done_doc_path(d / "_DONE.txt")
            if dp:
                doc_paths.append(dp)

        canonical_info = _pick_canonical_book_for_folder(
            folder_name=book_dir.name,
            canonical_infos=canonical_infos,
            doc_paths=doc_paths,
            books_manifest=books_manifest,
        )

        out_book_dir = OUT_BASE / book_dir.name
        _ensure_dir(out_book_dir)
        out_book_images_dir = out_book_dir / "images"
        _ensure_dir(out_book_images_dir)
        out_book_docs_dir = out_book_dir / "documents"
        _ensure_dir(out_book_docs_dir)

        number_index: dict[str, set[str]] = {"sections": set(), "subparagraphs": set()}
        if canonical_info:
            try:
                number_index = _build_number_index(canonical_info.canonical_book_json)
            except Exception:
                number_index = {"sections": set(), "subparagraphs": set()}

        book_rows: list[dict[str, Any]] = []  # placements
        book_missing: list[dict[str, Any]] = []
        book_assets_by_sha: dict[str, dict[str, Any]] = {}
        used_book_asset_filenames: set[str] = set()

        # Per-doc processing
        for doc_dir in doc_dirs:
            out_doc_dir = out_book_docs_dir / doc_dir.name
            _ensure_dir(out_doc_dir)

            done_doc_path = _load_done_doc_path(doc_dir / "_DONE.txt")

            metadata_path = doc_dir / "figure_metadata.json"
            figures_meta: list[dict[str, Any]] = []
            if metadata_path.exists():
                try:
                    figures_meta_raw = _read_json_any_encoding(metadata_path)
                    if isinstance(figures_meta_raw, list):
                        figures_meta = [x for x in figures_meta_raw if isinstance(x, dict)]
                except Exception:
                    figures_meta = []

            expected_n = len(figures_meta)
            raw_fig_dir = doc_dir / "figures_300"
            raw_imgs = _iter_pngs(raw_fig_dir)

            # Index actual by fnum
            present_fnums: set[int] = set()
            parsed_by_file: dict[str, dict[str, Any]] = {}
            for img in raw_imgs:
                parsed = _parse_fig_output_filename(img.name)
                if not parsed:
                    continue
                present_fnums.add(int(parsed["fnum"]))
                parsed_by_file[img.name] = parsed

            missing_fnums = [n for n in range(1, expected_n + 1) if n not in present_fnums]

            missing_entries: list[dict[str, Any]] = []
            for fnum in missing_fnums:
                idx0 = fnum - 1
                m = figures_meta[idx0] if 0 <= idx0 < len(figures_meta) else {}
                missing_entries.append(
                    {
                        "fnum": fnum,
                        "page": m.get("page"),
                        "imageName": m.get("imageName"),
                        "bounds": {
                            "top": m.get("top"),
                            "left": m.get("left"),
                            "bottom": m.get("bottom"),
                            "right": m.get("right"),
                        },
                    }
                )

            doc_missing_obj = {
                "doc_dir": str(doc_dir),
                "doc_source_indd": done_doc_path,
                "expected_figures_in_metadata": expected_n,
                "actual_exported_images": len(raw_imgs),
                "missing_fnums": missing_fnums,
                "missing_entries": missing_entries,
            }
            _safe_write_json(out_doc_dir / "missing.json", doc_missing_obj)
            if missing_fnums:
                global_missing.append(
                    {
                        "book": book_dir.name,
                        "doc": doc_dir.name,
                        "expected": expected_n,
                        "actual": len(raw_imgs),
                        "missing_count": len(missing_fnums),
                        "missing_fnums": ",".join(str(x) for x in missing_fnums[:200]),
                    }
                )
                book_missing.append(doc_missing_obj)

            # Build placement rows. Store actual image files once per book (deduped).
            doc_rows: list[dict[str, Any]] = []

            for img in raw_imgs:
                parsed = parsed_by_file.get(img.name) or _parse_fig_output_filename(img.name) or {}
                fnum = int(parsed.get("fnum") or 0) if parsed else 0
                idx0 = fnum - 1
                meta = figures_meta[idx0] if (fnum and 0 <= idx0 < len(figures_meta)) else {}
                link_name = str(meta.get("imageName") or "")
                page_name = str(meta.get("page") or (parsed.get("page") if parsed else "") or "")

                # Attempt AF4 canonical mapping
                canonical: dict[str, Any] = {}
                dest_name = img.name
                if canonical_info and canonical_info.book_id == AF4_BOOK_ID:
                    lm = af4_link_map.get(link_name.lower()) if link_name else None
                    if lm:
                        figure_id = lm.get("figure_id")
                        src_asset_path = lm.get("src_asset_path")
                        figure_num = lm.get("figureNumber")

                        para_id: str | None = None
                        if isinstance(src_asset_path, str) and src_asset_path in af4_src_to_para and len(af4_src_to_para[src_asset_path]) == 1:
                            para_id = af4_src_to_para[src_asset_path][0]
                        elif isinstance(figure_num, str) and figure_num in af4_fig_num_to_para and len(af4_fig_num_to_para[figure_num]) == 1:
                            para_id = af4_fig_num_to_para[figure_num][0]

                        ctx = af4_para_ctx.get(para_id) if para_id else None

                        canonical = {
                            "book_id": AF4_BOOK_ID,
                            "canonical_book_json": str(AF4_CANONICAL_BOOK_JSON),
                            "figure_id": figure_id,
                            "figureNumber": figure_num,
                            "caption": lm.get("caption"),
                            "src_asset_path": src_asset_path,
                            "canonical_paragraph_id": para_id,
                            "canonical_context": ctx,
                        }

                        if figure_id:
                            dest_name = f"{figure_id}.png"

                # Dedup within book by sha256 (no duplicate image files).
                sha = _sha256_file(img)
                asset = book_assets_by_sha.get(sha)
                if asset is None:
                    # Prefer canonical figure_id names when we have them; otherwise hash-prefix for uniqueness.
                    if canonical.get("figure_id"):
                        cand = f"{canonical['figure_id']}.png"
                    else:
                        base = Path(link_name).stem if link_name else Path(dest_name).stem
                        base = _sanitize_filename(base, max_len=110)
                        cand = f"{sha[:12]}__{base}.png"

                    cand = _sanitize_filename(cand)
                    if cand in used_book_asset_filenames:
                        cand = f"{Path(cand).stem}__{sha[:12]}.png"
                    used_book_asset_filenames.add(cand)

                    asset_path = out_book_images_dir / cand
                    _copy_image(img, asset_path)
                    w_px, h_px = _image_dimensions(asset_path)
                    asset = {
                        "sha256": sha,
                        "filename": cand,
                        "relpath": str(asset_path.relative_to(OUT_BASE)),
                        "width_px": w_px,
                        "height_px": h_px,
                        "bytes": asset_path.stat().st_size if asset_path.exists() else None,
                    }
                    book_assets_by_sha[sha] = asset
                else:
                    w_px, h_px = asset.get("width_px"), asset.get("height_px")

                chapter_guess = _guess_chapter_from_link_name(link_name) or None
                numbering_guess = _guess_numbering_from_link_name(link_name)
                canonical_number_found = None
                if canonical_info and numbering_guess:
                    key = str(numbering_guess.get("key") or "")
                    if key:
                        if key in number_index.get("sections", set()) or key in number_index.get("subparagraphs", set()):
                            canonical_number_found = True
                        else:
                            canonical_number_found = False

                row = {
                    "book_folder": book_dir.name,
                    "doc_folder": doc_dir.name,
                    "doc_source_indd": done_doc_path,
                    "source_page_name": page_name or None,
                    "source_fnum": fnum or None,
                    "source_link_name": link_name or None,
                    "source_metadata_index_1based": fnum or None,
                    "source_metadata_entry": meta if meta else None,
                    "chapter_guess": chapter_guess,
                    # Best-effort chapter/paragraph(/subparagraph) extracted from filenames (when present)
                    "numbering_guess": numbering_guess,
                    "canonical_number_found_in_book_json": canonical_number_found,
                    "canonical_book_id": canonical_info.book_id if canonical_info else None,
                    "canonical_book_json": str(canonical_info.canonical_book_json) if canonical_info else None,
                    "canonical_mapping": canonical if canonical else None,
                    "asset_sha256": sha,
                    "output_image_relpath": asset.get("relpath"),
                    "output_image_filename": asset.get("filename"),
                    "output_width_px": w_px,
                    "output_height_px": h_px,
                    "output_bytes": asset.get("bytes") if isinstance(asset, dict) else None,
                }
                doc_rows.append(row)
                book_rows.append(row)
                global_rows.append(row)

            # Write per-doc manifest
            _safe_write_json(out_doc_dir / "manifest.json", {"images": doc_rows, "missing": doc_missing_obj})
            # CSV (flattened; we keep only high-signal columns)
            csv_rows = []
            for r in doc_rows:
                cm = r.get("canonical_mapping") if isinstance(r.get("canonical_mapping"), dict) else {}
                ctx = cm.get("canonical_context") if isinstance(cm.get("canonical_context"), dict) else {}
                ng = r.get("numbering_guess") if isinstance(r.get("numbering_guess"), dict) else {}
                csv_rows.append(
                    {
                        "book_folder": r.get("book_folder"),
                        "doc_folder": r.get("doc_folder"),
                        "source_page_name": r.get("source_page_name"),
                        "source_fnum": r.get("source_fnum"),
                        "source_link_name": r.get("source_link_name"),
                        "chapter_guess": r.get("chapter_guess"),
                        "num_key_guess": ng.get("key"),
                        "num_chapter_guess": ng.get("chapter_number"),
                        "num_paragraph_guess": ng.get("paragraph_number"),
                        "num_subparagraph_guess": ng.get("subparagraph_number"),
                        "canonical_number_found_in_book_json": r.get("canonical_number_found_in_book_json"),
                        "canonical_book_id": r.get("canonical_book_id"),
                        "figure_id": cm.get("figure_id"),
                        "figureNumber": cm.get("figureNumber"),
                        "canonical_paragraph_id": cm.get("canonical_paragraph_id"),
                        "canonical_chapter_number": ctx.get("chapter_number"),
                        "canonical_section_number": ctx.get("section_number"),
                        "canonical_subparagraph_number": ctx.get("subparagraph_number"),
                        "asset_sha256": r.get("asset_sha256"),
                        "output_image_relpath": r.get("output_image_relpath"),
                        "output_width_px": r.get("output_width_px"),
                        "output_height_px": r.get("output_height_px"),
                    }
                )
            _write_csv(
                out_doc_dir / "manifest.csv",
                csv_rows,
                fieldnames=[
                    "book_folder",
                    "doc_folder",
                    "source_page_name",
                    "source_fnum",
                    "source_link_name",
                    "chapter_guess",
                    "num_key_guess",
                    "num_chapter_guess",
                    "num_paragraph_guess",
                    "num_subparagraph_guess",
                    "canonical_number_found_in_book_json",
                    "canonical_book_id",
                    "figure_id",
                    "figureNumber",
                    "canonical_paragraph_id",
                    "canonical_chapter_number",
                    "canonical_section_number",
                    "canonical_subparagraph_number",
                    "asset_sha256",
                    "output_image_relpath",
                    "output_width_px",
                    "output_height_px",
                ],
            )

        # -----------------------------------------
        # Book-level assets + placements
        # -----------------------------------------
        book_assets = sorted(book_assets_by_sha.values(), key=lambda a: str(a.get("filename") or "").lower())
        for a in book_assets:
            global_assets.append({"book_folder": book_dir.name, **a})

        _safe_write_json(out_book_dir / "assets.json", {"assets": book_assets})
        _write_csv(
            out_book_dir / "assets.csv",
            book_assets,
            fieldnames=["sha256", "filename", "relpath", "width_px", "height_px", "bytes"],
        )

        _safe_write_json(out_book_dir / "placements.json", {"placements": book_rows})

        # Flattened placements per-book (subset of the global schema)
        placements_csv_rows: list[dict[str, Any]] = []
        for r in book_rows:
            cm = r.get("canonical_mapping") if isinstance(r.get("canonical_mapping"), dict) else {}
            ctx = cm.get("canonical_context") if isinstance(cm.get("canonical_context"), dict) else {}
            ng = r.get("numbering_guess") if isinstance(r.get("numbering_guess"), dict) else {}
            placements_csv_rows.append(
                {
                    "doc_folder": r.get("doc_folder"),
                    "source_page_name": r.get("source_page_name"),
                    "source_fnum": r.get("source_fnum"),
                    "source_link_name": r.get("source_link_name"),
                    "num_key_guess": ng.get("key"),
                    "canonical_number_found_in_book_json": r.get("canonical_number_found_in_book_json"),
                    "canonical_book_id": r.get("canonical_book_id"),
                    "figure_id": cm.get("figure_id"),
                    "figureNumber": cm.get("figureNumber"),
                    "canonical_paragraph_id": cm.get("canonical_paragraph_id"),
                    "canonical_chapter_number": ctx.get("chapter_number"),
                    "canonical_section_number": ctx.get("section_number"),
                    "canonical_subparagraph_number": ctx.get("subparagraph_number"),
                    "asset_sha256": r.get("asset_sha256"),
                    "output_image_relpath": r.get("output_image_relpath"),
                    "output_width_px": r.get("output_width_px"),
                    "output_height_px": r.get("output_height_px"),
                }
            )
        _write_csv(
            out_book_dir / "placements.csv",
            placements_csv_rows,
            fieldnames=[
                "doc_folder",
                "source_page_name",
                "source_fnum",
                "source_link_name",
                "num_key_guess",
                "canonical_number_found_in_book_json",
                "canonical_book_id",
                "figure_id",
                "figureNumber",
                "canonical_paragraph_id",
                "canonical_chapter_number",
                "canonical_section_number",
                "canonical_subparagraph_number",
                "asset_sha256",
                "output_image_relpath",
                "output_width_px",
                "output_height_px",
            ],
        )

        # Book-level docs
        book_summary = {
            "book_folder": book_dir.name,
            "canonical_book": {
                "book_id": canonical_info.book_id if canonical_info else None,
                "canonical_book_json": str(canonical_info.canonical_book_json) if canonical_info else None,
                "meta_title": canonical_info.meta_title if canonical_info else None,
                "meta_id": canonical_info.meta_id if canonical_info else None,
            },
            "docs": [d.name for d in doc_dirs],
            "total_placements": len(book_rows),
            "total_unique_images": len(book_assets),
            "docs_with_missing": len(book_missing),
        }
        _safe_write_json(out_book_dir / "book_manifest.json", book_summary)

        md = []
        md.append(f"# {book_dir.name}")
        md.append("")
        if canonical_info:
            md.append("## Canonical JSON")
            md.append(f"- book_id: `{canonical_info.book_id}`")
            if canonical_info.meta_title:
                md.append(f"- title: {canonical_info.meta_title}")
            md.append(f"- canonical_book_with_figures.json: `{canonical_info.canonical_book_json}`")
            md.append("")
        md.append("## Contents")
        md.append(f"- documents: {len(doc_dirs)}")
        md.append(f"- placements: {len(book_rows)}")
        md.append(f"- unique images (deduped): {len(book_assets)}")
        md.append(f"- docs with missing exports: {len(book_missing)}")
        md.append("")
        md.append("## How to use")
        md.append("- Use each document’s `manifest.json` / `manifest.csv` to see which extracted image corresponds to which source link/page.")
        if canonical_info and canonical_info.book_id == AF4_BOOK_ID:
            md.append("- For this book, `manifest.csv` also includes canonical paragraph context (chapter/section/subparagraph) via the AF4 figure mapping files.")
        else:
            md.append("- For this book, canonical paragraph-level figure placement is not available in this repo yet; see the per-doc manifests for page/link-level provenance.")
        md.append("")
        _safe_write_text(out_book_dir / "book_manifest.md", "\n".join(md) + "\n")

    # -----------------------------------------
    # Global manifests
    # -----------------------------------------
    _safe_write_json(
        OUT_BASE / "placements.json",
        {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "source_highres_base": str(HIGHRES_BASE),
            "repo_root": str(REPO_ROOT),
            "total_placements": len(global_rows),
            "total_docs_with_missing": len(global_missing),
            "placements": global_rows,
            "missing_summary": global_missing,
        },
    )

    _safe_write_json(OUT_BASE / "assets.json", {"assets": global_assets})
    _write_csv(
        OUT_BASE / "assets.csv",
        global_assets,
        fieldnames=["book_folder", "sha256", "filename", "relpath", "width_px", "height_px", "bytes"],
    )

    # Global placements.csv (flattened)
    csv_rows = []
    for r in global_rows:
        cm = r.get("canonical_mapping") if isinstance(r.get("canonical_mapping"), dict) else {}
        ctx = cm.get("canonical_context") if isinstance(cm.get("canonical_context"), dict) else {}
        ng = r.get("numbering_guess") if isinstance(r.get("numbering_guess"), dict) else {}
        csv_rows.append(
            {
                "book_folder": r.get("book_folder"),
                "doc_folder": r.get("doc_folder"),
                "source_page_name": r.get("source_page_name"),
                "source_fnum": r.get("source_fnum"),
                "source_link_name": r.get("source_link_name"),
                "chapter_guess": r.get("chapter_guess"),
                "num_key_guess": ng.get("key"),
                "num_chapter_guess": ng.get("chapter_number"),
                "num_paragraph_guess": ng.get("paragraph_number"),
                "num_subparagraph_guess": ng.get("subparagraph_number"),
                "canonical_number_found_in_book_json": r.get("canonical_number_found_in_book_json"),
                "canonical_book_id": r.get("canonical_book_id"),
                "figure_id": cm.get("figure_id"),
                "figureNumber": cm.get("figureNumber"),
                "canonical_paragraph_id": cm.get("canonical_paragraph_id"),
                "canonical_chapter_number": ctx.get("chapter_number"),
                "canonical_section_number": ctx.get("section_number"),
                "canonical_subparagraph_number": ctx.get("subparagraph_number"),
                "asset_sha256": r.get("asset_sha256"),
                "output_image_relpath": r.get("output_image_relpath"),
                "output_width_px": r.get("output_width_px"),
                "output_height_px": r.get("output_height_px"),
            }
        )

    _write_csv(
        OUT_BASE / "placements.csv",
        csv_rows,
        fieldnames=[
            "book_folder",
            "doc_folder",
            "source_page_name",
            "source_fnum",
            "source_link_name",
            "chapter_guess",
            "num_key_guess",
            "num_chapter_guess",
            "num_paragraph_guess",
            "num_subparagraph_guess",
            "canonical_number_found_in_book_json",
            "canonical_book_id",
            "figure_id",
            "figureNumber",
            "canonical_paragraph_id",
            "canonical_chapter_number",
            "canonical_section_number",
            "canonical_subparagraph_number",
            "asset_sha256",
            "output_image_relpath",
            "output_width_px",
            "output_height_px",
        ],
    )

    # README
    readme = []
    readme.append("# Updated images")
    readme.append("")
    readme.append("This folder is generated from the high-res page-export + smart-crop pipeline outputs.")
    readme.append("All images are included; duplicate image files are removed (deduped) per book, and usage is tracked in the placements manifests.")
    readme.append("")
    readme.append("## Structure")
    readme.append("- One folder per book (mirrors `~/Desktop/highres_labeled_figures`).")
    readme.append("- Inside each book:")
    readme.append("  - `images/`: deduped PNGs (one copy per unique image content for that book)")
    readme.append("  - `assets.json` / `assets.csv`: unique image inventory for that book")
    readme.append("  - `placements.json` / `placements.csv`: where each image is used (page/link + canonical mapping when available)")
    readme.append("  - `documents/<doc>/manifest.*`: per-document placements referencing `images/`")
    readme.append("  - `documents/<doc>/missing.json`: missing crops report (should be empty when complete)")
    readme.append("")
    readme.append("## Global manifests")
    readme.append("- `placements.json` / `placements.csv`: all placements across all books")
    readme.append("- `assets.json` / `assets.csv`: all unique assets across all books (still separated per book)")
    readme.append("")
    readme.append("## Canonical assembly notes")
    readme.append("- For `MBO_AF4_2024_COMMON_CORE` (A&F 4), placements include canonical paragraph context (chapter/section/subparagraph) derived from:")
    readme.append(f"  - `{AF4_FIGURES_BY_PARA}`")
    readme.append(f"  - `{AF4_CANONICAL_BOOK_JSON}`")
    readme.append("- For other books, this repo currently lacks a canonical figure→paragraph placement map; manifests still include page/link provenance and best-effort numbering guesses.")
    readme.append("")
    readme.append("## Zip")
    readme.append(f"- A full zip is written next to this folder: `{OUT_BASE.parent / (OUT_BASE.name + '.zip')}`")
    readme.append("")
    _safe_write_text(OUT_BASE / "README.md", "\n".join(readme) + "\n")

    # -----------------------------------------
    # Zip everything into one file on Desktop
    # -----------------------------------------
    zip_path = OUT_BASE.parent / f"{OUT_BASE.name}.zip"
    if zip_path.exists():
        try:
            zip_path.unlink()
        except Exception:
            pass
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        base_parent = OUT_BASE.parent
        for p in sorted(OUT_BASE.rglob("*"), key=lambda x: x.as_posix().lower()):
            if p.is_dir():
                continue
            arc = p.relative_to(base_parent)  # includes "Updated images/..."
            z.write(p, arcname=str(arc))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


