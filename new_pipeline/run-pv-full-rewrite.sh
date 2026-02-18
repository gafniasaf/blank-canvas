#!/bin/bash
# Full rewrite pipeline for MBO Persoonlijke Verzorging (32 chapters)
# Logs to /tmp/pv_n3_rewrite.log for pipeline monitor

set -e

CANONICAL="/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/_canonical_jsons_all/MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024__canonical_book_with_figures.json"
OUT_DIR="/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/pv_n3"
LOG="/tmp/pv_n3_rewrite.log"
PIPELINE_DIR="/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline"

# Load API keys
export OPENAI_API_KEY=$(grep "^OPENAI_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env | cut -d= -f2)
export ANTHROPIC_API_KEY=$(grep "^ANTHROPIC_API_KEY=" /Users/asafgafni/Desktop/InDesign/TestRun/.env.local | cut -d= -f2)

mkdir -p "$OUT_DIR"

# Initialize log
echo "========================================" >> "$LOG"
echo "Starting PV N3 Full Rewrite - $(date)" >> "$LOG"
echo "Canonical: $CANONICAL" >> "$LOG"
echo "Output: $OUT_DIR" >> "$LOG"
echo "========================================" >> "$LOG"

cd "$PIPELINE_DIR"

for ch in $(seq 1 32); do
  CH_PAD=$(printf "%02d" $ch)
  SKELETON="$OUT_DIR/skeleton_ch${CH_PAD}.json"
  REWRITE="$OUT_DIR/rewrites_ch${ch}.json"
  
  echo "" >> "$LOG"
  echo "========== CHAPTER $ch ($(date +%H:%M:%S)) ==========" >> "$LOG"
  
  # Step 1: Extract skeleton
  echo "Extracting skeleton for Chapter $ch..." >> "$LOG"
  npx --yes tsx scripts/extract-skeleton.ts \
    --canonical "$CANONICAL" \
    --chapter $ch \
    --out "$SKELETON" 2>&1 | tee -a "$LOG"
  
  # Step 2: Generate from skeleton using Claude Sonnet 4.5
  echo "Generating rewrite for Chapter $ch with Claude Sonnet 4.5..." >> "$LOG"
  npx --yes tsx scripts/generate-from-skeleton.ts \
    --skeleton "$SKELETON" \
    --out "$REWRITE" \
    --provider anthropic \
    --model claude-sonnet-4-5-20250929 2>&1 | tee -a "$LOG"
  
  echo "✅ Chapter $ch complete: $REWRITE" >> "$LOG"
done

echo "" >> "$LOG"
echo "========================================" >> "$LOG"
echo "All 32 chapters complete! $(date)" >> "$LOG"
echo "========================================" >> "$LOG"

echo "Done! Check $OUT_DIR for output files."



