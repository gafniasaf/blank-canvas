import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// --- CONFIG ---
const MANIFEST_PATH = path.resolve(__dirname, '../books/manifest.json');
const OUTPUT_BASE = path.resolve(__dirname, '../new_pipeline/output/final_images');
const SCRIPT_TEMPLATE_DIR = path.resolve(__dirname, 'temp_scripts');

if (!fs.existsSync(OUTPUT_BASE)) {
  fs.mkdirSync(OUTPUT_BASE, { recursive: true });
}
if (!fs.existsSync(SCRIPT_TEMPLATE_DIR)) {
  fs.mkdirSync(SCRIPT_TEMPLATE_DIR, { recursive: true });
}

// --- TYPES ---
interface Manifest {
  books: BookEntry[];
}

interface BookEntry {
  book_id: string;
  canonical_n4_indd_path: string;
}

interface Figure {
  image: string;
  pageIndex: number;
  bounds: [number, number, number, number]; // [top, left, bottom, right]
}

// --- HELPERS ---
function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

/**
 * Generates the InDesign JSX script to extract bounds for a specific book
 */
function generateBoundsJsx(bookId: string, inddPath: string, jsonPath: string): string {
  // Use raw string for the body to avoid escaping hell
  return `
// Auto-generated bounds extraction for ${bookId}
#targetengine "session"

(function () {
  // Suppress dialogs
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  function jsonStringify(obj) {
    var t = typeof (obj);
    if (t !== "object" || obj === null) {
      if (t == "string") return '"' + obj.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n').replace(/\\r/g, '') + '"';
      return String(obj);
    } else {
      var n, v, json = [], arr = (obj && obj.constructor == Array);
      for (n in obj) {
        v = obj[n]; t = typeof(v);
        if (t == "string") v = '"' + v.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n').replace(/\\r/g, '') + '"';
        else if (t == "object" && v !== null) v = jsonStringify(v);
        json.push((arr ? "" : '"' + n + '":') + String(v));
      }
      return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");
    }
  }

  function writeJson(path, obj) {
    var f = File(path);
    f.encoding = "UTF-8";
    if (f.open("w")) { f.write(jsonStringify(obj)); f.close(); }
  }
  
  function isBodyStyle(styleName) {
    if (!styleName) return false;
    var s = styleName.toLowerCase();
    if (s.indexOf("basis") !== -1) return true;
    if (s.indexOf("body") !== -1) return true;
    if (s.indexOf("bullet") !== -1) return true;
    if (s.indexOf("numbered") !== -1) return true;
    if (s.indexOf("header") !== -1) return true;
    if (s.indexOf("titel") !== -1) return true;
    if (s.indexOf("introductie") !== -1) return true;
    if (s.indexOf("inhoud") !== -1) return true;
    if (s.indexOf("normal") !== -1) return true;
    return false;
  }

  function isLabelStyle(styleName) {
    if (!styleName) return false;
    var s = styleName.toLowerCase();
    if (s.indexOf("label") !== -1) return true;
    if (s.indexOf("annotation") !== -1) return true;
    if (s.indexOf("freightsans") !== -1) return true;
    if (s.indexOf("white") !== -1) return true;
    return false;
  }

  var srcPath = "${inddPath}";
  var outputPath = "${jsonPath}";
  
  if (!File(srcPath).exists) return;
  
  try {
    var doc = app.open(File(srcPath), false);
    
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
    
    var figures = [];
    var links = doc.links;
    
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.status === LinkStatus.LINK_MISSING) continue;
      if (!link.name.match(/\\.(tif|tiff|png|jpg|jpeg|psd|ai|eps)$/i)) continue;
      
      var parent = link.parent;
      if (!parent || !parent.parent) continue;
      var frame = parent.parent; 
      
      if (!frame.hasOwnProperty("geometricBounds")) continue;
      
      var page = frame.parentPage;
      if (!page || page.constructor.name !== "Page") continue;
      
      var pageIndex = page.documentOffset + 1;
      
      var b = frame.geometricBounds;
      var top = Number(b[0]), left = Number(b[1]), bottom = Number(b[2]), right = Number(b[3]);
      
      // Normalize bounds
      if (top > bottom) { var t = top; top = bottom; bottom = t; }
      if (left > right) { var t = left; left = right; right = t; }

      var width = right - left;
      var height = bottom - top;
      
      if (width < 30 || height < 30) continue; 
      
      var buffer = 30; 
      var searchTop = top - buffer;
      var searchLeft = left - buffer;
      var searchBottom = bottom + buffer;
      var searchRight = right + buffer;
      
      var cropTop = top;
      var cropLeft = left;
      var cropBottom = bottom;
      var cropRight = right;
      
      var pageItems = page.allPageItems;
      for (var j = 0; j < pageItems.length; j++) {
        var item = pageItems[j];
        if (!(item instanceof TextFrame)) continue;
        
        if (item.appliedObjectStyle && item.appliedObjectStyle.name.indexOf("Text Column") !== -1) continue;

        var pStyleName = "";
        if (item.paragraphs.length > 0) {
            pStyleName = item.paragraphs[0].appliedParagraphStyle.name;
        }

        var isLabel = isLabelStyle(pStyleName);
        var isBody = isBodyStyle(pStyleName);

        var include = false;
        if (isLabel) include = true;
        else if (isBody) include = false;
        else {
            if (item.previousTextFrame != null || item.nextTextFrame != null) include = false;
            else {
                var iB = item.geometricBounds;
                var iH = iB[2] - iB[0];
                var iW = iB[3] - iB[1];
                if (iH > 400 || iW > 400) include = false;
                else if (item.contents.length > 300) include = false;
                else include = true;
            }
        }
        
        if (!include) continue;

        var iB = item.geometricBounds;
        var iTop = Number(iB[0]), iLeft = Number(iB[1]), iBottom = Number(iB[2]), iRight = Number(iB[3]);
        
        // Normalize
        if (iTop > iBottom) { var t = iTop; iTop = iBottom; iBottom = t; }
        if (iLeft > iRight) { var t = iLeft; iLeft = iRight; iRight = t; }

        var intersects = !(iLeft > searchRight || iRight < searchLeft || iTop > searchBottom || iBottom < searchTop);
        
        if (intersects) {
          if (iTop < cropTop) cropTop = iTop;
          if (iLeft < cropLeft) cropLeft = iLeft;
          if (iBottom > cropBottom) cropBottom = iBottom;
          if (iRight > cropRight) cropRight = iRight;
        }
      }
      
      var pageBounds = page.bounds; 
      if (cropTop < pageBounds[0]) cropTop = pageBounds[0];
      if (cropLeft < pageBounds[1]) cropLeft = pageBounds[1];
      if (cropBottom > pageBounds[2]) cropBottom = pageBounds[2];
      if (cropRight > pageBounds[3]) cropRight = pageBounds[3];

      figures.push({
        image: link.name,
        pageIndex: pageIndex,
        bounds: [cropTop, cropLeft, cropBottom, cropRight]
      });
    }
    
    doc.close(SaveOptions.NO);
    writeJson(outputPath, { figures: figures });
    
  } catch (e) {
    // Fail silent
  }
})();
`;
}

