#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

# Load API keys from both .env files
export OPENAI_API_KEY=$(grep "^OPENAI_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env 2>/dev/null | cut -d= -f2)
export ANTHROPIC_API_KEY=$(grep "^ANTHROPIC_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env.local | cut -d= -f2)

CANONICAL="output/_canonical_jsons_all/MBO_COMMUNICATIE_9789083251387_03_2024__canonical_book_with_figures.json"
OUT="output/communicatie"
LOG="/tmp/comm_rewrite.log"

echo "Continuing chapters 4-8 (with Anthropic for planning)" >> "$LOG"

for ch in 4 5 6 7 8; do
  echo "Processing Chapter $ch..."
  echo "=== CHAPTER $ch ===" >> "$LOG"
  npx tsx scripts/extract-skeleton.ts "$CANONICAL" "$OUT/skeleton_ch0${ch}.json" --chapter $ch 2>&1 | tee -a "$LOG" | grep -E "Injected|Extracted|planning"
  npx tsx scripts/generate-from-skeleton.ts --skeleton "$OUT/skeleton_ch0${ch}.json" --out "$OUT/rewrites_ch${ch}.json" --provider anthropic --model claude-sonnet-4-5-20250929 2>&1 | tee -a "$LOG" | tail -1
  echo "Done ch$ch" >> "$LOG"
done

echo "All 8 chapters complete!"

