// SIMPLE: Export heart image page region as JPEG
// Uses InDesign's native page export with crop area

#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT = "/Users/asafgafni/Desktop/heart_test.jpg";
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Page 208 has the heart (0-indexed = 207)
  var pageNum = 208;
  
  // Set JPEG export preferences
  app.jpegExportPreferences.exportResolution = 300;
  app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
  app.jpegExportPreferences.antiAlias = true;
  app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  app.jpegExportPreferences.pageString = String(pageNum);
  
  var outFile = File(OUTPUT);
  try { if (outFile.exists) outFile.remove(); } catch (e) {}
  
  try {
    doc.exportFile(ExportFormat.JPG, outFile, false);
    alert("Exported page " + pageNum + " to:\n" + OUTPUT);
  } catch (e) {
    alert("Export failed: " + e);
  }
  
  doc.close(SaveOptions.NO);
})();









