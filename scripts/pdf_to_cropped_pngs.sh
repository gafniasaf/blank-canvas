#!/bin/bash
#
# PDF to Cropped PNGs
# Converts a PDF with images+labels to cropped high-res PNGs
#
# Usage:
#   ./scripts/pdf_to_cropped_pngs.sh <input.pdf> <output_dir> [options]
#
# Options:
#   --dpi <value>     DPI for rendering (default: 300)
#   --shave <XxY>     Pixels to shave from edges before trim (default: 0x150)
#                     Format: WIDTHxHEIGHT (removes from left/right and top/bottom)
#   --fuzz <percent>  Fuzz factor for trim (default: 5%)
#   --no-trim         Skip the trim step (just shave)
#   --verbose         Show progress
#
# Example:
#   ./scripts/pdf_to_cropped_pngs.sh deliverables/MBO_AF4_2024_COMMON_CORE/MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf output/af4_images --dpi 300 --shave 0x200
#

set -e

# Defaults
DPI=300
SHAVE="0x150"
FUZZ="5%"
DO_TRIM=true
VERBOSE=false

# Parse arguments
INPUT_PDF=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dpi)
            DPI="$2"
            shift 2
            ;;
        --shave)
            SHAVE="$2"
            shift 2
            ;;
        --fuzz)
            FUZZ="$2"
            shift 2
            ;;
        --no-trim)
            DO_TRIM=false
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            if [[ -z "$INPUT_PDF" ]]; then
                INPUT_PDF="$1"
            elif [[ -z "$OUTPUT_DIR" ]]; then
                OUTPUT_DIR="$1"
            fi
            shift
            ;;
    esac
done

# Validate input
if [[ -z "$INPUT_PDF" ]] || [[ -z "$OUTPUT_DIR" ]]; then
    echo "Usage: $0 <input.pdf> <output_dir> [options]"
    echo ""
    echo "Options:"
    echo "  --dpi <value>     DPI for rendering (default: 300)"
    echo "  --shave <XxY>     Pixels to shave from edges (default: 0x150)"
    echo "  --fuzz <percent>  Fuzz factor for trim (default: 5%)"
    echo "  --no-trim         Skip the trim step"
    echo "  --verbose         Show progress"
    exit 1
fi

if [[ ! -f "$INPUT_PDF" ]]; then
    echo "Error: Input PDF not found: $INPUT_PDF"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Get PDF basename for output naming
PDF_BASENAME=$(basename "$INPUT_PDF" .pdf)

echo "=== PDF to Cropped PNGs ==="
echo "Input:  $INPUT_PDF"
echo "Output: $OUTPUT_DIR"
echo "DPI:    $DPI"
echo "Shave:  $SHAVE"
echo "Fuzz:   $FUZZ"
echo "Trim:   $DO_TRIM"
echo ""

# Build ImageMagick command
# -density must come BEFORE the input file to affect rasterization
if [[ "$DO_TRIM" == true ]]; then
    CMD="magick -density $DPI \"$INPUT_PDF\" -shave $SHAVE -fuzz $FUZZ -trim +repage \"$OUTPUT_DIR/${PDF_BASENAME}-%03d.png\""
else
    CMD="magick -density $DPI \"$INPUT_PDF\" -shave $SHAVE +repage \"$OUTPUT_DIR/${PDF_BASENAME}-%03d.png\""
fi

echo "Running: $CMD"
echo ""

# Execute
eval $CMD

# Count output files
NUM_FILES=$(ls -1 "$OUTPUT_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Done! Created $NUM_FILES PNG files in $OUTPUT_DIR"

