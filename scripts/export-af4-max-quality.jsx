// ============================================================
// EXPORT A&F N4 PDF - Maximum Image Quality (No Downsampling)
// ============================================================
// Purpose:
// - Export the A&F N4 InDesign document to PDF with MAXIMUM image quality
// - NO downsampling of images
// - Labels and text remain exactly as in the layout
//
// Key settings:
// - Color images: No downsampling, ZIP compression
// - Grayscale images: No downsampling, ZIP compression
// - Monochrome images: No downsampling, ZIP compression
// - JPEG quality: Maximum (if JPEG is used)
// ============================================================

#targetengine "session"

(function () {
  // Suppress dialogs
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
  log.push("A&F N4 PDF Export - Maximum Quality");
  log.push("Started: " + new Date().toString());
  log.push("");
  
  // Source INDD
  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var outputDir = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/";
  var outputPdf = outputDir + "MBO_AF4_N4_MAX_QUALITY_" + isoStamp() + ".pdf";
  
  log.push("Source: " + srcPath);
  log.push("Output: " + outputPdf);
  log.push("");
  
  var srcFile = File(srcPath);
  if (!srcFile.exists) {
    log.push("ERROR: Source file not found!");
    writeLog("export_af4_maxquality_ERROR.txt", log.join("\n"));
    restoreUI();
    return;
  }
  
  try {
    // Open document
    log.push("Opening document...");
    var doc = app.open(srcFile, false); // false = don't show window (faster)
    log.push("Document opened: " + doc.name);
    log.push("Pages: " + doc.pages.length);
    log.push("");
    
    // Configure PDF export preset
    log.push("Configuring PDF export settings...");
    
    with (app.pdfExportPreferences) {
      // General
      pageRange = PageRange.ALL_PAGES;
      exportLayers = false;
      exportGuidesAndGrids = false;
      exportNonPrintingObjects = false;
      generateThumbnails = false;
      optimizePDF = false;  // Don't optimize (keeps quality)
      
      // Compression - NO DOWNSAMPLING
      // Color images
      colorBitmapCompression = BitmapCompression.ZIP;
      colorBitmapSampling = Sampling.NONE;  // NO downsampling
      colorBitmapQuality = CompressionQuality.MAXIMUM;
      
      // Grayscale images
      grayscaleBitmapCompression = BitmapCompression.ZIP;
      grayscaleBitmapSampling = Sampling.NONE;  // NO downsampling
      grayscaleBitmapQuality = CompressionQuality.MAXIMUM;
      
      // Monochrome images
      monochromeBitmapCompression = MonoBitmapCompression.ZIP;
      monochromeBitmapSampling = Sampling.NONE;  // NO downsampling
      
      // Compression text and line art
      compressTextAndLineArt = true;
      
      // Output - use destinationProfile approach instead
      // colorConversionType is not available in all InDesign versions
      try {
        pdfColorSpace = PDFColorSpace.UNCHANGED_COLOR_SPACE;
      } catch (e) {
        // Fallback - just skip color conversion settings
      }
      
      // Advanced
      omitBitmaps = false;
      omitEPS = false;
      omitPDF = false;
      
      // Printers marks - none
      bleedBottom = 0;
      bleedTop = 0;
      bleedInside = 0;
      bleedOutside = 0;
      cropMarks = false;
      bleedMarks = false;
      registrationMarks = false;
      colorBars = false;
      pageInformationMarks = false;
    }
    
    log.push("PDF settings configured:");
    log.push("  - Color images: ZIP compression, NO downsampling");
    log.push("  - Grayscale images: ZIP compression, NO downsampling");
    log.push("  - Monochrome images: ZIP compression, NO downsampling");
    log.push("  - Color conversion: None");
    log.push("");
    
    // Export PDF
    log.push("Exporting PDF...");
    var outFile = File(outputPdf);
    doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
    log.push("PDF exported successfully!");
    log.push("");
    
    // Get file size
    if (outFile.exists) {
      var sizeMB = (outFile.length / (1024 * 1024)).toFixed(2);
      log.push("Output file size: " + sizeMB + " MB");
    }
    
    // Close document without saving
    doc.close(SaveOptions.NO);
    log.push("Document closed.");
    
  } catch (e) {
    log.push("ERROR: " + String(e.message || e));
    log.push("Line: " + (e.line || "unknown"));
  }
  
  log.push("");
  log.push("Finished: " + new Date().toString());
  
  // Write log
  writeLog("export_af4_maxquality_" + isoStamp() + ".txt", log.join("\n"));
  
  restoreUI();
  alert("Export complete!\n\nOutput: " + outputPdf + "\n\nCheck Desktop for log file.");
})();

