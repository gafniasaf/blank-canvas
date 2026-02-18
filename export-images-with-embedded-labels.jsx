// ============================================================
// EXPORT: Images with Embedded Labels (Flattened)
// ============================================================
// Purpose:
// - For all books, find images and their associated labels/callouts
// - Export each image WITH its overlapping labels as a single PNG
// - EXCLUDES caption text below the image (e.g., "Afbeelding 1.2: ...")
//
// Output:
// - Images saved to: extracted_images/<book>/embedded_figures/
//
// SAFE:
// - Opens each INDD read-only (no saves)
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
  function trimStr(s) { try { return safeStr(s).replace(/^\s+|\s+$/g, ""); } catch (e) { return safeStr(s); } }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function ensureFolder(absDir) {
    try {
      var f = Folder(absDir);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) { return false; }
  }

  function sanitizeFileName(name) {
    var s = safeStr(name);
    s = s.replace(/[\/\\:*?"<>|]/g, "_");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    return s || "figure";
  }

  function normalizeText(s) {
    var t = safeStr(s || "");
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/\u00AD/g, ""); } catch (e) {}
    try { t = t.replace(/\r\n/g, "\n"); } catch (e) {}
    try { t = t.replace(/\r/g, "\n"); } catch (e) {}
    try { t = t.replace(/[\u0000-\u001F]/g, " "); } catch (e) {}
    try { t = t.replace(/[ \t]+/g, " "); } catch (e) {}
    return trimStr(t);
  }

  function wordCount(s) {
    var t = normalizeText(s || "");
    if (!t) return 0;
    var parts = t.split(/\s+/);
    var c = 0;
    for (var i = 0; i < parts.length; i++) if (trimStr(parts[i])) c++;
    return c;
  }

  function boundsUnion(a, b) {
    return [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3])
    ];
  }

  function boundsIntersect(a, b) {
    return !(a[3] < b[1] || a[1] > b[3] || a[2] < b[0] || a[0] > b[2]);
  }

  function boundsExpand(b, pad) {
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  }

  // Check if text frame is a caption (to exclude)
  function isCaptionFrame(tf) {
    var styleName = "";
    try {
      if (tf.paragraphs && tf.paragraphs.length) styleName = safeStr(tf.paragraphs[0].appliedParagraphStyle.name);
    } catch (e) { styleName = ""; }
    var sn = styleName.toLowerCase();
    
    // Caption-like styles
    if (sn.indexOf("_annotation") !== -1) return true;
    if (sn.indexOf("bijschrift") !== -1) return true;
    if (sn.indexOf("caption") !== -1) return true;
    if (sn.indexOf("onderschrift") !== -1) return true;
    
    // Check text content
    var t = "";
    try { t = normalizeText(tf.contents); } catch (e) { t = ""; }
    
    // Caption starts with "Afbeelding X.Y" or "Figuur X.Y"
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(t)) return true;
    
    // Long text (more than 20 words) is likely a caption, not a label
    if (wordCount(t) > 20) return true;
    
    return false;
  }

  // Check if text frame is a valid label/callout (to include)
  function isLabelFrame(tf, imageBounds) {
    // Must have content
    var t = "";
    try { t = normalizeText(tf.contents); } catch (e) { t = ""; }
    if (!t) return false;
    
    // Labels are typically short (1-10 words)
    var wc = wordCount(t);
    if (wc > 15) return false;
    
    // Single line only (labels don't span multiple lines usually)
    if (t.indexOf("\n") !== -1 && wc > 5) return false;
    
    // Get bounds
    var tfBounds = null;
    try { tfBounds = tf.geometricBounds; } catch (e) { return false; }
    if (!tfBounds) return false;
    
    // Must be within reasonable distance of image (50pt margin)
    var expandedBounds = boundsExpand(imageBounds, 50);
    if (!boundsIntersect(tfBounds, expandedBounds)) return false;
    
    // Exclude if it's a caption
    if (isCaptionFrame(tf)) return false;
    
    return true;
  }

  // Get top-most group container
  function topMostGroup(item) {
    var cur = item;
    try {
      while (cur && cur.parent && cur.parent.constructor && safeStr(cur.parent.constructor.name) === "Group") {
        cur = cur.parent;
      }
    } catch (e) {}
    return cur || item;
  }

  // Export page items as single PNG
  function exportPageItemsToPng(pageItems, outAbsPath, resolutionPpi) {
    if (!pageItems || !pageItems.length) return false;

    // Compute union bounds
    var ub = null;
    for (var i = 0; i < pageItems.length; i++) {
      var b = null;
      try { b = pageItems[i].geometricBounds; } catch (e) { b = null; }
      if (!b) continue;
      if (!ub) ub = [b[0], b[1], b[2], b[3]];
      else ub = boundsUnion(ub, b);
    }
    if (!ub) return false;

    var padPt = 12;
    var h = Math.max(10, ub[2] - ub[0]);
    var w = Math.max(10, ub[3] - ub[1]);

    var outFile = File(outAbsPath);
    try { if (outFile.exists) outFile.remove(); } catch (e) {}
    try { if (outFile.parent && !outFile.parent.exists) outFile.parent.create(); } catch (e) {}

    var tmp = null;
    try { tmp = app.documents.add(); } catch (e) { tmp = null; }
    if (!tmp) return false;

    try {
      tmp.documentPreferences.facingPages = false;
      tmp.documentPreferences.pagesPerDocument = 1;
      try {
        tmp.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        tmp.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        tmp.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
      } catch (e) {}
      tmp.documentPreferences.pageHeight = (h + padPt * 2) + "pt";
      tmp.documentPreferences.pageWidth = (w + padPt * 2) + "pt";
    } catch (e) {}

    var p0 = null;
    try { p0 = tmp.pages[0]; } catch (e) { p0 = null; }
    if (!p0) { try { tmp.close(SaveOptions.NO); } catch (e) {} return false; }

    // Duplicate items
    var dups = [];
    for (var di = 0; di < pageItems.length; di++) {
      var dup = null;
      try { dup = pageItems[di].duplicate(p0); } catch (e) { dup = null; }
      if (dup) dups.push(dup);
    }
    if (!dups.length) { try { tmp.close(SaveOptions.NO); } catch (e) {} return false; }

    // Translate all duplicates
    var dx = padPt - ub[1];
    var dy = padPt - ub[0];
    for (var mi = 0; mi < dups.length; mi++) {
      try { dups[mi].move(undefined, [dx, dy]); } catch (e) {}
    }

    // Export
    try { app.pngExportPreferences.exportResolution = resolutionPpi; } catch (e) {}
    try { app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH; } catch (e) {}
    try { app.pngExportPreferences.transparentBackground = true; } catch (e) {}

    var ok = false;
    try {
      try { tmp.exportFile(ExportFormat.PNG_FORMAT, outFile, false); ok = true; } catch (e1) {}
      if (!ok) { try { tmp.exportFile(ExportFormat.PNG, outFile, false); ok = true; } catch (e2) {} }
    } catch (e) { ok = false; }

    try { tmp.close(SaveOptions.NO); } catch (e) {}
    try { return ok && outFile.exists; } catch (e) { return ok; }
  }

  // --------------------------
  // Book definitions
  // --------------------------
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var OUTPUT_BASE = "/Users/asafgafni/Desktop/InDesign/TestRun/extracted_images";

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
      files: (function() {
        var arr = [];
        for (var i = 1; i <= 12; i++) {
          var num = i < 10 ? "0" + i : String(i);
          arr.push(BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH" + num + "_03.2024.indd");
        }
        return arr;
      })()
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
  var REPORT_NAME = "export_embedded_labels__" + STAMP + ".txt";
  var PPI = 300;

  var log = [];
  log.push("=== EXPORT IMAGES WITH EMBEDDED LABELS ===");
  log.push("Started: " + (new Date()).toString());
  log.push("Books to process: " + BOOKS.length);
  log.push("Resolution: " + PPI + " PPI");
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  ensureFolder(OUTPUT_BASE);

  var totalExported = 0;
  var totalSkipped = 0;
  var bookResults = [];

  // Process each book
  for (var bi = 0; bi < BOOKS.length; bi++) {
    var book = BOOKS[bi];
    log.push("=== BOOK " + (bi + 1) + "/" + BOOKS.length + ": " + book.displayName + " ===");

    var bookOutputDir = OUTPUT_BASE + "/" + book.name;
    var embeddedDir = bookOutputDir + "/embedded_figures";
    ensureFolder(bookOutputDir);
    ensureFolder(embeddedDir);

    var bookExported = 0;
    var bookSkipped = 0;
    var processedImages = {}; // Track processed images by link path
    var figureCounter = 0;

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

      // Force POINTS for consistent bounds
      try {
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
      } catch (e) {}

      // Find all linked images
      for (var li = 0; li < doc.links.length; li++) {
        var link = doc.links[li];
        var linkName = safeStr(link.name);

        if (!(/\.(png|jpg|jpeg|tif|tiff|psd)$/i.test(linkName))) continue;

        // Get the image frame
        var graphic = null;
        try { graphic = link.parent; } catch (e) { graphic = null; }
        var frame = null;
        try { frame = graphic ? graphic.parent : null; } catch (e) { frame = null; }
        if (!frame) continue;

        var page = null;
        try { page = frame.parentPage; } catch (e) { page = null; }
        if (!page) continue;

        // Get link path for deduplication
        var linkPath = "";
        try { linkPath = safeStr(link.linkResourceURI || link.filePath || linkName); } catch (e) {}
        if (processedImages[linkPath]) continue;
        processedImages[linkPath] = true;

        // Get image bounds
        var imageBounds = null;
        try { imageBounds = frame.geometricBounds; } catch (e) { continue; }
        if (!imageBounds) continue;

        // Get the top-most group if image is in a group
        var topItem = topMostGroup(frame);
        var topBounds = null;
        try { topBounds = topItem.geometricBounds; } catch (e) { topBounds = imageBounds; }

        // Collect items to export: the image/group + overlapping labels
        var itemsToExport = [];
        var seenIds = {};

        function addItem(it) {
          if (!it) return;
          var id = null;
          try { id = it.id; } catch (e) { id = null; }
          var k = id !== null ? String(id) : null;
          if (k && seenIds[k]) return;
          if (k) seenIds[k] = true;
          itemsToExport.push(it);
        }

        // Add the main image/group
        addItem(topItem);

        // Find overlapping labels on the same page
        var pageItems = [];
        try { pageItems = page.allPageItems; } catch (e) { pageItems = []; }

        for (var pi = 0; pi < pageItems.length; pi++) {
          var pItem = pageItems[pi];
          if (!pItem) continue;

          var pItemTop = topMostGroup(pItem);
          if (pItemTop === topItem) continue;

          var ctor = "";
          try { ctor = safeStr(pItem.constructor.name); } catch (e) { ctor = ""; }

          // Include lines, polygons, ovals (arrows, pointers)
          if (ctor === "GraphicLine" || ctor === "Polygon" || ctor === "Oval" || ctor === "Rectangle") {
            var pBounds = null;
            try { pBounds = pItem.geometricBounds; } catch (e) { continue; }
            var expandedImage = boundsExpand(topBounds, 30);
            if (boundsIntersect(pBounds, expandedImage)) {
              addItem(pItemTop);
            }
          }
          // Include short text frames (labels)
          else if (ctor === "TextFrame") {
            if (isLabelFrame(pItem, topBounds)) {
              addItem(pItemTop);
            }
          }
          // Include groups that overlap
          else if (ctor === "Group") {
            var gBounds = null;
            try { gBounds = pItem.geometricBounds; } catch (e) { continue; }
            var expandedImage2 = boundsExpand(topBounds, 30);
            if (boundsIntersect(gBounds, expandedImage2)) {
              // Check if group contains labels/lines, not body text
              var gItems = [];
              try { gItems = pItem.allPageItems; } catch (e) { gItems = []; }
              var hasLabel = false;
              var hasLongText = false;
              for (var gi = 0; gi < gItems.length; gi++) {
                var gIt = gItems[gi];
                var gCtor = "";
                try { gCtor = safeStr(gIt.constructor.name); } catch (e) { gCtor = ""; }
                if (gCtor === "GraphicLine" || gCtor === "Polygon") hasLabel = true;
                if (gCtor === "TextFrame") {
                  var gText = "";
                  try { gText = normalizeText(gIt.contents); } catch (e) { gText = ""; }
                  if (wordCount(gText) <= 10) hasLabel = true;
                  if (wordCount(gText) > 30) hasLongText = true;
                }
              }
              if (hasLabel && !hasLongText) {
                addItem(pItem);
              }
            }
          }
        }

        // Export if we have items
        if (itemsToExport.length > 0) {
          figureCounter++;
          var baseName = sanitizeFileName(linkName.replace(/\.[^.]+$/, ""));
          var outPath = embeddedDir + "/" + baseName + "_embedded.png";
          
          // Handle duplicates
          var outFile = File(outPath);
          var counter = 1;
          while (outFile.exists) {
            outPath = embeddedDir + "/" + baseName + "_embedded_" + counter + ".png";
            outFile = File(outPath);
            counter++;
          }

          var ok = false;
          try { ok = exportPageItemsToPng(itemsToExport, outPath, PPI); } catch (e) { ok = false; }

          if (ok) {
            bookExported++;
            if (bookExported % 20 === 0) {
              log.push("    Exported " + bookExported + " figures...");
              writeTextToDesktop(REPORT_NAME, log.join("\n"));
            }
          } else {
            bookSkipped++;
          }
        }
      }

      // Close document
      try { doc.close(SaveOptions.NO); } catch (e) {}
    }

    log.push("  Embedded figures exported: " + bookExported);
    log.push("  Skipped: " + bookSkipped);
    log.push("");

    totalExported += bookExported;
    totalSkipped += bookSkipped;
    bookResults.push({ name: book.displayName, exported: bookExported, skipped: bookSkipped });

    writeTextToDesktop(REPORT_NAME, log.join("\n"));
  }

  // Final summary
  log.push("=== FINAL SUMMARY ===");
  log.push("");
  for (var ri = 0; ri < bookResults.length; ri++) {
    var r = bookResults[ri];
    log.push(r.name + ": " + r.exported + " embedded figures");
  }
  log.push("");
  log.push("TOTAL: " + totalExported + " embedded figures exported");
  log.push("Output location: " + OUTPUT_BASE + "/<book>/embedded_figures/");
  log.push("");
  log.push("Completed: " + (new Date()).toString());

  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();

  var summaryMsg = "Embedded figures extraction complete!\n\n";
  summaryMsg += "Total embedded figures: " + totalExported + "\n";
  summaryMsg += "\nOutput location:\n" + OUTPUT_BASE + "/<book>/embedded_figures/\n\n";
  summaryMsg += "Report saved to Desktop.";

  alert(summaryMsg);
})();










