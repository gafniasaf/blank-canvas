import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const MANIFEST_PATH = path.resolve(__dirname, '../books/manifest.json');
const OUTPUT_BASE = path.resolve(__dirname, '../new_pipeline/output/highres_exports');

// Ensure output base exists
if (!fs.existsSync(OUTPUT_BASE)) {
  fs.mkdirSync(OUTPUT_BASE, { recursive: true });
}

interface Manifest {
  books: BookEntry[];
}

interface BookEntry {
  book_id: string;
  canonical_n4_indd_path: string;
}

function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

function getLinksPath(inddPath: string): string {
  return path.join(path.dirname(inddPath), 'Links');
}

function generateJsx(bookId: string, inddPath: string, highResFolder: string, outputPdfPath: string, logPath: string): string {
  // Escaping backslashes for JS string literals if on Windows, but we are on Mac so forward slashes are fine.
  // We just need to be careful about quotes.
  
  return `// Auto-generated script for ${bookId}
#target "InDesign"
#targetengine "session"

(function () {
  var LOG_FILE_PATH = "${logPath}";
  var INDD_PATH = "${inddPath}";
  var HIGH_RES_FOLDER = "${highResFolder}";
  var OUTPUT_PDF_PATH = "${outputPdfPath}";

  function log(message) {
    var f = new File(LOG_FILE_PATH);
    f.open("a");
    f.writeln("[" + new Date().toString() + "] " + message);
    f.close();
  }

  function getHighResPath(linkName) {
    var safeName = linkName.replace(/[^a-zA-Z0-9._-]/g, '_');
    var lastDotIndex = safeName.lastIndexOf('.');
    var baseName = (lastDotIndex > 0) ? safeName.substring(0, lastDotIndex) : safeName;
    return HIGH_RES_FOLDER + "/" + baseName + ".png";
  }

  log("Script started - Relink and Export for ${bookId}");
  
  // Suppress dialogs
  var originalInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  try {
    // 1. Open Document
    log("Opening document: " + INDD_PATH);
    app.open(new File(INDD_PATH), false);
    var doc = app.activeDocument;
    
    // 2. Relink Images
    log("Scanning " + doc.links.length + " links...");
    var relinkCount = 0;
    
    var links = doc.links;
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.status === LinkStatus.LINK_MISSING) continue;
      
      var linkName = link.name;
      if (!linkName.match(/\\.(tif|tiff|png|jpg|jpeg|psd|ai|eps)$/i)) continue;
      
      var newPath = getHighResPath(linkName);
      var newFile = new File(newPath);
      
      if (newFile.exists && link.filePath !== newFile.fsName) {
        try {
          link.relink(newFile);
          try { link.update(); } catch(e) {}
          relinkCount++;
        } catch (e) {
          log("Failed to relink " + linkName + ": " + e.message);
        }
      }
    }
    
    log("Relinked count: " + relinkCount);
    
    // 3. Configure PDF Export (Safe Method)
    log("Configuring PDF export...");
    
    var basePresetName = "[High Quality Print]";
    var tempPresetName = "Temp_HighRes_${bookId}_" + Math.floor(Math.random() * 10000);
    
    var basePreset = app.pdfExportPresets.item(basePresetName);
    if (!basePreset.isValid) {
      throw new Error("Base preset " + basePresetName + " not found!");
    }
    
    var myPreset = basePreset.duplicate();
    myPreset.name = tempPresetName;
    
    myPreset.colorBitmapSampling = Sampling.NONE;
    myPreset.grayscaleBitmapSampling = Sampling.NONE;
    myPreset.monochromeBitmapSampling = Sampling.NONE;
    
    // 4. Export
    log("Exporting to PDF: " + OUTPUT_PDF_PATH);
    doc.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF_PATH), false, myPreset);
    
    log("Export successful!");
    
    myPreset.remove();
    doc.close(SaveOptions.NO);
    log("Document closed.");

  } catch (e) {
    log("FATAL ERROR: " + e.message + " (Line " + e.line + ")");
  } finally {
    app.scriptPreferences.userInteractionLevel = originalInteractionLevel;
    log("Script finished.");
  }
})();
`;
}

