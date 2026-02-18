#!/usr/bin/env python3
"""Extract figure captions from Persoonlijke Verzorging IDML - improved version"""
import os
import re
import json
from pathlib import Path

stories_dir = Path("/tmp/pv_idml/Stories")
captions = {}

for story_file in stories_dir.glob("*.xml"):
    content = story_file.read_text(encoding='utf-8')
    
    # Method 1: Find Fotobijschrift paragraphs with separate Content tags
    pattern = r'ParagraphStyle/•Fotobijschrift"[^>]*>(.*?)</ParagraphStyleRange>'
    matches = re.findall(pattern, content, re.DOTALL)
    
    for match in matches:
        contents = re.findall(r'<Content>([^<]+)</Content>', match)
        if len(contents) >= 1:
            first = contents[0].strip()
            # Check if caption is in the same Content tag
            fig_match = re.match(r'Afbeelding\s+(\d+\.\d+)\s*(.*)', first)
            if fig_match:
                fig_num = fig_match.group(1)
                caption_in_first = fig_match.group(2).strip()
                
                if caption_in_first and not caption_in_first.endswith(':'):
                    # Caption is in the same Content tag
                    captions[fig_num] = caption_in_first
                elif len(contents) > 1:
                    # Caption is in subsequent Content tags
                    caption_parts = contents[1:]
                    caption = ' '.join(c.strip() for c in caption_parts if c.strip())
                    if caption:
                        captions[fig_num] = caption
    
    # Method 2: Find ANY Content tag with "Afbeelding X.Y caption" pattern
    all_contents = re.findall(r'<Content>([^<]+)</Content>', content)
    for c in all_contents:
        fig_match = re.match(r'Afbeelding\s+(\d+\.\d+)\s+([A-Z].*)', c.strip())
        if fig_match:
            fig_num = fig_match.group(1)
            caption = fig_match.group(2).strip()
            if caption and fig_num not in captions:
                captions[fig_num] = caption

print(f"Found {len(captions)} figure captions")

# Sort and show examples
def sort_key(fig_num):
    parts = fig_num.split('.')
    return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)

sorted_keys = sorted(captions.keys(), key=sort_key)
print("\nChapter 1 captions:")
for k in sorted_keys:
    if k.startswith('1.'):
        print(f"  Afbeelding {k}: {captions[k][:50]}{'...' if len(captions[k]) > 50 else ''}")

print("\nChapter 18 captions:")
for k in sorted_keys:
    if k.startswith('18.'):
        print(f"  Afbeelding {k}: {captions[k][:50]}{'...' if len(captions[k]) > 50 else ''}")

# Save
output_path = "new_pipeline/extract/persoonlijke_verzorging_captions.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(captions, f, indent=2, ensure_ascii=False)
print(f"\nSaved to {output_path}")





