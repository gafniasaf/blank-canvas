// Export pages that contain figures as 300dpi JPGs (high-res, smaller than PNG)
// Reads pages from: ~/Desktop/extracted_figures/needed_pages.txt
#target indesign

(function () {
  var DOC_NAME_CONTAINS = "MBO A&F 4_9789083251370_03.2024";
  var DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";

  var neededPagesFile = File("/Users/asafgafni/Desktop/extracted_figures/needed_pages.txt");
  if (!neededPagesFile.exists) {
    alert("needed_pages.txt not found:\n" + neededPagesFile.fsName);
    return;
  }

  var outFolder = new Folder("/Users/asafgafni/Desktop/page_exports_300");
  if (!outFolder.exists) outFolder.create();

  // Find / open document
  var doc = null;
  for (var i = 0; i < app.documents.length; i++) {
    try {
      if (String(app.documents[i].name).indexOf(DOC_NAME_CONTAINS) >= 0) {
        doc = app.documents[i];
        break;
      }
    } catch (e) {}
  }
  if (!doc) {
    doc = app.open(File(DOC_PATH), false);
  }
  if (!doc) {
    alert("Could not open doc");
    return;
  }

  // Read needed pages list
  var neededLookup = {};
  neededPagesFile.open("r");
  var raw = neededPagesFile.read();
  neededPagesFile.close();

  var lines = raw.split(/\r?\n/);
  var totalNeeded = 0;
  for (var l = 0; l < lines.length; l++) {
    var s = String(lines[l]).replace(/^\s+|\s+$/g, "");
    if (!s) continue;
    neededLookup[s] = true;
    totalNeeded++;
  }

  // JPG export prefs (300dpi)
  try {
    app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
    app.jpegExportPreferences.exportResolution = 300;
    app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  } catch (ePrefs) {
    alert("Error setting JPG export preferences:\n" + ePrefs);
    return;
  }

  var exported = 0;
  var skippedExists = 0;

  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageName = String(page.name);
    if (!neededLookup[pageName]) continue;

    var outFile = new File(outFolder.fsName + "/page_" + pageName + ".jpg");
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

    if (exported > 0 && exported % 20 === 0) {
      $.writeln("Exported " + exported + " pages...");
    }
  }

  alert(
    "Done exporting 300dpi JPG pages.\n\n" +
      "Needed pages: " + totalNeeded + "\n" +
      "Exported new: " + exported + "\n" +
      "Skipped (already existed): " + skippedExists + "\n\n" +
      "Folder:\n" + outFolder.fsName
  );
})();








