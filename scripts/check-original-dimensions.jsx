/**
 * Check original cover dimensions
 */

var files = [
    "/Users/asafgafni/Downloads/MBO 2024/Cover/Communicatie advies en instructie in de zorg_170x240_9789083251387_04.2024.indd"
];

var pointsToMm = 0.352777778;

(function() {
    for (var i = 0; i < files.length; i++) {
        var file = new File(files[i]);
        if (!file.exists) {
            $.writeln("Not found: " + files[i]);
            continue;
        }
        
        var doc = app.open(file);
        
        var w = doc.documentPreferences.pageWidth * pointsToMm;
        var h = doc.documentPreferences.pageHeight * pointsToMm;
        
        var report = "ORIGINAL: " + file.name + "\n";
        report += "Page size: " + w.toFixed(1) + " x " + h.toFixed(1) + " mm\n";
        report += "Pages: " + doc.pages.length + "\n";
        report += "Spreads: " + doc.spreads.length + "\n\n";
        
        // Check first spread
        var spread = doc.spreads[0];
        report += "Spread 0 pages: " + spread.pages.length + "\n";
        report += "Spread 0 items: " + spread.allPageItems.length + "\n\n";
        
        // List page items
        report += "Page items:\n";
        for (var j = 0; j < Math.min(spread.allPageItems.length, 10); j++) {
            var item = spread.allPageItems[j];
            var bounds = item.geometricBounds;
            var itemW = (bounds[3] - bounds[1]) * pointsToMm;
            var itemH = (bounds[2] - bounds[0]) * pointsToMm;
            report += "  " + item.constructor.name + ": " + itemW.toFixed(1) + " x " + itemH.toFixed(1) + " mm\n";
        }
        
        alert(report);
        $.writeln(report);
        
        doc.close(SaveOptions.NO);
    }
})();

