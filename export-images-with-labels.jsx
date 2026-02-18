// ============================================================
// EXPORT IMAGES WITH EMBEDDED TEXT LABELS
// ============================================================
// Finds images and their associated text labels (nearby text frames)
// and exports them as a single flattened PNG
// ============================================================

#targetengine "session"

(function () {
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (e) {}
  }

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

  // Get bounds [top, left, bottom, right] in points
  function getBounds(item) {
    try { return item.geometricBounds; } catch (e) { return null; }
  }

  // Check if two bounds overlap or are close (within margin)
  function boundsOverlapOrNear(b1, b2, margin) {
    if (!b1 || !b2) return false;
    // Expand b1 by margin
    var t1 = b1[0] - margin;
    var l1 = b1[1] - margin;
    var bt1 = b1[2] + margin;
    var r1 = b1[3] + margin;
    // Check overlap
    return !(b2[2] < t1 || b2[0] > bt1 || b2[3] < l1 || b2[1] > r1);
  }

  // Merge multiple bounds into one
  function mergeBounds(boundsArray) {
    if (!boundsArray || boundsArray.length === 0) return null;
    var t = boundsArray[0][0];
    var l = boundsArray[0][1];
    var b = boundsArray[0][2];
    var r = boundsArray[0][3];
    for (var i = 1; i < boundsArray.length; i++) {
      var bb = boundsArray[i];
      if (bb[0] < t) t = bb[0];
      if (bb[1] < l) l = bb[1];
      if (bb[2] > b) b = bb[2];
      if (bb[3] > r) r = bb[3];
    }
    return [t, l, b, r];
  }

  // Check if text frame looks like a label (short text, near image)
  function isLabelTextFrame(tf) {
    try {
      var content = safeStr(tf.contents);
      // Labels are typically short (< 100 chars) and don't have multiple paragraphs
      if (content.length > 150) return false;
      // Skip if it looks like a caption (starts with "Afbeelding")
      if (content.indexOf("Afbeelding") === 0) return false;
      // Skip if it's too long (body text)
      var lines = content.split(/[\r\n]/);
      if (lines.length > 4) return false;
      return true;
    } catch (e) { return false; }
  }

  // Check if item is a line/connector
  function isLineOrPath(item) {
    try {
      var ctor = safeStr(item.constructor.name);
      return (ctor === "GraphicLine" || ctor === "Polygon" || ctor === "Oval" || ctor === "Rectangle");
    } catch (e) { return false; }
  }

  // Get image name from graphic
  function getImageName(graphic) {
    try {
      var link = graphic.itemLink;
      if (link) return safeStr(link.name).replace(/\.[^.]+$/, "");
    } catch (e) {}
    return "";
  }

  // Export a region of the page as PNG
  function exportRegionToPng(doc, page, bounds, outPath, ppi) {
    var padPt = 12;
    var t = bounds[0] - padPt;
    var l = bounds[1] - padPt;
    var b = bounds[2] + padPt;
    var r = bounds[3] + padPt;
    
    var h = Math.max(20, b - t);
    var w = Math.max(20, r - l);

    var outFile = File(outPath);
    try { if (outFile.exists) outFile.remove(); } catch (e) {}
    try { if (outFile.parent && !outFile.parent.exists) outFile.parent.create(); } catch (e) {}

    // Create temp document
    var tmp = null;
    try { tmp = app.documents.add(); } catch (e) { return false; }

    try {
      tmp.documentPreferences.facingPages = false;
      tmp.documentPreferences.pagesPerDocument = 1;
      tmp.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
      tmp.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
      tmp.documentPreferences.pageHeight = h + "pt";
      tmp.documentPreferences.pageWidth = w + "pt";
    } catch (e) {}

    var p0 = null;
    try { p0 = tmp.pages[0]; } catch (e) {}
    if (!p0) { try { tmp.close(SaveOptions.NO); } catch (e) {} return false; }

    // Collect all items that overlap with the bounds on this page
    var itemsToCopy = [];
    var pageItems = [];
    try { pageItems = page.allPageItems; } catch (e) {}

    for (var i = 0; i < pageItems.length; i++) {
      var item = pageItems[i];
      var itemBounds = getBounds(item);
      if (!itemBounds) continue;
      
      // Check if item overlaps with our region
      if (boundsOverlapOrNear(bounds, itemBounds, 5)) {
        // Skip the page itself or spreads
        var ctor = "";
        try { ctor = safeStr(item.constructor.name); } catch (e) {}
        if (ctor === "Page" || ctor === "Spread") continue;
        itemsToCopy.push(item);
      }
    }

    // Duplicate items to temp doc
    var copied = 0;
    for (var j = 0; j < itemsToCopy.length; j++) {
      try {
        var dup = itemsToCopy[j].duplicate(p0);
        // Move to correct position
        var origBounds = getBounds(itemsToCopy[j]);
        if (origBounds && dup) {
          var offsetX = padPt - l;
          var offsetY = padPt - t;
          dup.move(undefined, [origBounds[1] - l + padPt - origBounds[1], origBounds[0] - t + padPt - origBounds[0]]);
          copied++;
        }
      } catch (e) {}
    }

    if (copied === 0) {
      try { tmp.close(SaveOptions.NO); } catch (e) {}
      return false;
    }

    // Export
    try { app.pngExportPreferences.exportResolution = ppi; } catch (e) {}
    try { app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH; } catch (e) {}
    try { app.pngExportPreferences.transparentBackground = true; } catch (e) {}

    var ok = false;
    try {
      try { tmp.exportFile(ExportFormat.PNG_FORMAT, outFile, false); ok = true; } catch (e1) {}
      if (!ok) { try { tmp.exportFile(ExportFormat.PNG, outFile, false); ok = true; } catch (e2) {} }
    } catch (e) {}

    try { tmp.close(SaveOptions.NO); } catch (e) {}
    return ok;
  }

  // Main: Process ONE book for testing - A&F N4
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var OUTPUT_BASE = "/Users/asafgafni/Desktop/InDesign/TestRun/extracted_images";
  var STAMP = isoStamp();
  var REPORT_NAME = "export_with_labels__" + STAMP + ".txt";
  var PPI = 300;
  var LABEL_MARGIN = 100; // Points - how far to look for labels

  var log = [];
  log.push("=== EXPORT IMAGES WITH TEXT LABELS ===");
  log.push("Started: " + (new Date()).toString());
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  // Just process A&F N4 for now as a test
  var bookName = "af_n4";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  
  var bookOutputDir = OUTPUT_BASE + "/" + bookName;
  var labelsDir = bookOutputDir + "/with_labels";
  ensureFolder(bookOutputDir);
  ensureFolder(labelsDir);

  var inddFile = File(inddPath);
  if (!inddFile.exists) {
    log.push("ERROR: File not found: " + inddPath);
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
    restoreUI();
    return;
  }

  log.push("Opening: " + inddFile.name);
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e1) {
    try { doc = app.open(inddFile); } catch (e2) { doc = null; }
  }
  
  if (!doc) {
    log.push("ERROR: Could not open document");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
    restoreUI();
    return;
  }

  try { app.activeDocument = doc; } catch (e) {}
  try {
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
  } catch (e) {}

  var exported = 0;
  var figureCounter = 0;
  var processedImages = {}; // Track which images we've already processed

  // Process each page
  for (var pi = 0; pi < doc.pages.length; pi++) {
    var page = doc.pages[pi];
    var pageItems = [];
    try { pageItems = page.allPageItems; } catch (e) { continue; }

    log.push("Page " + (pi + 1) + "/" + doc.pages.length + " - " + pageItems.length + " items");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));

    // Find all images on this page
    var images = [];
    var textFrames = [];
    var lines = [];

    for (var i = 0; i < pageItems.length; i++) {
      var item = pageItems[i];
      var ctor = "";
      try { ctor = safeStr(item.constructor.name); } catch (e) { continue; }

      if (ctor === "Image" || ctor === "EPS" || ctor === "PDF" || ctor === "ImportedPage") {
        images.push(item);
      } else if (ctor === "TextFrame") {
        textFrames.push(item);
      } else if (ctor === "GraphicLine" || ctor === "Polygon") {
        lines.push(item);
      }
    }

    // For each image, find associated labels
    for (var ii = 0; ii < images.length; ii++) {
      var img = images[ii];
      var imgBounds = getBounds(img);
      if (!imgBounds) continue;

      var imgName = getImageName(img);
      
      // Skip if we've already processed this image (by name)
      if (imgName && processedImages[imgName]) continue;

      // Find all labels and lines near this image
      var associatedBounds = [imgBounds];
      var hasLabels = false;

      // Check text frames
      for (var ti = 0; ti < textFrames.length; ti++) {
        var tf = textFrames[ti];
        var tfBounds = getBounds(tf);
        if (!tfBounds) continue;

        if (boundsOverlapOrNear(imgBounds, tfBounds, LABEL_MARGIN)) {
          if (isLabelTextFrame(tf)) {
            associatedBounds.push(tfBounds);
            hasLabels = true;
          }
        }
      }

      // Check lines
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var lineBounds = getBounds(line);
        if (!lineBounds) continue;

        if (boundsOverlapOrNear(imgBounds, lineBounds, LABEL_MARGIN)) {
          associatedBounds.push(lineBounds);
        }
      }

      // Only export if we found labels
      if (!hasLabels) continue;

      figureCounter++;
      var baseName = sanitizeFileName(imgName || ("figure_" + figureCounter));
      var outPath = labelsDir + "/" + baseName + "_with_labels.png";

      var outFile = File(outPath);
      var counter = 1;
      while (outFile.exists) {
        outPath = labelsDir + "/" + baseName + "_with_labels_" + counter + ".png";
        outFile = File(outPath);
        counter++;
      }

      // Merge all bounds
      var regionBounds = mergeBounds(associatedBounds);

      // Export the region
      var ok = exportRegionToPng(doc, page, regionBounds, outPath, PPI);
      if (ok) {
        exported++;
        if (imgName) processedImages[imgName] = true;
        log.push("  Exported: " + baseName);
      }

      // Progress update every 10
      if (exported % 10 === 0) {
        writeTextToDesktop(REPORT_NAME, log.join("\n"));
      }
    }
  }

  try { doc.close(SaveOptions.NO); } catch (e) {}

  log.push("");
  log.push("=== COMPLETE ===");
  log.push("Exported: " + exported + " images with labels");
  log.push("Location: " + labelsDir);
  log.push("Finished: " + (new Date()).toString());
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  alert("Done! Exported " + exported + " images with labels.\n\nSee: " + labelsDir);
})();









