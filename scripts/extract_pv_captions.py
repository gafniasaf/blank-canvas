#!/usr/bin/env python3
"""Extract figure captions from Persoonlijke Verzorging IDML"""
import os
import re
import json
from pathlib import Path

stories_dir = Path("/tmp/pv_idml/Stories")
captions = {}

for story_file in stories_dir.glob("*.xml"):
    content = story_file.read_text(encoding='utf-8')
    
    # Find all Fotobijschrift paragraphs
    pattern = r'ParagraphStyle/•Fotobijschrift"[^>]*>(.*?)</ParagraphStyleRange>'
    matches = re.findall(pattern, content, re.DOTALL)
    
    for match in matches:
        # Extract all Content values
        contents = re.findall(r'<Content>([^<]+)</Content>', match)
        if len(contents) >= 1:
            first = contents[0].strip()
            fig_match = re.match(r'Afbeelding\s+(\d+\.\d+)', first)
            if fig_match:
                fig_num = fig_match.group(1)
                caption_parts = contents[1:] if len(contents) > 1 else []
                caption = ' '.join(c.strip() for c in caption_parts if c.strip())
                if caption:
                    captions[fig_num] = caption

print(f"Found {len(captions)} figure captions from Fotobijschrift style")
print("\nExamples:")
sorted_keys = sorted(captions.keys(), key=lambda x: (int(x.split('.')[0]), int(x.split('.')[1])))
for k in sorted_keys[:20]:
    cap = captions[k]
    print(f"  Afbeelding {k}: {cap[:60]}{'...' if len(cap) > 60 else ''}")

# Save
output_path = "new_pipeline/extract/persoonlijke_verzorging_captions.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(captions, f, indent=2, ensure_ascii=False)
print(f"\nSaved to {output_path}")





