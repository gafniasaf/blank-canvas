/**
 * export-vth4-all-chapters.jsx
 * Export all VTH nivo 4 chapters as individual PDFs, then optionally merge.
 * This bypasses issues with opening the .indb book file.
 */

#target indesign

(function() {
    var BOOK_FOLDER = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
    var OUTPUT_FOLDER = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/VTH4_chapters";
    var LOG_FILE = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/export-vth4-all.log";
    
    // Chapter file pattern: NN-VTH_Combined_03.2024.indd (01 through 30, plus 00_TOC and 31_INDEX)
    var CHAPTER_FILES = [
        "00_TOC-VTH_Combined_03.2024.indd",
        "01-VTH_Combined_03.2024.indd",
        "02-VTH_Combined_03.2024.indd",
        "03-VTH_Combined_03.2024.indd",
        "04-VTH_Combined_03.2024.indd",
        "05-VTH_Combined_03.2024.indd",
        "06-VTH_Combined_03.2024.indd",
        "07-VTH_Combined_03.2024.indd",
        "08-VTH_Combined_03.2024.indd",
        "09-VTH_Combined_03.2024.indd",
        "10-VTH_Combined_03.2024.indd",
        "11-VTH_Combined_03.2024.indd",
        "12-VTH_Combined_03.2024.indd",
        "13-VTH_Combined_03.2024.indd",
        "14-VTH_Combined_03.2024.indd",
        "15-VTH_Combined_03.2024.indd",
        "16-VTH_Combined_03.2024.indd",
        "17-VTH_Combined_03.2024.indd",
        "18-VTH_Combined_03.2024.indd",
        "19-VTH_Combined_03.2024.indd",
        "20-VTH_Combined_03.2024.indd",
        "21-VTH_Combined_03.2024.indd",
        "22-VTH_Combined_03.2024.indd",
        "23-VTH_Combined_03.2024.indd",
        "24-VTH_Combined_03.2024.indd",
        "25-VTH_Combined_03.2024.indd",
        "26-VTH_Combined_03.2024.indd",
        "27-VTH_Combined_03.2024.indd",
        "28-VTH_Combined_03.2024.indd",
        "29-VTH_Combined_03.2024.indd",
        "30-VTH_Combined_03.2024.indd",
        "31_INDEX-VTH_Combined_03.2024.indd"
    ];
    
    function log(msg) {
        var now = new Date();
        var ts = now.getFullYear() + "-" + 
                 ("0" + (now.getMonth()+1)).slice(-2) + "-" +
                 ("0" + now.getDate()).slice(-2) + " " +
                 ("0" + now.getHours()).slice(-2) + ":" +
                 ("0" + now.getMinutes()).slice(-2) + ":" +
                 ("0" + now.getSeconds()).slice(-2);
        var logFile = new File(LOG_FILE);
        logFile.open("a");
        logFile.writeln("[" + ts + "] " + msg);
        logFile.close();
    }
    
    // Clear old log
    var logFile = new File(LOG_FILE);
    if (logFile.exists) logFile.remove();
    
    log("Script started - exporting all chapters");
    
    // Suppress ALL dialogs
    var origInteraction = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    
    // Create output folder
    var outFolder = new Folder(OUTPUT_FOLDER);
    if (!outFolder.exists) {
        outFolder.create();
        log("Created output folder: " + OUTPUT_FOLDER);
    }
    
    // Close all open documents first
    log("Closing all open documents...");
    while (app.documents.length > 0) {
        app.documents[0].close(SaveOptions.NO);
    }
    
    var successCount = 0;
    var failCount = 0;
    
    for (var i = 0; i < CHAPTER_FILES.length; i++) {
        var filename = CHAPTER_FILES[i];
        var inddPath = BOOK_FOLDER + "/" + filename;
        var pdfName = filename.replace(".indd", ".pdf");
        var pdfPath = OUTPUT_FOLDER + "/" + pdfName;
        
        try {
            var inddFile = new File(inddPath);
            if (!inddFile.exists) {
                log("SKIP: " + filename + " (not found)");
                continue;
            }
            
            log("Processing: " + filename);
            
            var doc = app.open(inddFile);
            
            var outFile = new File(pdfPath);
            app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
            app.pdfExportPreferences.viewPDF = false;
            
            doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
            
            doc.close(SaveOptions.NO);
            
            if (outFile.exists) {
                var sizeMB = Math.round(outFile.length / 1024) + " KB";
                log("  SUCCESS: " + pdfName + " (" + sizeMB + ")");
                successCount++;
            } else {
                log("  WARNING: PDF not created");
                failCount++;
            }
            
        } catch (e) {
            log("  ERROR: " + e.message);
            failCount++;
            // Try to close any open doc
            try { if (app.documents.length > 0) app.documents[0].close(SaveOptions.NO); } catch(e2) {}
        }
    }
    
    log("Complete: " + successCount + " exported, " + failCount + " failed");
    log("Output folder: " + OUTPUT_FOLDER);
    log("Script finished");
    
    app.scriptPreferences.userInteractionLevel = origInteraction;
    
})();









