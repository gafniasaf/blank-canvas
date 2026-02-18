#!/usr/bin/env python3
"""
Smart (visual) cropper v2

The previous version was wrong because:
- It assumed metadata was in points; it's actually in *page units* (here: mm).
- The expand-by-whitespace heuristic can stop early and miss labels.

This version fixes both issues:
1) Converts metadata -> pixels by deriving scale from the page export size and the
   page dimensions found in metadata (max right/bottom).
2) Uses a connected-components crop (flood fill) starting from the image area, so we
   keep the figure + labels/leader lines but avoid unrelated body text when it's disconnected.
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

DEFAULT_METADATA_FILE = Path.home() / "Desktop/extracted_figures/figure_metadata.json"
DEFAULT_PAGE_EXPORTS_DIRS = [
    Path.home() / "Desktop/page_exports_300",  # preferred high-res
    Path.home() / "Desktop/page_exports",      # fallback low-res
]
DEFAULT_OUTPUT_DIR = Path.home() / "Desktop/extracted_figures/smart_crop_300"

# Visual thresholds
INK_THRESHOLD = 245  # grayscale < threshold == "ink" (non-white)

# ROI expansion around the image bounds (in *page units*, e.g. mm)
ROI_MARGIN_UNITS_X = 60.0
ROI_MARGIN_UNITS_Y = 60.0

# Connected-components speed knobs
DOWNSAMPLE = 2  # analyze at 1/2 resolution, then scale bbox back up
DILATE_RADIUS = 1  # 0 disables; 1 = light dilation to connect labels/lines

# Output padding (pixels) to avoid tight cuts
OUT_PAD_PX = 6

# Extra “ink window” around the main connected component (to catch labels that are
# *not* connected by a leader line, e.g. DNA base labels).
# These margins are in page units (same units as metadata, e.g. mm).
EXTRA_INK_MARGIN_X_UNITS = 80.0
# Keep vertical expansion at 0 to avoid pulling in captions/body text; most disconnected
# label blocks are lateral (left/right), not above/below.
EXTRA_INK_MARGIN_Y_UNITS = 0.0

# Optional: limit to specific pages while iterating
TEST_PAGES: set[str] | None = None  # e.g. {"11", "15", "189"} for quick testing

# Prefer PNG output for high-res clarity (no JPEG artifacts)
OUTPUT_EXT = ".png"


def _binary_dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Very small binary dilation without SciPy (radius 1 only is supported)."""
    if radius <= 0:
        return mask
    if radius != 1:
        raise ValueError("Only DILATE_RADIUS=1 is supported without SciPy")

    m = mask
    out = m.copy()
    # 8-neighborhood shifts
    out |= np.roll(m, 1, axis=0)
    out |= np.roll(m, -1, axis=0)
    out |= np.roll(m, 1, axis=1)
    out |= np.roll(m, -1, axis=1)
    out |= np.roll(np.roll(m, 1, axis=0), 1, axis=1)
    out |= np.roll(np.roll(m, 1, axis=0), -1, axis=1)
    out |= np.roll(np.roll(m, -1, axis=0), 1, axis=1)
    out |= np.roll(np.roll(m, -1, axis=0), -1, axis=1)
    return out


def _find_seed(mask: np.ndarray, seed_box: tuple[int, int, int, int]) -> tuple[int, int] | None:
    """Return one (y,x) seed inside seed_box where mask is True."""
    top, left, bottom, right = seed_box
    if top >= bottom or left >= right:
        return None
    region = mask[top:bottom, left:right]
    if not region.any():
        return None
    yx = np.argwhere(region)[0]
    return (top + int(yx[0]), left + int(yx[1]))


