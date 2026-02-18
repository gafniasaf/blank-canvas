// ============================================================
// EXPORT: VTH N4 Chapters to IDML
// ============================================================
// Purpose: Export all 30 VTH N4 chapter INDD files to IDML format
// Output: designs-relinked/_MBO_VTH_nivo_4/XX-VTH_Combined_03.2024.idml
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

  // --------------------------
  // Main
  // --------------------------
  var SOURCE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
  var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4";
  var STAMP = isoStamp();
  var REPORT_NAME = "export_vth_n4_idml__" + STAMP + ".txt";

  var log = [];
  log.push("=== EXPORT VTH N4 TO IDML ===");
  log.push("Started: " + (new Date()).toString());
  log.push("Source: " + SOURCE_DIR);
  log.push("Output: " + OUTPUT_DIR);
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  ensureFolder(OUTPUT_DIR);

  var chapters = [];
  // Chapters 01-30
  for (var ch = 1; ch <= 30; ch++) {
    var chStr = ch < 10 ? "0" + String(ch) : String(ch);
    var filename = chStr + "-VTH_Combined_03.2024.indd";
    chapters.push({ chapter: ch, filename: filename });
  }

  var successCount = 0;
  var failedChapters = [];

  for (var ci = 0; ci < chapters.length; ci++) {
    var chInfo = chapters[ci];
    var chNum = chInfo.chapter;
    var inddPath = SOURCE_DIR + "/" + chInfo.filename;

    log.push("--- Chapter " + String(chNum) + " ---");
    log.push("INDD: " + inddPath);

    var inddFile = File(inddPath);
    if (!inddFile.exists) {
      log.push("ERROR: File not found, skipping");
      failedChapters.push(chNum);
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    var doc = null;
    try { doc = app.open(inddFile, true); } catch (e) { doc = null; }
    if (!doc) {
      log.push("ERROR: Failed to open");
      failedChapters.push(chNum);
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    // Export as IDML
    var chStr2 = chNum < 10 ? "0" + String(chNum) : String(chNum);
    var idmlPath = OUTPUT_DIR + "/" + chStr2 + "-VTH_Combined_03.2024.idml";
    var idmlFile = File(idmlPath);

    var ok = false;
    try {
      doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile, false);
      ok = idmlFile.exists;
    } catch (e) {
      log.push("ERROR exporting: " + safeStr(e));
      ok = false;
    }

    try { doc.close(SaveOptions.NO); } catch (e) {}

    if (ok) {
      log.push("Exported: " + idmlPath);
      successCount++;
    } else {
      log.push("FAILED to export");
      failedChapters.push(chNum);
    }

    writeTextToDesktop(REPORT_NAME, log.join("\n"));
  }

  log.push("");
  log.push("=== SUMMARY ===");
  log.push("Exported: " + successCount + " chapters");
  log.push("Failed: " + failedChapters.length + " (" + failedChapters.join(", ") + ")");
  log.push("Output directory: " + OUTPUT_DIR);

  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  alert("VTH N4 IDML export complete!\n\nExported: " + successCount + " chapters\nFailed: " + failedChapters.length + "\n\nReport saved to Desktop.");
})();