async function processBook(book: BookEntry) {
  console.log(`\n========================================`);
  console.log(`Processing: ${book.book_id}`);
  console.log(`========================================`);

  const linksPath = getLinksPath(book.canonical_n4_indd_path);
  if (!fs.existsSync(linksPath)) {
    console.error(`ERROR: Links folder not found at ${linksPath}`);
    return;
  }

  const bookImageDir = path.join(OUTPUT_BASE, `${book.book_id}_images`);
  if (!fs.existsSync(bookImageDir)) {
    fs.mkdirSync(bookImageDir, { recursive: true });
  }

  // 1. Convert Images
  console.log(`Converting images from ${linksPath} to ${bookImageDir}...`);
  try {
    // We use a shell loop for efficiency and glob handling
    // SIPS: Convert TIF/PSD to PNG
    const cmdConvert = `
      setopt +o nomatch
      cd "${linksPath}"
      for f in *.tif *.TIF *.psd *.PSD; do
        if [ -f "$f" ]; then
           # logic to safely name
           base="\${f%.*}"
           safeName=$(echo "$base" | sed 's/[^a-zA-Z0-9._-]/_/g')
           sips -s format png "$f" --out "${bookImageDir}/$safeName.png" 2>&1 | grep -v "Warning" | grep -v "^$" || true
        fi
      done
    `;
    execSync(cmdConvert, { stdio: 'inherit', shell: '/bin/zsh' });

    // CP: Copy existing PNG/JPG just in case, renaming safely
    // Note: This is a bit trickier in shell one-liner to match the safe name logic perfectly.
    // For simplicity, we will trust sips to handle conversion, and manual copy for others.
    // Actually, sips can "convert" jpg to png too, ensuring format consistency.
    const cmdConvertAll = `
      setopt +o nomatch
      cd "${linksPath}"
      for f in *.jpg *.JPG *.jpeg *.JPEG *.png *.PNG *.ai *.AI *.eps *.EPS; do
        if [ -f "$f" ]; then
           base="\${f%.*}"
           safeName=$(echo "$base" | sed 's/[^a-zA-Z0-9._-]/_/g')
           # Convert EVERYTHING to PNG to be safe and consistent with the relinker
           sips -s format png "$f" --out "${bookImageDir}/$safeName.png" 2>&1 | grep -v "Warning" | grep -v "^$" || true
        fi
      done
    `;
    execSync(cmdConvertAll, { stdio: 'inherit', shell: '/bin/zsh' });

  } catch (e) {
    console.error(`Error processing images for ${book.book_id}`, e);
  }

  // 2. Run InDesign Script
  const outputPdfPath = path.join(OUTPUT_BASE, `${book.book_id}_HIGHRES.pdf`);
  const logPath = path.join(OUTPUT_BASE, `${book.book_id}_log.txt`);
  const jsxPath = path.join(__dirname, `temp_relink_${book.book_id}.jsx`);

  console.log(`Generating JSX script...`);
  const jsxContent = generateJsx(book.book_id, book.canonical_n4_indd_path, bookImageDir, outputPdfPath, logPath);
  fs.writeFileSync(jsxPath, jsxContent);

  console.log(`Running InDesign export (this may take time)...`);
  try {
    execSync(`osascript -e 'with timeout of 3600 seconds' -e 'tell application "Adobe InDesign 2026" to do script POSIX file "${jsxPath}" language javascript' -e 'end timeout'`, { stdio: 'inherit' });
    console.log(`InDesign script completed.`);
  } catch (e) {
    console.error(`Error running InDesign script for ${book.book_id}`, e);
  }
}

async function main() {
  const manifest = loadManifest();
  
  for (const book of manifest.books) {
    await processBook(book);
  }

  console.log(`\n\nAll books processed. Check ${OUTPUT_BASE} for results.`);
}

main();


