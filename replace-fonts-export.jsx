// Replace missing FreightSans Pro with Helvetica Neue and export page 208
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT_JPG = "/Users/asafgafni/Desktop/heart_with_labels.jpg";
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Find and replace missing fonts
  var replacements = [];
  var targetFont = null;
  
  // Try to find Helvetica Neue or Arial as replacement
  try {
    targetFont = app.fonts.itemByName("Helvetica Neue\tRegular");
    if (!targetFont.isValid) targetFont = null;
  } catch (e) {}
  
  if (!targetFont) {
    try {
      targetFont = app.fonts.itemByName("Arial\tRegular");
      if (!targetFont.isValid) targetFont = null;
    } catch (e) {}
  }
  
  if (!targetFont) {
    try {
      targetFont = app.fonts.itemByName("Helvetica\tRegular");
      if (!targetFont.isValid) targetFont = null;
    } catch (e) {}
  }
  
  if (!targetFont) {
    alert("Could not find replacement font (Helvetica Neue, Arial, or Helvetica)");
    doc.close(SaveOptions.NO);
    return;
  }
  
  // Replace all missing fonts
  for (var i = 0; i < doc.fonts.length; i++) {
    var f = doc.fonts[i];
    if (f.status !== FontStatus.INSTALLED) {
      replacements.push(f.name);
      try {
        // Find all text using this font and change it
        app.findTextPreferences = NothingEnum.NOTHING;
        app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.appliedFont = f;
        app.changeTextPreferences.appliedFont = targetFont;
        doc.changeText();
      } catch (e) {
        // Try alternative method
      }
    }
  }
  
  // Make all layers visible
  for (var i = 0; i < doc.layers.length; i++) {
    try { doc.layers[i].visible = true; } catch (e) {}
  }
  
  // Export page 208 as JPEG
  app.jpegExportPreferences.exportResolution = 300;
  app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
  app.jpegExportPreferences.antiAlias = true;
  app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  app.jpegExportPreferences.pageString = "208";
  
  var outFile = File(OUTPUT_JPG);
  try { if (outFile.exists) outFile.remove(); } catch (e) {}
  
  try {
    doc.exportFile(ExportFormat.JPG, outFile, false);
    alert("SUCCESS!\n\nReplaced fonts: " + replacements.join(", ") + "\n\nExported to: " + OUTPUT_JPG);
  } catch (e) {
    alert("Export failed: " + e);
  }
  
  // Close WITHOUT saving (don't modify original)
  doc.close(SaveOptions.NO);
})();








