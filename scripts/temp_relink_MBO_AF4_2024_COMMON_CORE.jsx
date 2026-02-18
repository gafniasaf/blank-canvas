// Auto-generated script for MBO_AF4_2024_COMMON_CORE
#target "InDesign"
#targetengine "session"

(function () {
  var LOG_FILE_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_2024_COMMON_CORE_log.txt";
  var INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var HIGH_RES_FOLDER = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_2024_COMMON_CORE_images";
  var OUTPUT_PDF_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf";

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

  log("Script started - Relink and Export for MBO_AF4_2024_COMMON_CORE");
  
  // Suppress dialogs
  var originalInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  try {
    // 1. Open Document
    log("Opening document: " + INDD_PATH);
    app.open(new File(INDD_PATH), false);
    var doc = app.activeDocument;
    
    // 2. Relink Images
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
    var tempPresetName = "Temp_HighRes_MBO_AF4_2024_COMMON_CORE_" + Math.floor(Math.random() * 10000);
    
    var basePreset = app.pdfExportPresets.item(basePresetName);
    if (!basePreset.isValid) {
      throw new Error("Base preset " + basePresetName + " not found!");
    }
    
    var myPreset = basePreset.duplicate();
    myPreset.name = tempPresetName;
    
    myPreset.colorBitmapSampling = Sampling.NONE;
    myPreset.grayscaleBitmapSampling = Sampling.NONE;
    myPreset.monochromeBitmapSampling = Sampling.NONE;
    
    // 4. Export
    log("Exporting to PDF: " + OUTPUT_PDF_PATH);
    doc.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF_PATH), false, myPreset);
    
    log("Export successful!");
    
    myPreset.remove();
    doc.close(SaveOptions.NO);
    log("Document closed.");

  } catch (e) {
    log("FATAL ERROR: " + e.message + " (Line " + e.line + ")");
  } finally {
    app.scriptPreferences.userInteractionLevel = originalInteractionLevel;
    log("Script finished.");
  }
})();
