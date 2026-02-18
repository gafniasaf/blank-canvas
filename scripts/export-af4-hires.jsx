/**
 * export-af4-hires.jsx
 * Export MBO A&F 4 (N4) as HIGH RESOLUTION PDF directly from InDesign.
 */

#target indesign

(function() {
    var INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
    var OUTPUT_PDF = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/MBO_AF4_N4_ORIGINAL_HIRES.pdf";
    var LOG_FILE = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/export-af4-hires.log";
    
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
    
    log("Script started - A&F N4 HIGH RESOLUTION export");
    log("INDD_PATH: " + INDD_PATH);
    log("OUTPUT_PDF: " + OUTPUT_PDF);
    
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
        
        // Configure HIGH QUALITY PDF export settings
        with (app.pdfExportPreferences) {
            pageRange = PageRange.ALL_PAGES;
            viewPDF = false;
            
            // ===== IMAGE QUALITY - NO DOWNSAMPLING =====
            colorBitmapSampling = Sampling.NONE;
            colorBitmapCompression = BitmapCompression.ZIP;
            colorBitmapQuality = CompressionQuality.MAXIMUM;
            
            grayscaleBitmapSampling = Sampling.NONE;
            grayscaleBitmapCompression = BitmapCompression.ZIP;
            grayscaleBitmapQuality = CompressionQuality.MAXIMUM;
            
            monochromeBitmapSampling = Sampling.NONE;
            monochromeBitmapCompression = BitmapCompression.ZIP;
            
            // ===== FONTS =====
            subsetFontsBelow = 0;
            
            // ===== GENERAL =====
            acrobatCompatibility = AcrobatCompatibility.ACROBAT_7;
            
            // No marks
            cropMarks = false;
            bleedMarks = false;
            registrationMarks = false;
            colorBars = false;
            pageInformationMarks = false;
            
            useDocumentBleedWithPDF = true;
            compressTextAndLineArt = true;
            includeBookmarks = true;
            includeHyperlinks = true;
            exportLayers = false;
        }
        
        log("PDF preferences configured for maximum quality");
        log("Opening document...");
        
        var doc = app.open(inddFile);
        
        log("Document opened: " + doc.name);
        log("Page count: " + doc.pages.length);
        
        var outFile = new File(OUTPUT_PDF);
        
        log("Exporting to PDF...");
        
        doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
        
        log("Export command completed");
        
        // Verify
        if (outFile.exists) {
            var sizeMB = Math.round(outFile.length / 1024 / 1024 * 10) / 10;
            log("SUCCESS: PDF created, size: " + sizeMB + " MB");
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









