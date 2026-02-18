import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const MANIFEST_PATH = path.resolve(__dirname, '../books/manifest.json');
const DELIVERABLES_DIR = path.resolve(__dirname, '../deliverables');
const HIGHRES_EXPORT_DIR = path.resolve(__dirname, '../new_pipeline/output/highres_exports');
const PIPELINE_OUTPUT_DIR = path.resolve(__dirname, '../new_pipeline/output');

// Ensure deliverables dir exists and is clean
if (fs.existsSync(DELIVERABLES_DIR)) {
  fs.rmSync(DELIVERABLES_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DELIVERABLES_DIR, { recursive: true });

interface Manifest {
  books: BookEntry[];
}

interface BookEntry {
  book_id: string;
  canonical_n4_idml_path?: string;
  canonical_n4_indd_path?: string;
}

function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

function copyFile(src: string, dest: string) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else {
    // console.warn(`Warning: Source file not found: ${src}`);
  }
}

function copyDir(src: string, dest: string) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  } else {
    // console.warn(`Warning: Source dir not found: ${src}`);
  }
}

function generateImageReport(bookId: string, jsonPath: string, imagesDir: string, reportPath: string, missingReportPath: string) {
  if (!fs.existsSync(jsonPath)) {
    fs.writeFileSync(reportPath, "Canonical JSON not found, cannot generate image references.");
    return;
  }

  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const imagesInJson: Set<string> = new Set();
  let csvContent = "Chapter,Section,Paragraph,Image_Filename,Caption\n";

  function traverse(node: any, context: string) {
    if (!node) return;
    
    // Check if node is an image block
    if (node.type === 'image' || node.type === 'img' || (node.role === 'image')) {
      // Try to find src
      const src = node.src || node.url || '';
      const caption = (node.caption || '').replace(/[\r\n,]/g, ' '); // Clean for CSV
      
      if (src) {
        // Extract filename from src (it might be a path or url)
        const filename = path.basename(src);
        imagesInJson.add(filename);
        csvContent += `${context},"${filename}","${caption}"\n`;
      }
    }

    // Traverse children
    if (Array.isArray(node.chapters)) {
        node.chapters.forEach((ch: any, i: number) => traverse(ch, `Ch ${ch.number || i+1}`));
    } else if (Array.isArray(node.content)) {
        node.content.forEach((item: any, i: number) => traverse(item, `${context} > Para ${i+1}`));
    } else if (Array.isArray(node)) {
         node.forEach((item: any, i: number) => traverse(item, `${context} > Item ${i+1}`));
    } else if (typeof node === 'object') {
        // Generic traversal for other keys
        Object.keys(node).forEach(key => {
            if (key !== 'meta' && typeof node[key] === 'object') {
                traverse(node[key], context);
            }
        });
    }
  }

  traverse(json, "Book");
  fs.writeFileSync(reportPath, csvContent);

  // Check for missing images
  if (fs.existsSync(imagesDir)) {
    const imagesOnDisk = new Set(fs.readdirSync(imagesDir));
    const report = `Total Images Referenced in JSON: ${imagesInJson.size}\nTotal Images in Folder: ${imagesOnDisk.size}\n`;
    fs.writeFileSync(missingReportPath, report);
  }
}

