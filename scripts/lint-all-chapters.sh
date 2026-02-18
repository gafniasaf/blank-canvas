#!/bin/bash
# 🎯 Dopamine-feeding linter - run all chapters with satisfying progress

cd /Users/asafgafni/Desktop/InDesign/TestRun
mkdir -p todo/lint-reports

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🔍 LINTING ALL 14 CHAPTERS                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

total_errors=0
total_warnings=0
results=""

for ch in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do
  input="output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715/ch${ch}.iterated.json"
  output="todo/lint-reports/ch${ch}.lint.json"
  
  if [ ! -f "$input" ]; then
    echo "  ⏭️  ch$ch: SKIPPED (not found)"
    continue
  fi
  
  # Run linter silently, capture output
  result=$(npx ts-node scripts/lint-rewrites.ts "$input" --output "$output" 2>&1)
  
  # Extract counts
  errors=$(echo "$result" | grep -o "❌ Errors:.*[0-9]*" | grep -o "[0-9]*" | head -1)
  warnings=$(echo "$result" | grep -o "⚠️  Warnings:.*[0-9]*" | grep -o "[0-9]*" | head -1)
  
  errors=${errors:-0}
  warnings=${warnings:-0}
  
  total_errors=$((total_errors + errors))
  total_warnings=$((total_warnings + warnings))
  
  # Progress bar
  done=$((10#$ch))
  pct=$((done * 100 / 14))
  bar=$(printf '█%.0s' $(seq 1 $((pct / 5))))
  bar="${bar}$(printf '░%.0s' $(seq 1 $((20 - pct / 5))))"
  
  if [ "$errors" -eq 0 ]; then
    icon="✅"
  else
    icon="❌"
  fi
  
  echo "  $icon ch$ch: $errors errors, $warnings warnings  [$bar] $pct%"
  
  results="$results\nch$ch: $errors errors"
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  📊 SUMMARY                                                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Total Errors:   $total_errors"
echo "║  Total Warnings: $total_warnings"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [ "$total_errors" -eq 0 ]; then
  echo "🎉 ALL CHAPTERS CLEAN! No errors found."
else
  echo "🔧 $total_errors errors to fix. Run:"
  echo "   npm run generate:cursor-tasks"
fi































