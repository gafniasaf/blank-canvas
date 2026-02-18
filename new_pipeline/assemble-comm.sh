#!/bin/bash
cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

CANONICAL="output/_canonical_jsons_all/MBO_COMMUNICATIE_9789083251387_03_2024__canonical_book_with_figures.json"
OUT="output/communicatie"

for ch in 1 2 3 4 5 6 7 8; do
  CH_PAD=$(printf "%02d" $ch)
  echo "Assembling Chapter $ch..."
  npx tsx scripts/assemble-skeleton-rewrites.ts "$CANONICAL" "$OUT/skeleton_ch${CH_PAD}.json" "$OUT/rewrites_ch${ch}.json" "$OUT/assembled_ch${ch}.json"
done

echo "All chapters assembled!"

# Merge into full book JSON
echo "Merging into full book..."
npx tsx scripts/merge-assembled-chapters.ts "$OUT" "$OUT/communicatie_full_rewritten.json"

# Render PDF
echo "Rendering PDF..."
npx tsx renderer/render-prince-pdf.ts "$OUT/communicatie_full_rewritten.json" "$OUT/communicatie_FINAL.pdf"

echo "Done! PDF at: $OUT/communicatie_FINAL.pdf"

