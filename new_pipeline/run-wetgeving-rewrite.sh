#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

# Load API key
export ANTHROPIC_API_KEY=$(grep "^ANTHROPIC_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env.local | cut -d= -f2)

CANONICAL="output/_canonical_jsons_all/MBO_WETGEVING_9789083412061_03_2024__canonical_book_with_figures.json"
OUT="output/wetgeving"
LOG="/tmp/wetgeving_rewrite.log"

echo "Starting Wetgeving rewrite - 16 chapters" | tee "$LOG"
echo "$(date)" >> "$LOG"

for ch in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
  CH_PAD=$(printf "%02d" $ch)
  echo "Processing Chapter $ch..."
  echo "=== CHAPTER $ch ===" >> "$LOG"
  
  # Extract skeleton with praktijk injection
  npx tsx scripts/extract-skeleton.ts "$CANONICAL" "$OUT/skeleton_ch${CH_PAD}.json" --chapter $ch 2>&1 | tee -a "$LOG" | grep -E "Injected|Extracted|Error" || true
  
  # Generate rewrites
  npx tsx scripts/generate-from-skeleton.ts \
    --skeleton "$OUT/skeleton_ch${CH_PAD}.json" \
    --out "$OUT/rewrites_ch${ch}.json" \
    --provider anthropic \
    --model claude-sonnet-4-5-20250929 2>&1 | tee -a "$LOG" | tail -1
  
  echo "Done ch$ch" >> "$LOG"
done

echo "All 16 chapters complete!" | tee -a "$LOG"

