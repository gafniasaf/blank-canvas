// ============================================================
// RELINK TO HIGH-RES PNGs AND EXPORT PDF
// ============================================================
// 1. Opens the A&F N4 INDD file.
// 2. Relinks images to the high-res PNGs in 'new_pipeline/assets/figures_highres'.
// 3. Exports to PDF with Maximum Quality settings.
// ============================================================

#target "InDesign"
#targetengine "session"

(function () {
  var LOG_FILE_PATH = "/Users/asafgafni/Desktop/relink_export_log.txt";
  var INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var HIGH_RES_FOLDER = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/figures_highres";
  var OUTPUT_PDF_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/MBO_AF4_N4_RELINKED_HIGHRES.pdf";

  function log(message) {
    var f = new File(LOG_FILE_PATH);
    f.open("a");
    f.writeln("[" + new Date().toString() + "] " + message);
    f.close();
  }

  function getHighResPath(linkName) {
    var safeName = linkName.replace(/[^a-zA-Z0-9._-]/g, '_');
    var lastDotIndex = safeName.lastIndexOf('.');
    var baseName = (lastDotIndex > 0) ? safeName.substring(0, lastDotIndex) : safeName;
    return HIGH_RES_FOLDER + "/" + baseName + ".png";
  }

  log("Script started - Relink and Export");
  
  // Suppress dialogs
  var originalInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  try {
    // 1. Open Document
    log("Opening document: " + INDD_PATH);
    app.open(new File(INDD_PATH), false);
    var doc = app.activeDocument;
    
    // 2. Relink Images
    // Note: If document was already open and relinked, this step just verifies
    log("Scanning " + doc.links.length + " links...");
    var relinkCount = 0;
    
    var links = doc.links;
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.status === LinkStatus.LINK_MISSING) continue;
      
      var linkName = link.name;
      if (!linkName.match(/\.(tif|tiff|png|jpg|jpeg|psd|ai|eps)$/i)) continue;
      
      var newPath = getHighResPath(linkName);
      var newFile = new File(newPath);
      
      if (newFile.exists && link.filePath !== newFile.fsName) {
        try {
          link.relink(newFile);
          try { link.update(); } catch(e) {}
          relinkCount++;
        } catch (e) {
          log("Failed to relink " + linkName + ": " + e.message);
        }
      }
    }
    
    log("Relinked count: " + relinkCount);
    
    // 3. Configure PDF Export (Safe Method)
    log("Configuring PDF export...");
    
    var basePresetName = "[High Quality Print]";
    var tempPresetName = "Temp_HighRes_Export_" + Math.floor(Math.random() * 10000);
    
    var basePreset = app.pdfExportPresets.item(basePresetName);
    if (!basePreset.isValid) {
      throw new Error("Base preset " + basePresetName + " not found!");
    }
    
    // Create a duplicate to modify
    var myPreset = basePreset.duplicate();
    myPreset.name = tempPresetName;
    
    // Modify the duplicate
    // Disable downsampling to keep original resolution
    myPreset.colorBitmapSampling = Sampling.NONE;
    myPreset.grayscaleBitmapSampling = Sampling.NONE;
    myPreset.monochromeBitmapSampling = Sampling.NONE;
    
    // Try to set compression to ZIP if possible (using raw integer if enum fails, or just skipping if tricky)
    // PDFBitmapCompression.ZIP is often problematic to reference if enums aren't loaded. 
    // We will rely on High Quality Print's default compression (JPEG High) but with NO downsampling.
    // This is usually sufficient for "clean" images.
    
    // 4. Export
    log("Exporting to PDF: " + OUTPUT_PDF_PATH);
    // Signature: exportFile(format, to, showingOptions, using)
    doc.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF_PATH), false, myPreset);
    
    log("Export successful!");
    
    // Cleanup preset
    myPreset.remove();
    
    // 5. Close without saving
    doc.close(SaveOptions.NO);
    log("Document closed.");

  } catch (e) {
    log("FATAL ERROR: " + e.message + " (Line " + e.line + ")");
  } finally {
    app.scriptPreferences.userInteractionLevel = originalInteractionLevel;
    log("Script finished.");
  }

})();
