/**
 * Check Cover Dimensions Script
 * Reports the document dimensions of a cover file
 */

var filePath = "/Users/asafgafni/Downloads/MBO 2024/Cover/Praktijkgestuurd klinisch redeneren voor het mbo_170x240_9789083412030_04.2024_RESIZED_297x437_spine17mm.indd";

(function() {
    var pointsToMm = 0.352777778;
    
    try {
        var file = new File(filePath);
        
        if (!file.exists) {
            alert("File not found:\n" + filePath);
            return;
        }
        
        var doc = app.open(file);
        
        // Get dimensions in points
        var widthPt = doc.documentPreferences.pageWidth;
        var heightPt = doc.documentPreferences.pageHeight;
        
        // Convert to mm
        var widthMm = widthPt * pointsToMm;
        var heightMm = heightPt * pointsToMm;
        
        // Get bleed
        var bleedTop = doc.documentPreferences.documentBleedTopOffset * pointsToMm;
        var bleedBottom = doc.documentPreferences.documentBleedBottomOffset * pointsToMm;
        var bleedInside = doc.documentPreferences.documentBleedInsideOrLeftOffset * pointsToMm;
        var bleedOutside = doc.documentPreferences.documentBleedOutsideOrRightOffset * pointsToMm;
        
        // Build report
        var report = "DOCUMENT DIMENSIONS CHECK\n";
        report += "========================\n\n";
        report += "File: " + file.name + "\n\n";
        report += "PAGE SIZE:\n";
        report += "  Width:  " + widthMm.toFixed(2) + " mm (" + widthPt.toFixed(2) + " pt)\n";
        report += "  Height: " + heightMm.toFixed(2) + " mm (" + heightPt.toFixed(2) + " pt)\n\n";
        report += "TARGET:\n";
        report += "  Width:  437 mm\n";
        report += "  Height: 297 mm\n\n";
        report += "DIFFERENCE:\n";
        report += "  Width:  " + (widthMm - 437).toFixed(2) + " mm\n";
        report += "  Height: " + (heightMm - 297).toFixed(2) + " mm\n\n";
        report += "BLEED:\n";
        report += "  Top:     " + bleedTop.toFixed(2) + " mm\n";
        report += "  Bottom:  " + bleedBottom.toFixed(2) + " mm\n";
        report += "  Inside:  " + bleedInside.toFixed(2) + " mm\n";
        report += "  Outside: " + bleedOutside.toFixed(2) + " mm\n\n";
        
        // Check if dimensions match
        var widthOK = Math.abs(widthMm - 437) < 0.5;
        var heightOK = Math.abs(heightMm - 297) < 0.5;
        
        if (widthOK && heightOK) {
            report += "✓ DIMENSIONS MATCH TARGET!";
        } else {
            report += "✗ DIMENSIONS DO NOT MATCH TARGET";
        }
        
        // Write to file for easy reading
        var outputFile = new File("/Users/asafgafni/Desktop/InDesign/TestRun/dimension-check-result.txt");
        outputFile.open("w");
        outputFile.write(report);
        outputFile.close();
        
        alert(report);
        
        doc.close(SaveOptions.NO);
        
    } catch (e) {
        alert("Error: " + e.message);
    }
})();

