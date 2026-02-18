#!/bin/bash
set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

# Load API key
export ANTHROPIC_API_KEY=$(grep "^ANTHROPIC_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env.local | cut -d= -f2)

CANONICAL="output/_canonical_jsons_all/MBO_AF4_2024_COMMON_CORE__canonical_book_with_figures.json"
OUT="output/af4"
LOG="/tmp/af4_rewrite.log"

echo "Starting A&F 4 rewrite - 14 chapters (using Opus 4.5)" | tee "$LOG"
echo "$(date)" >> "$LOG"

for ch in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
  CH_PAD=$(printf "%02d" $ch)
  echo "Processing Chapter $ch..."
  echo "=== CHAPTER $ch ===" >> "$LOG"
  
  # Extract skeleton with praktijk injection
  npx tsx scripts/extract-skeleton.ts "$CANONICAL" "$OUT/skeleton_ch${CH_PAD}.json" --chapter $ch 2>&1 | tee -a "$LOG" | grep -E "Injected|Extracted|Error" || true
  
  # Generate rewrites with Opus 4.5
  npx tsx scripts/generate-from-skeleton.ts \
    --skeleton "$OUT/skeleton_ch${CH_PAD}.json" \
    --out "$OUT/rewrites_ch${ch}.json" \
    --provider anthropic \
    --model claude-opus-4-5-20251101 2>&1 | tee -a "$LOG" | tail -1
  
  echo "Done ch$ch" >> "$LOG"
done

echo "All 14 chapters complete!" | tee -a "$LOG"
