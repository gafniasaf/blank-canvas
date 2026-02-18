/**
 * export-vth4-pdf.jsx
 * Export the VTH nivo 4 InDesign book (.indb) directly to a high-quality PDF.
 * Writes progress to a log file for debugging.
 */

#target indesign

(function() {
    var BOOK_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/_MBO VTH nivo 4_9789083412054_03.2024.indb";
    var OUTPUT_PDF = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/MBO_VTH_nivo_4_ORIGINAL_FROM_INDESIGN.pdf";
    var LOG_FILE = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/export-vth4.log";
    
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
    
    log("Script started");
    log("BOOK_PATH: " + BOOK_PATH);
    log("OUTPUT_PDF: " + OUTPUT_PDF);
    
    // Suppress ALL dialogs (missing fonts, missing links, recovery, etc.)
    var origInteraction = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    
    try {
        // Check if the book file exists
        var bookFile = new File(BOOK_PATH);
        log("Book file exists: " + bookFile.exists);
        
        if (!bookFile.exists) {
            log("ERROR: Book file not found");
            return;
        }
        
        log("Opening book (with dialogs suppressed)...");
        
        // Open the book
        var book = app.open(bookFile);
        
        log("app.open returned: " + (book ? book.constructor.name : "null"));
        
        if (!(book instanceof Book)) {
            log("ERROR: Not a Book object, got: " + (book ? book.constructor.name : "null/undefined"));
            // Maybe it's a Document if the .indb contains only one doc?
            if (book instanceof Document) {
                log("Got Document instead of Book - this is a single-document scenario");
            }
            return;
        }
        
        var docCount = book.bookContents.length;
        log("Book has " + docCount + " documents");
        
        // List all documents in the book
        for (var i = 0; i < book.bookContents.length; i++) {
            var bc = book.bookContents[i];
            log("  Doc " + i + ": " + bc.name + " (status: " + bc.status + ")");
        }
        
        // Create output folder if needed
        var outFile = new File(OUTPUT_PDF);
        var outFolder = outFile.parent;
        if (!outFolder.exists) {
            outFolder.create();
            log("Created output folder");
        }
        
        // Basic export preferences
        app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
        app.pdfExportPreferences.viewPDF = false;
        
        log("Starting export...");
        
        // Export the entire book to PDF using default settings
        book.exportFile(ExportFormat.PDF_TYPE, outFile, false);
        
        log("Export command completed");
        
        // Verify export
        var verifyFile = new File(OUTPUT_PDF);
        if (verifyFile.exists) {
            log("SUCCESS: PDF created, size: " + Math.round(verifyFile.length / 1024 / 1024) + " MB");
        } else {
            log("WARNING: Export finished but PDF not found");
        }
        
        // Close the book without saving changes
        book.close(SaveOptions.NO);
        log("Book closed");
        
    } catch (e) {
        log("EXCEPTION: " + e.message + " (line " + e.line + ")");
    } finally {
        // Restore original interaction level
        app.scriptPreferences.userInteractionLevel = origInteraction;
        log("Script finished");
    }
    
})();
