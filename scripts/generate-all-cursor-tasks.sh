#!/bin/bash
# Generate Cursor tasks for ALL chapters (errors only)

cd /Users/asafgafni/Desktop/InDesign/TestRun
mkdir -p todo/cursor-tasks

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🎯 GENERATING CURSOR TASKS FOR ALL CHAPTERS                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

total_tasks=0

for ch in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do
  lint="todo/lint-reports/ch${ch}.lint.json"
  source="output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715/ch${ch}.iterated.json"
  outdir="todo/cursor-tasks/ch${ch}"
  
  if [ ! -f "$lint" ]; then
    echo "  ⏭️  ch$ch: SKIPPED (no lint report)"
    continue
  fi
  
  mkdir -p "$outdir"
  
  # Run task generator
  result=$(npx ts-node scripts/generate-cursor-tasks.ts "$lint" "$source" --errors-only --output-dir "$outdir" 2>&1)
  
  # Count tasks
  tasks=$(ls "$outdir"/*.json 2>/dev/null | grep -v _summary | wc -l | tr -d ' ')
  total_tasks=$((total_tasks + tasks))
  
  if [ "$tasks" -eq 0 ]; then
    echo "  ✅ ch$ch: 0 tasks (clean!)"
  else
    echo "  📝 ch$ch: $tasks tasks generated"
  fi
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  📊 SUMMARY                                                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Total Tasks: $total_tasks"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Tasks saved in: todo/cursor-tasks/ch*/task_*.json"
echo ""
echo "Next: Open tasks in Cursor and fix them!"































