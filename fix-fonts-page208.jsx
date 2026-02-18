// Directly fix fonts on page 208 text frames and export
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT = "/Users/asafgafni/Desktop/heart_fixed.jpg";
  var LOG = "/Users/asafgafni/Desktop/font_fix_log.txt";
  
  var log = [];
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Find a replacement font
  var replaceFont = null;
  var fontNames = ["Helvetica Neue\tRegular", "Helvetica\tRegular", "Arial\tRegular", "Myriad Pro\tRegular"];
  
  for (var i = 0; i < fontNames.length; i++) {
    try {
      var f = app.fonts.itemByName(fontNames[i]);
      if (f && f.isValid) {
        replaceFont = f;
        log.push("Using replacement font: " + fontNames[i]);
        break;
      }
    } catch (e) {}
  }
  
  if (!replaceFont) {
    // List available fonts
    log.push("Could not find replacement font. Available fonts:");
    for (var i = 0; i < Math.min(50, app.fonts.length); i++) {
      try { log.push("  " + app.fonts[i].name); } catch (e) {}
    }
    var logFile = File(LOG);
    logFile.open("w");
    logFile.write(log.join("\n"));
    logFile.close();
    alert("No replacement font found. See log.");
    doc.close(SaveOptions.NO);
    return;
  }
  
  // Go to page 208 (0-indexed = 207)
  var page = doc.pages[207];
  log.push("Processing page 208...");
  
  // Find all text frames and fix their fonts
  var fixed = 0;
  for (var j = 0; j < page.allPageItems.length; j++) {
    var item = page.allPageItems[j];
    if (item.constructor.name !== "TextFrame") continue;
    
    try {
      var txt = item.contents.substring(0, 30);
      
      // Check if this text frame uses a missing font
      var paras = item.paragraphs;
      for (var p = 0; p < paras.length; p++) {
        try {
          var para = paras[p];
          var currentFont = para.appliedFont;
          
          // Check if font is missing
          if (currentFont && currentFont.status !== FontStatus.INSTALLED) {
            log.push("Fixing: \"" + txt + "\" from " + currentFont.name);
            para.appliedFont = replaceFont;
            fixed++;
          }
        } catch (e) {
          // Try character level
          try {
            var chars = item.characters;
            for (var c = 0; c < chars.length; c++) {
              try {
                var ch = chars[c];
                if (ch.appliedFont && ch.appliedFont.status !== FontStatus.INSTALLED) {
                  ch.appliedFont = replaceFont;
                  fixed++;
                }
              } catch (e2) {}
            }
          } catch (e3) {}
        }
      }
    } catch (e) {
      log.push("Error processing frame " + j + ": " + e);
    }
  }
  
  log.push("Fixed " + fixed + " font instances");
  
  // Make all layers visible
  for (var i = 0; i < doc.layers.length; i++) {
    try { doc.layers[i].visible = true; } catch (e) {}
  }
  
  // Export page 208
  app.jpegExportPreferences.exportResolution = 300;
  app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
  app.jpegExportPreferences.antiAlias = true;
  app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  app.jpegExportPreferences.pageString = "208";
  
  var outFile = File(OUTPUT);
  try { if (outFile.exists) outFile.remove(); } catch (e) {}
  
  try {
    doc.exportFile(ExportFormat.JPG, outFile, false);
    log.push("Exported to: " + OUTPUT);
  } catch (e) {
    log.push("Export failed: " + e);
  }
  
  // Write log
  var logFile = File(LOG);
  logFile.open("w");
  logFile.write(log.join("\n"));
  logFile.close();
  
  doc.close(SaveOptions.NO);
  
  alert("Done! Fixed " + fixed + " font instances.\nExported to: " + OUTPUT);
})();








