/**
 * Resize Cover Using Transform
 * Uses InDesign's transform to properly scale all content including images
 */

var CONFIG = {
    source: "/Users/asafgafni/Downloads/MBO 2024/Cover/Communicatie advies en instructie in de zorg_170x240_9789083251387_04.2024.indd",
    targetWidth: 435,
    targetHeight: 297,
    spine: 15,
    suffix: "_RESIZED_297x435_spine15mm"
};

var OUTPUT_FOLDER = "/Users/asafgafni/Downloads/MBO 2024/Cover/resized spreads";
var mmToPoints = 2.834645669291339;
var pointsToMm = 0.352777778;

(function() {
    var sourceFile = new File(CONFIG.source);
    if (!sourceFile.exists) {
        alert("File not found");
        return;
    }
    
    var doc = app.open(sourceFile);
    
    // Get original dimensions
    var origWidthPt = doc.documentPreferences.pageWidth;
    var origHeightPt = doc.documentPreferences.pageHeight;
    var origWidthMm = origWidthPt * pointsToMm;
    var origHeightMm = origHeightPt * pointsToMm;
    
    var targetWidthPt = CONFIG.targetWidth * mmToPoints;
    var targetHeightPt = CONFIG.targetHeight * mmToPoints;
    
    // Calculate scale percentages
    var scaleX = (CONFIG.targetWidth / origWidthMm) * 100;
    var scaleY = (CONFIG.targetHeight / origHeightMm) * 100;
    
    var info = "Original: " + origWidthMm.toFixed(1) + " x " + origHeightMm.toFixed(1) + " mm\n";
    info += "Target: " + CONFIG.targetWidth + " x " + CONFIG.targetHeight + " mm\n";
    info += "Scale X: " + scaleX.toFixed(1) + "%\n";
    info += "Scale Y: " + scaleY.toFixed(1) + "%\n\n";
    info += "Continue?";
    
    if (!confirm(info)) {
        doc.close(SaveOptions.NO);
        return;
    }
    
    // First, group all items on each spread and transform the group
    for (var s = 0; s < doc.spreads.length; s++) {
        var spread = doc.spreads[s];
        var items = spread.allPageItems;
        
        if (items.length === 0) continue;
        
        $.writeln("Spread " + s + ": " + items.length + " items");
        
        // Transform each item individually using resize method
        for (var i = items.length - 1; i >= 0; i--) {
            var item = items[i];
            
            try {
                // Get original bounds
                var bounds = item.geometricBounds;
                
                // Calculate anchor point (top-left of page)
                var anchorX = bounds[1];
                var anchorY = bounds[0];
                
                // Use transform with scale
                // AnchorPoint, horizontalScale, verticalScale
                item.transform(
                    CoordinateSpaces.PASTEBOARD_COORDINATES,
                    AnchorPoint.TOP_LEFT_ANCHOR,
                    app.transformationMatrices.add({
                        horizontalScaleFactor: scaleX / 100,
                        verticalScaleFactor: scaleY / 100
                    })
                );
                
                // Now reposition based on new scale
                var newBounds = item.geometricBounds;
                var newX = bounds[1] * (scaleX / 100);
                var newY = bounds[0] * (scaleY / 100);
                
                item.move([newX, newY]);
                
            } catch (e) {
                $.writeln("Transform error on item " + i + ": " + e.message);
            }
        }
    }
    
    // Update page dimensions
    doc.documentPreferences.pageWidth = targetWidthPt;
    doc.documentPreferences.pageHeight = targetHeightPt;
    
    // Set bleed
    doc.documentPreferences.documentBleedTopOffset = 3 * mmToPoints;
    doc.documentPreferences.documentBleedBottomOffset = 3 * mmToPoints;
    doc.documentPreferences.documentBleedInsideOrLeftOffset = 0;
    doc.documentPreferences.documentBleedOutsideOrRightOffset = 3 * mmToPoints;
    
    // Save
    var outputName = sourceFile.name.replace(/\.indd$/i, CONFIG.suffix + ".indd");
    var outputFile = new File(OUTPUT_FOLDER + "/" + outputName);
    doc.saveACopy(outputFile);
    
    // Export PDF
    app.pdfExportPreferences.useDocumentBleedWithPDF = true;
    var pdfFile = new File(OUTPUT_FOLDER + "/" + outputName.replace(/\.indd$/i, ".pdf"));
    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
    
    doc.close(SaveOptions.NO);
    
    alert("Done!\n\nScale applied: " + scaleX.toFixed(1) + "% x " + scaleY.toFixed(1) + "%\n\nSaved to:\n" + outputName);
})();

