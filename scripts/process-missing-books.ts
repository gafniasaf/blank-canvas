import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const OUTPUT_BASE = path.resolve(__dirname, '../new_pipeline/output/highres_exports');

// Ensure output base exists
if (!fs.existsSync(OUTPUT_BASE)) {
  fs.mkdirSync(OUTPUT_BASE, { recursive: true });
}

interface MissingBook {
  id: string;
  path: string;
  type: 'INDD' | 'INDB';
}

// Removed MBO_AF3_2024 as it is already successfully processed
const MISSING_BOOKS: MissingBook[] = [
  {
    id: 'MBO_PATHOLOGIE_N4_2024',
    path: '/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Pathologie nivo 4_9789083412016_03/MBO Pathologie nivo 4_9789083412016_03.2024.indb',
    type: 'INDB'
  },
  {
    id: 'MBO_VTH_N3_2024',
    path: '/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 3_9789083412047_03/_MBO VTH nivo 3_9789083412047_03.2024.indb',
    type: 'INDB'
  },
  {
    id: 'MBO_VTH_N4_2024',
    path: '/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/_MBO VTH nivo 4_9789083412054_03.2024.indb',
    type: 'INDB'
  }
];

function getLinksPath(docPath: string): string {
  return path.join(path.dirname(docPath), 'Links');
}

function generateJsxIndd(bookId: string, inddPath: string, highResFolder: string, outputPdfPath: string, logPath: string): string {
  return `// Auto-generated script for ${bookId} (INDD)
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
  
  // CLEANUP: Close existing docs to avoid conflicts
  try { app.documents.everyItem().close(SaveOptions.NO); } catch(e) {}
  try { app.books.everyItem().close(SaveOptions.NO); } catch(e) {}

  var originalInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  try {
    log("Opening document: " + INDD_PATH);
    app.open(new File(INDD_PATH), false);
    var doc = app.activeDocument;
    
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
    
    log("Configuring PDF export...");
    var basePresetName = "[High Quality Print]";
    var tempPresetName = "Temp_HighRes_${bookId}_" + Math.floor(Math.random() * 10000);
    
    var basePreset = app.pdfExportPresets.item(basePresetName);
    if (!basePreset.isValid) throw new Error("Base preset not found!");
    
    var myPreset = basePreset.duplicate();
    myPreset.name = tempPresetName;
    myPreset.colorBitmapSampling = Sampling.NONE;
    myPreset.grayscaleBitmapSampling = Sampling.NONE;
    myPreset.monochromeBitmapSampling = Sampling.NONE;
    myPreset.colorBitmapCompression = BitmapCompression.ZIP;
    myPreset.grayscaleBitmapCompression = BitmapCompression.ZIP;
    myPreset.monochromeBitmapCompression = MonoBitmapCompression.ZIP;
    
    log("Exporting to PDF: " + OUTPUT_PDF_PATH);
    doc.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF_PATH), false, myPreset);
    
    log("Export successful!");
    
    myPreset.remove();
    doc.close(SaveOptions.NO);

  } catch (e) {
    log("FATAL ERROR: " + e.message);
  } finally {
    app.scriptPreferences.userInteractionLevel = originalInteractionLevel;
    log("Script finished.");
  }
})();
`;
}

