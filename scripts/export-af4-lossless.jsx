// ============================================================
// EXPORT A&F N4 PDF - Lossless Compression (No JPEG)
// ============================================================
// Uses ZIP compression only (no JPEG lossy compression)
// This eliminates compression artifacts
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
  log.push("A&F N4 PDF Export - Lossless (No JPEG)");
  log.push("Started: " + new Date().toString());
  log.push("");
  
  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var outputDir = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/";
  var outputPdf = outputDir + "MBO_AF4_N4_LOSSLESS_" + ts + ".pdf";
  
  log.push("Source: " + srcPath);
  log.push("Output: " + outputPdf);
  log.push("");
  
  var srcFile = File(srcPath);
  if (!srcFile.exists) {
    log.push("ERROR: Source file not found!");
    writeLog("export_af4_lossless_ERROR.txt", log.join("\n"));
    restoreUI();
    return;
  }
  
  try {
    log.push("Opening document...");
    var doc = app.open(srcFile, false);
    log.push("Document opened: " + doc.name);
    log.push("Pages: " + doc.pages.length);
    log.push("");
    
    log.push("Configuring lossless compression settings...");
    
    with (app.pdfExportPreferences) {
      pageRange = PageRange.ALL_PAGES;
      
      // NO downsampling at all
      colorBitmapSampling = Sampling.NONE;
      grayscaleBitmapSampling = Sampling.NONE;
      monochromeBitmapSampling = Sampling.NONE;
      
      // LOSSLESS compression only (ZIP, not JPEG)
      colorBitmapCompression = BitmapCompression.ZIP;
      grayscaleBitmapCompression = BitmapCompression.ZIP;
      monochromeBitmapCompression = MonoBitmapCompression.ZIP;
      
      // Quality settings (for fallback)
      colorBitmapQuality = CompressionQuality.MAXIMUM;
      grayscaleBitmapQuality = CompressionQuality.MAXIMUM;
      
      // Compress text
      compressTextAndLineArt = true;
      
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
    log.push("  - Downsampling: NONE");
    log.push("  - Color compression: ZIP (lossless)");
    log.push("  - Grayscale compression: ZIP (lossless)");
    log.push("  - Monochrome compression: ZIP (lossless)");
    log.push("");
    
    log.push("Exporting PDF (this may take a while for lossless)...");
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
  writeLog("export_af4_lossless_" + ts + ".txt", log.join("\n"));
  
  restoreUI();
  alert("Export complete!\n\nOutput: " + outputPdf);
})();