def _flood_bbox_size(
    mask: np.ndarray,
    visited: np.ndarray,
    seed: tuple[int, int],
) -> tuple[tuple[int, int, int, int], int]:
    """Flood-fill 8-connected True pixels starting at seed; return (bbox, size)."""
    h, w = mask.shape
    sy, sx = seed
    dq: deque[tuple[int, int]] = deque()
    dq.append((sy, sx))
    visited[sy, sx] = True

    min_y = max_y = sy
    min_x = max_x = sx
    size = 0

    while dq:
        y, x = dq.popleft()
        size += 1
        if y < min_y:
            min_y = y
        if y > max_y:
            max_y = y
        if x < min_x:
            min_x = x
        if x > max_x:
            max_x = x

        # 8-neighborhood
        for ny in (y - 1, y, y + 1):
            if ny < 0 or ny >= h:
                continue
            for nx in (x - 1, x, x + 1):
                if nx < 0 or nx >= w:
                    continue
                if visited[ny, nx] or not mask[ny, nx]:
                    continue
                visited[ny, nx] = True
                dq.append((ny, nx))

    # +1 because bbox is exclusive on bottom/right
    return (min_y, min_x, max_y + 1, max_x + 1), size


def _largest_component_bbox_in_seed_box(
    mask: np.ndarray,
    seed_box: tuple[int, int, int, int],
    max_samples: int = 400,
) -> tuple[int, int, int, int] | None:
    """
    Pick the largest connected component that intersects the seed_box.
    This prevents us from accidentally seeding on a small body-text word inside the box.
    """
    top, left, bottom, right = seed_box
    if top >= bottom or left >= right:
        return None

    region = mask[top:bottom, left:right]
    if not region.any():
        return None

    coords = np.argwhere(region)
    # Subsample to limit work; biggest component will still be hit.
    if coords.shape[0] > max_samples:
        step = max(1, coords.shape[0] // max_samples)
        coords = coords[::step]

    visited = np.zeros_like(mask, dtype=bool)
    best_bbox: tuple[int, int, int, int] | None = None
    best_size = -1

    for yx in coords:
        y = top + int(yx[0])
        x = left + int(yx[1])
        if visited[y, x] or not mask[y, x]:
            continue
        bbox, size = _flood_bbox_size(mask, visited, (y, x))
        if size > best_size:
            best_size = size
            best_bbox = bbox

    return best_bbox


def _parse_pages_arg(s: str | None) -> set[str] | None:
    if not s:
        return None
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return set(parts) if parts else None


def _read_json_any_encoding(path: Path) -> list[dict]:
    raw = path.read_bytes()
    last_err: Exception | None = None
    for enc in ("utf-8", "utf-8-sig", "mac_roman", "cp1252", "latin-1"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            last_err = e
            continue
    raise RuntimeError(f"Failed to decode/parse JSON: {path} ({last_err})")


def run(
    *,
    metadata_file: Path,
    page_exports_dirs: list[Path],
    output_dir: Path,
    output_ext: str,
    clean_output: bool,
    test_pages: set[str] | None,
) -> None:
    output_ext = output_ext if output_ext.startswith(".") else ("." + output_ext)
    output_dir.mkdir(parents=True, exist_ok=True)
    if clean_output:
        for old in output_dir.glob(f"*{output_ext}"):
            try:
                old.unlink()
            except Exception:
                pass

    figures = _read_json_any_encoding(metadata_file)

    if not figures:
        print("No figures found in metadata.")
        return

    # Derive page units (use explicit page size if present; fallback to max bounds)
    page_units_w = float(
        max(fig.get("pageWidthUnits", fig.get("right", 0)) for fig in figures)
    )
    page_units_h = float(
        max(fig.get("pageHeightUnits", fig.get("bottom", 0)) for fig in figures)
    )

    print(f"Smart cropping {len(figures)} figures...")
    print(f"Detected page size in metadata units: {page_units_w} x {page_units_h}")

    for idx, fig in enumerate(figures):
        page_name = str(fig["page"])
        if test_pages is not None and page_name not in test_pages:
            continue

        # Prefer high-res exports; fall back to low-res.
        page_file = None
        for d in page_exports_dirs:
            if d is None:
                continue
            cand = d / f"page_{page_name}.jpg"
            if cand.exists():
                page_file = cand
                break
            cand = d / f"page_{page_name}.png"
            if cand.exists():
                page_file = cand
                break
        if page_file is None:
            continue

        img = Image.open(page_file)
        w_px, h_px = img.size

        # Scale metadata units -> pixels using page size (robust to mm/pt/etc)
        sx = w_px / page_units_w
        sy = h_px / page_units_h

        # Initial image bounds in metadata units.
        # NOTE: Some INDDs (esp. facing-page docs) can yield "spread-like" X coords where
        # left-page items are negative and right-page items are > pageWidth. If the entire
        # bbox is off-page, normalize by shifting in page-width chunks so we can still crop.
        top_u = float(fig["top"])
        left_u = float(fig["left"])
        bottom_u = float(fig["bottom"])
        right_u = float(fig["right"])

        # Normalize X into [0, page_units_w] when bbox is fully outside.
        # (Keep partial bleed; we clamp later.)
        while right_u <= 0:
            left_u += page_units_w
            right_u += page_units_w
        while left_u >= page_units_w:
            left_u -= page_units_w
            right_u -= page_units_w

        # Convert to pixels (clamped)
        top_px = int(round(top_u * sy))
        left_px = int(round(left_u * sx))
        bottom_px = int(round(bottom_u * sy))
        right_px = int(round(right_u * sx))

        top_px = max(0, min(h_px - 1, top_px))
        left_px = max(0, min(w_px - 1, left_px))
        bottom_px = max(0, min(h_px, bottom_px))
        right_px = max(0, min(w_px, right_px))
        if bottom_px <= top_px or right_px <= left_px:
            continue

        # Build ROI around the image bounds (in pixels)
        mx = int(round(ROI_MARGIN_UNITS_X * sx))
        my = int(round(ROI_MARGIN_UNITS_Y * sy))
        roi_top = max(0, top_px - my)
        roi_left = max(0, left_px - mx)
        roi_bottom = min(h_px, bottom_px + my)
        roi_right = min(w_px, right_px + mx)

        roi = img.crop((roi_left, roi_top, roi_right, roi_bottom))

        # Downsample for speed
        if DOWNSAMPLE > 1:
            ds_w = max(1, roi.size[0] // DOWNSAMPLE)
            ds_h = max(1, roi.size[1] // DOWNSAMPLE)
            roi_small = roi.resize((ds_w, ds_h), Image.BILINEAR)
        else:
            roi_small = roi

        gray = roi_small.convert("L")
        arr = np.asarray(gray)

        # Ink mask
        mask = arr < INK_THRESHOLD
        if DILATE_RADIUS:
            mask = _binary_dilate(mask, DILATE_RADIUS)

        # Seed box in ROI-small coords
        seed_top = (top_px - roi_top) // DOWNSAMPLE
        seed_left = (left_px - roi_left) // DOWNSAMPLE
        seed_bottom = (bottom_px - roi_top) // DOWNSAMPLE
        seed_right = (right_px - roi_left) // DOWNSAMPLE

        seed_top = max(0, min(mask.shape[0] - 1, seed_top))
        seed_left = max(0, min(mask.shape[1] - 1, seed_left))
        seed_bottom = max(seed_top + 1, min(mask.shape[0], seed_bottom))
        seed_right = max(seed_left + 1, min(mask.shape[1], seed_right))

        bbox_small = _largest_component_bbox_in_seed_box(
            mask,
            (seed_top, seed_left, seed_bottom, seed_right),
        )
        if bbox_small is None:
            # If thresholding missed the image, fall back to a looser threshold just for seeding.
            mask2 = arr < 252
            if DILATE_RADIUS:
                mask2 = _binary_dilate(mask2, DILATE_RADIUS)
            bbox_small = _largest_component_bbox_in_seed_box(
                mask2,
                (seed_top, seed_left, seed_bottom, seed_right),
            )
            if bbox_small is None:
                continue

        # Optionally expand to include nearby disconnected label ink
        bb_top_s, bb_left_s, bb_bottom_s, bb_right_s = bbox_small
        extra_x_s = int(round(EXTRA_INK_MARGIN_X_UNITS * sx / DOWNSAMPLE))
        extra_y_s = int(round(EXTRA_INK_MARGIN_Y_UNITS * sy / DOWNSAMPLE))
        win_top_s = max(0, bb_top_s - extra_y_s)
        win_left_s = max(0, bb_left_s - extra_x_s)
        win_bottom_s = min(mask.shape[0], bb_bottom_s + extra_y_s)
        win_right_s = min(mask.shape[1], bb_right_s + extra_x_s)

        sub = mask[win_top_s:win_bottom_s, win_left_s:win_right_s]
        if sub.any():
            ys, xs = np.where(sub)
            bb_top_s = win_top_s + int(ys.min())
            bb_bottom_s = win_top_s + int(ys.max()) + 1
            bb_left_s = win_left_s + int(xs.min())
            bb_right_s = win_left_s + int(xs.max()) + 1

        # Scale bbox back to original ROI coords
        bb_top = roi_top + bb_top_s * DOWNSAMPLE
        bb_left = roi_left + bb_left_s * DOWNSAMPLE
        bb_bottom = roi_top + bb_bottom_s * DOWNSAMPLE
        bb_right = roi_left + bb_right_s * DOWNSAMPLE

        # Pad + clamp
        bb_top = max(0, bb_top - OUT_PAD_PX)
        bb_left = max(0, bb_left - OUT_PAD_PX)
        bb_bottom = min(h_px, bb_bottom + OUT_PAD_PX)
        bb_right = min(w_px, bb_right + OUT_PAD_PX)

        cropped = img.crop((bb_left, bb_top, bb_right, bb_bottom))

        safe_name_raw = str(fig.get("imageName", "fig"))
        # Strip the final extension to avoid names like "...png.png"
        if "." in safe_name_raw:
            safe_name_raw = safe_name_raw.rsplit(".", 1)[0]
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in safe_name_raw)
        out_file = output_dir / f"p{page_name}_f{idx+1:04d}_{safe_name[:40]}{output_ext}"
        if output_ext.lower() == ".png":
            cropped.save(out_file)
        else:
            cropped.save(out_file, quality=95)

        print(f"Saved {out_file.name}  ({cropped.size[0]}x{cropped.size[1]})")


def _read_config(path: Path) -> dict:
    return json.loads(path.read_text())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=str, help="Path to JSON config file")
    ap.add_argument("--metadata", type=str, default=None, help="Path to metadata JSON")
    ap.add_argument(
        "--page-exports-dir",
        type=str,
        action="append",
        default=[],
        help="Page exports directory (can be provided multiple times)",
    )
    ap.add_argument("--output-dir", type=str, default=None, help="Output directory")
    ap.add_argument("--output-ext", type=str, default=OUTPUT_EXT, help="Output extension (.png or .jpg)")
    ap.add_argument("--no-clean", action="store_true", help="Do not delete existing outputs first")
    ap.add_argument("--test-pages", type=str, default=None, help="Comma-separated page names to process")
    args = ap.parse_args()

    test_pages = _parse_pages_arg(args.test_pages)

    if args.config:
        cfg = _read_config(Path(args.config))
        run(
            metadata_file=Path(cfg["metadataPath"]),
            page_exports_dirs=[
                Path(cfg["pageExports300Dir"]),
                Path(cfg.get("pageExportsFallbackDir")) if cfg.get("pageExportsFallbackDir") else None,
            ],
            output_dir=Path(cfg["figuresOutDir"]),
            output_ext=str(cfg.get("figuresOutExt", OUTPUT_EXT)),
            clean_output=not bool(cfg.get("noClean", False)),
            test_pages=test_pages,
        )
        return

    metadata_file = Path(args.metadata) if args.metadata else DEFAULT_METADATA_FILE
    page_exports_dirs = (
        [Path(p) for p in args.page_exports_dir] if args.page_exports_dir else DEFAULT_PAGE_EXPORTS_DIRS
    )
    output_dir = Path(args.output_dir) if args.output_dir else DEFAULT_OUTPUT_DIR
    run(
        metadata_file=metadata_file,
        page_exports_dirs=page_exports_dirs,
        output_dir=output_dir,
        output_ext=args.output_ext,
        clean_output=(not args.no_clean),
        test_pages=test_pages,
    )


if __name__ == "__main__":
    main()

