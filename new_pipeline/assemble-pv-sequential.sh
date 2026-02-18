#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

OUT="output/pv_n3"
CANONICAL="$OUT/canonical_pv_n3_book_with_figures.json"

TMP1="$OUT/_tmp_pv_book_1.json"
TMP2="$OUT/_tmp_pv_book_2.json"

FINAL_JSON="$OUT/pv_n3_FINAL_REWRITTEN.json"
FINAL_JSON_WITH_FIGURES="$OUT/pv_n3_FINAL_REWRITTEN.with_figures.json"
FINAL_PDF="$OUT/pv_n3_FINAL_REWRITTEN.pdf"
FINAL_LOG="$OUT/pv_n3_FINAL.prince.log"

# Map + inject in-text figures exported from InDesign (grouped PNGs w/ labels).
# This keeps PV from having only chapter openers.
EMBEDDED_DIR="/Users/asafgafni/Desktop/InDesign/TestRun/extracted_images/persoonlijke_verzorging/embedded_figures"
FIGURES_MAP="$OUT/pv_n3_figures_by_paragraph.from_extracted_images.json"

echo "Assembling Persoonlijke Verzorging sequentially (no duplication, apply latest cleanups)..."

CUR="$CANONICAL"
NEXT="$TMP1"

for ch in $(seq 1 32); do
  CH_PAD=$(printf "%02d" $ch)
  echo "Applying chapter $ch..."
  npx tsx scripts/assemble-skeleton-rewrites.ts \
    "$CUR" \
    "$OUT/skeleton_ch${CH_PAD}.json" \
    "$OUT/rewrites_ch${ch}.json" \
    "$NEXT"

  CUR="$NEXT"
  if [ "$NEXT" = "$TMP1" ]; then
    NEXT="$TMP2"
  else
    NEXT="$TMP1"
  fi
done

cp "$CUR" "$FINAL_JSON"
echo "✅ Full-book JSON: $FINAL_JSON"

echo "Building figures mapping from extracted embedded_figures..."
npx tsx scripts/build-embedded-figures-map.ts \
  --book-json "$FINAL_JSON" \
  --embedded-dir "$EMBEDDED_DIR" \
  --out "$FIGURES_MAP"
echo "✅ Figures map: $FIGURES_MAP"

echo "Applying figures mapping..."
npx tsx scripts/apply-figures-mapping.ts \
  "$FINAL_JSON" \
  "$FIGURES_MAP" \
  "$FINAL_JSON_WITH_FIGURES"
echo "✅ JSON with figures: $FINAL_JSON_WITH_FIGURES"

echo "Rendering PDF..."
npx tsx renderer/render-prince-pdf.ts "$FINAL_JSON_WITH_FIGURES" --out "$FINAL_PDF" --log "$FINAL_LOG"
echo "✅ PDF: $FINAL_PDF"


