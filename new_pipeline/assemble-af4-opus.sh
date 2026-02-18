#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

CANONICAL="output/_canonical_jsons_all/MBO_AF4_2024_COMMON_CORE__canonical_book_with_figures.json"
OUT="output/af4"

TMP1="$OUT/_tmp_af4_book_1.json"
TMP2="$OUT/_tmp_af4_book_2.json"

FINAL_JSON="$OUT/af4_opus_45_full_rewritten.json"
FINAL_JSON_WITH_FIGURES="$OUT/af4_opus_45_full_rewritten.with_figures.json"
FINAL_PDF="$OUT/af4_opus_45_FINAL.pdf"
FINAL_PDF_WITH_FIGURES="$OUT/af4_opus_45_FINAL.with_figures.pdf"
FINAL_LOG="$OUT/af4_opus_45_prince.log"
FINAL_LOG_WITH_FIGURES="$OUT/af4_opus_45_prince.with_figures.log"

echo "Assembling A&F4 sequentially (no duplication)..."

CUR="$CANONICAL"
NEXT="$TMP1"

for ch in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
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

echo "Applying figures mapping..."
npx tsx scripts/apply-figures-mapping.ts "$FINAL_JSON" "extract/figures_by_paragraph_all.json" "$FINAL_JSON_WITH_FIGURES"
echo "✅ Full-book JSON (with figures): $FINAL_JSON_WITH_FIGURES"

echo "Rendering PDF (with figures)..."
npx tsx renderer/render-prince-pdf.ts "$FINAL_JSON_WITH_FIGURES" --out "$FINAL_PDF_WITH_FIGURES" --log "$FINAL_LOG_WITH_FIGURES"
echo "✅ PDF (with figures): $FINAL_PDF_WITH_FIGURES"


