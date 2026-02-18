// ============================================================
// EXPORT: VTH N4 Single Chapter at a Time (Auto-advance)
// ============================================================
// Exports one chapter, closes it, then moves to the next
// More reliable than batch export
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

  function ensureFolder(absPath) {
    try {
      var f = Folder(absPath);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  function readProgressFile() {
    var progressFile = File(Folder.desktop + "/vth_n4_export_progress.txt");
    var lastChapter = 6; // Start from chapter 7
    try {
      if (progressFile.exists) {
        progressFile.open("r");
        var content = progressFile.read();
        progressFile.close();
        var match = content.match(/LAST_CHAPTER=(\d+)/);
        if (match) lastChapter = parseInt(match[1], 10);
      }
    } catch (e) {}
    return lastChapter;
  }

  function writeProgressFile(chapterNum) {
    var progressFile = File(Folder.desktop + "/vth_n4_export_progress.txt");
    try {
      progressFile.open("w");
      progressFile.write("LAST_CHAPTER=" + String(chapterNum) + "\n");
      progressFile.write("UPDATED=" + (new Date()).toString() + "\n");
      progressFile.close();
    } catch (e) {}
  }

  var SOURCE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
  var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4";
  var STAMP = isoStamp();
  var REPORT_NAME = "export_vth_n4_single__" + STAMP + ".txt";

  var log = [];
  log.push("=== EXPORT VTH N4 (SINGLE CHAPTER MODE) ===");
  log.push("Started: " + (new Date()).toString());
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  ensureFolder(OUTPUT_DIR);

  var startChapter = readProgressFile() + 1;
  var endChapter = 30;
  log.push("Starting from chapter: " + String(startChapter));
  log.push("Ending at chapter: " + String(endChapter));
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  var successCount = 0;
  var failedChapters = [];

  for (var chNum = startChapter; chNum <= endChapter; chNum++) {
    var chStr = chNum < 10 ? "0" + String(chNum) : String(chNum);
    var filename = chStr + "-VTH_Combined_03.2024.indd";
    var inddPath = SOURCE_DIR + "/" + filename;

    log.push("");
    log.push("=== Chapter " + String(chNum) + " ===");
    log.push("INDD: " + inddPath);
    writeTextToDesktop(REPORT_NAME, log.join("\n"));

    var inddFile = File(inddPath);
    if (!inddFile.exists) {
      log.push("ERROR: File not found");
      failedChapters.push(chNum);
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    // Close any open documents first
    try {
      while (app.documents.length > 0) {
        app.documents[0].close(SaveOptions.NO);
      }
    } catch (e) {}

    // Small delay to let InDesign settle
    $.sleep(500);

    var doc = null;
    try {
      doc = app.open(inddFile, true);
      $.sleep(1000); // Wait for document to fully load
    } catch (e) {
      log.push("ERROR opening: " + safeStr(e));
      doc = null;
    }

    if (!doc) {
      log.push("ERROR: Failed to open document");
      failedChapters.push(chNum);
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    var idmlPath = OUTPUT_DIR + "/" + chStr + "-VTH_Combined_03.2024.idml";
    var idmlFile = File(idmlPath);

    var ok = false;
    try {
      log.push("Exporting to IDML...");
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      
      doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile, false);
      
      // Wait a bit for export to complete
      $.sleep(2000);
      
      ok = idmlFile.exists && idmlFile.length > 1000;
      
      if (ok) {
        log.push("OK: " + idmlPath + " (" + String(Math.round(idmlFile.length / 1024)) + " KB)");
      } else {
        log.push("FAILED: File too small or missing");
      }
    } catch (e) {
      log.push("ERROR exporting: " + safeStr(e));
      ok = false;
    }

    // Close document
    try {
      doc.close(SaveOptions.NO);
      $.sleep(500);
    } catch (e) {}

    if (ok) {
      successCount++;
      writeProgressFile(chNum);
    } else {
      failedChapters.push(chNum);
    }

    writeTextToDesktop(REPORT_NAME, log.join("\n"));
  }

  log.push("");
  log.push("=== SUMMARY ===");
  log.push("Exported: " + successCount + " chapters");
  log.push("Failed: " + failedChapters.length);
  if (failedChapters.length > 0) {
    log.push("Failed chapters: " + failedChapters.join(", "));
  }
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  alert("VTH N4 export complete!\n\nExported: " + successCount + "\nFailed: " + failedChapters.length);
})();











