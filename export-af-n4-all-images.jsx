// ============================================================
// EXPORT: All Images from A&F N4 (Including Chapter Openers)
// ============================================================
// Purpose:
// - Extract ALL images from A&F N4 book:
//   1. All linked image files (figures, diagrams, etc.)
//   2. Chapter opener pages exported as JPEG images
// - Save everything to a local folder
//
// Output:
// - Images folder: /Users/asafgafni/Desktop/InDesign/TestRun/extracted_images/af_n4/
//   - linked_images/ - copies of all linked image files
//   - chapter_openers/ - JPEG exports of chapter opener pages
//
// SAFE:
// - Opens the INDD read-only intent (no saves)
// - Does NOT modify document content
// - Closes without saving
//
// Run:
// - From InDesign: app.doScript(File("<this file>"), ScriptLanguage.JAVASCRIPT)
// ============================================================

#targetengine "session"

(function () {
  // ------------------------------------------------------------------
  // Non-interactive safety: suppress any InDesign modal dialogs
  // ------------------------------------------------------------------
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (eUI0) { __prevUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI1) {}
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (eUI2) {}
  }

  // --------------------------
  // Utilities
  // --------------------------
  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "_" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function ensureFolder(absPathFolder) {
    try {
      var f = Folder(absPathFolder);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  function sanitizeFileName(name) {
    var s = safeStr(name);
    // Remove path separators and other problematic characters
    s = s.replace(/[\/\\:*?"<>|]/g, "_");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    return s || "image";
  }

  // --------------------------
  // Main
  // --------------------------
  var INDD = File("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd");
  var STAMP = isoStamp();
  var BASE_OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/extracted_images/af_n4";
  var LINKED_IMAGES_DIR = BASE_OUTPUT_DIR + "/linked_images";
  var CHAPTER_OPENERS_DIR = BASE_OUTPUT_DIR + "/chapter_openers";
  var REPORT_NAME = "export_af_n4_all_images__" + STAMP + ".txt";

  var log = [];
  log.push("=== EXPORT ALL IMAGES FROM A&F N4 ===");
  log.push("Started: " + (new Date()).toString());
  log.push("INDD: " + INDD.fsName);
  log.push("Output: " + BASE_OUTPUT_DIR);
  log.push("");

  // Early breadcrumb
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  if (!INDD.exists) {
    log.push("ERROR: INDD not found.");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
    restoreUI();
    alert("ERROR: INDD not found at:\n" + INDD.fsName);
    return;
  }

  // Create output directories
  if (!ensureFolder(BASE_OUTPUT_DIR)) {
    log.push("ERROR: Failed to create base output directory.");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
    restoreUI();
    alert("ERROR: Failed to create output directory:\n" + BASE_OUTPUT_DIR);
    return;
  }
  ensureFolder(LINKED_IMAGES_DIR);
  ensureFolder(CHAPTER_OPENERS_DIR);

  // Open document
  var doc = null;
  try { doc = app.open(INDD, true); } catch (eOpen1) { 
    try { doc = app.open(INDD); } catch (eOpen2) { doc = null; } 
  }
  if (!doc) {
    log.push("ERROR: Failed to open INDD.");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
    restoreUI();
    alert("ERROR: Failed to open INDD.");
    return;
  }

  try { app.activeDocument = doc; } catch (eAct) {}

  // Hard gate: ensure we are on the intended document
  try {
    var openedDocName = safeStr(doc.name);
    var expectedNameRaw = safeStr(INDD.name);
    var expectedName = expectedNameRaw;
    try { expectedName = decodeURIComponent(expectedNameRaw); } catch (eDec) { 
      expectedName = expectedNameRaw.replace(/%20/g, " "); 
    }
    if (openedDocName !== expectedName) {
      throw new Error("Document name mismatch. Refusing to run.");
    }
  } catch (eGate) {
    try { doc.close(SaveOptions.NO); } catch (eClose0) {}
    log.push("ERROR: Active document mismatch. Refusing to run.");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
    restoreUI();
    alert("ERROR: Active document mismatch.");
    return;
  }

  log.push("Document opened successfully.");
  log.push("Total pages: " + doc.pages.length);
  log.push("");

  // ============================================================
  // PART 1: Extract all linked images
  // ============================================================
  log.push("=== PART 1: Extracting Linked Images ===");
  var linkedImages = [];
  var copiedCount = 0;
  var failedCount = 0;
  var skippedCount = 0;

  for (var li = 0; li < doc.links.length; li++) {
    var link = doc.links[li];
    var linkName = safeStr(link.name);
    
    // Only consider common image formats
    if (!(/\.(png|jpg|jpeg|tif|tiff|psd|ai|eps|pdf)$/i.test(linkName))) {
      skippedCount++;
      continue;
    }

    var linkPath = "";
    var sourceFile = null;
    
    // Try to get file path directly from link object (preferred method)
    try { 
      if (link.filePath && link.filePath.exists) {
        sourceFile = link.filePath;
        linkPath = sourceFile.fsName;
      }
    } catch (eLP) { 
      // filePath not available or error accessing it
    }
    
    // If filePath didn't work, try linkResourceURI and decode it
    if (!sourceFile || !linkPath) {
      try { 
        var uri = safeStr(link.linkResourceURI); 
        var decodedPath = "";
        
        // Handle file: URLs (can be file:/ or file://)
        // InDesign often returns file:/ (one slash) not file:// (two slashes)
        if (uri.indexOf("file:") === 0) {
          // Strip file: prefix and any leading slashes
          decodedPath = uri.replace(/^file:\/*/, "/");
          
          // Manual URL decoding (ExtendScript doesn't have decodeURIComponent)
          // Decode hex-encoded characters one by one
          var result = "";
          for (var i = 0; i < decodedPath.length; i++) {
            if (decodedPath.charAt(i) === "%" && i + 2 < decodedPath.length) {
              var hex = decodedPath.substring(i + 1, i + 3);
              var charCode = parseInt(hex, 16);
              if (!isNaN(charCode) && charCode >= 0 && charCode <= 255) {
                result += String.fromCharCode(charCode);
                i += 2;
              } else {
                result += decodedPath.charAt(i);
              }
            } else {
              result += decodedPath.charAt(i);
            }
          }
          linkPath = result;
          sourceFile = File(linkPath);
        } else if (uri && uri.length > 0) {
          // Not a file: URL, try using it directly
          linkPath = uri;
          sourceFile = File(uri);
        }
      } catch (eURI) { 
        linkPath = ""; 
        sourceFile = null;
      }
    }

    if (!linkPath || !sourceFile) {
      log.push("  Skipping " + linkName + " (no file path)");
      skippedCount++;
      continue;
    }

    // Check if file exists
    var fileExists = false;
    try {
      fileExists = sourceFile.exists;
    } catch (eExists) {
      // Try creating a new File object from the decoded path
      try {
        var testFile = File(linkPath);
        fileExists = testFile.exists;
        if (fileExists) sourceFile = testFile;
      } catch (eExists2) {
        fileExists = false;
      }
    }
    
    if (!fileExists) {
      // Log both decoded and original for debugging
      var displayPath = linkPath;
      if (linkPath.indexOf("file://") === 0) {
        displayPath = linkPath.replace(/^file:\/\//, "").replace(/%20/g, " ").replace(/%26/g, "&");
      }
      log.push("  WARNING: Source file not found: " + displayPath);
      failedCount++;
      continue;
    }

    // Create destination filename (preserve extension, sanitize name)
    var ext = "";
    try {
      var extMatch = linkName.match(/\.([^.]+)$/i);
      if (extMatch) ext = extMatch[1].toLowerCase();
    } catch (eExt) {}
    var baseName = sanitizeFileName(linkName.replace(/\.[^.]+$/, ""));
    var destFileName = baseName + (ext ? "." + ext : "");
    
    // Handle duplicates by appending number
    var destPath = LINKED_IMAGES_DIR + "/" + destFileName;
    var destFile = File(destPath);
    var counter = 1;
    while (destFile.exists) {
      destPath = LINKED_IMAGES_DIR + "/" + baseName + "_" + counter + (ext ? "." + ext : "");
      destFile = File(destPath);
      counter++;
    }

    // Copy the file
    try {
      sourceFile.copy(destFile);
      if (destFile.exists) {
        copiedCount++;
        linkedImages.push({
          originalName: linkName,
          originalPath: linkPath,
          copiedTo: destFile.fsName,
          fileName: destFile.name
        });
        if (copiedCount % 10 === 0) {
          log.push("  Copied " + copiedCount + " images...");
        }
      } else {
        failedCount++;
        log.push("  ERROR: Copy failed for " + linkName);
      }
    } catch (eCopy) {
      failedCount++;
      log.push("  ERROR copying " + linkName + ": " + safeStr(eCopy.message));
    }
  }

  log.push("");
  log.push("Linked images summary:");
  log.push("  Total linked files: " + doc.links.length);
  log.push("  Image files found: " + (copiedCount + failedCount + skippedCount));
  log.push("  Successfully copied: " + copiedCount);
  log.push("  Failed: " + failedCount);
  log.push("  Skipped (non-image): " + skippedCount);
  log.push("");

  // ============================================================
  // PART 2: Export chapter opener pages
  // ============================================================
  log.push("=== PART 2: Exporting Chapter Opener Pages ===");
  
  var chapterPages = [];
  var foundPageIndices = {};
  
  // Method 1: Find pages with chapter number/title paragraph styles
  for (var i = 0; i < doc.pages.length; i++) {
    var page = doc.pages[i];
    var pageItems = page.allPageItems;
    
    for (var j = 0; j < pageItems.length; j++) {
      var item = pageItems[j];
      if (item.constructor.name === "TextFrame") {
        try {
          var paras = item.paragraphs;
          for (var k = 0; k < paras.length; k++) {
            var para = paras[k];
            if (!para.appliedParagraphStyle) continue;
            var styleName = para.appliedParagraphStyle.name;
            
            // Look for chapter number or title styles
            if (styleName.indexOf("Hoofdstukcijfer") >= 0 || 
                styleName.indexOf("Hoofdstuktitel") >= 0 ||
                styleName.indexOf("hoofdstukcijfer") >= 0 ||
                styleName.indexOf("hoofdstuktitel") >= 0) {
              
              if (!foundPageIndices[i]) {
                var text = "";
                try {
                  text = para.contents.replace(/[\r\n\t]/g, ' ').substring(0, 30);
                } catch (eTxt) {}
                chapterPages.push({
                  pageIndex: i,
                  pageName: page.name,
                  source: "style:" + styleName,
                  preview: text
                });
                foundPageIndices[i] = true;
                log.push("  Found chapter page (style): " + page.name + " - " + text);
              }
              break;
            }
          }
        } catch (e) {
          // Skip problematic text frames
        }
      }
    }
  }
  
  // Method 2: Find pages using B-Master (typical chapter opener master)
  for (var i = 0; i < doc.pages.length; i++) {
    if (foundPageIndices[i]) continue;
    
    var page = doc.pages[i];
    if (page.appliedMaster) {
      var masterName = page.appliedMaster.name;
      if (masterName.indexOf("B-") === 0 || masterName.indexOf("B ") === 0) {
        chapterPages.push({
          pageIndex: i,
          pageName: page.name,
          source: "master:" + masterName,
          preview: "(B-Master page)"
        });
        foundPageIndices[i] = true;
        log.push("  Found chapter page (master): " + page.name + " - " + masterName);
      }
    }
  }
  
  // Sort by page index
  chapterPages.sort(function(a, b) { return a.pageIndex - b.pageIndex; });
  
  // Limit to first occurrence per chapter (chapters start on odd pages typically)
  var uniqueOpeners = [];
  var lastPageIndex = -100;
  for (var i = 0; i < chapterPages.length; i++) {
    var info = chapterPages[i];
    // Skip if this page is very close to the previous one (same chapter spread)
    if (info.pageIndex - lastPageIndex > 3) {
      uniqueOpeners.push(info);
      lastPageIndex = info.pageIndex;
    }
  }
  
  log.push("Found " + uniqueOpeners.length + " unique chapter opener pages.");
  log.push("");

  // Set export preferences
  var exportPrefs = app.jpegExportPreferences;
  exportPrefs.jpegQuality = JPEGOptionsQuality.MAXIMUM;
  exportPrefs.exportResolution = 150;
  exportPrefs.jpegColorSpace = JpegColorSpaceEnum.RGB;
  exportPrefs.antiAlias = true;
  exportPrefs.simulateOverprint = false;
  exportPrefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  
  // Export each chapter opener page
  var exportedOpeners = 0;
  var failedOpeners = 0;
  for (var i = 0; i < uniqueOpeners.length; i++) {
    var info = uniqueOpeners[i];
    var page = doc.pages[info.pageIndex];
    var chapterNum = i + 1;
    
    var outFile = new File(CHAPTER_OPENERS_DIR + "/chapter_" + chapterNum + "_opener.jpg");
    
    try {
      exportPrefs.pageString = page.name;
      doc.exportFile(ExportFormat.JPG, outFile, false);
      if (outFile.exists) {
        exportedOpeners++;
        log.push("  Exported chapter " + chapterNum + ": " + outFile.name + " (page " + page.name + ")");
      } else {
        failedOpeners++;
        log.push("  ERROR: Export failed for chapter " + chapterNum);
      }
    } catch (e) {
      failedOpeners++;
      log.push("  ERROR exporting page " + page.name + ": " + safeStr(e.message));
    }
  }

  log.push("");
  log.push("Chapter openers summary:");
  log.push("  Found: " + uniqueOpeners.length);
  log.push("  Successfully exported: " + exportedOpeners);
  log.push("  Failed: " + failedOpeners);
  log.push("");

  // ============================================================
  // Finalize
  // ============================================================
  try { doc.close(SaveOptions.NO); } catch (eCloseAll) {}
  
  log.push("=== SUMMARY ===");
  log.push("Linked images copied: " + copiedCount);
  log.push("Chapter openers exported: " + exportedOpeners);
  log.push("Output location: " + BASE_OUTPUT_DIR);
  log.push("");
  log.push("Completed: " + (new Date()).toString());

  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  
  var summaryMsg = "Image extraction complete!\n\n";
  summaryMsg += "Linked images: " + copiedCount + " copied\n";
  summaryMsg += "Chapter openers: " + exportedOpeners + " exported\n";
  summaryMsg += "\nOutput location:\n" + BASE_OUTPUT_DIR + "\n\n";
  summaryMsg += "Report saved to Desktop.";
  
  alert(summaryMsg);
})();

