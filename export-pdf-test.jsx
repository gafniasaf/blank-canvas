// Export page 208 as PDF to check if labels render
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT = "/Users/asafgafni/Desktop/heart_page208.pdf";
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Check for missing fonts
  var missingFonts = [];
  for (var i = 0; i < doc.fonts.length; i++) {
    var f = doc.fonts[i];
    if (f.status !== FontStatus.INSTALLED) {
      missingFonts.push(f.name + " (" + f.status + ")");
    }
  }
  
  if (missingFonts.length > 0) {
    alert("MISSING FONTS:\n" + missingFonts.join("\n"));
  }
  
  // Make ALL layers visible
  for (var i = 0; i < doc.layers.length; i++) {
    try { doc.layers[i].visible = true; } catch (e) {}
  }
  
  // PDF export - page 208 only
  app.pdfExportPreferences.pageRange = "208";
  app.pdfExportPreferences.exportLayers = true;
  
  var outFile = File(OUTPUT);
  try { if (outFile.exists) outFile.remove(); } catch (e) {}
  
  try {
    doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
    alert("Exported PDF to:\n" + OUTPUT);
  } catch (e) {
    alert("Export failed: " + e);
  }
  
  doc.close(SaveOptions.NO);
})();








