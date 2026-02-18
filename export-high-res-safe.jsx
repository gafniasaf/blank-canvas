// Robust High-Res Export - Duplicate to Temp Doc method
// Safe, no document modification, handles locked items
#target indesign

var doc = app.activeDocument;
var outputFolder = new Folder("/Users/asafgafni/Desktop/extracted_figures/high_res");
if (!outputFolder.exists) outputFolder.create();

// Export settings
app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
app.pngExportPreferences.exportResolution = 300;
app.pngExportPreferences.transparentBackground = true;

// Pages to process
var testPages = ["11", "15", "21", "189"];

$.writeln("Starting export...");

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    
    // Check if page is in our list
    var processPage = false;
    for (var k=0; k<testPages.length; k++) {
        if (page.name == testPages[k]) processPage = true;
    }
    if (!processPage) continue;
    
    var pageItems = page.allPageItems;
    
    // Find images
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        // Check for image content
        var isImage = false;
        try {
            if (item.images.length > 0 || item.graphics.length > 0) isImage = true;
        } catch(e) {}
        
        if (isImage) {
            try {
                // Bounds of the image
                var imgBounds = item.geometricBounds; // [top, left, bottom, right]
                var imgWidth = imgBounds[3] - imgBounds[1];
                var imgHeight = imgBounds[2] - imgBounds[0];
                
                // Skip icons
                if (imgWidth < 50 || imgHeight < 50) continue;
                
                // Collect related items
                var itemsToExport = [item];
                var exportBounds = [imgBounds[0], imgBounds[1], imgBounds[2], imgBounds[3]];
                
                // Search for labels
                var searchMargin = 150;
                
                for (var j = 0; j < pageItems.length; j++) {
                    var other = pageItems[j];
                    if (other === item) continue;
                    
                    var otherBounds = other.geometricBounds;
                    
                    // Basic proximity check
                    if (otherBounds[2] < imgBounds[0] - searchMargin || 
                        otherBounds[0] > imgBounds[2] + searchMargin || 
                        otherBounds[3] < imgBounds[1] - searchMargin || 
                        otherBounds[1] > imgBounds[3] + searchMargin) {
                        continue;
                    }
                    
                    var include = false;
                    
                    // Check text frames
                    if (other.constructor.name === "TextFrame") {
                        if (other.contents.length < 200 || other.contents.indexOf("Afbeelding") === 0) {
                            include = true;
                        }
                    }
                    // Check lines
                    else if (other.constructor.name === "GraphicLine") {
                        include = true;
                    }
                    
                    if (include) {
                        itemsToExport.push(other);
                        // Expand bounds
                        exportBounds[0] = Math.min(exportBounds[0], otherBounds[0]);
                        exportBounds[1] = Math.min(exportBounds[1], otherBounds[1]);
                        exportBounds[2] = Math.max(exportBounds[2], otherBounds[2]);
                        exportBounds[3] = Math.max(exportBounds[3], otherBounds[3]);
                    }
                }
                
                // EXPORT STRATEGY: Duplicate to new temp doc
                var width = exportBounds[3] - exportBounds[1];
                var height = exportBounds[2] - exportBounds[0];
                
                // Add padding
                width += 20;
                height += 20;
                
                // Create temp doc
                var tempDoc = app.documents.add();
                tempDoc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
                tempDoc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
                tempDoc.documentPreferences.pageWidth = width;
                tempDoc.documentPreferences.pageHeight = height;
                tempDoc.documentPreferences.facingPages = false;
                
                // Duplicate items
                for (var k = 0; k < itemsToExport.length; k++) {
                    try {
                        var dup = itemsToExport[k].duplicate(tempDoc.pages[0]);
                        // Move to correct position (relative to new bounds)
                        var oldBounds = itemsToExport[k].geometricBounds;
                        var newTop = (oldBounds[0] - exportBounds[0]) + 10;
                        var newLeft = (oldBounds[1] - exportBounds[1]) + 10;
                        dup.move([newLeft, newTop]);
                    } catch(e) {
                        // Sometimes duplicate fails on complex items
                    }
                }
                
                // Export temp doc
                var fileName = "p" + page.name + "_fig_" + i + ".png";
                var file = new File(outputFolder + "/" + fileName);
                tempDoc.exportFile(ExportFormat.PNG_FORMAT, file);
                
                // Close temp doc
                tempDoc.close(SaveOptions.NO);
                
                $.writeln("Exported " + fileName);
                
            } catch (e) {
                $.writeln("Error: " + e);
            }
        }
    }
}

alert("Done!");







