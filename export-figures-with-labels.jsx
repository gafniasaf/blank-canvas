// Export figures with embedded labels - systematic approach
// This script finds images and their associated labels, calculates exact bounds, and exports
#target indesign

var docPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
var outputFolder = new Folder("/Users/asafgafni/Desktop/extracted_figures/af4");
if (!outputFolder.exists) outputFolder.create();

// Open the document
var doc;
for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].name.indexOf("MBO A&F 4_9789083251370_03.2024") >= 0) {
        doc = app.documents[i];
        break;
    }
}
if (!doc) {
    doc = app.open(File(docPath), false);
}

var exportCount = 0;
var logOutput = "Figure Export Log\n==================\n\n";

// Process each page
for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageItems = page.allPageItems;
    
    // Find all images on this page
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        // Check if this is a graphic (image)
        if (item.constructor.name === "Rectangle" || item.constructor.name === "Polygon" || item.constructor.name === "Oval") {
            try {
                if (item.graphics.length > 0 || item.images.length > 0) {
                    // This is an image frame - find all related items (labels, lines)
                    var imageBounds = item.geometricBounds; // [top, left, bottom, right]
                    
                    // Expand bounds to include nearby text frames (labels) and graphic lines
                    var expandedBounds = findRelatedItemsBounds(page, imageBounds, pageItems);
                    
                    // Only export if we found something substantial
                    var width = expandedBounds[3] - expandedBounds[1];
                    var height = expandedBounds[2] - expandedBounds[0];
                    
                    if (width > 50 && height > 50) { // Skip tiny images
                        // Export this region
                        var fileName = "page_" + page.name + "_fig_" + (exportCount + 1) + ".png";
                        var exportFile = new File(outputFolder + "/" + fileName);
                        
                        exportPageRegion(doc, page, expandedBounds, exportFile);
                        
                        logOutput += "Exported: " + fileName + "\n";
                        logOutput += "  Page: " + page.name + "\n";
                        logOutput += "  Bounds: " + expandedBounds.join(", ") + "\n";
                        logOutput += "  Size: " + Math.round(width) + " x " + Math.round(height) + " pt\n\n";
                        
                        exportCount++;
                    }
                }
            } catch (e) {
                // Skip items that cause errors
            }
        }
    }
    
    // Progress indicator every 50 pages
    if (p % 50 === 0) {
        $.writeln("Processing page " + (p + 1) + " of " + doc.pages.length);
    }
}

// Save log
var logFile = new File(outputFolder + "/_export_log.txt");
logFile.open("w");
logFile.write(logOutput);
logFile.close();

alert("Done! Exported " + exportCount + " figures to:\n" + outputFolder.fsName);


// Function to find bounds including all related items (labels, lines)
function findRelatedItemsBounds(page, imageBounds, pageItems) {
    var top = imageBounds[0];
    var left = imageBounds[1];
    var bottom = imageBounds[2];
    var right = imageBounds[3];
    
    // Expand search area around the image
    var searchMargin = 100; // points - look for labels within this distance
    var searchTop = top - searchMargin;
    var searchLeft = left - searchMargin;
    var searchBottom = bottom + searchMargin;
    var searchRight = right + searchMargin;
    
    // Find all text frames and graphic lines that overlap or are near the image
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        try {
            var itemBounds = item.geometricBounds;
            
            // Check if this item is within search area
            if (itemBounds[0] < searchBottom && itemBounds[2] > searchTop &&
                itemBounds[1] < searchRight && itemBounds[3] > searchLeft) {
                
                // Include text frames (labels) and graphic lines
                if (item.constructor.name === "TextFrame" || item.constructor.name === "GraphicLine") {
                    // Check if it looks like a label (short text, near image)
                    if (item.constructor.name === "TextFrame") {
                        var text = item.contents;
                        // Include if it's a short label (not body text)
                        if (text.length < 100) {
                            // Expand bounds to include this item
                            top = Math.min(top, itemBounds[0]);
                            left = Math.min(left, itemBounds[1]);
                            bottom = Math.max(bottom, itemBounds[2]);
                            right = Math.max(right, itemBounds[3]);
                        }
                    } else {
                        // Include graphic lines (pointer lines)
                        top = Math.min(top, itemBounds[0]);
                        left = Math.min(left, itemBounds[1]);
                        bottom = Math.max(bottom, itemBounds[2]);
                        right = Math.max(right, itemBounds[3]);
                    }
                }
            }
        } catch (e) {
            // Skip items that cause errors
        }
    }
    
    // Add small padding
    var padding = 10;
    return [top - padding, left - padding, bottom + padding, right + padding];
}


// Function to export a specific region of a page
function exportPageRegion(doc, page, bounds, exportFile) {
    // Create a temporary document with just this region
    var tempDoc = app.documents.add();
    
    // Set page size to match the region
    var width = bounds[3] - bounds[1];
    var height = bounds[2] - bounds[0];
    
    tempDoc.documentPreferences.pageWidth = width + "pt";
    tempDoc.documentPreferences.pageHeight = height + "pt";
    tempDoc.marginPreferences.top = 0;
    tempDoc.marginPreferences.bottom = 0;
    tempDoc.marginPreferences.left = 0;
    tempDoc.marginPreferences.right = 0;
    
    var tempPage = tempDoc.pages[0];
    
    // Duplicate items from the source region to the temp document
    var pageItems = page.allPageItems;
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        try {
            var itemBounds = item.geometricBounds;
            
            // Check if item overlaps with our export region
            if (itemBounds[0] < bounds[2] && itemBounds[2] > bounds[0] &&
                itemBounds[1] < bounds[3] && itemBounds[3] > bounds[1]) {
                
                // Duplicate to temp document
                var dup = item.duplicate(tempPage);
                
                // Reposition relative to new page origin
                var newTop = itemBounds[0] - bounds[0];
                var newLeft = itemBounds[1] - bounds[1];
                dup.move([newLeft, newTop]);
            }
        } catch (e) {
            // Skip items that can't be duplicated
        }
    }
    
    // Export as PNG
    app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
    app.pngExportPreferences.exportResolution = 150;
    
    tempDoc.exportFile(ExportFormat.PNG_FORMAT, exportFile);
    
    // Close temp document without saving
    tempDoc.close(SaveOptions.NO);
}







