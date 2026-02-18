#!/bin/bash
# Assemble all VTH N4 chapters using the official assembly script

set -e
cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline

CANONICAL="output/_canonical_jsons_all/VTH_N4__canonical_vth_n4_full_30ch.with_figures.with_captions.cleaned.links.json"
OUT_DIR="output/vth_n4"
FINAL_OUT="output/_canonical_jsons_all/VTH_N4__canonical_vth_n4_full_30ch.REWRITTEN.json"

# Start with a copy of the original canonical
cp "$CANONICAL" "$FINAL_OUT"

echo "Assembling VTH N4 chapters 1-30..."

for ch in $(seq 1 30); do
  CH_PAD=$(printf "%02d" $ch)
  SKELETON="$OUT_DIR/skeleton_ch${CH_PAD}.json"
  REWRITE="$OUT_DIR/rewrites_ch${ch}_pass2.json"
  
  # Fall back to non-pass2 if needed
  if [ ! -f "$REWRITE" ]; then
    REWRITE="$OUT_DIR/rewrites_ch${ch}.json"
  fi
  
  if [ ! -f "$SKELETON" ] || [ ! -f "$REWRITE" ]; then
    echo "  ⚠️ Skipping chapter $ch (missing skeleton or rewrite)"
    continue
  fi
  
  echo "  📖 Assembling chapter $ch..."
  TEMP_OUT="$OUT_DIR/assembled_ch${ch}.json"
  
  npx --yes tsx scripts/assemble-skeleton-rewrites.ts \
    "$FINAL_OUT" \
    "$SKELETON" \
    "$REWRITE" \
    "$TEMP_OUT" 2>&1 | grep -E "✅|Error|assembled" || true
  
  # Use assembled output for next iteration
  if [ -f "$TEMP_OUT" ]; then
    mv "$TEMP_OUT" "$FINAL_OUT"
    echo "    ✅ Chapter $ch assembled"
  fi
done

echo ""
echo "✅ All chapters assembled!"
echo "   Output: $FINAL_OUT"





