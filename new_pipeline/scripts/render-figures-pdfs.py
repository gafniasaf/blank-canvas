#!/usr/bin/env python3
"""
Render Prince PDFs for processed books in figure_pipeline_report.json.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
REPORT_PATH = REPO_ROOT / "new_pipeline" / "output" / "figure_pipeline_report.json"
RENDERER = REPO_ROOT / "new_pipeline" / "renderer" / "render-prince-pdf.ts"


def main() -> None:
    if not REPORT_PATH.exists():
        raise SystemExit(f"Missing report: {REPORT_PATH}")

    with REPORT_PATH.open("r", encoding="utf-8") as f:
        report = json.load(f)

    for slug, info in report.items():
        if info.get("status") != "processed":
            continue
        input_json = Path(info["output_json"])
        output_pdf = input_json.parent / f"{slug}_with_all_figures.pdf"
        output_log = input_json.parent / f"{slug}_with_all_figures_prince.log"
        if output_pdf.exists():
            print(f"Skipping {slug} (already exists): {output_pdf}")
            continue
        print(f"Rendering {slug} -> {output_pdf}")
        subprocess.run(
            [
                "npx",
                "ts-node",
                str(RENDERER),
                str(input_json),
                "--out",
                str(output_pdf),
                "--log",
                str(output_log),
            ],
            cwd=str(REPO_ROOT / "new_pipeline"),
            check=False,
        )


if __name__ == "__main__":
    main()