function generateJsxIndb(bookId: string, indbPath: string, highResFolder: string, outputPdfPath: string, logPath: string): string {
    return `// Auto-generated script for ${bookId} (INDB)
#target "InDesign"
#targetengine "session"

(function () {
  var LOG_FILE_PATH = "${logPath}";
  var INDB_PATH = "${indbPath}";
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

  log("Script started - Relink and Export for BOOK: ${bookId}");
  
  // CLEANUP: Close existing docs/books
  try { app.documents.everyItem().close(SaveOptions.NO); } catch(e) {}
  try { app.books.everyItem().close(SaveOptions.NO); } catch(e) {}
  
  var originalInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  try {
    log("Opening book: " + INDB_PATH);
    var myBook = app.open(new File(INDB_PATH));
    
    log("Processing " + myBook.bookContents.length + " chapters...");
    
    // Open all chapters
    var openedDocs = [];
    for (var i = 0; i < myBook.bookContents.length; i++) {
        var content = myBook.bookContents[i];
        log("Opening chapter: " + content.name);
        try {
            var doc = app.open(content.fullName, false); // Open visible=false
            openedDocs.push(doc);
            
            // Relink images in this doc
            var links = doc.links;
            var relinkCount = 0;
            for (var j = 0; j < links.length; j++) {
                var link = links[j];
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
                         // log("Failed to relink " + linkName);
                    }
                }
            }
            log("  > Relinked " + relinkCount + " images.");
            
        } catch(e) {
            log("Failed to open/process chapter " + content.name + ": " + e.message);
        }
    }
    
    log("Configuring PDF export...");
    var basePresetName = "[High Quality Print]";
    var tempPresetName = "Temp_HighRes_${bookId}_" + Math.floor(Math.random() * 10000);
    
    var basePreset = app.pdfExportPresets.item(basePresetName);
    if (!basePreset.isValid) throw new Error("Base preset not found!");
    
    var myPreset = basePreset.duplicate();
    myPreset.name = tempPresetName;
    myPreset.colorBitmapSampling = Sampling.NONE;
    myPreset.grayscaleBitmapSampling = Sampling.NONE;
    myPreset.monochromeBitmapSampling = Sampling.NONE;
    myPreset.colorBitmapCompression = BitmapCompression.ZIP;
    myPreset.grayscaleBitmapCompression = BitmapCompression.ZIP;
    myPreset.monochromeBitmapCompression = MonoBitmapCompression.ZIP;
    
    log("Exporting BOOK to PDF: " + OUTPUT_PDF_PATH);
    // Export the whole book
    myBook.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF_PATH), false, myPreset);
    
    log("Export successful!");
    
    myPreset.remove();
    
    // Close all opened docs without saving
    log("Closing " + openedDocs.length + " documents...");
    while (openedDocs.length > 0) {
        var d = openedDocs.pop();
        d.close(SaveOptions.NO);
    }
    
    // Close book
    myBook.close(SaveOptions.NO);

  } catch (e) {
    log("FATAL ERROR: " + e.message + " line " + e.line);
  } finally {
    app.scriptPreferences.userInteractionLevel = originalInteractionLevel;
    log("Script finished.");
  }
})();
`;
}

async function processBook(book: MissingBook) {
  console.log(`\n========================================`);
  console.log(`Processing Missing Book: ${book.id}`);
  console.log(`========================================`);

  const linksPath = getLinksPath(book.path);
  if (!fs.existsSync(linksPath)) {
    console.error(`ERROR: Links folder not found at ${linksPath}`);
    return;
  }

  const bookImageDir = path.join(OUTPUT_BASE, `${book.id}_images`);
  if (!fs.existsSync(bookImageDir)) {
    fs.mkdirSync(bookImageDir, { recursive: true });
  }

  // 1. Convert Images (Skip if already done to save time?)
  // We'll run it anyway, sips is fast if files exist.
  console.log(`Converting images from ${linksPath}...`);
  try {
    const cmdConvert = `
      setopt +o nomatch
      cd "${linksPath}"
      for f in *.tif *.TIF *.psd *.PSD *.jpg *.JPG *.jpeg *.JPEG *.png *.PNG *.ai *.AI *.eps *.EPS; do
        if [ -f "$f" ]; then
           base="\${f%.*}"
           safeName=$(echo "$base" | sed 's/[^a-zA-Z0-9._-]/_/g')
           # Only convert if destination doesn't exist
           if [ ! -f "${bookImageDir}/$safeName.png" ]; then
             sips -s format png "$f" --out "${bookImageDir}/$safeName.png" 2>&1 | grep -v "Warning" | grep -v "^$" || true
           fi
        fi
      done
    `;
    execSync(cmdConvert, { stdio: 'inherit', shell: '/bin/zsh' });
  } catch (e) {
    console.error(`Error processing images for ${book.id}`, e);
  }

  // 2. Run InDesign Script
  const outputPdfPath = path.join(OUTPUT_BASE, `${book.id}_HIGHRES.pdf`);
  const logPath = path.join(OUTPUT_BASE, `${book.id}_log.txt`);
  const jsxPath = path.join(__dirname, `temp_relink_${book.id}.jsx`);

  console.log(`Generating JSX script (${book.type})...`);
  let jsxContent = '';
  if (book.type === 'INDD') {
      jsxContent = generateJsxIndd(book.id, book.path, bookImageDir, outputPdfPath, logPath);
  } else {
      jsxContent = generateJsxIndb(book.id, book.path, bookImageDir, outputPdfPath, logPath);
  }
  
  fs.writeFileSync(jsxPath, jsxContent);

  console.log(`Running InDesign export...`);
  try {
    // 2 hours timeout just in case
    execSync(`osascript -e 'with timeout of 7200 seconds' -e 'tell application "Adobe InDesign 2026" to do script POSIX file "${jsxPath}" language javascript' -e 'end timeout'`, { stdio: 'inherit' });
    console.log(`InDesign script completed.`);
  } catch (e) {
    console.error(`Error running InDesign script for ${book.id}`, e);
  }
}

async function main() {
  for (const book of MISSING_BOOKS) {
    await processBook(book);
  }
  console.log(`\n\nAll missing books processed.`);
}

main();
