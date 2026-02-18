// ============================================================
// EXPORT: VTH N4 - Manual Run (One Chapter at a Time)
// ============================================================
// Run this script from InDesign: File > Scripts > User Scripts
// It will export the NEXT chapter that hasn't been exported yet
// Run it repeatedly until all chapters are done
// ============================================================

#targetengine "session"

(function () {
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) { __prevUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (e) {}
  }

  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }

  function ensureFolder(absPath) {
    try {
      var f = Folder(absPath);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  function findNextChapter() {
    var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4";
    var lastChapter = 6;
    
    // Find highest chapter number that exists
    for (var ch = 1; ch <= 30; ch++) {
      var chStr = ch < 10 ? "0" + String(ch) : String(ch);
      var idmlFile = File(OUTPUT_DIR + "/" + chStr + "-VTH_Combined_03.2024.idml");
      if (idmlFile.exists && idmlFile.length > 1000) {
        lastChapter = ch;
      }
    }
    
    return lastChapter + 1;
  }

  var SOURCE_DIR = "/Users/asafgafni/Desktop/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
  var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4";
  
  ensureFolder(OUTPUT_DIR);

  var chNum = findNextChapter();
  
  if (chNum > 30) {
    alert("All chapters already exported!");
    restoreUI();
    return;
  }

  var chStr = chNum < 10 ? "0" + String(chNum) : String(chNum);
  var filename = chStr + "-VTH_Combined_03.2024.indd";
  var inddPath = SOURCE_DIR + "/" + filename;

  var inddFile = File(inddPath);
  if (!inddFile.exists) {
    alert("File not found: " + inddPath);
    restoreUI();
    return;
  }

  // Close any open documents
  try {
    while (app.documents.length > 0) {
      app.documents[0].close(SaveOptions.NO);
    }
  } catch (e) {}

  $.sleep(500);

  var doc = null;
  try {
    doc = app.open(inddFile, true);
    $.sleep(1000);
  } catch (e) {
    alert("Error opening: " + safeStr(e));
    restoreUI();
    return;
  }

  var idmlPath = OUTPUT_DIR + "/" + chStr + "-VTH_Combined_03.2024.idml";
  var idmlFile = File(idmlPath);

  var ok = false;
  try {
    doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile, false);
    $.sleep(2000);
    ok = idmlFile.exists && idmlFile.length > 1000;
  } catch (e) {
    alert("Error exporting: " + safeStr(e));
    ok = false;
  }

  try {
    doc.close(SaveOptions.NO);
  } catch (e) {}

  if (ok) {
    var sizeKB = Math.round(idmlFile.length / 1024);
    alert("Chapter " + String(chNum) + " exported!\n\nFile: " + idmlPath + "\nSize: " + String(sizeKB) + " KB\n\nRun script again for next chapter.");
  } else {
    alert("Failed to export Chapter " + String(chNum));
  }

  restoreUI();
})();











