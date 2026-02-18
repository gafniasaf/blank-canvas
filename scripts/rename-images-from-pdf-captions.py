#!/usr/bin/env python3
"""
Extract captions from PDF and rename images based on their captions.
Matches images in order (output-000.png, output-001.png, etc.) to PDF pages.
"""

import fitz  # PyMuPDF
import os
import re
import sys
from pathlib import Path

# Caption patterns
CAPTION_PATTERNS = [
    r'^Afbeelding\s+\d',       # "Afbeelding 1.1"
    r'^Figuur\s+\d',           # "Figuur 1.1"
    r'^Fig\.\s*\d',            # "Fig. 1"
    r'^Tabel\s+\d',            # "Tabel 1.1"
    r'^Schema\s+\d',           # "Schema 1"
]
CAPTION_REGEX = re.compile('|'.join(CAPTION_PATTERNS), re.IGNORECASE)

def sanitize_filename(text, max_length=100):
    """Convert caption text to a safe filename."""
    # Remove or replace problematic characters
    text = re.sub(r'[<>:"/\\|?*]', '_', text)
    # Replace multiple spaces/underscores with single underscore
    text = re.sub(r'[\s_]+', '_', text)
    # Remove leading/trailing underscores
    text = text.strip('_')
    # Truncate if too long
    if len(text) > max_length:
        text = text[:max_length]
    return text

def extract_captions_from_page(page):
    """Extract all captions from a PDF page."""
    captions = []
    try:
        # Use simpler text extraction first (faster)
        text = page.get_text()
        if not text:
            return captions
        
        # Split into lines and check each line
        lines = text.split('\n')
        current_caption = None
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Check if this line starts a caption
            if CAPTION_REGEX.search(line):
                if current_caption:
                    captions.append(current_caption)
                current_caption = line
            elif current_caption and len(current_caption) < 200:
                # Append continuation lines (captions are usually short)
                current_caption += " " + line
            else:
                # If we have a caption and hit non-caption text, save it
                if current_caption:
                    captions.append(current_caption)
                    current_caption = None
        
        # Don't forget the last caption
        if current_caption:
            captions.append(current_caption)
    except Exception as e:
        # If simple extraction fails, try dict method
        try:
            text_dict = page.get_text("dict")
            for block in text_dict.get("blocks", []):
                if block.get("type") == 0:  # Text block
                    text = ""
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text += span.get("text", "") + " "
                    text = text.strip()
                    
                    if text and CAPTION_REGEX.search(text):
                        lines = text.split('\n')
                        caption_text = ' '.join(lines[:3])
                        captions.append(caption_text)
        except:
            pass
    
    return captions

def main():
    # Paths
    pdf_path = Path("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/images_only/MBO_AF4_2024_COMMON_CORE_IMAGES_ONLY.pdf")
    images_dir = Path("/Users/asafgafni/Downloads/MBO_AF4_2024_COMMON_CORE_IMAGES_ONLY_CROPPED")
    
    if not pdf_path.exists():
        print(f"Error: PDF not found at {pdf_path}")
        print("Please provide the correct path to the PDF.")
        sys.exit(1)
    
    if not images_dir.exists():
        print(f"Error: Images directory not found at {images_dir}")
        sys.exit(1)
    
    # Open PDF
    print(f"Opening PDF: {pdf_path}")
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"Found {total_pages} pages in PDF")
    
    # Get all image files
    image_files = sorted(images_dir.glob("output-*.png"))
    print(f"Found {len(image_files)} image files")
    
    if len(image_files) != total_pages:
        print(f"Warning: Number of images ({len(image_files)}) doesn't match number of pages ({total_pages})")
        print("Proceeding anyway...")
    
    # Extract captions and rename
    renamed_count = 0
    skipped_count = 0
    
    print("\nProcessing pages...")
    for i, image_file in enumerate(image_files):
        if i >= total_pages:
            print(f"Warning: More images than pages. Stopping at page {total_pages}")
            break
        
        # Progress indicator
        if (i + 1) % 50 == 0 or i == 0:
            print(f"  Processing page {i+1}/{min(len(image_files), total_pages)}...")
        
        try:
            page = doc[i]
            captions = extract_captions_from_page(page)
        except Exception as e:
            print(f"  [{i:03d}] Error reading page {i+1}: {e}")
            skipped_count += 1
            continue
        
        if captions:
            # Use the first caption found
            caption = captions[0]
            # Create filename from caption
            safe_name = sanitize_filename(caption)
            if not safe_name:
                safe_name = f"image_{i:03d}"
            
            new_name = f"{safe_name}.png"
            new_path = images_dir / new_name
            
            # Handle duplicates
            counter = 1
            while new_path.exists() and new_path != image_file:
                safe_name_base = sanitize_filename(caption, max_length=90)
                new_name = f"{safe_name_base}_{counter:02d}.png"
                new_path = images_dir / new_name
                counter += 1
            
            # Rename
            try:
                image_file.rename(new_path)
                print(f"  [{i:03d}] {image_file.name} -> {new_name}")
                renamed_count += 1
            except Exception as e:
                print(f"  [{i:03d}] Error renaming {image_file.name}: {e}")
                skipped_count += 1
        else:
            # No caption found, keep original name or use generic
            print(f"  [{i:03d}] No caption found for {image_file.name} (keeping original)")
            skipped_count += 1
    
    doc.close()
    
    print(f"\nSummary:")
    print(f"  Renamed: {renamed_count}")
    print(f"  Skipped: {skipped_count}")
    print(f"  Total: {len(image_files)}")

if __name__ == "__main__":
    main()