/**
 * Merge overlapping bounds to create composite figures
 */
function mergeBounds(inputJsonPath: string, outputJsonPath: string) {
  if (!fs.existsSync(inputJsonPath)) return;

  const data = JSON.parse(fs.readFileSync(inputJsonPath, 'utf-8'));
  const figures: Figure[] = data.figures;

  // Normalize bounds first
  figures.forEach(f => {
    let [top, left, bottom, right] = f.bounds;
    if (top > bottom) [top, bottom] = [bottom, top];
    if (left > right) [left, right] = [right, left];
    f.bounds = [top, left, bottom, right];
  });

  const byPage: { [key: number]: Figure[] } = {};
  figures.forEach(f => {
    if (!byPage[f.pageIndex]) byPage[f.pageIndex] = [];
    byPage[f.pageIndex].push(f);
  });

  const mergedFigures: Figure[] = [];
  const MERGE_THRESHOLD = 50; 

  for (const pageStr in byPage) {
    const pageIndex = parseInt(pageStr);
    let pageFigs = byPage[pageIndex];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < pageFigs.length; i++) {
        for (let j = i + 1; j < pageFigs.length; j++) {
          const a = pageFigs[i];
          const b = pageFigs[j];
          
          const expandedA = [a.bounds[0]-MERGE_THRESHOLD, a.bounds[1]-MERGE_THRESHOLD, a.bounds[2]+MERGE_THRESHOLD, a.bounds[3]+MERGE_THRESHOLD];
          
          const intersect = !(b.bounds[1] > expandedA[3] || 
                              b.bounds[3] < expandedA[1] || 
                              b.bounds[0] > expandedA[2] || 
                              b.bounds[2] < expandedA[0]);

          if (intersect) {
            const newTop = Math.min(a.bounds[0], b.bounds[0]);
            const newLeft = Math.min(a.bounds[1], b.bounds[1]);
            const newBottom = Math.max(a.bounds[2], b.bounds[2]);
            const newRight = Math.max(a.bounds[3], b.bounds[3]);
            
            const nameA = path.basename(a.image, path.extname(a.image));
            const nameB = path.basename(b.image, path.extname(b.image));
            const newName = (nameA + "_" + nameB).substring(0, 50) + "_merged.png";

            pageFigs[i] = {
              image: newName,
              pageIndex: pageIndex,
              bounds: [newTop, newLeft, newBottom, newRight]
            };
            
            pageFigs.splice(j, 1);
            changed = true;
            break; 
          }
        }
        if (changed) break;
      }
    }
    mergedFigures.push(...pageFigs);
  }

  fs.writeFileSync(outputJsonPath, JSON.stringify({ figures: mergedFigures }, null, 2));
}

