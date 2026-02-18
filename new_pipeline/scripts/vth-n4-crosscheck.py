#!/usr/bin/env python3
"""
Cross-check VTH N4 JSON figures vs assets and PDF captions.
"""
import json
import re
from pathlib import Path
import fitz
import csv

REPO_ROOT = Path('/Users/asafgafni/Desktop/InDesign/TestRun')
CANONICAL = REPO_ROOT / 'new_pipeline' / 'output' / '_canonical_jsons_all' / 'VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.json'
ASSETS_DIR = REPO_ROOT / 'new_pipeline' / 'assets' / 'figures' / 'vth_n4'
PDF_PATH = REPO_ROOT / 'new_pipeline' / 'output' / 'highres_exports' / 'MBO_VTH_N4_2024_HIGHRES.pdf'
REPORT_JSON = REPO_ROOT / 'new_pipeline' / 'output' / 'vth_n4_text_extract' / 'vth_n4_figures_crosscheck.json'
REPORT_CSV = REPO_ROOT / 'new_pipeline' / 'output' / 'vth_n4_text_extract' / 'vth_n4_figures_crosscheck.csv'

# Load canonical
with CANONICAL.open('r', encoding='utf-8') as f:
    book = json.load(f)

# Extract captions from PDF again for cross-check
pdf_doc = fitz.open(str(PDF_PATH))
pdf_captions = {}
for page_num in range(pdf_doc.page_count):
    text = pdf_doc[page_num].get_text('text')
    matches = re.finditer(
        r'Afbeelding\s+(\d+)\.(\d+)\s*[:\.]?\s*([^\n]+(?:\n(?![A-Z0-9]|\d+\.\d+)[^\n]+)?)',
        text, re.IGNORECASE
    )
    for match in matches:
        ch_num = match.group(1)
        fig_num = match.group(2)
        caption_text = match.group(3).strip()
        caption_text = re.sub(r'\s+', ' ', caption_text)
        caption_text = re.sub(r'­', '', caption_text)  # Remove soft hyphens
        fig_key = f"{ch_num}.{fig_num}"
        if len(caption_text) > 10 and not caption_text.lower().startswith('zie '):
            if fig_key not in pdf_captions or len(caption_text) > len(pdf_captions[fig_key]):
                pdf_captions[fig_key] = caption_text
pdf_doc.close()

# Build figure list from canonical
figures = []
for chapter in book.get('chapters', []):
    for section in chapter.get('sections', []):
        for block in section.get('content', []):
            if not isinstance(block, dict):
                continue
            for img in block.get('images', []):
                fig_number = img.get('figureNumber', '')
                match = re.search(r'(\d+\.\d+)', fig_number)
                if not match:
                    continue
                fig_key = match.group(1)
                src = img.get('src', '')
                caption = img.get('caption', '')
                figures.append({
                    'figure_key': fig_key,
                    'figure_number': fig_number,
                    'src': src,
                    'caption': caption,
                })

# Deduplicate by figure_key (in case of multiple placement)
by_key = {}
for fig in figures:
    if fig['figure_key'] not in by_key:
        by_key[fig['figure_key']] = fig

# Asset files on disk
asset_files = {p.name for p in ASSETS_DIR.glob('*.png')}

# Cross-check
rows = []
missing_assets = []
missing_captions = []
caption_mismatches = []

for fig_key, fig in sorted(by_key.items(), key=lambda x: (int(x[0].split('.')[0]), int(x[0].split('.')[1]))):
    expected_filename = f"Afbeelding_{fig_key}.png"
    asset_exists = expected_filename in asset_files
    if not asset_exists:
        missing_assets.append(fig_key)

    pdf_caption = pdf_captions.get(fig_key, '')
    json_caption = (fig.get('caption') or '').strip()
    if not json_caption:
        missing_captions.append(fig_key)

    # Basic match check: pdf caption prefix in json caption or vice versa
    matches = False
    if pdf_caption and json_caption:
        if pdf_caption.lower() in json_caption.lower() or json_caption.lower() in pdf_caption.lower():
            matches = True
        else:
            # relaxed compare: compare first 60 chars without punctuation
            def norm(s: str) -> str:
                s = re.sub(r'[^a-z0-9 ]', '', s.lower())
                return s[:60]
            if norm(pdf_caption) == norm(json_caption):
                matches = True
    if pdf_caption and json_caption and not matches:
        caption_mismatches.append(fig_key)

    rows.append({
        'figure_key': fig_key,
        'asset_expected': expected_filename,
        'asset_exists': asset_exists,
        'caption_matches': matches if pdf_caption and json_caption else None,
        'json_caption': json_caption,
        'pdf_caption': pdf_caption,
    })

# Unreferenced assets
referenced_assets = {f"Afbeelding_{k}.png" for k in by_key.keys()}
unreferenced_assets = sorted(asset_files - referenced_assets)

# Write reports
REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
with REPORT_JSON.open('w', encoding='utf-8') as f:
    json.dump({
        'figures_total': len(by_key),
        'pdf_captions_total': len(pdf_captions),
        'missing_assets': missing_assets,
        'unreferenced_assets': unreferenced_assets,
        'missing_captions': missing_captions,
        'caption_mismatches': caption_mismatches,
        'rows': rows,
    }, f, indent=2, ensure_ascii=False)

with REPORT_CSV.open('w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['figure_key', 'asset_expected', 'asset_exists', 'caption_matches', 'json_caption', 'pdf_caption'])
    writer.writeheader()
    for r in rows:
        writer.writerow(r)

print('=== VTH N4 Figures Cross-check ===')
print(f"Figures in JSON: {len(by_key)}")
print(f"PDF captions found: {len(pdf_captions)}")
print(f"Missing assets: {len(missing_assets)}")
print(f"Unreferenced assets: {len(unreferenced_assets)}")
print(f"Missing captions in JSON: {len(missing_captions)}")
print(f"Caption mismatches vs PDF: {len(caption_mismatches)}")
print(f"Report JSON: {REPORT_JSON}")
print(f"Report CSV: {REPORT_CSV}")

if missing_assets:
    print('Missing assets sample:', missing_assets[:10])
if unreferenced_assets:
    print('Unreferenced assets sample:', unreferenced_assets[:10])
if missing_captions:
    print('Missing captions sample:', missing_captions[:10])
if caption_mismatches:
    print('Caption mismatches sample:', caption_mismatches[:10])
