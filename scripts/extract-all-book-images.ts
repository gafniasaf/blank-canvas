#!/usr/bin/env npx tsx
/**
 * extract-all-book-images.ts
 * 
 * Extracts ALL images from ALL books in the source folder:
 * - Figures (Afbeelding X.Y)
 * - Chapter openers
 * - Icons/decorations
 * 
 * Organizes output:
 *   new_pipeline/assets/books/<book_id>/
 *     figures/ch<N>/*.png
 *     chapter_openers/*.jpg
 *     icons/*.png (if any)
 *   
 * Creates manifest:
 *   new_pipeline/assets/image_manifest.json
 * 
 * Usage:
 *   npx tsx scripts/extract-all-book-images.ts [--book <book_id>] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = '/Users/asafgafni/Desktop/InDesign/TestRun';
const SOURCE_ROOT = '/Users/asafgafni/Downloads/MBO 2024/Binnenwerk';
const OUTPUT_ROOT = path.join(REPO_ROOT, 'new_pipeline/assets/books');

interface BookConfig {
  book_id: string;
  folder_name: string;
  indd_file: string;
  chapters: number[];
}

// All books from the source folder
const ALL_BOOKS: BookConfig[] = [
  {
    book_id: 'MBO_AF3_9789083251363_03_2024',
    folder_name: 'MBO A&F 3_9789083251363_03',
    indd_file: 'MBO A&F 3_9789083251363_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  },
  {
    book_id: 'MBO_AF4_9789083251370_03_2024',
    folder_name: 'MBO A&F 4_9789083251370_03',
    indd_file: 'MBO A&F 4_9789083251370_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  },
  {
    book_id: 'MBO_COMMUNICATIE_9789083251387_03_2024',
    folder_name: 'MBO Communicatie_9789083251387_03',
    indd_file: 'MBO Communicatie_9789083251387_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8]
  },
  {
    book_id: 'MBO_METHODISCH_WERKEN_9789083251394_03_2024',
    folder_name: 'MBO Methodisch werken_9789083251394_03',
    indd_file: 'MBO Methodisch werken_9789083251394_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
  },
  {
    book_id: 'MBO_PATHOLOGIE_N4_9789083412016_03_2024',
    folder_name: 'MBO Pathologie nivo 4_9789083412016_03',
    indd_file: 'MBO Pathologie nivo 4_9789083412016_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  },
  {
    book_id: 'MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024',
    folder_name: 'MBO Persoonlijke Verzorging_9789083412023_03',
    indd_file: 'MBO Persoonlijke Verzorging_9789083412023_03.2024.indd',
    chapters: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]
  },
  {
    book_id: 'MBO_KLINISCH_REDENEREN_9789083412030_03_2024',
    folder_name: 'MBO Praktijkgestuurd klinisch redeneren_9789083412030_03',
    indd_file: 'MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd',
    chapters: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  },
  {
    book_id: 'MBO_WETGEVING_9789083412061_03_2024',
    folder_name: 'MBO Wetgeving_9789083412061_03',
    indd_file: 'MBO Wetgeving_9789083412061_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  },
  {
    book_id: 'MBO_VTH_N3_9789083412047_03_2024',
    folder_name: '_MBO VTH nivo 3_9789083412047_03',
    indd_file: 'MBO VTH nivo 3_9789083412047_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
  },
  {
    book_id: 'MBO_VTH_N4_9789083412054_03_2024',
    folder_name: '_MBO VTH nivo 4_9789083412054_03',
    indd_file: 'MBO VTH nivo 4_9789083412054_03.2024.indd',
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]
  }
];

interface ImageEntry {
  book_id: string;
  type: 'figure' | 'chapter_opener' | 'icon';
  chapter?: number;
  figure_number?: string;
  filename: string;
  relative_path: string;
  absolute_path: string;
}

interface ImageManifest {
  version: string;
  generated_at: string;
  books: {
    [book_id: string]: {
      figures: ImageEntry[];
      chapter_openers: ImageEntry[];
      icons: ImageEntry[];
    };
  };
  stats: {
    total_images: number;
    total_figures: number;
    total_chapter_openers: number;
    total_icons: number;
    books_processed: number;
  };
}

function findLinksFolder(bookFolder: string): string | null {
  const candidates = [
    path.join(bookFolder, 'Links'),
    path.join(bookFolder, 'links'),
    path.join(bookFolder, 'Afbeeldingen'),
    path.join(bookFolder, 'Images'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function categorizeImage(filename: string): { type: 'figure' | 'chapter_opener' | 'icon'; chapter?: number; figureNumber?: string } {
  const lower = filename.toLowerCase();
  
  // Chapter opener patterns
  if (lower.includes('opener') || lower.includes('chapter_') || lower.match(/^ch?\d+[_-]?opener/i)) {
    const chMatch = filename.match(/(\d+)/);
    return { type: 'chapter_opener', chapter: chMatch ? parseInt(chMatch[1]) : undefined };
  }
  
  // Figure patterns: "Afbeelding 1.2", "Fig_1.2", "MAF_Ch01_Img2"
  const figMatch = filename.match(/(?:afbeelding|fig|img)[_\s]*(\d+)[\._](\d+)/i) ||
                   filename.match(/Ch(\d+)_Img(\d+)/i) ||
                   filename.match(/(\d+)\.(\d+)\./);
  if (figMatch) {
    const chapter = parseInt(figMatch[1]);
    const figNum = `${figMatch[1]}.${figMatch[2]}`;
    return { type: 'figure', chapter, figureNumber: figNum };
  }
  
  // Standalone chapter images
  const chOnlyMatch = filename.match(/^(\d+)\.\d+\./);
  if (chOnlyMatch) {
    return { type: 'figure', chapter: parseInt(chOnlyMatch[1]) };
  }
  
  // Icons/decorations (small, generic names)
  if (lower.includes('icon') || lower.includes('bullet') || lower.includes('arrow')) {
    return { type: 'icon' };
  }
  
  // Default to figure if it looks like an image
  return { type: 'figure' };
}

function copyImage(src: string, dest: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    console.error(`  ⚠️ Failed to copy: ${src}`);
    return false;
  }
}

function convertToPng(src: string, dest: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Use macOS sips for conversion
    const result = spawnSync('sips', ['-s', 'format', 'png', src, '--out', dest], { 
      stdio: 'pipe',
      timeout: 30000 // 30 second timeout per image
    });
    return result.status === 0 && fs.existsSync(dest);
  } catch (e) {
    console.error(`  ⚠️ Failed to convert: ${src}`);
    return false;
  }
}

function extractBookImages(book: BookConfig, dryRun: boolean): ImageEntry[] {
  const bookFolder = path.join(SOURCE_ROOT, book.folder_name);
  const outputFolder = path.join(OUTPUT_ROOT, book.book_id);
  const entries: ImageEntry[] = [];
  
  console.log(`\n📚 Processing: ${book.book_id}`);
  
  if (!fs.existsSync(bookFolder)) {
    console.log(`  ⚠️ Folder not found: ${bookFolder}`);
    return entries;
  }
  
  const linksFolder = findLinksFolder(bookFolder);
  if (!linksFolder) {
    console.log(`  ⚠️ No Links folder found`);
    return entries;
  }
  
  console.log(`  📁 Links folder: ${linksFolder}`);
  
  const files = fs.readdirSync(linksFolder).filter(f => 
    /\.(png|jpg|jpeg|tif|tiff|psd|eps|ai)$/i.test(f)
  );
  
  console.log(`  📷 Found ${files.length} images`);
  
  for (const file of files) {
    const srcPath = path.join(linksFolder, file);
    const { type, chapter, figureNumber } = categorizeImage(file);
    
    // Determine output path
    let subFolder: string;
    let outputFilename = file;
    
    // Convert to PNG if needed (for TIF/PSD/EPS)
    if (/\.(tif|tiff|psd|eps|ai)$/i.test(file)) {
      outputFilename = file.replace(/\.(tif|tiff|psd|eps|ai)$/i, '.png');
    }
    
    switch (type) {
      case 'chapter_opener':
        subFolder = 'chapter_openers';
        if (chapter) {
          outputFilename = `chapter_${chapter}_opener${path.extname(outputFilename)}`;
        }
        break;
      case 'icon':
        subFolder = 'icons';
        break;
      case 'figure':
      default:
        subFolder = chapter ? `figures/ch${chapter}` : 'figures/uncategorized';
        if (figureNumber) {
          outputFilename = `Afbeelding_${figureNumber}${path.extname(outputFilename)}`;
        }
        break;
    }
    
    const destPath = path.join(outputFolder, subFolder, outputFilename);
    const relativePath = path.relative(REPO_ROOT, destPath);
    
    const entry: ImageEntry = {
      book_id: book.book_id,
      type,
      chapter,
      figure_number: figureNumber,
      filename: outputFilename,
      relative_path: relativePath,
      absolute_path: destPath
    };
    
    if (!dryRun) {
      if (/\.(png|jpg|jpeg)$/i.test(file)) {
        copyImage(srcPath, destPath);
      } else if (/\.(tif|tiff)$/i.test(file)) {
        // Convert TIF to PNG using sips
        const success = convertToPng(srcPath, destPath);
        if (!success) {
          console.log(`  ⚠️ Failed conversion: ${file}`);
        }
      } else {
        // PSD/EPS/AI need special handling
        console.log(`  ⏭️ Skipping (unsupported): ${file}`);
      }
    }
    
    entries.push(entry);
  }
  
  return entries;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bookFilter = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
  
  console.log('🖼️  Image Extraction Tool');
  console.log('========================');
  if (dryRun) console.log('🔍 DRY RUN - no files will be copied');
  
  const manifest: ImageManifest = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    books: {},
    stats: {
      total_images: 0,
      total_figures: 0,
      total_chapter_openers: 0,
      total_icons: 0,
      books_processed: 0
    }
  };
  
  const booksToProcess = bookFilter 
    ? ALL_BOOKS.filter(b => b.book_id === bookFilter)
    : ALL_BOOKS;
  
  if (booksToProcess.length === 0) {
    console.error(`❌ Book not found: ${bookFilter}`);
    console.log('Available books:');
    ALL_BOOKS.forEach(b => console.log(`  - ${b.book_id}`));
    process.exit(1);
  }
  
  for (const book of booksToProcess) {
    const entries = extractBookImages(book, dryRun);
    
    manifest.books[book.book_id] = {
      figures: entries.filter(e => e.type === 'figure'),
      chapter_openers: entries.filter(e => e.type === 'chapter_opener'),
      icons: entries.filter(e => e.type === 'icon')
    };
    
    const bookStats = manifest.books[book.book_id];
    manifest.stats.total_figures += bookStats.figures.length;
    manifest.stats.total_chapter_openers += bookStats.chapter_openers.length;
    manifest.stats.total_icons += bookStats.icons.length;
    manifest.stats.books_processed++;
  }
  
  manifest.stats.total_images = 
    manifest.stats.total_figures + 
    manifest.stats.total_chapter_openers + 
    manifest.stats.total_icons;
  
  // Write manifest
  const manifestPath = path.join(REPO_ROOT, 'new_pipeline/assets/image_manifest.json');
  if (!dryRun) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✅ Manifest written to: ${manifestPath}`);
  }
  
  // Summary
  console.log('\n📊 Summary:');
  console.log(`  Books processed: ${manifest.stats.books_processed}`);
  console.log(`  Total images: ${manifest.stats.total_images}`);
  console.log(`    - Figures: ${manifest.stats.total_figures}`);
  console.log(`    - Chapter openers: ${manifest.stats.total_chapter_openers}`);
  console.log(`    - Icons: ${manifest.stats.total_icons}`);
}

main().catch(console.error);

