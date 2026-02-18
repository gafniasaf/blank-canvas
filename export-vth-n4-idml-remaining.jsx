// ============================================================
// EXPORT: VTH N4 Chapters 7-30 to IDML (Remaining)
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

  var SOURCE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
  var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4";
  var STAMP = isoStamp();
  var REPORT_NAME = "export_vth_n4_remaining__" + STAMP + ".txt";

  var log = [];
  log.push("=== EXPORT VTH N4 REMAINING (7-30) ===");
  log.push("Started: " + (new Date()).toString());
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  ensureFolder(OUTPUT_DIR);

  var successCount = 0;
  var failedChapters = [];

  // Process chapters 7-30
  for (var chNum = 7; chNum <= 30; chNum++) {
    var chStr = chNum < 10 ? "0" + String(chNum) : String(chNum);
    var filename = chStr + "-VTH_Combined_03.2024.indd";
    var inddPath = SOURCE_DIR + "/" + filename;

    log.push("--- Chapter " + String(chNum) + " ---");

    var inddFile = File(inddPath);
    if (!inddFile.exists) {
      log.push("ERROR: File not found: " + inddPath);
      failedChapters.push(chNum);
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    var doc = null;
    try { doc = app.open(inddFile, true); } catch (e) { 
      log.push("ERROR opening: " + safeStr(e));
      doc = null; 
    }
    if (!doc) {
      log.push("ERROR: Failed to open");
      failedChapters.push(chNum);
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    var idmlPath = OUTPUT_DIR + "/" + chStr + "-VTH_Combined_03.2024.idml";
    var idmlFile = File(idmlPath);

    var ok = false;
    try {
      doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile, false);
      ok = idmlFile.exists && idmlFile.length > 1000;
    } catch (e) {
      log.push("ERROR exporting: " + safeStr(e));
      ok = false;
    }

    try { doc.close(SaveOptions.NO); } catch (e) {}

    if (ok) {
      log.push("OK: " + idmlPath);
      successCount++;
    } else {
      log.push("FAILED");
      failedChapters.push(chNum);
    }

    writeTextToDesktop(REPORT_NAME, log.join("\n"));
  }

  log.push("");
  log.push("=== SUMMARY ===");
  log.push("Exported: " + successCount + "/24 chapters");
  log.push("Failed: " + failedChapters.join(", "));
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  alert("VTH N4 remaining chapters done!\n\nExported: " + successCount + "\nFailed: " + failedChapters.length);
})();











