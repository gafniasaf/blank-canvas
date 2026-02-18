/**
 * Export Chapter Opener Pages for Pathologie N4
 * 
 * Pathologie has separate INDD files per chapter. This script:
 * 1. Opens each chapter file
 * 2. Exports the first page (chapter opener) as JPEG
 * 3. Closes the file
 * 
 * Run this in InDesign.
 */

#target "indesign"

(function() {
    var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Pathologie nivo 4_9789083412016_03/";
    var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/images/pathologie_chapter_openers/";
    
    // Chapter files pattern
    var chapterFiles = [
        { num: 1, file: "Pathologie_mbo_CH01_03.2024.indd" },
        { num: 2, file: "Pathologie_mbo_CH02_03.2024.indd" },
        { num: 3, file: "Pathologie_mbo_CH03_03.2024.indd" },
        { num: 4, file: "Pathologie_mbo_CH04_03.2024.indd" },
        { num: 5, file: "Pathologie_mbo_CH05_03.2024.indd" },
        { num: 6, file: "Pathologie_mbo_CH06_03.2024.indd" },
        { num: 7, file: "Pathologie_mbo_CH07_03.2024.indd" },
        { num: 8, file: "Pathologie_mbo_CH08_03.2024.indd" },
        { num: 9, file: "Pathologie_mbo_CH09_03.2024.indd" },
        { num: 10, file: "Pathologie_mbo_CH10_03.2024.indd" },
        { num: 11, file: "Pathologie_mbo_CH11_03.2024.indd" },
        { num: 12, file: "Pathologie_mbo_CH12_03.2024.indd" }
    ];
    
    // Create output directory if needed
    var outputFolder = new Folder(OUTPUT_DIR);
    if (!outputFolder.exists) {
        outputFolder.create();
    }
    
    // Set export preferences
    var exportPrefs = app.jpegExportPreferences;
    exportPrefs.jpegQuality = JPEGOptionsQuality.MAXIMUM;
    exportPrefs.exportResolution = 150;
    exportPrefs.jpegColorSpace = JpegColorSpaceEnum.RGB;
    exportPrefs.antiAlias = true;
    exportPrefs.simulateOverprint = false;
    exportPrefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
    
    var exported = 0;
    
    for (var i = 0; i < chapterFiles.length; i++) {
        var chInfo = chapterFiles[i];
        var filePath = BASE_DIR + chInfo.file;
        var inddFile = new File(filePath);
        
        if (!inddFile.exists) {
            $.writeln("File not found: " + filePath);
            continue;
        }
        
        $.writeln("Processing chapter " + chInfo.num + ": " + chInfo.file);
        
        try {
            // Open the document
            var doc = app.open(inddFile);
            
            // Get first page
            var firstPage = doc.pages[0];
            var pageName = firstPage.name;
            
            // Export first page
            var outFile = new File(OUTPUT_DIR + "chapter_" + chInfo.num + "_opener.jpg");
            exportPrefs.pageString = pageName;
            
            doc.exportFile(ExportFormat.JPG, outFile, false);
            $.writeln("  Exported: " + outFile.fsName);
            exported++;
            
            // Close without saving
            doc.close(SaveOptions.NO);
            
        } catch (e) {
            $.writeln("ERROR processing " + chInfo.file + ": " + e.message);
        }
    }
    
    $.writeln("\nDone! Exported " + exported + " chapter opener images.");
    alert("Exported " + exported + " chapter opener images to:\n" + OUTPUT_DIR);
})();