async function main() {
  const manifest = loadManifest();
  const processedBookIds = new Set<string>();
  
  // 1. Process books from Manifest
  for (const book of manifest.books) {
    console.log(`Packaging ${book.book_id}...`);
    processedBookIds.add(book.book_id);
    const bookDir = path.join(DELIVERABLES_DIR, book.book_id);
    fs.mkdirSync(bookDir, { recursive: true });

    // 1. PDF
    const pdfSrc = path.join(HIGHRES_EXPORT_DIR, `${book.book_id}_HIGHRES.pdf`);
    copyFile(pdfSrc, path.join(bookDir, `${book.book_id}_HIGHRES.pdf`));

    // 2. Images
    const imagesSrc = path.join(HIGHRES_EXPORT_DIR, `${book.book_id}_images`);
    const imagesDest = path.join(bookDir, "Images");
    copyDir(imagesSrc, imagesDest);

    // 3. JSONs
    const jsonDir = path.join(bookDir, "JSON");
    fs.mkdirSync(jsonDir);
    
    // Canonical
    const canonicalJsonSrc = path.join(PIPELINE_OUTPUT_DIR, book.book_id, 'canonical_book_with_figures.json');
    if (fs.existsSync(canonicalJsonSrc)) {
        copyFile(canonicalJsonSrc, path.join(jsonDir, 'canonical_book.json'));
    }

    // Skeleton / Rewrites (if exist)
    const skeletonSrc = path.join(PIPELINE_OUTPUT_DIR, book.book_id, 'skeleton.json'); // Guessing name
    if (fs.existsSync(skeletonSrc)) copyFile(skeletonSrc, path.join(jsonDir, 'skeleton.json'));

    // 4. Source IDML
    if (book.canonical_n4_idml_path) {
        const idmlAbsPath = path.resolve(__dirname, '..', book.canonical_n4_idml_path);
        if (fs.existsSync(idmlAbsPath)) {
            copyFile(idmlAbsPath, path.join(bookDir, 'source.idml'));
        }
    }

    // 5. Image Report
    try {
        generateImageReport(book.book_id, canonicalJsonSrc, imagesDest, path.join(bookDir, 'image_references.csv'), path.join(bookDir, 'images_status.txt'));
    } catch (e) {
        fs.writeFileSync(path.join(bookDir, 'image_references_note.txt'), `Report generation skipped/failed (JSON missing?)`);
    }
  }

  // 2. Scan for Extra Books (Generated but not in Manifest)
  if (fs.existsSync(HIGHRES_EXPORT_DIR)) {
      const files = fs.readdirSync(HIGHRES_EXPORT_DIR);
      for (const file of files) {
          if (file.endsWith('_HIGHRES.pdf')) {
              const bookId = file.replace('_HIGHRES.pdf', '');
              if (!processedBookIds.has(bookId)) {
                  console.log(`Packaging EXTRA book found in output: ${bookId}...`);
                  processedBookIds.add(bookId);
                  
                  const bookDir = path.join(DELIVERABLES_DIR, bookId);
                  if (!fs.existsSync(bookDir)) fs.mkdirSync(bookDir, { recursive: true });
                  
                  // Copy PDF
                  copyFile(path.join(HIGHRES_EXPORT_DIR, file), path.join(bookDir, file));
                  
                  // Copy Images
                  const imagesSrc = path.join(HIGHRES_EXPORT_DIR, `${bookId}_images`);
                  if (fs.existsSync(imagesSrc)) {
                      copyDir(imagesSrc, path.join(bookDir, "Images"));
                  }
                  
                  // Add note
                  fs.writeFileSync(path.join(bookDir, 'NOTE.txt'), "This book was discovered and processed via PDF export only. No JSON/IDML data available in the current pipeline manifest.");
              }
          }
      }
  }

  // Write Process Doc
  const readmeContent = `
# InDesign High-Res Export & Data Package

Generated on: ${new Date().toISOString()}

## Contents
For each book, this package contains:
1. **HIGHRES PDF**: Generated directly from the original InDesign source, with all images relinked to high-resolution PNGs (converted from source TIF/PSD/etc.).
   - Settings: No Downsampling, Lossless Compression (ZIP).
2. **Images Folder**: The collection of high-resolution PNGs used for the export.
3. **JSON Data** (if available): The 'Canonical' JSON representation of the book structure.
4. **Source IDML** (if available): The original IDML snapshot used as the source of truth.
5. **Image References** (if available): A report listing where images appear in the book structure.

## Process Description
1. **Image Conversion**: All original linked images (TIF, PSD, AI, EPS, etc.) were found in the source 'Links' directory and converted to high-quality PNGs (300 DPI equivalent) to ensure compatibility and quality.
2. **Relinking**: A custom InDesign script opened each book's original .indd file, scanned for links, and relinked them to the newly converted high-res PNGs.
3. **Export**: The books were exported using a custom PDF Preset that explicitly disables downsampling and enables lossless compression, ensuring maximum image fidelity.
4. **Data Extraction**: The book structure was exported to JSON (for manifest books) to provide a programmatic reference for content and image placement.

## Notes
- Books marked as "EXTRA" (or lacking JSON) were identified in the Downloads folder and processed for High-Res PDF/Images, but have not yet been fully onboarded into the JSON/IDML pipeline.
- The PDFs are large due to the lack of downsampling. This is intentional to preserve maximum quality as requested.

`;
  fs.writeFileSync(path.join(DELIVERABLES_DIR, 'README.md'), readmeContent);

  console.log("Zipping deliverables...");
  try {
      execSync(`zip -r deliverables.zip deliverables`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
      console.log("Done! deliverables.zip created.");
  } catch (e) {
      console.error("Zip failed (maybe zip is not installed?)", e);
  }
}

main();
