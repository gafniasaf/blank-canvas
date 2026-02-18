// Export page 208 with ALL layers visible
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT = "/Users/asafgafni/Desktop/heart_full.jpg";
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Make ALL layers visible
  for (var i = 0; i < doc.layers.length; i++) {
    try { doc.layers[i].visible = true; } catch (e) {}
  }
  
  // Page 208
  var pageNum = 208;
  
  // JPEG export with all settings maxed
  app.jpegExportPreferences.exportResolution = 300;
  app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
  app.jpegExportPreferences.antiAlias = true;
  app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  app.jpegExportPreferences.pageString = String(pageNum);
  app.jpegExportPreferences.simulateOverprint = false;
  app.jpegExportPreferences.useDocumentBleeds = false;
  
  var outFile = File(OUTPUT);
  try { if (outFile.exists) outFile.remove(); } catch (e) {}
  
  try {
    doc.exportFile(ExportFormat.JPG, outFile, false);
    alert("Exported page " + pageNum + " to:\n" + OUTPUT + "\n\nCheck if labels are visible now!");
  } catch (e) {
    alert("Export failed: " + e);
  }
  
  doc.close(SaveOptions.NO);
})();








