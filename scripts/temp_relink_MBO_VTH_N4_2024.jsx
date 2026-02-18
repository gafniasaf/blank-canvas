// Auto-generated script for MBO_VTH_N4_2024 (INDB)
#target "InDesign"
#targetengine "session"

(function () {
  var LOG_FILE_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_VTH_N4_2024_log.txt";
  var INDB_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/_MBO VTH nivo 4_9789083412054_03.2024.indb";
  var HIGH_RES_FOLDER = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_VTH_N4_2024_images";
  var OUTPUT_PDF_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_VTH_N4_2024_HIGHRES.pdf";

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

  log("Script started - Relink and Export for BOOK: MBO_VTH_N4_2024");
  
  // CLEANUP: Close existing docs/books
  try { app.documents.everyItem().close(SaveOptions.NO); } catch(e) {}
  try { app.books.everyItem().close(SaveOptions.NO); } catch(e) {}
  
  var originalInteractionLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  try {
    log("Opening book: " + INDB_PATH);
    var myBook = app.open(new File(INDB_PATH));
    
    log("Processing " + myBook.bookContents.length + " chapters...");
    
    // Open all chapters
    var openedDocs = [];
    for (var i = 0; i < myBook.bookContents.length; i++) {
        var content = myBook.bookContents[i];
        log("Opening chapter: " + content.name);
        try {
            var doc = app.open(content.fullName, false); // Open visible=false
            openedDocs.push(doc);
            
            // Relink images in this doc
            var links = doc.links;
            var relinkCount = 0;
            for (var j = 0; j < links.length; j++) {
                var link = links[j];
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
                         // log("Failed to relink " + linkName);
                    }
                }
            }
            log("  > Relinked " + relinkCount + " images.");
            
        } catch(e) {
            log("Failed to open/process chapter " + content.name + ": " + e.message);
        }
    }
    
    log("Configuring PDF export...");
    var basePresetName = "[High Quality Print]";
    var tempPresetName = "Temp_HighRes_MBO_VTH_N4_2024_" + Math.floor(Math.random() * 10000);
    
    var basePreset = app.pdfExportPresets.item(basePresetName);
    if (!basePreset.isValid) throw new Error("Base preset not found!");
    
    var myPreset = basePreset.duplicate();
    myPreset.name = tempPresetName;
    myPreset.colorBitmapSampling = Sampling.NONE;
    myPreset.grayscaleBitmapSampling = Sampling.NONE;
    myPreset.monochromeBitmapSampling = Sampling.NONE;
    myPreset.colorBitmapCompression = BitmapCompression.ZIP;
    myPreset.grayscaleBitmapCompression = BitmapCompression.ZIP;
    myPreset.monochromeBitmapCompression = MonoBitmapCompression.ZIP;
    
    log("Exporting BOOK to PDF: " + OUTPUT_PDF_PATH);
    // Export the whole book
    myBook.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF_PATH), false, myPreset);
    
    log("Export successful!");
    
    myPreset.remove();
    
    // Close all opened docs without saving
    log("Closing " + openedDocs.length + " documents...");
    while (openedDocs.length > 0) {
        var d = openedDocs.pop();
        d.close(SaveOptions.NO);
    }
    
    // Close book
    myBook.close(SaveOptions.NO);

  } catch (e) {
    log("FATAL ERROR: " + e.message + " line " + e.line);
  } finally {
    app.scriptPreferences.userInteractionLevel = originalInteractionLevel;
    log("Script finished.");
  }
})();
