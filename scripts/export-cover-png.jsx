/**
 * Export InDesign cover to high-res PNG
 * Run this script in InDesign with the cover file open
 */

#target indesign

(function() {
    // Check if a document is open
    if (app.documents.length === 0) {
        alert("Please open the cover InDesign file first.");
        return;
    }
    
    var doc = app.activeDocument;
    var docName = doc.name.replace(/\.indd$/i, '');
    
    // Output folder - same as document location or Desktop
    var outputFolder;
    try {
        outputFolder = doc.filePath;
    } catch (e) {
        outputFolder = Folder.desktop;
    }
    
    var outputFile = new File(outputFolder + "/" + docName + "_COVER_HIGHRES.png");
    
    // PNG export options
    app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.EXPORT_ALL;
    app.pngExportPreferences.exportResolution = 300; // High-res 300 DPI
    app.pngExportPreferences.pngColorSpace = PNGColorSpaceEnum.RGB;
    app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
    app.pngExportPreferences.transparentBackground = false; // White background
    app.pngExportPreferences.antiAlias = true;
    app.pngExportPreferences.useDocumentBleeds = true; // Include bleeds for print
    
    // Export
    try {
        doc.exportFile(ExportFormat.PNG_FORMAT, outputFile, false);
        alert("Cover exported successfully!\n\nFile: " + outputFile.fsName);
    } catch (e) {
        alert("Export failed: " + e.message);
    }
})();





