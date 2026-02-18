#!/bin/bash
# 🔧 Fix + Re-lint with dopamine monitor

cd /Users/asafgafni/Desktop/InDesign/TestRun
LOG="/tmp/fix-relint-progress.log"
RESULT="/tmp/fix-relint-result.txt"

# Clear logs
echo "" > "$LOG"
echo "RUNNING" > "$RESULT"

# Background process for actual work
(
  echo "$(date +%H:%M:%S) Starting fixes..." >> "$LOG"
  
  # PHASE 1: Fix BROKEN_PUNCTUATION
  echo "$(date +%H:%M:%S) PHASE 1: Fixing broken punctuation..." >> "$LOG"
  
  fixed=0
  for f in output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715/ch*.iterated.json; do
    if [ -f "$f" ]; then
      # Count occurrences before fix
      before=$(grep -o ';\.' "$f" | wc -l | tr -d ' ')
      
      # Apply fixes
      sed -i '' 's/;\./;/g' "$f"      # ;. -> ;
      sed -i '' 's/,\./,/g' "$f"      # ,. -> ,
      sed -i '' 's/\.,/./g' "$f"      # ., -> .
      sed -i '' 's/\.;/;/g' "$f"      # .; -> ;
      
      ch=$(basename "$f" | grep -o 'ch[0-9]*')
      if [ "$before" -gt 0 ]; then
        echo "$(date +%H:%M:%S)   $ch: fixed $before punctuation issues" >> "$LOG"
        fixed=$((fixed + before))
      fi
    fi
  done
  
  echo "$(date +%H:%M:%S) PHASE 1 COMPLETE: Fixed $fixed punctuation issues" >> "$LOG"
  echo "" >> "$LOG"
  
  # PHASE 2: Re-lint all chapters
  echo "$(date +%H:%M:%S) PHASE 2: Re-linting all chapters..." >> "$LOG"
  
  mkdir -p todo/lint-reports-v2
  total_errors=0
  total_warnings=0
  
  for ch in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do
    input="output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715/ch${ch}.iterated.json"
    output="todo/lint-reports-v2/ch${ch}.lint.json"
    
    if [ -f "$input" ]; then
      result=$(npx ts-node scripts/lint-rewrites.ts "$input" --output "$output" 2>&1)
      
      errors=$(echo "$result" | grep -o "❌ Errors:.*[0-9]*" | grep -o "[0-9]*" | head -1)
      warnings=$(echo "$result" | grep -o "⚠️  Warnings:.*[0-9]*" | grep -o "[0-9]*" | head -1)
      
      errors=${errors:-0}
      warnings=${warnings:-0}
      
      total_errors=$((total_errors + errors))
      total_warnings=$((total_warnings + warnings))
      
      echo "$(date +%H:%M:%S)   ch$ch: $errors errors, $warnings warnings" >> "$LOG"
    fi
  done
  
  echo "" >> "$LOG"
  echo "$(date +%H:%M:%S) ═══════════════════════════════════════" >> "$LOG"
  echo "$(date +%H:%M:%S) COMPLETE!" >> "$LOG"
  echo "$(date +%H:%M:%S) Punctuation fixed: $fixed" >> "$LOG"
  echo "$(date +%H:%M:%S) Remaining errors: $total_errors" >> "$LOG"
  echo "$(date +%H:%M:%S) Warnings: $total_warnings" >> "$LOG"
  echo "$(date +%H:%M:%S) ═══════════════════════════════════════" >> "$LOG"
  
  echo "DONE:$fixed:$total_errors:$total_warnings" > "$RESULT"
) &

WORKER_PID=$!

# Monitor loop
while true; do
  clear
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  🔧 FIX + RE-LINT MONITOR (updates every 30s)                    ║"
  echo "║  $(date +%H:%M:%S)                                                         ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  echo ""
  
  # Show last 15 lines of progress
  if [ -f "$LOG" ]; then
    tail -15 "$LOG" | while read line; do
      echo "  $line"
    done
  fi
  
  echo ""
  echo "╠══════════════════════════════════════════════════════════════════╣"
  
  # Check if done
  status=$(cat "$RESULT" 2>/dev/null)
  if [[ "$status" == DONE:* ]]; then
    fixed=$(echo "$status" | cut -d: -f2)
    errors=$(echo "$status" | cut -d: -f3)
    warnings=$(echo "$status" | cut -d: -f4)
    
    echo "║  🎉 COMPLETE!                                                    ║"
    echo "║                                                                  ║"
    echo "║  Punctuation fixed:  $fixed                                      "
    echo "║  Remaining errors:   $errors                                     "
    echo "║  Warnings:           $warnings                                   "
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    
    if [ "$errors" -eq 0 ]; then
      echo "✅ ALL ERRORS FIXED!"
    else
      echo "🔧 $errors errors remaining. Next steps:"
      echo "   1. Review error types in todo/lint-reports-v2/"
      echo "   2. Regenerate Cursor tasks for remaining errors"
    fi
    break
  else
    echo "║  ⏳ Working... (background PID: $WORKER_PID)                     ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
  fi
  
  sleep 30
done































