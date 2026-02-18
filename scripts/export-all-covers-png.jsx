/**
 * Export ALL InDesign cover files in a folder to high-res PNG
 * Run this script in InDesign
 */

#target indesign

(function() {
    // Source folder with cover InDesign files
    var sourceFolder = new Folder("/Users/asafgafni/Downloads/MBO 2024/Cover");
    
    // Output folder for PNGs
    var outputFolder = new Folder("/Users/asafgafni/Desktop/InDesign/TestRun/output/covers_highres");
    if (!outputFolder.exists) {
        outputFolder.create();
    }
    
    // Get all .indd files
    var inddFiles = sourceFolder.getFiles("*.indd");
    
    if (inddFiles.length === 0) {
        alert("No InDesign files found in:\n" + sourceFolder.fsName);
        return;
    }
    
    var exportedCount = 0;
    var failedFiles = [];
    
    // PNG export settings
    app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.EXPORT_ALL;
    app.pngExportPreferences.exportResolution = 300;
    app.pngExportPreferences.pngColorSpace = PNGColorSpaceEnum.RGB;
    app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
    app.pngExportPreferences.transparentBackground = false;
    app.pngExportPreferences.antiAlias = true;
    app.pngExportPreferences.useDocumentBleeds = true;
    
    for (var i = 0; i < inddFiles.length; i++) {
        var inddFile = inddFiles[i];
        var docName = inddFile.name.replace(/\.indd$/i, '');
        
        // Create a clean short name for the output
        var shortName = docName
            .replace(/_195x265_|_170x240_/g, '_')
            .replace(/_04\.2024$/, '')
            .replace(/\s+/g, '_');
        
        try {
            // Open document
            var doc = app.open(inddFile);
            
            // Export each page
            var pageCount = doc.pages.length;
            
            for (var p = 0; p < pageCount; p++) {
                app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;
                app.pngExportPreferences.pageString = String(p + 1);
                
                var suffix = (pageCount > 1) ? "_page" + (p + 1) : "";
                var outputFile = new File(outputFolder + "/" + shortName + suffix + ".png");
                
                doc.exportFile(ExportFormat.PNG_FORMAT, outputFile, false);
            }
            
            doc.close(SaveOptions.NO);
            exportedCount++;
            
        } catch (e) {
            failedFiles.push(docName + ": " + e.message);
            try { doc.close(SaveOptions.NO); } catch (ex) {}
        }
    }
    
    var message = "Export complete!\n\n";
    message += "Exported: " + exportedCount + " of " + inddFiles.length + " files\n";
    message += "Output folder: " + outputFolder.fsName;
    
    if (failedFiles.length > 0) {
        message += "\n\nFailed files:\n" + failedFiles.join("\n");
    }
    
    alert(message);
})();





