#!/bin/bash
# Rewrite pipeline for VTH N4 chapters 7-30
# Chapters 1-6 already have rewrites

set -e

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

# Load API key (use OpenAI if Anthropic not available)
export OPENAI_API_KEY=$(grep "^OPENAI_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env | cut -d= -f2)
PROVIDER="openai"
MODEL="gpt-4o"

# Check for Anthropic key (preferred)
if grep -q "^ANTHROPIC_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env.local 2>/dev/null; then
  export ANTHROPIC_API_KEY=$(grep "^ANTHROPIC_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env.local | cut -d= -f2)
  PROVIDER="anthropic"
  MODEL="claude-sonnet-4-5-20250929"
fi

echo "Using provider: $PROVIDER / $MODEL"

# Use the full 30-chapter canonical (with raw PDF text for ch 7-30)
CANONICAL="output/_canonical_jsons_all/VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUT="output/vth_n4"
LOG="/tmp/vth_n4_rewrite.log"

mkdir -p "$OUT"

echo "========================================" | tee "$LOG"
echo "Starting VTH N4 Rewrite - Chapters 7-30" | tee -a "$LOG"
echo "$(date)" | tee -a "$LOG"
echo "Canonical: $CANONICAL" | tee -a "$LOG"
echo "Output: $OUT" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"

TOTAL=24
CURRENT=0

for ch in 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  CURRENT=$((CURRENT + 1))
  CH_PAD=$(printf "%02d" $ch)
  SKELETON="$OUT/skeleton_ch${CH_PAD}.json"
  REWRITE="$OUT/rewrites_ch${ch}.json"
  REWRITE_PASS2="$OUT/rewrites_ch${ch}_pass2.json"
  
  echo "" | tee -a "$LOG"
  echo "[$CURRENT/$TOTAL] ========== CHAPTER $ch ($(date +%H:%M:%S)) ==========" | tee -a "$LOG"
  
  # Skip if pass2 already exists
  if [ -f "$REWRITE_PASS2" ]; then
    echo "  ⏭️ Skipping ch$ch - pass2 already exists" | tee -a "$LOG"
    continue
  fi
  
  # Step 1: Extract skeleton
  echo "  → Extracting skeleton for Chapter $ch..." | tee -a "$LOG"
  npx --yes tsx scripts/extract-skeleton.ts \
    "$CANONICAL" \
    "$SKELETON" \
    --chapter $ch 2>&1 | tee -a "$LOG"
  
  # Step 2: Generate from skeleton using LLM
  echo "  → Generating rewrite for Chapter $ch with $PROVIDER/$MODEL..." | tee -a "$LOG"
  npx --yes tsx scripts/generate-from-skeleton.ts \
    --skeleton "$SKELETON" \
    --out "$REWRITE" \
    --provider "$PROVIDER" \
    --model "$MODEL" 2>&1 | tee -a "$LOG"
  
  # Copy to pass2 for consistency
  cp "$REWRITE" "$REWRITE_PASS2"
  
  echo "  ✅ Chapter $ch complete: $REWRITE" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"
echo "All chapters 7-30 complete! $(date)" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"

# Count completed
DONE=$(ls -1 "$OUT"/rewrites_ch*_pass2.json 2>/dev/null | wc -l | tr -d ' ')
echo "Total pass2 rewrites: $DONE / 30" | tee -a "$LOG"