/**
 * Main execution loop
 */
async function processAllBooks() {
  const manifest = loadManifest();
  const books = manifest.books;

  for (const book of books) {
    console.log(`\n========================================`);
    console.log(`Processing: ${book.book_id}`);
    console.log(`========================================`);

    const bookOutDir = path.join(OUTPUT_BASE, book.book_id);
    if (!fs.existsSync(bookOutDir)) fs.mkdirSync(bookOutDir, { recursive: true });

    const rawJsonPath = path.join(bookOutDir, 'raw_bounds.json');
    const mergedJsonPath = path.join(bookOutDir, 'merged_bounds.json');
    
    // 1. EXTRACT BOUNDS (InDesign)
    console.log(`[1/4] Extracting bounds from InDesign...`);
    const jsxPath = path.join(SCRIPT_TEMPLATE_DIR, `extract_${book.book_id}.jsx`);
    const jsxContent = generateBoundsJsx(book.book_id, book.canonical_n4_indd_path, rawJsonPath);
    fs.writeFileSync(jsxPath, jsxContent);

    try {
        execSync(`osascript -e 'with timeout of 1200 seconds' -e 'tell application "Adobe InDesign 2026" to do script POSIX file "${jsxPath}" language javascript' -e 'end timeout'`, { stdio: 'inherit' });
    } catch (e) {
        console.error(`InDesign extraction failed for ${book.book_id}:`, e);
        continue;
    }

    if (!fs.existsSync(rawJsonPath)) {
        console.error(`JSON output not found for ${book.book_id}. Skipping.`);
        continue;
    }

    // 2. MERGE BOUNDS
    console.log(`[2/4] Merging overlapping figures...`);
    mergeBounds(rawJsonPath, mergedJsonPath);

    // 3. CROP IMAGES (pdftocairo)
    const pdfPath = path.resolve(__dirname, `../new_pipeline/output/highres_exports/${book.book_id}_HIGHRES.pdf`);
    
    if (!fs.existsSync(pdfPath)) {
        console.error(`High-res PDF not found: ${pdfPath}`);
        console.log(`Please ensure 'scripts/process-all-books-highres.ts' has been run.`);
        continue;
    }

    console.log(`[3/4] Cropping images from PDF...`);
    try {
        cropImagesForBook(mergedJsonPath, pdfPath, bookOutDir);
    } catch (e) {
        console.error(`Cropping failed for ${book.book_id}:`, e);
    }

    // 4. FLATTEN IMAGES (Python)
    console.log(`[4/4] Flattening transparency...`);
    try {
        flattenImagesInDir(bookOutDir);
    } catch (e) {
        console.error(`Flattening failed for ${book.book_id}:`, e);
    }
  }
}

