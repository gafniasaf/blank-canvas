/**
 * export-vth4-single-chapter.jsx
 * Test: Export a single chapter from VTH nivo 4 to see if InDesign can open files.
 */

#target indesign

(function() {
    // Try opening the first chapter directly
    var INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/01-VTH_Combined_03.2024.indd";
    var OUTPUT_PDF = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/VTH4_CH01_TEST.pdf";
    var LOG_FILE = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/export-vth4-test.log";
    
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
    
    log("Script started - single chapter test");
    log("INDD_PATH: " + INDD_PATH);
    
    // Suppress ALL dialogs
    var origInteraction = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    
    try {
        var inddFile = new File(INDD_PATH);
        log("File exists: " + inddFile.exists);
        
        if (!inddFile.exists) {
            log("ERROR: File not found");
            return;
        }
        
        // Close all open documents first
        log("Closing all open documents...");
        while (app.documents.length > 0) {
            app.documents[0].close(SaveOptions.NO);
        }
        log("All documents closed");
        
        log("Opening document...");
        var doc = app.open(inddFile);
        
        log("Document opened: " + doc.name);
        log("Page count: " + doc.pages.length);
        
        // Export to PDF
        var outFile = new File(OUTPUT_PDF);
        log("Exporting to: " + OUTPUT_PDF);
        
        app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
        app.pdfExportPreferences.viewPDF = false;
        
        doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
        
        // Verify
        if (outFile.exists) {
            log("SUCCESS: PDF created, size: " + Math.round(outFile.length / 1024 / 1024) + " MB");
        } else {
            log("WARNING: PDF not found after export");
        }
        
        doc.close(SaveOptions.NO);
        log("Document closed");
        
    } catch (e) {
        log("EXCEPTION: " + e.message + " (line " + e.line + ")");
    } finally {
        app.scriptPreferences.userInteractionLevel = origInteraction;
        log("Script finished");
    }
    
})();









