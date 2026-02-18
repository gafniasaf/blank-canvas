#!/bin/bash
# Quick lint verification - run this yourself!
cd /Users/asafgafni/Desktop/InDesign/TestRun

echo "🔍 Linting ch01 (expect 0 errors after fix)..."
result=$(npx ts-node scripts/lint-rewrites.ts output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715/ch01.iterated.json 2>&1)

echo "$result" | grep -E "(Errors|Warnings)"
echo ""
echo "✅ Done! (full output above if you scroll up)"































