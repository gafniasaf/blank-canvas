// Step 1: Export figure metadata (bounds) from InDesign
// This finds all images with their labels and outputs exact coordinates
#target indesign

var doc;
for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].name.indexOf("MBO A&F 4_9789083251370_03.2024") >= 0) {
        doc = app.documents[i];
        break;
    }
}

if (!doc) {
    var docPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
    doc = app.open(File(docPath), false);
}

var figures = [];
var processedImages = {}; // Track processed images to avoid duplicates

// Get page dimensions for coordinate conversion
var pageWidth = doc.documentPreferences.pageWidth;
var pageHeight = doc.documentPreferences.pageHeight;

$.writeln("Processing " + doc.pages.length + " pages...");

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageName = page.name;
    var pageItems = page.allPageItems;
    var pageBounds = page.bounds; // [top, left, bottom, right]
    
    // Find all images on this page
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        try {
            // Check if this is an image container
            var hasImage = false;
            var imageName = "";
            
            if (item.constructor.name === "Rectangle" || 
                item.constructor.name === "Polygon" || 
                item.constructor.name === "Oval") {
                if (item.images && item.images.length > 0) {
                    hasImage = true;
                    try {
                        imageName = item.images[0].itemLink.name;
                    } catch (e) {
                        imageName = "unknown";
                    }
                } else if (item.graphics && item.graphics.length > 0) {
                    hasImage = true;
                    try {
                        imageName = item.graphics[0].itemLink.name;
                    } catch (e) {
                        imageName = "graphic";
                    }
                }
            }
            
            if (hasImage) {
                var imageBounds = item.geometricBounds; // [top, left, bottom, right]
                
                // Create unique key to avoid duplicates
                var key = pageName + "_" + Math.round(imageBounds[0]) + "_" + Math.round(imageBounds[1]);
                if (processedImages[key]) continue;
                processedImages[key] = true;
                
                // Find all related labels and lines
                var expandedBounds = findFigureBounds(page, imageBounds, pageItems, pageBounds);
                
                // Calculate dimensions
                var figWidth = expandedBounds[3] - expandedBounds[1];
                var figHeight = expandedBounds[2] - expandedBounds[0];
                
                // Skip tiny images (icons, bullets, etc.)
                if (figWidth < 72 || figHeight < 72) continue; // Less than 1 inch
                
                // Convert to page-relative coordinates (for cropping from page export)
                var relTop = expandedBounds[0] - pageBounds[0];
                var relLeft = expandedBounds[1] - pageBounds[1];
                var relBottom = expandedBounds[2] - pageBounds[0];
                var relRight = expandedBounds[3] - pageBounds[1];
                
                figures.push({
                    page: pageName,
                    pageIndex: p,
                    imageName: imageName,
                    // Bounds relative to page (in points)
                    top: relTop,
                    left: relLeft,
                    bottom: relBottom,
                    right: relRight,
                    width: figWidth,
                    height: figHeight,
                    // Original image bounds (for reference)
                    imageTop: imageBounds[0] - pageBounds[0],
                    imageLeft: imageBounds[1] - pageBounds[1],
                    imageBottom: imageBounds[2] - pageBounds[0],
                    imageRight: imageBounds[3] - pageBounds[1]
                });
            }
        } catch (e) {
            // Skip problematic items
        }
    }
    
    if (p % 100 === 0) {
        $.writeln("Processed " + (p + 1) + "/" + doc.pages.length + " pages, found " + figures.length + " figures");
    }
}

// Output as JSON
var outputFile = new File("/Users/asafgafni/Desktop/extracted_figures/figure_metadata.json");
outputFile.open("w");
outputFile.write("[\n");
for (var f = 0; f < figures.length; f++) {
    var fig = figures[f];
    var json = '  {\n';
    json += '    "page": "' + fig.page + '",\n';
    json += '    "pageIndex": ' + fig.pageIndex + ',\n';
    json += '    "imageName": "' + fig.imageName.replace(/"/g, '\\"') + '",\n';
    json += '    "top": ' + fig.top.toFixed(2) + ',\n';
    json += '    "left": ' + fig.left.toFixed(2) + ',\n';
    json += '    "bottom": ' + fig.bottom.toFixed(2) + ',\n';
    json += '    "right": ' + fig.right.toFixed(2) + ',\n';
    json += '    "width": ' + fig.width.toFixed(2) + ',\n';
    json += '    "height": ' + fig.height.toFixed(2) + '\n';
    json += '  }';
    if (f < figures.length - 1) json += ',';
    json += '\n';
    outputFile.write(json);
}
outputFile.write("]\n");
outputFile.close();

alert("Done! Found " + figures.length + " figures.\nMetadata saved to:\n" + outputFile.fsName);


// Function to find the full bounds of a figure including all labels
function findFigureBounds(page, imageBounds, pageItems, pageBounds) {
    var top = imageBounds[0];
    var left = imageBounds[1];
    var bottom = imageBounds[2];
    var right = imageBounds[3];
    
    // Search area: expand from image bounds
    var searchMargin = 150; // points (~2 inches) - labels can be far from image
    var searchTop = top - searchMargin;
    var searchLeft = left - searchMargin;
    var searchBottom = bottom + searchMargin;
    var searchRight = right + searchMargin;
    
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        try {
            var itemBounds = item.geometricBounds;
            
            // Check if item is within search area
            if (itemBounds[2] < searchTop || itemBounds[0] > searchBottom ||
                itemBounds[3] < searchLeft || itemBounds[1] > searchRight) {
                continue; // Outside search area
            }
            
            // Include text frames that look like labels
            if (item.constructor.name === "TextFrame") {
                var text = "";
                try { text = item.contents; } catch (e) {}
                
                // Include short text (labels) but not body paragraphs
                // Also include captions that start with "Afbeelding"
                var isLabel = text.length < 150 || text.indexOf("Afbeelding") === 0;
                
                if (isLabel && text.length > 0) {
                    // Check if this text is connected to our image (by proximity or lines)
                    var dist = distanceToRect(itemBounds, imageBounds);
                    if (dist < searchMargin) {
                        top = Math.min(top, itemBounds[0]);
                        left = Math.min(left, itemBounds[1]);
                        bottom = Math.max(bottom, itemBounds[2]);
                        right = Math.max(right, itemBounds[3]);
                    }
                }
            }
            // Include graphic lines (pointer/leader lines)
            else if (item.constructor.name === "GraphicLine") {
                var dist = distanceToRect(itemBounds, imageBounds);
                if (dist < searchMargin) {
                    top = Math.min(top, itemBounds[0]);
                    left = Math.min(left, itemBounds[1]);
                    bottom = Math.max(bottom, itemBounds[2]);
                    right = Math.max(right, itemBounds[3]);
                }
            }
        } catch (e) {}
    }
    
    // Add padding
    var padding = 15;
    top = Math.max(pageBounds[0], top - padding);
    left = Math.max(pageBounds[1], left - padding);
    bottom = Math.min(pageBounds[2], bottom + padding);
    right = Math.min(pageBounds[3], right + padding);
    
    return [top, left, bottom, right];
}

// Calculate minimum distance between two rectangles
function distanceToRect(bounds1, bounds2) {
    var dx = Math.max(0, Math.max(bounds1[1] - bounds2[3], bounds2[1] - bounds1[3]));
    var dy = Math.max(0, Math.max(bounds1[0] - bounds2[2], bounds2[0] - bounds1[2]));
    return Math.sqrt(dx * dx + dy * dy);
}







