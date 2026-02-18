/**
 * Export All Resized Covers to PDF
 * Exports all .indd files in the resized spreads folder to PDF
 */

var folderPath = "/Users/asafgafni/Downloads/MBO 2024/Cover/resized spreads";

(function() {
    if (app.name !== "Adobe InDesign") {
        alert("This script must be run in Adobe InDesign.");
        return;
    }
    
    var folder = new Folder(folderPath);
    
    if (!folder.exists) {
        alert("Folder not found:\n" + folderPath);
        return;
    }
    
    // Get all .indd files
    var inddFiles = folder.getFiles("*.indd");
    
    if (inddFiles.length === 0) {
        alert("No .indd files found in folder.");
        return;
    }
    
    var confirmMsg = "Found " + inddFiles.length + " InDesign files.\n\n";
    for (var i = 0; i < inddFiles.length; i++) {
        confirmMsg += "• " + inddFiles[i].name + "\n";
    }
    confirmMsg += "\nExport all to PDF?";
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    var exported = 0;
    var errors = [];
    
    // Set up PDF export preset (High Quality Print)
    var pdfPreset;
    try {
        pdfPreset = app.pdfExportPresets.itemByName("[High Quality Print]");
        if (!pdfPreset.isValid) {
            pdfPreset = app.pdfExportPresets.itemByName("[Press Quality]");
        }
    } catch (e) {
        // Use default if preset not found
        pdfPreset = null;
    }
    
    for (var i = 0; i < inddFiles.length; i++) {
        var inddFile = inddFiles[i];
        var pdfPath = inddFile.fsName.replace(/\.indd$/i, ".pdf");
        var pdfFile = new File(pdfPath);
        
        $.writeln("Processing: " + inddFile.name);
        
        try {
            // Open the document
            var doc = app.open(inddFile);
            
            // Set PDF export preferences for print-ready output
            with (app.pdfExportPreferences) {
                // Bleed settings - include bleed
                useDocumentBleedWithPDF = true;
                
                // Marks (optional - uncomment if needed)
                // cropMarks = true;
                // bleedMarks = true;
                // registrationMarks = true;
                
                // Color
                colorBitmapSampling = Sampling.BICUBIC_DOWNSAMPLE;
                colorBitmapSamplingDPI = 300;
                
                // Compression
                colorBitmapCompression = BitmapCompression.AUTO_COMPRESSION;
                colorBitmapQuality = CompressionQuality.MAXIMUM;
            }
            
            // Export to PDF
            doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
            
            $.writeln("Exported: " + pdfFile.name);
            exported++;
            
            // Close without saving
            doc.close(SaveOptions.NO);
            
        } catch (e) {
            errors.push(inddFile.name + ": " + e.message);
            $.writeln("Error: " + e.message);
            
            // Try to close if open
            try {
                if (app.documents.length > 0) {
                    app.activeDocument.close(SaveOptions.NO);
                }
            } catch (closeError) {}
        }
    }
    
    // Report results
    var resultMsg = "PDF Export Complete\n\n";
    resultMsg += "Exported: " + exported + " of " + inddFiles.length + " files\n\n";
    
    if (errors.length > 0) {
        resultMsg += "Errors:\n";
        for (var e = 0; e < errors.length; e++) {
            resultMsg += "• " + errors[e] + "\n";
        }
    }
    
    // Write result to file
    var resultFile = new File(folderPath + "/export-result.txt");
    resultFile.open("w");
    resultFile.write(resultMsg);
    resultFile.close();
    
    alert(resultMsg);
})();

