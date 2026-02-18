// ============================================================
// FAST EXPORT: Grouped Figures Only
// ============================================================
// Purpose:
// - Find all GROUPS that contain images (these have embedded labels)
// - Export each group as a single PNG
// - Much faster than detecting overlapping items
//
// Output:
// - Images saved to: extracted_images/<book>/embedded_figures/
// ============================================================

#targetengine "session"

(function () {
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) { __prevUI = null; }
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

  // Check if a group contains at least one image
  function groupHasImage(grp) {
    try {
      var items = grp.allGraphics;
      return items && items.length > 0;
    } catch (e) {
      return false;
    }
  }

  // Get image name from group
  function getImageNameFromGroup(grp) {
    try {
      var graphics = grp.allGraphics;
      if (graphics && graphics.length > 0) {
        var link = graphics[0].itemLink;
        if (link) return safeStr(link.name).replace(/\.[^.]+$/, "");
      }
    } catch (e) {}
    return "";
  }

  // Fast export: just duplicate group to temp doc and export
  function exportGroupToPng(grp, outAbsPath, ppi) {
    var b = null;
    try { b = grp.geometricBounds; } catch (e) { return false; }
    if (!b) return false;

    var padPt = 12;
    var h = Math.max(10, b[2] - b[0]);
    var w = Math.max(10, b[3] - b[1]);

    var outFile = File(outAbsPath);
    try { if (outFile.exists) outFile.remove(); } catch (e) {}
    try { if (outFile.parent && !outFile.parent.exists) outFile.parent.create(); } catch (e) {}

    var tmp = null;
    try { tmp = app.documents.add(); } catch (e) { return false; }

    try {
      tmp.documentPreferences.facingPages = false;
      tmp.documentPreferences.pagesPerDocument = 1;
      tmp.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
      tmp.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
      tmp.documentPreferences.pageHeight = (h + padPt * 2) + "pt";
      tmp.documentPreferences.pageWidth = (w + padPt * 2) + "pt";
    } catch (e) {}

    var p0 = null;
    try { p0 = tmp.pages[0]; } catch (e) {}
    if (!p0) { try { tmp.close(SaveOptions.NO); } catch (e) {} return false; }

    var dup = null;
    try { dup = grp.duplicate(p0); } catch (e) {}
    if (!dup) { try { tmp.close(SaveOptions.NO); } catch (e) {} return false; }

    // Move to position
    try { dup.move(undefined, [padPt - b[1], padPt - b[0]]); } catch (e) {}

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

  // Book definitions
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var OUTPUT_BASE = "/Users/asafgafni/Desktop/InDesign/TestRun/extracted_images";

  var BOOKS = [
    { name: "af_n3", displayName: "MBO A&F 3", files: [BASE_DIR + "/MBO A&F 3_9789083251363_03/MBO A&F 3_9789083251363_03.2024.indd"] },
    { name: "af_n4", displayName: "MBO A&F 4", files: [BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd"] },
    { name: "communicatie", displayName: "MBO Communicatie", files: [BASE_DIR + "/MBO Communicatie_9789083251387_03/MBO Communicatie_9789083251387_03.2024.indd"] },
    { name: "methodisch_werken", displayName: "MBO Methodisch werken", files: [BASE_DIR + "/MBO Methodisch werken_9789083251394_03/MBO Methodisch werken_9789083251394_03.2024.indd"] },
    { name: "pathologie_n4", displayName: "MBO Pathologie nivo 4", files: (function() { var arr = []; for (var i = 1; i <= 12; i++) { var num = i < 10 ? "0" + i : String(i); arr.push(BASE_DIR + "/MBO Pathologie nivo 4_9789083412016_03/Pathologie_mbo_CH" + num + "_03.2024.indd"); } return arr; })() },
    { name: "persoonlijke_verzorging", displayName: "MBO Persoonlijke Verzorging", files: [BASE_DIR + "/MBO Persoonlijke Verzorging_9789083412023_03/MBO Persoonlijke Verzorging_9789083412023_03.2024.indd"] },
    { name: "klinisch_redeneren", displayName: "MBO Praktijkgestuurd klinisch redeneren", files: [BASE_DIR + "/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd"] },
    { name: "wetgeving", displayName: "MBO Wetgeving", files: [BASE_DIR + "/MBO Wetgeving_9789083412061_03/MBO Wetgeving_9789083412061_03.2024.indd"] },
    { name: "vth_n3", displayName: "MBO VTH nivo 3", files: (function() { var arr = []; for (var i = 1; i <= 21; i++) { var num = i < 10 ? "0" + i : String(i); arr.push(BASE_DIR + "/_MBO VTH nivo 3_9789083412047_03/" + num + "-VTH_Niveau-3_03.2024.indd"); } return arr; })() },
    { name: "vth_n4", displayName: "MBO VTH nivo 4", files: (function() { var arr = []; for (var i = 1; i <= 30; i++) { var num = i < 10 ? "0" + i : String(i); arr.push(BASE_DIR + "/_MBO VTH nivo 4_9789083412054_03/" + num + "-VTH_Combined_03.2024.indd"); } return arr; })() }
  ];

  var STAMP = isoStamp();
  var REPORT_NAME = "export_grouped_figures__" + STAMP + ".txt";
  var PPI = 300;

  var log = [];
  log.push("=== FAST EXPORT: GROUPED FIGURES ===");
  log.push("Started: " + (new Date()).toString());
  log.push("Books: " + BOOKS.length);
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  ensureFolder(OUTPUT_BASE);

  var totalExported = 0;
  var bookResults = [];

  for (var bi = 0; bi < BOOKS.length; bi++) {
    var book = BOOKS[bi];
    log.push("=== " + (bi + 1) + "/" + BOOKS.length + ": " + book.displayName + " ===");
    writeTextToDesktop(REPORT_NAME, log.join("\n"));

    var bookOutputDir = OUTPUT_BASE + "/" + book.name;
    var embeddedDir = bookOutputDir + "/embedded_figures";
    ensureFolder(bookOutputDir);
    ensureFolder(embeddedDir);

    var bookExported = 0;
    var figureCounter = 0;

    for (var fi = 0; fi < book.files.length; fi++) {
      var inddPath = book.files[fi];
      var inddFile = File(inddPath);

      if (!inddFile.exists) continue;

      log.push("  " + inddFile.name);

      var doc = null;
      try { doc = app.open(inddFile, true); } catch (e1) {
        try { doc = app.open(inddFile); } catch (e2) { doc = null; }
      }
      if (!doc) continue;

      try { app.activeDocument = doc; } catch (e) {}
      try {
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
      } catch (e) {}

      // Find all groups with images
      for (var pi = 0; pi < doc.pages.length; pi++) {
        var page = doc.pages[pi];
        var pageItems = [];
        try { pageItems = page.allPageItems; } catch (e) { continue; }

        for (var pii = 0; pii < pageItems.length; pii++) {
          var item = pageItems[pii];
          var ctor = "";
          try { ctor = safeStr(item.constructor.name); } catch (e) { continue; }

          if (ctor !== "Group") continue;

          // Skip if parent is also a group (avoid nested duplicates)
          try {
            if (item.parent && item.parent.constructor && safeStr(item.parent.constructor.name) === "Group") continue;
          } catch (e) {}

          if (!groupHasImage(item)) continue;

          figureCounter++;
          var imgName = getImageNameFromGroup(item) || ("figure_" + figureCounter);
          var baseName = sanitizeFileName(imgName);
          var outPath = embeddedDir + "/" + baseName + "_grouped.png";

          var outFile = File(outPath);
          var counter = 1;
          while (outFile.exists) {
            outPath = embeddedDir + "/" + baseName + "_grouped_" + counter + ".png";
            outFile = File(outPath);
            counter++;
          }

          var ok = false;
          try { ok = exportGroupToPng(item, outPath, PPI); } catch (e) {}

          if (ok) bookExported++;
        }
      }

      try { doc.close(SaveOptions.NO); } catch (e) {}
    }

    log.push("  Grouped figures: " + bookExported);
    log.push("");
    totalExported += bookExported;
    bookResults.push({ name: book.displayName, count: bookExported });
    writeTextToDesktop(REPORT_NAME, log.join("\n"));
  }

  log.push("=== SUMMARY ===");
  for (var ri = 0; ri < bookResults.length; ri++) {
    log.push(bookResults[ri].name + ": " + bookResults[ri].count);
  }
  log.push("");
  log.push("TOTAL: " + totalExported + " grouped figures");
  log.push("Location: " + OUTPUT_BASE + "/<book>/embedded_figures/");
  log.push("Completed: " + (new Date()).toString());
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  alert("Done! Exported " + totalExported + " grouped figures.\n\nSee: " + OUTPUT_BASE);
})();










