/**
 * Batch Resize All Covers
 * Re-processes all covers with non-uniform scaling to fill page
 */

var COVERS = [
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Cover/Communicatie advies en instructie in de zorg_170x240_9789083251387_04.2024.indd",
        width: 435, height: 297, spine: 15,
        suffix: "_RESIZED_297x435_spine15mm"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Cover/Methodisch werken en kwaliteitsverbetering in de zorg voor het mbo_170x240_9789083251394_04.2024.indd",
        width: 440, height: 297, spine: 20,
        suffix: "_RESIZED_297x440_spine20mm"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Cover/Wetgeving en beleid in de zorg voor het mbo_170x240_9789083412061_04.2024.indd",
        width: 436, height: 297, spine: 16,
        suffix: "_RESIZED_297x436_spine16mm"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Cover/Pathologie voor het mbo_195x265_9789083412016_04.2024.indd",
        width: 444, height: 297, spine: 24,
        suffix: "_RESIZED_297x444_spine24mm"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Cover/Praktijkgestuurd klinisch redeneren voor het mbo_170x240_9789083412030_04.2024.indd",
        width: 437, height: 297, spine: 17,
        suffix: "_RESIZED_297x437_spine17mm"
    }
];

var OUTPUT_FOLDER = "/Users/asafgafni/Downloads/MBO 2024/Cover/resized spreads";
var mmToPoints = 2.834645669291339;

(function() {
    if (app.name !== "Adobe InDesign") {
        alert("Run in InDesign");
        return;
    }
    
    if (!confirm("Re-process all " + COVERS.length + " covers with full-page scaling?\n\nThis will overwrite existing files.")) {
        return;
    }
    
    var processed = 0;
    var errors = [];
    
    for (var c = 0; c < COVERS.length; c++) {
        var cover = COVERS[c];
        $.writeln("\n=== Processing " + (c+1) + "/" + COVERS.length + " ===");
        $.writeln("Source: " + cover.source);
        
        try {
            var sourceFile = new File(cover.source);
            if (!sourceFile.exists) {
                errors.push("Not found: " + cover.source);
                continue;
            }
            
            var doc = app.open(sourceFile);
            
            var originalWidth = doc.documentPreferences.pageWidth;
            var originalHeight = doc.documentPreferences.pageHeight;
            
            var targetWidthPt = cover.width * mmToPoints;
            var targetHeightPt = cover.height * mmToPoints;
            
            var scaleX = targetWidthPt / originalWidth;
            var scaleY = targetHeightPt / originalHeight;
            
            $.writeln("Scale X: " + scaleX.toFixed(3) + ", Y: " + scaleY.toFixed(3));
            
            // Update page size
            doc.documentPreferences.pageWidth = targetWidthPt;
            doc.documentPreferences.pageHeight = targetHeightPt;
            
            // Set bleed
            doc.documentPreferences.documentBleedTopOffset = 3 * mmToPoints;
            doc.documentPreferences.documentBleedBottomOffset = 3 * mmToPoints;
            doc.documentPreferences.documentBleedInsideOrLeftOffset = 0;
            doc.documentPreferences.documentBleedOutsideOrRightOffset = 3 * mmToPoints;
            
            // Scale all content
            for (var s = 0; s < doc.spreads.length; s++) {
                var spread = doc.spreads[s];
                
                for (var p = 0; p < spread.pages.length; p++) {
                    var pageItems = spread.pages[p].allPageItems;
                    
                    for (var i = 0; i < pageItems.length; i++) {
                        scaleItem(pageItems[i], scaleX, scaleY);
                    }
                }
                
                // Spread-level items
                for (var si = 0; si < spread.pageItems.length; si++) {
                    if (spread.pageItems[si].parent.constructor.name === "Spread") {
                        scaleItem(spread.pageItems[si], scaleX, scaleY);
                    }
                }
            }
            
            // Save to output folder
            var outputName = sourceFile.name.replace(/\.indd$/i, cover.suffix + ".indd");
            var outputPath = OUTPUT_FOLDER + "/" + outputName;
            var outputFile = new File(outputPath);
            
            doc.saveACopy(outputFile);
            $.writeln("Saved: " + outputName);
            
            // Export PDF
            var pdfPath = outputPath.replace(/\.indd$/i, ".pdf");
            var pdfFile = new File(pdfPath);
            
            app.pdfExportPreferences.useDocumentBleedWithPDF = true;
            doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
            $.writeln("PDF: " + pdfFile.name);
            
            doc.close(SaveOptions.NO);
            processed++;
            
        } catch (e) {
            errors.push(cover.source.split("/").pop() + ": " + e.message);
            $.writeln("ERROR: " + e.message);
            try { app.activeDocument.close(SaveOptions.NO); } catch(x) {}
        }
    }
    
    var msg = "Batch Complete!\n\n";
    msg += "Processed: " + processed + "/" + COVERS.length + "\n";
    if (errors.length > 0) {
        msg += "\nErrors:\n" + errors.join("\n");
    }
    alert(msg);
})();

function scaleItem(item, scaleX, scaleY) {
    try {
        var bounds = item.geometricBounds; // [y1, x1, y2, x2]
        
        // Scale position
        var newY1 = bounds[0] * scaleY;
        var newX1 = bounds[1] * scaleX;
        var newY2 = bounds[2] * scaleY;
        var newX2 = bounds[3] * scaleX;
        
        item.geometricBounds = [newY1, newX1, newY2, newX2];
        
        // Scale text
        if (item.constructor.name === "TextFrame") {
            var avgScale = (scaleX + scaleY) / 2;
            try {
                for (var t = 0; t < item.texts.length; t++) {
                    var paras = item.texts[t].paragraphs;
                    for (var p = 0; p < paras.length; p++) {
                        if (typeof paras[p].pointSize === "number") {
                            paras[p].pointSize *= avgScale;
                        }
                        if (typeof paras[p].leading === "number") {
                            paras[p].leading *= avgScale;
                        }
                    }
                }
            } catch(te) {}
        }
    } catch (e) {
        $.writeln("Skip: " + e.message);
    }
}

