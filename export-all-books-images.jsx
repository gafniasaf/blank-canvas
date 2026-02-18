// ============================================================
// EXPORT: All Images from ALL Books in Downloads
// ============================================================
// Purpose:
// - Extract ALL images from all MBO books:
//   1. All linked image files (figures, diagrams, etc.)
//   2. Chapter opener pages exported as JPEG images
// - Save everything in organized folders per book
//
// Output:
// - Images folder: /Users/asafgafni/Desktop/InDesign/TestRun/extracted_images/
//   - <book_name>/linked_images/
//   - <book_name>/chapter_openers/
//
// SAFE:
// - Opens each INDD read-only intent (no saves)
// - Does NOT modify document content
// - Closes without saving
// ============================================================

#targetengine "session"

(function () {
  // ------------------------------------------------------------------
  // Non-interactive safety
  // ------------------------------------------------------------------
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) { __prevUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (e) {}
  }

  // --------------------------
  // Utilities
  // --------------------------
  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
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
    s = s.replace(/[\/\\:*?"<>|]/g, "_");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    return s || "image";
  }

  function sanitizeFolderName(name) {
    var s = safeStr(name);
    // Remove special chars but keep spaces for readability
    s = s.replace(/[\/\\:*?"<>|]/g, "");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    return s || "book";
  }

  // --------------------------
  // Book definitions
  // --------------------------
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var OUTPUT_BASE = "/Users/asafgafni/Desktop/InDesign/TestRun/extracted_images";
  
  // Define all books with their INDD files
  var BOOKS = [
    {
      name: "af_n3",
      displayName: "MBO A&F 3",
      files: [BASE_DIR + "/MBO A&F 3_9789083251363_03/MBO A&F 3_9789083251363_03.2024.indd"]
    },
    {
      name: "af_n4",
      displayName: "MBO A&F 4",
      files: [BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd"]
    },
    {
      name: "communicatie",
      displayName: "MBO Communicatie",
      files: [BASE_DIR + "/MBO Communicatie_9789083251387_03/MBO Communicatie_9789083251387_03.2024.indd"]
    },
    {
      name: "methodisch_werken",
      displayName: "MBO Methodisch werken",
      files: [BASE_DIR + "/MBO Methodisch werken_9789083251394_03/MBO Methodisch werken_9789083251394_03.2024.indd"]
    },
    {
      name: "pathologie_n4",
      displayName: "MBO Pathologie nivo 4",
      files: [
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH01_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH02_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH03_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH04_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH05_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH06_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH07_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH08_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH09_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH10_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH11_03.2024.indd",
        BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH12_03.2024.indd"
      ]
    },
    {
      name: "persoonlijke_verzorging",
      displayName: "MBO Persoonlijke Verzorging",
      files: [BASE_DIR + "/MBO Persoonlijke Verzorging_9789083412023_03/MBO Persoonlijke Verzorging_9789083412023_03.2024.indd"]
    },
    {
      name: "klinisch_redeneren",
      displayName: "MBO Praktijkgestuurd klinisch redeneren",
      files: [BASE_DIR + "/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd"]
    },
    {
      name: "wetgeving",
      displayName: "MBO Wetgeving",
      files: [BASE_DIR + "/MBO Wetgeving_9789083412061_03/MBO Wetgeving_9789083412061_03.2024.indd"]
    },
    {
      name: "vth_n3",
      displayName: "MBO VTH nivo 3",
      files: (function() {
        var arr = [];
        for (var i = 1; i <= 21; i++) {
          var num = i < 10 ? "0" + i : String(i);
          arr.push(BASE_DIR + "/_MBO VTH nivo 3_9789083412047_03/" + num + "-VTH_Niveau-3_03.2024.indd");
        }
        return arr;
      })()
    },
    {
      name: "vth_n4",
      displayName: "MBO VTH nivo 4",
      files: (function() {
        var arr = [];
        for (var i = 1; i <= 30; i++) {
          var num = i < 10 ? "0" + i : String(i);
          arr.push(BASE_DIR + "/_MBO VTH nivo 4_9789083412054_03/" + num + "-VTH_Combined_03.2024.indd");
        }
        return arr;
      })()
    }
  ];

  var STAMP = isoStamp();
  var REPORT_NAME = "export_all_books_images__" + STAMP + ".txt";

  var log = [];
  log.push("=== EXPORT ALL IMAGES FROM ALL BOOKS ===");
  log.push("Started: " + (new Date()).toString());
  log.push("Books to process: " + BOOKS.length);
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  // Create base output directory
  ensureFolder(OUTPUT_BASE);

  var totalLinked = 0;
  var totalOpeners = 0;
  var bookResults = [];

  // Process each book
  for (var bi = 0; bi < BOOKS.length; bi++) {
    var book = BOOKS[bi];
    log.push("=== BOOK " + (bi + 1) + "/" + BOOKS.length + ": " + book.displayName + " ===");
    
    var bookOutputDir = OUTPUT_BASE + "/" + book.name;
    var linkedDir = bookOutputDir + "/linked_images";
    var openersDir = bookOutputDir + "/chapter_openers";
    
    ensureFolder(bookOutputDir);
    ensureFolder(linkedDir);
    ensureFolder(openersDir);
    
    var bookLinked = 0;
    var bookOpeners = 0;
    var processedLinks = {}; // Track already copied files to avoid duplicates
    
    // Process each file for this book
    for (var fi = 0; fi < book.files.length; fi++) {
      var inddPath = book.files[fi];
      var inddFile = File(inddPath);
      
      if (!inddFile.exists) {
        log.push("  Skipping (not found): " + inddPath);
        continue;
      }
      
      log.push("  Processing: " + inddFile.name);
      
      var doc = null;
      try { doc = app.open(inddFile, true); } catch (e1) { 
        try { doc = app.open(inddFile); } catch (e2) { doc = null; } 
      }
      if (!doc) {
        log.push("    ERROR: Failed to open");
        continue;
      }
      
      try { app.activeDocument = doc; } catch (e) {}
      
      // ---- Extract linked images ----
      for (var li = 0; li < doc.links.length; li++) {
        var link = doc.links[li];
        var linkName = safeStr(link.name);
        
        if (!(/\.(png|jpg|jpeg|tif|tiff|psd|ai|eps|pdf)$/i.test(linkName))) continue;
        
        var linkPath = "";
        var sourceFile = null;
        
        // Try filePath first
        try { 
          if (link.filePath && link.filePath.exists) {
            sourceFile = link.filePath;
            linkPath = sourceFile.fsName;
          }
        } catch (e) {}
        
        // Try linkResourceURI if filePath didn't work
        if (!sourceFile || !linkPath) {
          try { 
            var uri = safeStr(link.linkResourceURI); 
            if (uri.indexOf("file:") === 0) {
              var decodedPath = uri.replace(/^file:\/*/, "/");
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
            }
          } catch (e) {}
        }
        
        if (!sourceFile || !linkPath) continue;
        
        // Skip if already processed
        if (processedLinks[linkPath]) continue;
        processedLinks[linkPath] = true;
        
        // Check if file exists
        var fileExists = false;
        try { fileExists = sourceFile.exists; } catch (e) {}
        if (!fileExists) continue;
        
        // Create destination filename
        var ext = "";
        try { var extMatch = linkName.match(/\.([^.]+)$/i); if (extMatch) ext = extMatch[1].toLowerCase(); } catch (e) {}
        var baseName = sanitizeFileName(linkName.replace(/\.[^.]+$/, ""));
        var destFileName = baseName + (ext ? "." + ext : "");
        
        var destPath = linkedDir + "/" + destFileName;
        var destFile = File(destPath);
        var counter = 1;
        while (destFile.exists) {
          destPath = linkedDir + "/" + baseName + "_" + counter + (ext ? "." + ext : "");
          destFile = File(destPath);
          counter++;
        }
        
        // Copy the file
        try {
          sourceFile.copy(destFile);
          if (destFile.exists) bookLinked++;
        } catch (e) {}
      }
      
      // ---- Extract chapter openers ----
      var foundPageIndices = {};
      for (var pi = 0; pi < doc.pages.length; pi++) {
        var page = doc.pages[pi];
        var pageItems = page.allPageItems;
        
        for (var pj = 0; pj < pageItems.length; pj++) {
          var item = pageItems[pj];
          if (item.constructor.name === "TextFrame") {
            try {
              var paras = item.paragraphs;
              for (var pk = 0; pk < paras.length; pk++) {
                var para = paras[pk];
                if (!para.appliedParagraphStyle) continue;
                var styleName = para.appliedParagraphStyle.name;
                
                if (styleName.indexOf("Hoofdstukcijfer") >= 0 || 
                    styleName.indexOf("Hoofdstuktitel") >= 0 ||
                    styleName.indexOf("hoofdstukcijfer") >= 0 ||
                    styleName.indexOf("hoofdstuktitel") >= 0 ||
                    styleName.indexOf("Chapter") >= 0) {
                  if (!foundPageIndices[pi]) {
                    foundPageIndices[pi] = true;
                  }
                  break;
                }
              }
            } catch (e) {}
          }
        }
      }
      
      // Also check for B-Master pages
      for (var pi = 0; pi < doc.pages.length; pi++) {
        if (foundPageIndices[pi]) continue;
        var page = doc.pages[pi];
        if (page.appliedMaster) {
          var masterName = page.appliedMaster.name;
          if (masterName.indexOf("B-") === 0 || masterName.indexOf("B ") === 0) {
            foundPageIndices[pi] = true;
          }
        }
      }
      
      // Export chapter openers
      var chapterIndices = [];
      for (var pi in foundPageIndices) if (foundPageIndices.hasOwnProperty(pi)) chapterIndices.push(parseInt(pi, 10));
      chapterIndices.sort(function(a, b) { return a - b; });
      
      // Filter to unique openers (skip pages close together)
      var uniqueOpeners = [];
      var lastIdx = -100;
      for (var ci = 0; ci < chapterIndices.length; ci++) {
        if (chapterIndices[ci] - lastIdx > 3) {
          uniqueOpeners.push(chapterIndices[ci]);
          lastIdx = chapterIndices[ci];
        }
      }
      
      if (uniqueOpeners.length > 0) {
        var exportPrefs = app.jpegExportPreferences;
        exportPrefs.jpegQuality = JPEGOptionsQuality.MAXIMUM;
        exportPrefs.exportResolution = 150;
        exportPrefs.jpegColorSpace = JpegColorSpaceEnum.RGB;
        exportPrefs.antiAlias = true;
        exportPrefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
        
        for (var ui = 0; ui < uniqueOpeners.length; ui++) {
          var pageIdx = uniqueOpeners[ui];
          var page = doc.pages[pageIdx];
          var chapterNum = bookOpeners + ui + 1;
          
          var outFile = new File(openersDir + "/chapter_" + chapterNum + "_opener.jpg");
          
          try {
            exportPrefs.pageString = page.name;
            doc.exportFile(ExportFormat.JPG, outFile, false);
            if (outFile.exists) bookOpeners++;
          } catch (e) {}
        }
      }
      
      // Close document
      try { doc.close(SaveOptions.NO); } catch (e) {}
    }
    
    log.push("  Linked images: " + bookLinked);
    log.push("  Chapter openers: " + bookOpeners);
    log.push("");
    
    totalLinked += bookLinked;
    totalOpeners += bookOpeners;
    bookResults.push({ name: book.displayName, linked: bookLinked, openers: bookOpeners });
    
    // Save progress
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
  }

  // Final summary
  log.push("=== FINAL SUMMARY ===");
  log.push("");
  for (var ri = 0; ri < bookResults.length; ri++) {
    var r = bookResults[ri];
    log.push(r.name + ": " + r.linked + " linked, " + r.openers + " openers");
  }
  log.push("");
  log.push("TOTAL: " + totalLinked + " linked images, " + totalOpeners + " chapter openers");
  log.push("Output location: " + OUTPUT_BASE);
  log.push("");
  log.push("Completed: " + (new Date()).toString());

  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  
  var summaryMsg = "All books image extraction complete!\n\n";
  summaryMsg += "Total linked images: " + totalLinked + "\n";
  summaryMsg += "Total chapter openers: " + totalOpeners + "\n";
  summaryMsg += "\nOutput location:\n" + OUTPUT_BASE + "\n\n";
  summaryMsg += "Report saved to Desktop.";
  
  alert(summaryMsg);
})();










