#!/usr/bin/env python3
"""Extract figure captions - handles ALL Fotobijschrift variants"""
import re
import json
from pathlib import Path

stories_dir = Path("/tmp/pv_idml/Stories")
captions = {}

for story_file in stories_dir.glob("*.xml"):
    content = story_file.read_text(encoding='utf-8')
    
    # Find ALL Fotobijschrift variants (•Fotobijschrift, •Fotobijschrift_2, etc.)
    # But NOT •Fotobijschrift_credit
    pattern = r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/•Fotobijschrift(?:_\d+)?"[^>]*>(.*?)</ParagraphStyleRange>'
    matches = re.findall(pattern, content, re.DOTALL)
    
    for match in matches:
        # Extract ALL Content values
        contents = re.findall(r'<Content>([^<]*)</Content>', match)
        full_text = ''.join(contents).strip()
        
        # Check for Afbeelding X.Y pattern
        fig_match = re.match(r'Afbeelding\s+(\d+\.\d+)\s*(.*)', full_text)
        if fig_match:
            fig_num = fig_match.group(1)
            caption = fig_match.group(2).strip()
            caption = re.sub(r'\s+', ' ', caption)
            if caption and fig_num not in captions:
                captions[fig_num] = caption

def sort_key(fig_num):
    parts = fig_num.split('.')
    return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)

print(f"Found {len(captions)} captions")

# Show chapter 33
print("\nChapter 33:")
for k in sorted(captions.keys(), key=sort_key):
    if k.startswith('33.'):
        print(f"  {k}: {captions[k][:60]}...")

# Coverage
img_dir = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/figures/persoonlijke_verzorging")
all_imgs = [f.stem.replace("Afbeelding_", "") for f in img_dir.glob("Afbeelding_*.png")]
with_cap = sum(1 for i in all_imgs if i in captions)
missing = [i for i in sorted(all_imgs, key=sort_key) if i not in captions]
print(f"\nCoverage: {with_cap}/{len(all_imgs)}")
print(f"Missing: {missing}")

# Save
output = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/extract/persoonlijke_verzorging_captions.json"
with open(output, 'w', encoding='utf-8') as f:
    json.dump(captions, f, indent=2, ensure_ascii=False)
print(f"\nSaved to {output}")





