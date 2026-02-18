#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

CANONICAL="output/_canonical_jsons_all/MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024__canonical_book_with_figures.json"
OUT="output/klinisch_redeneren"

echo "Assembling 13 chapters (2-14)..."

# Chapters 2-14
for ch in 2 3 4 5 6 7 8 9 10 11 12 13 14; do
  CH_PAD=$(printf "%02d" $ch)
  echo "Assembling Chapter $ch..."
  npx tsx scripts/assemble-skeleton-rewrites.ts "$CANONICAL" "$OUT/skeleton_ch${CH_PAD}.json" "$OUT/rewrites_ch${ch}.json" "$OUT/assembled_ch${ch}.json"
done

echo "All chapters assembled!"

# Merge into full book JSON
echo "Merging into full book..."
npx tsx scripts/merge-assembled-chapters.ts "$OUT" "$OUT/klinisch_redeneren_full_rewritten.json"

# Render PDF
echo "Rendering PDF..."
npx tsx renderer/render-prince-pdf.ts "$OUT/klinisch_redeneren_full_rewritten.json" "$OUT/klinisch_redeneren_FINAL.pdf"

echo "Done! PDF at: $OUT/klinisch_redeneren_FINAL.pdf"

