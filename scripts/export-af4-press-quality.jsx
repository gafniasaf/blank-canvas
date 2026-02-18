// ============================================================
// EXPORT A&F N4 PDF - Press Quality (Maximum Resolution)
// ============================================================
// Uses [Press Quality] preset and then overrides downsampling
// to preserve maximum image resolution
// ============================================================

#targetengine "session"

(function () {
  var prevUI = null;
  try { prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  
  function restoreUI() {
    try { if (prevUI !== null) app.scriptPreferences.userInteractionLevel = prevUI; } catch (e) {}
  }
  
  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? "0" + String(n) : String(n); }
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + 
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  
  function writeLog(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }
  
  var log = [];
  var ts = isoStamp();
  log.push("A&F N4 PDF Export - Press Quality");
  log.push("Started: " + new Date().toString());
  log.push("");
  
  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var outputDir = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/";
  var outputPdf = outputDir + "MBO_AF4_N4_PRESS_" + ts + ".pdf";
  
  log.push("Source: " + srcPath);
  log.push("Output: " + outputPdf);
  log.push("");
  
  var srcFile = File(srcPath);
  if (!srcFile.exists) {
    log.push("ERROR: Source file not found!");
    writeLog("export_af4_press_ERROR.txt", log.join("\n"));
    restoreUI();
    return;
  }
  
  try {
    log.push("Opening document...");
    var doc = app.open(srcFile, false);
    log.push("Document opened: " + doc.name);
    log.push("Pages: " + doc.pages.length);
    log.push("");
    
    // Try to load [Press Quality] preset first
    log.push("Looking for [Press Quality] preset...");
    var presetFound = false;
    try {
      var preset = app.pdfExportPresets.itemByName("[Press Quality]");
      if (preset.isValid) {
        log.push("Found [Press Quality] preset - applying...");
        app.pdfExportPreferences.pdfExportPreset = preset;
        presetFound = true;
      }
    } catch (e) {
      log.push("Could not load preset: " + e.message);
    }
    
    if (!presetFound) {
      log.push("Using [High Quality Print] instead...");
      try {
        var hqPreset = app.pdfExportPresets.itemByName("[High Quality Print]");
        if (hqPreset.isValid) {
          app.pdfExportPreferences.pdfExportPreset = hqPreset;
          presetFound = true;
        }
      } catch (e2) {
        log.push("Could not load HQ preset: " + e2.message);
      }
    }
    
    // Now override with maximum quality settings
    log.push("Overriding compression settings for maximum quality...");
    
    with (app.pdfExportPreferences) {
      pageRange = PageRange.ALL_PAGES;
      
      // Key: Set very high thresholds so downsampling never triggers
      // Threshold of 9999 means "don't downsample anything under 9999 dpi effective"
      
      // Color images - only downsample if over 4800 dpi (effectively never)
      colorBitmapSampling = Sampling.SUBSAMPLE;
      colorBitmapSamplingDPI = 600;  // Target DPI if downsampling happens
      thresholdToCompressColor = 4800;  // Only downsample if above 4800 dpi
      colorBitmapCompression = BitmapCompression.ZIP;
      colorBitmapQuality = CompressionQuality.MAXIMUM;
      
      // Grayscale images - same approach
      grayscaleBitmapSampling = Sampling.SUBSAMPLE;
      grayscaleBitmapSamplingDPI = 600;
      thresholdToCompressGray = 4800;
      grayscaleBitmapCompression = BitmapCompression.ZIP;
      grayscaleBitmapQuality = CompressionQuality.MAXIMUM;
      
      // Monochrome
      monochromeBitmapSampling = Sampling.SUBSAMPLE;
      monochromeBitmapSamplingDPI = 2400;
      thresholdToCompressMonochrome = 4800;
      monochromeBitmapCompression = MonoBitmapCompression.ZIP;
      
      // General
      exportLayers = false;
      generateThumbnails = false;
      optimizePDF = false;
      
      // No marks
      cropMarks = false;
      bleedMarks = false;
      registrationMarks = false;
      colorBars = false;
      pageInformationMarks = false;
    }
    
    log.push("Settings applied:");
    log.push("  - Downsample threshold: 4800 dpi (effectively preserves all resolution)");
    log.push("  - Target DPI if downsampling: 600 dpi color/gray, 2400 dpi mono");
    log.push("  - Compression: ZIP");
    log.push("");
    
    log.push("Exporting PDF...");
    var outFile = File(outputPdf);
    doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
    log.push("PDF exported successfully!");
    log.push("");
    
    if (outFile.exists) {
      var sizeMB = (outFile.length / (1024 * 1024)).toFixed(2);
      log.push("Output file size: " + sizeMB + " MB");
    }
    
    doc.close(SaveOptions.NO);
    log.push("Document closed.");
    
  } catch (e) {
    log.push("ERROR: " + String(e.message || e));
    log.push("Line: " + (e.line || "unknown"));
  }
  
  log.push("");
  log.push("Finished: " + new Date().toString());
  writeLog("export_af4_press_" + ts + ".txt", log.join("\n"));
  
  restoreUI();
  alert("Export complete!\n\nOutput: " + outputPdf);
})();








