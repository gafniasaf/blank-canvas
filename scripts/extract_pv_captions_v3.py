#!/usr/bin/env python3
"""Extract figure captions from Persoonlijke Verzorging IDML - v3 handles split Content tags"""
import os
import re
import json
from pathlib import Path

stories_dir = Path("/tmp/pv_idml/Stories")
captions = {}

for story_file in stories_dir.glob("*.xml"):
    content = story_file.read_text(encoding='utf-8')
    
    # Find all Fotobijschrift paragraphs (the entire paragraph block)
    pattern = r'<ParagraphStyleRange[^>]*AppliedParagraphStyle="ParagraphStyle/•Fotobijschrift"[^>]*>(.*?)</ParagraphStyleRange>'
    matches = re.findall(pattern, content, re.DOTALL)
    
    for match in matches:
        # Extract ALL Content values in this paragraph
        contents = re.findall(r'<Content>([^<]*)</Content>', match)
        
        # Join all content
        full_text = ''.join(contents).strip()
        
        # Check if it starts with Afbeelding X.Y
        fig_match = re.match(r'Afbeelding\s+(\d+\.\d+)\s*(.*)', full_text)
        if fig_match:
            fig_num = fig_match.group(1)
            caption = fig_match.group(2).strip()
            
            # Clean up caption
            caption = re.sub(r'\s+', ' ', caption)
            caption = caption.rstrip('.')
            if caption:
                caption = caption + '.'
            
            if caption and fig_num not in captions:
                captions[fig_num] = caption

print(f"Found {len(captions)} figure captions")

# Sort and show examples
def sort_key(fig_num):
    parts = fig_num.split('.')
    return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)

sorted_keys = sorted(captions.keys(), key=sort_key)

# Show chapter 33
print("\nChapter 33 captions:")
for k in sorted_keys:
    if k.startswith('33.'):
        print(f"  Afbeelding {k}: {captions[k][:60]}{'...' if len(captions[k]) > 60 else ''}")

# Count coverage
from pathlib import Path
img_dir = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/figures/persoonlijke_verzorging")
all_imgs = [f.stem.replace("Afbeelding_", "") for f in img_dir.glob("Afbeelding_*.png")]
with_cap = sum(1 for i in all_imgs if i in captions)
print(f"\nCoverage: {with_cap}/{len(all_imgs)} images have captions")

# Show missing
missing = [i for i in sorted(all_imgs, key=sort_key) if i not in captions]
print(f"Missing: {missing[:20]}{'...' if len(missing) > 20 else ''}")

# Save
output_path = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/extract/persoonlijke_verzorging_captions.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(captions, f, indent=2, ensure_ascii=False)
print(f"\nSaved to {output_path}")





