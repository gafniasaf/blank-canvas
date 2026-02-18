# Pipeline Status

**Last Updated:** December 28, 2024 22:39

## ✅ A&F N4 (Complete)

**Book:** MBO Anatomie & Fysiologie N4  
**ISBN:** 9789083251370  
**Chapters:** 14  
**Status:** Complete with Sonnet 4.5

### Key Files:
- Canonical: `output/canonical_book_with_figures.json`
- Skeleton: `output/skeleton_ch1.json` (all chapters)
- Rewrites: `output/rewrites_ch1.json` → `rewrites_ch1_pass2.json`
- Final: `output/canonical_book_PASS2.assembled.json`
- PDF: `output/canonical_book_PASS2_with_openers.pdf`
- Chapter Openers: `assets/images/chapter_openers/chapter_N_opener.jpg`

### Backup Location:
`_backups/working_af4_20251228_223515/`


## 🔄 Pathologie N4 (In Progress)

**Book:** MBO Pathologie N4  
**ISBN:** 9789083412016  
**Chapters:** 12  
**Status:** Building with Sonnet 4.5

### Key Files:
- Canonical: `output/pathologie_n4/canonical_book_with_figures.json`
- Skeleton: `output/skeleton_ch{N}.json` (being generated)
- Rewrites: `output/rewrites_ch{N}.json` (being generated)
- Chapter Openers: `assets/images/pathologie_chapter_openers/chapter_N_opener.jpg`

### Progress Log:
- Log file: `/tmp/pathologie_n4_build.log`
- Started: 2024-12-28 22:38

### Next Steps After Build:
1. Run Pass 2 (verdieping + microheadings)
2. Assemble final JSON
3. Render PDF with `--chapter-openers pathologie_chapter_openers`


## Pipeline Commands

### Build All Chapters (Pass 1):
```bash
cd new_pipeline
for ch in 1 2 3 ... N; do
  npx tsx scripts/build-chapter.ts \
    --chapter $ch \
    --in-json output/<book>/canonical_book_with_figures.json \
    --rewrite-mode skeleton \
    --rewrite-provider anthropic \
    --rewrite-model claude-sonnet-4-5-20250929
done
```

### Run Pass 2:
```bash
npx tsx scripts/pass2-verdieping-microheadings.ts \
  output/skeleton_ch1.json \
  output/rewrites_ch1.json \
  output/rewrites_ch1_pass2.json \
  --provider=anthropic \
  --model=claude-sonnet-4-5-20250929
```

### Assemble:
```bash
npx tsx scripts/assemble-skeleton-rewrites.ts \
  output/<book>/canonical_book_with_figures.json \
  output/skeleton_ch1.json \
  output/rewrites_ch1_pass2.json \
  output/<book>/final.assembled.json
```

### Render PDF:
```bash
npx tsx renderer/render-prince-pdf.ts \
  output/<book>/final.assembled.json \
  --out output/<book>/final.pdf \
  --chapter-openers <opener_directory>
```











