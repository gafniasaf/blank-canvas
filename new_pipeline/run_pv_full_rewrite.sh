#!/bin/bash
set -euo pipefail

cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

# Load API keys
source /Users/asafgafni/Desktop/InDesign/TestRun/.env

LOG="/tmp/pv_n3_rewrite.log"
OUT_DIR="output/pv_n3"

echo "=== PV N3 Full Rewrite Pipeline ===" | tee "$LOG"
echo "Started: $(date)" | tee -a "$LOG"

CHAPTERS="01 02 03 04 06 07 08 09 10 11 12 13 14 15 16 17 18 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35"
TOTAL=$(echo $CHAPTERS | wc -w | tr -d ' ')
CURRENT=0

for ch in $CHAPTERS; do
  CURRENT=$((CURRENT + 1))
  echo "" | tee -a "$LOG"
  echo "[$CURRENT/$TOTAL] Processing chapter $ch..." | tee -a "$LOG"
  
  CANONICAL="$OUT_DIR/canonical_ch${ch}.json"
  SKELETON="$OUT_DIR/skeleton_ch${ch}.json"
  REWRITES="$OUT_DIR/rewrites_ch${ch}.json"
  
  if [ ! -f "$CANONICAL" ]; then
    echo "  ⚠️ Skipping ch$ch - canonical not found" | tee -a "$LOG"
    continue
  fi
  
  # Step 1: Extract skeleton (with ut planning - microheadings/verdieping selection)
  echo "  → Extracting skeleton..." | tee -a "$LOG"
  npx --yes tsx scripts/extract-skeleton.ts "$CANONICAL" "$SKELETON" --chapter "${ch#0}" 2>&1 | tee -a "$LOG"
  
  # Step 2: Generate rewrites from skeleton
  echo "  → Generating rewrites..." | tee -a "$LOG"
  npx --yes tsx scripts/generate-from-skeleton.ts --skeleton "$SKELETON" --out "$REWRITES" 2>&1 | tee -a "$LOG"
  
  echo "  ✅ Chapter $ch complete" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "=== All chapters processed ===" | tee -a "$LOG"
echo "Finished: $(date)" | tee -a "$LOG"

# Count completed
DONE=$(ls -1 "$OUT_DIR"/rewrites_ch*.json 2>/dev/null | wc -l | tr -d ' ')
echo "Rewrites completed: $DONE / $TOTAL" | tee -a "$LOG"
