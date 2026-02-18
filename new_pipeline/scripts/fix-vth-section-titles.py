#!/usr/bin/env python3
"""
Fix incomplete section titles in VTH N4.
Section titles like "Hoe plaats je een eenmalige" need to be completed
with text from the first content block.
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
INPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.SMART_MERGED.json"
OUTPUT_JSON = REPO_ROOT / "new_pipeline" / "output" / "_canonical_jsons_all" / "VTH_N4__canonical_vth_n4_full_30ch.TITLES_FIXED.json"

def is_incomplete_title(title: str) -> bool:
    """Check if section title appears incomplete."""
    title = title.strip()
    if not title:
        return False
    
    # If title ends with proper punctuation, it's complete
    if re.search(r'[.?!]\s*$', title):
        return False
    
    # Title ends with article/preposition (definitely incomplete)
    incomplete_endings = [
        r'\s+(een|de|het|van|voor|bij|met|in|op|aan|naar|over)$',
        r'\s+je\s+een$',
        r'\s+je\s+de$',
        r'\s+een\s+\w{2,10}$',  # ends with word after "een"
        r'\s+eenmalige$',       # ends with "eenmalige"
        r'\s+urethrale$',       # ends with "urethrale"
    ]
    
    for pattern in incomplete_endings:
        if re.search(pattern, title, re.IGNORECASE):
            return True
    
    # Title is short and doesn't end with punctuation - probably incomplete
    if len(title) < 40 and not re.search(r'[.?!]$', title):
        return True
    
    return False

def complete_title_from_content(title: str, first_content: str) -> tuple[str, str]:
    """
    Try to complete an incomplete title using the first content block.
    Returns (completed_title, remaining_content).
    Only takes the MINIMUM needed to complete the title phrase (noun/question).
    """
    title = title.strip()
    content = first_content.strip()
    
    if not content:
        return title, content
    
    # Only merge if content starts with lowercase (continuation)
    if not content[0].islower():
        return title, content
    
    words = content.split()
    continuation = []
    
    # Sentence starters that indicate we've gone too far
    sentence_starters = {'Het', 'Je', 'We', 'De', 'Een', 'Als', 'Dit', 'Hierbij', 
                        'Hieronder', 'Stappenplan', 'Wanneer', 'Bij', 'In', 'Voor',
                        'Na', 'Om', 'Zorg', 'Let', 'Controleer', 'Volg', 'Er'}
    
    for i, word in enumerate(words[:6]):  # Max 6 words for title completion
        # Stop BEFORE sentence starters
        if word in sentence_starters:
            break
        
        continuation.append(word)
        
        # Stop after question mark, period, or if we completed a noun phrase
        if word.endswith('?') or word.endswith('.'):
            break
        
        # Stop after common noun endings that complete the title
        if word.endswith(('man', 'vrouw', 'katheter', 'sonde', 'systeem', 'zak')):
            # Check if next word is a sentence starter
            if i + 1 < len(words) and words[i + 1] in sentence_starters:
                break
    
    if continuation:
        title_cont = ' '.join(continuation)
        # Remove trailing punctuation if present for cleaner title
        if title_cont.endswith('.'):
            title_cont = title_cont[:-1]
        remaining = ' '.join(words[len(continuation):])
        return title + ' ' + title_cont, remaining
    
    return title, content

def main():
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        book = json.load(f)
    
    titles_fixed = 0
    
    for chapter in book['chapters']:
        for section in chapter.get('sections', []):
            title = section.get('title', '')
            content = section.get('content', [])
            
            if is_incomplete_title(title) and content:
                # Find first non-image content block
                for i, block in enumerate(content):
                    if block.get('images') and not (block.get('text') or block.get('basis')):
                        continue
                    
                    block_text = (block.get('text') or block.get('basis') or '').strip()
                    if block_text:
                        new_title, remaining = complete_title_from_content(title, block_text)
                        
                        if new_title != title:
                            section['title'] = new_title
                            # Update the content block
                            if remaining:
                                block['text'] = remaining
                                if 'basis' in block:
                                    block['basis'] = remaining
                            else:
                                # Remove empty block
                                content.pop(i)
                            titles_fixed += 1
                    break
    
    # Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(book, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Section titles fixed!")
    print(f"   Completed {titles_fixed} incomplete titles")
    print(f"   Output: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()

