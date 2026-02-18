/**
 * export-vth4-all-chapters-hires.jsx
 * Export all VTH nivo 4 chapters as HIGH RESOLUTION PDFs (no downsampling).
 */

#target indesign

(function() {
    var BOOK_FOLDER = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
    var OUTPUT_FOLDER = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/VTH4_chapters_hires";
    var LOG_FILE = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/export-vth4-hires.log";
    
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
    
    log("Script started - HIGH RESOLUTION export");
    
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
    
    // Configure HIGH QUALITY PDF export settings
    with (app.pdfExportPreferences) {
        // Page range
        pageRange = PageRange.ALL_PAGES;
        viewPDF = false;
        
        // ===== IMAGE QUALITY - NO DOWNSAMPLING =====
        // Color images: no downsampling, maximum quality
        colorBitmapSampling = Sampling.NONE;
        colorBitmapCompression = BitmapCompression.ZIP;
        colorBitmapQuality = CompressionQuality.MAXIMUM;
        
        // Grayscale images: no downsampling, maximum quality
        grayscaleBitmapSampling = Sampling.NONE;
        grayscaleBitmapCompression = BitmapCompression.ZIP;
        grayscaleBitmapQuality = CompressionQuality.MAXIMUM;
        
        // Monochrome images: no downsampling
        monochromeBitmapSampling = Sampling.NONE;
        monochromeBitmapCompression = BitmapCompression.ZIP;
        
        // ===== FONTS =====
        // Embed all fonts (subset threshold 0% = always embed full font)
        subsetFontsBelow = 0;
        
        // ===== GENERAL =====
        // High compatibility
        acrobatCompatibility = AcrobatCompatibility.ACROBAT_7;
        
        // Color: don't convert (keep original color space)
        // Note: colorConversionType may not be available in all versions
        
        // No marks
        cropMarks = false;
        bleedMarks = false;
        registrationMarks = false;
        colorBars = false;
        pageInformationMarks = false;
        
        // Include bleed from document
        useDocumentBleedWithPDF = true;
        
        // Compression
        compressTextAndLineArt = true;
        
        // Bookmarks and hyperlinks
        includeBookmarks = true;
        includeHyperlinks = true;
        
        // Export layers: flatten
        exportLayers = false;
    }
    
    log("PDF preferences configured for maximum quality");
    
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
            
            doc.exportFile(ExportFormat.PDF_TYPE, outFile, false);
            
            doc.close(SaveOptions.NO);
            
            if (outFile.exists) {
                var sizeKB = Math.round(outFile.length / 1024);
                var sizeStr = sizeKB >= 1024 ? (Math.round(sizeKB / 102.4) / 10) + " MB" : sizeKB + " KB";
                log("  SUCCESS: " + pdfName + " (" + sizeStr + ")");
                successCount++;
            } else {
                log("  WARNING: PDF not created");
                failCount++;
            }
            
        } catch (e) {
            log("  ERROR: " + e.message);
            failCount++;
            try { if (app.documents.length > 0) app.documents[0].close(SaveOptions.NO); } catch(e2) {}
        }
    }
    
    log("Complete: " + successCount + " exported, " + failCount + " failed");
    log("Output folder: " + OUTPUT_FOLDER);
    log("Script finished");
    
    app.scriptPreferences.userInteractionLevel = origInteraction;
    
})();