/**
 * Cropping Logic (Ported from crop-images-strict.ts)
 */
function cropImagesForBook(jsonPath: string, pdfPath: string, outputDir: string) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const figures = data.figures;
    const DPI = 300;

    console.log(`Cropping ${figures.length} figures...`);

    for (const fig of figures) {
        const baseName = path.basename(fig.image, path.extname(fig.image)).replace(/[^a-zA-Z0-9._-]/g, '_');
        let uniqueName = `${baseName}_p${fig.pageIndex}`;
        
        // Handle duplicates
        let counter = 1;
        let outFilePrefix = path.join(outputDir, uniqueName);
        while (fs.existsSync(outFilePrefix + ".png")) {
            uniqueName = `${baseName}_p${fig.pageIndex}_${counter}`;
            outFilePrefix = path.join(outputDir, uniqueName);
            counter++;
        }

        // Bounds
        let topPt = fig.bounds[0];
        let leftPt = fig.bounds[1];
        let bottomPt = fig.bounds[2];
        let rightPt = fig.bounds[3];

        if (topPt > bottomPt) [topPt, bottomPt] = [bottomPt, topPt];
        if (leftPt > rightPt) [leftPt, rightPt] = [rightPt, leftPt];

        const widthPt = rightPt - leftPt;
        const heightPt = bottomPt - topPt;

        const scale = DPI / 72;
        const xPx = Math.round(leftPt * scale);
        const yPx = Math.round(topPt * scale);
        const wPx = Math.round(widthPt * scale);
        const hPx = Math.round(heightPt * scale);

        if (wPx <= 0 || hPx <= 0) continue;

        try {
            const cmd = `pdftocairo -png -r ${DPI} -f ${fig.pageIndex} -l ${fig.pageIndex} -x ${xPx} -y ${yPx} -W ${wPx} -H ${hPx} -singlefile "${pdfPath}" "${outFilePrefix}"`;
            execSync(cmd, { stdio: 'ignore' });
        } catch (e) {
            // console.error(`Failed crop ${uniqueName}`);
        }
    }
}

/**
 * Flattening Logic (Python wrapper)
 */
function flattenImagesInDir(dir: string) {
    const script = `
import os
from PIL import Image
import sys

DIR = "${dir}"
for f in os.listdir(DIR):
    if f.lower().endswith(".png"):
        p = os.path.join(DIR, f)
        try:
            img = Image.open(p)
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode != 'RGBA': img = img.convert('RGBA')
                bg.paste(img, mask=img.split()[3])
                bg.save(p)
        except:
            pass
`;
    const tempPy = path.join(dir, 'temp_flatten.py');
    fs.writeFileSync(tempPy, script);
    try {
        execSync(`python3 "${tempPy}"`, { stdio: 'inherit' });
    } finally {
        if (fs.existsSync(tempPy)) fs.unlinkSync(tempPy);
    }
}

processAllBooks().catch(e => console.error(e));
