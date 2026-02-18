// Export pages (that contain figures) as 300dpi JPGs
// Reads config from: /Users/asafgafni/Desktop/InDesign/TestRun/_export_config.json
//
// Uses:
// - config.docPath
// - config.neededPagesPath
// - config.pageExports300Dir
//
// IMPORTANT: This script does not modify the document.
#target indesign

(function () {
  var CONFIG_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/_export_config.json";

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  function readJsonFile(path) {
    var f = File(path);
    if (!f.exists) return null;
    f.open("r");
    var txt = f.read();
    f.close();
    try { return eval("(" + txt + ")"); } catch (e) { return null; }
  }

  function safeStr(x) {
    try { return String(x); } catch (e) { return ""; }
  }

  function readLines(path) {
    var f = File(path);
    if (!f.exists) return [];
    f.open("r");
    var txt = f.read();
    f.close();
    var lines = txt.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var s = trim(lines[i]);
      if (s) out.push(s);
    }
    return out;
  }

  var oldInteraction = null;
  try { oldInteraction = app.scriptPreferences.userInteractionLevel; } catch (eOld) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI) {}

  var cfg = readJsonFile(CONFIG_PATH);
  if (!cfg) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore1) {}
    alert("Could not read config:\n" + CONFIG_PATH);
    return;
  }

  var docPath = safeStr(cfg.docPath || "");
  var neededPagesPath = safeStr(cfg.neededPagesPath || "");
  var pageExportsDir = safeStr(cfg.pageExports300Dir || "");
  var silent = !!cfg.silent;
  var closeDocAfter = !!cfg.closeDocAfter;

  if (!docPath || !neededPagesPath || !pageExportsDir) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore2) {}
    alert("Config missing docPath/neededPagesPath/pageExports300Dir.\nConfig:\n" + CONFIG_PATH);
    return;
  }

  var docFile = File(docPath);
  if (!docFile.exists) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore3) {}
    alert("INDD not found:\n" + docPath);
    return;
  }

  var outFolder = new Folder(pageExportsDir);
  if (!outFolder.exists) outFolder.create();

  var pages = readLines(neededPagesPath);
  if (!pages.length) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore4) {}
    if (!silent) {
      alert("No pages found in neededPagesPath:\n" + neededPagesPath);
    } else {
      $.writeln("No pages found in neededPagesPath: " + neededPagesPath);
    }
    return;
  }

  var neededLookup = {};
  for (var i = 0; i < pages.length; i++) neededLookup[pages[i]] = true;

  // Find already-open doc by full path, else open
  var doc = null;
  for (var d = 0; d < app.documents.length; d++) {
    try {
      if (app.documents[d].fullName && app.documents[d].fullName.fsName === docFile.fsName) {
        doc = app.documents[d];
        break;
      }
    } catch (eMatch) {}
  }
  if (!doc) {
    try {
      doc = app.open(docFile, false);
    } catch (eOpen) {
      try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore5) {}
      alert("Failed to open:\n" + docPath + "\n\n" + eOpen);
      return;
    }
  }

  // Export prefs
  try {
    app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
    app.jpegExportPreferences.exportResolution = 300;
    app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  } catch (ePrefs) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore6) {}
    alert("Failed to set JPG export prefs:\n" + ePrefs);
    return;
  }

  var exported = 0;
  var skippedExists = 0;

  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageName = safeStr(page.name);
    if (!neededLookup[pageName]) continue;

    var outFile = File(outFolder.fsName + "/page_" + pageName + ".jpg");
    if (outFile.exists) {
      skippedExists++;
      continue;
    }
    try {
      app.jpegExportPreferences.pageString = pageName;
      doc.exportFile(ExportFormat.JPG, outFile);
      exported++;
    } catch (eExp) {
      $.writeln("Failed exporting page " + pageName + ": " + eExp);
    }
  }

  // Optionally close document (without saving)
  if (closeDocAfter) {
    try { doc.close(SaveOptions.NO); } catch (eClose) {}
  }

  try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore7) {}

  if (!silent) {
    alert(
      "300dpi pages export done.\n\n" +
        "Pages needed: " + pages.length + "\n" +
        "Exported new: " + exported + "\n" +
        "Skipped (already existed): " + skippedExists + "\n\n" +
        "Folder:\n" + outFolder.fsName
    );
  } else {
    $.writeln(
      "300dpi pages export done. Pages=" + pages.length +
        " Exported=" + exported +
        " Skipped=" + skippedExists +
        " Folder=" + outFolder.fsName
    );
  }
})();


