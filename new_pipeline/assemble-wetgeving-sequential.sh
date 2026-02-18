#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

CANONICAL="output/_canonical_jsons_all/MBO_WETGEVING_9789083412061_03_2024__canonical_book_with_figures.json"
OUT="output/wetgeving"

TMP1="$OUT/_tmp_wetgeving_book_1.json"
TMP2="$OUT/_tmp_wetgeving_book_2.json"

FINAL_JSON="$OUT/wetgeving_full_rewritten.json"
FINAL_PDF="$OUT/wetgeving_FINAL.pdf"
FINAL_LOG="$OUT/wetgeving_prince.log"

echo "Assembling Wetgeving sequentially (no duplicated chapters)..."

CUR="$CANONICAL"
NEXT="$TMP1"

for ch in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
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

echo "Rendering PDF..."
npx tsx renderer/render-prince-pdf.ts "$FINAL_JSON" --out "$FINAL_PDF" --log "$FINAL_LOG"
echo "✅ PDF: $FINAL_PDF"


