// Export pages 196-210 to find the heart with electrical labels
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT_DIR = "/Users/asafgafni/Desktop/page_range/";
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  // Create output folder
  var outFolder = Folder(OUTPUT_DIR);
  if (!outFolder.exists) outFolder.create();
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Find replacement font
  var replaceFont = null;
  try { replaceFont = app.fonts.itemByName("Helvetica Neue\tRegular"); } catch (e) {}
  if (!replaceFont || !replaceFont.isValid) {
    try { replaceFont = app.fonts.itemByName("Arial\tRegular"); } catch (e) {}
  }
  
  // Fix all missing fonts in doc
  if (replaceFont && replaceFont.isValid) {
    for (var i = 0; i < doc.allPageItems.length; i++) {
      var item = doc.allPageItems[i];
      if (item.constructor.name === "TextFrame") {
        try {
          var chars = item.characters;
          for (var c = 0; c < chars.length; c++) {
            try {
              if (chars[c].appliedFont && chars[c].appliedFont.status !== FontStatus.INSTALLED) {
                chars[c].appliedFont = replaceFont;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }
  }
  
  // Export pages 196-210
  app.jpegExportPreferences.exportResolution = 150; // Lower res for speed
  app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.HIGH;
  app.jpegExportPreferences.antiAlias = true;
  app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  
  var exported = 0;
  for (var p = 196; p <= 210; p++) {
    app.jpegExportPreferences.pageString = String(p);
    var outFile = File(OUTPUT_DIR + "page_" + p + ".jpg");
    try {
      doc.exportFile(ExportFormat.JPG, outFile, false);
      exported++;
    } catch (e) {}
  }
  
  doc.close(SaveOptions.NO);
  
  alert("Exported " + exported + " pages to:\n" + OUTPUT_DIR);
})();








