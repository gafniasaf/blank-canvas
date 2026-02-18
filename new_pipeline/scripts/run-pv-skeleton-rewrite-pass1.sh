#!/usr/bin/env bash
set -euo pipefail

# Full PV rewrite: Skeleton-first Pass 1 (Prince-first).
# - extract skeleton (with microheading + verdieping planning)
# - generate unit rewrites
# - assemble rewritten canonical JSON per chapter
# - merge chapters into one book JSON
# - apply chapter openers
# - microtitle cleanup under headings
# - render PDF (no inline figures unless they exist in canonical JSON)
#
# Uses Claude Sonnet 4.5 by default.
#
# Run:
#   cd /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline
#   bash scripts/run-pv-skeleton-rewrite-pass1.sh

REPO_ROOT="/Users/asafgafni/Desktop/InDesign/TestRun"
PIPELINE_ROOT="${REPO_ROOT}/new_pipeline"

BOOK_ID="MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024"
PROVIDER="anthropic"
MODEL="claude-sonnet-4-5-20250929"

CANON_CH_DIR="${PIPELINE_ROOT}/output/persoonlijke_verzorging_skeleton/canonical_chapters"
RUN_ROOT="${PIPELINE_ROOT}/output/persoonlijke_verzorging_skeleton"
RUN_DIR="${RUN_ROOT}/full_$(date +%Y%m%d_%H%M%S)"

mkdir -p "${RUN_DIR}/"{skeleton,rewrites,assembled,logs}
echo "${RUN_DIR}" > "${RUN_ROOT}/LAST_RUN.txt"

# Ensure token CSS matches PV (important for correct look/spacing)
IDML="${REPO_ROOT}/_source_exports/MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024__FROM_DOWNLOADS.idml"
TOKENS_JSON="${PIPELINE_ROOT}/extract/design_tokens.json"
BASE_CSS="${PIPELINE_ROOT}/templates/prince-af-two-column.css"
TOKENS_CSS="${PIPELINE_ROOT}/templates/prince-af-two-column.tokens.css"

cd "${PIPELINE_ROOT}"

echo "[tokens] parsing IDML -> ${TOKENS_JSON}"
npx tsx extract/parse-idml-design-tokens.ts "${IDML}" --chapter 1 --out "${TOKENS_JSON}"
echo "[tokens] generating CSS -> ${TOKENS_CSS}"
npx tsx templates/generate-prince-css-from-tokens.ts --tokens "${TOKENS_JSON}" --base "${BASE_CSS}" --out "${TOKENS_CSS}"
echo "[tokens] verifying"
npx tsx validate/verify-design-tokens.ts "${TOKENS_JSON}"

if [ ! -d "${CANON_CH_DIR}" ]; then
  echo "❌ Missing canonical chapter dir: ${CANON_CH_DIR}"
  echo "   (Expected per-chapter canonical JSONs already split from the baseline PV canonical book JSON.)"
  exit 1
fi

echo "[rewrite] run_dir=${RUN_DIR}"

for f in $(ls "${CANON_CH_DIR}"/canonical_ch*.json | sort); do
  ch="$(basename "${f}" .json | sed 's/canonical_ch//')"

  out_s="${RUN_DIR}/skeleton/skeleton_ch${ch}.json"
  out_r="${RUN_DIR}/rewrites/rewrites_ch${ch}.json"
  out_a="${RUN_DIR}/assembled/assembled_ch${ch}.json"
  log="${RUN_DIR}/logs/ch${ch}.log"

  if [ -s "${out_a}" ]; then
    echo "✅ [skip] CH${ch} already assembled"
    continue
  fi

  echo ""
  echo "=== CH${ch} ==="
  echo "=== CH${ch} ===" > "${log}"

  echo "[extract]" >> "${log}"
  npx tsx scripts/extract-skeleton.ts "${f}" "${out_s}" --chapter "$((10#${ch}))" --provider "${PROVIDER}" --model "${MODEL}" >> "${log}" 2>&1

  echo "[generate]" >> "${log}"
  npx tsx scripts/generate-from-skeleton.ts --skeleton "${out_s}" --out "${out_r}" --provider "${PROVIDER}" --model "${MODEL}" >> "${log}" 2>&1

  echo "[assemble]" >> "${log}"
  npx tsx scripts/assemble-skeleton-rewrites.ts "${f}" "${out_s}" "${out_r}" "${out_a}" >> "${log}" 2>&1

  echo "✅ CH${ch} done"
done

echo ""
echo "[merge]"
MERGED_JSON="${RUN_DIR}/pv_skeleton_pass1_merged.json"
OPENERS_JSON="${RUN_DIR}/pv_skeleton_pass1_merged.with_openers.json"
MICROFIX_JSON="${RUN_DIR}/pv_skeleton_pass1_merged.with_openers.microfix.json"

npx tsx scripts/merge-assembled-chapters.ts "${RUN_DIR}/assembled" "${MERGED_JSON}"

echo "[openers]"
npx tsx scripts/apply-chapter-openers.ts "${MERGED_JSON}" --out "${OPENERS_JSON}" --book "${BOOK_ID}"

echo "[microfix]"
npx tsx fix/remove-leading-microtitles-under-headings.ts "${OPENERS_JSON}" --out "${MICROFIX_JSON}" --quiet

echo "[render]"
OUT_PDF="${PIPELINE_ROOT}/output/persoonlijke_verzorging_full_skeleton_pass1_professional.with_openers.no_figures.pdf"
OUT_LOG="${RUN_DIR}/pv_skeleton_pass1_prince.log"

npx tsx renderer/render-prince-pdf.ts "${MICROFIX_JSON}" --out "${OUT_PDF}" --log "${OUT_LOG}" --align left

echo "✅ DONE: ${OUT_PDF}"










