// Improved figure bounds detection - captures labels and leader lines
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
var processedImages = {};

$.writeln("Scanning " + doc.pages.length + " pages for figures with labels...");

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageName = page.name;
    var pageBounds = page.bounds; // [top, left, bottom, right]
    var pageItems = page.allPageItems;
    
    // First pass: collect all text frames and graphic lines on this page
    var textFrames = [];
    var graphicLines = [];
    
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        try {
            if (item.constructor.name === "TextFrame") {
                var content = "";
                try { content = item.contents; } catch (e) {}
                textFrames.push({
                    bounds: item.geometricBounds,
                    content: content,
                    length: content.length
                });
            } else if (item.constructor.name === "GraphicLine") {
                graphicLines.push({
                    bounds: item.geometricBounds
                });
            }
        } catch (e) {}
    }
    
    // Second pass: find images and their associated labels
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        try {
            var hasImage = false;
            var imageName = "";
            
            if (item.constructor.name === "Rectangle" || 
                item.constructor.name === "Polygon" || 
                item.constructor.name === "Oval") {
                if (item.images && item.images.length > 0) {
                    hasImage = true;
                    try { imageName = item.images[0].itemLink.name; } catch (e) { imageName = "image"; }
                } else if (item.graphics && item.graphics.length > 0) {
                    hasImage = true;
                    try { imageName = item.graphics[0].itemLink.name; } catch (e) { imageName = "graphic"; }
                }
            }
            
            if (hasImage) {
                var imgBounds = item.geometricBounds; // [top, left, bottom, right]
                
                // Skip duplicates
                var key = pageName + "_" + Math.round(imgBounds[0]) + "_" + Math.round(imgBounds[1]);
                if (processedImages[key]) continue;
                processedImages[key] = true;
                
                // Skip tiny images (icons, bullets)
                var imgWidth = imgBounds[3] - imgBounds[1];
                var imgHeight = imgBounds[2] - imgBounds[0];
                if (imgWidth < 50 || imgHeight < 50) continue;
                
                // Find all related labels and lines
                var figureBounds = findAllRelatedItems(imgBounds, textFrames, graphicLines, pageBounds);
                
                // Convert to page-relative coordinates
                var relBounds = {
                    top: figureBounds[0] - pageBounds[0],
                    left: figureBounds[1] - pageBounds[1],
                    bottom: figureBounds[2] - pageBounds[0],
                    right: figureBounds[3] - pageBounds[1]
                };
                
                figures.push({
                    page: pageName,
                    pageIndex: p,
                    imageName: imageName,
                    top: relBounds.top,
                    left: relBounds.left,
                    bottom: relBounds.bottom,
                    right: relBounds.right,
                    width: relBounds.right - relBounds.left,
                    height: relBounds.bottom - relBounds.top,
                    // Store image-only bounds for reference
                    imgTop: imgBounds[0] - pageBounds[0],
                    imgLeft: imgBounds[1] - pageBounds[1],
                    imgBottom: imgBounds[2] - pageBounds[0],
                    imgRight: imgBounds[3] - pageBounds[1]
                });
            }
        } catch (e) {}
    }
    
    if (p % 50 === 0) {
        $.writeln("Page " + (p + 1) + "/" + doc.pages.length + " - Found " + figures.length + " figures");
    }
}

// Save as JSON
var outputFile = new File("/Users/asafgafni/Desktop/extracted_figures/figure_bounds_v2.json");
outputFile.open("w");
outputFile.write("[\n");
for (var f = 0; f < figures.length; f++) {
    var fig = figures[f];
    var json = '  {\n';
    json += '    "page": "' + fig.page + '",\n';
    json += '    "pageIndex": ' + fig.pageIndex + ',\n';
    json += '    "imageName": "' + fig.imageName.replace(/"/g, '\\"') + '",\n';
    json += '    "top": ' + fig.top.toFixed(1) + ',\n';
    json += '    "left": ' + fig.left.toFixed(1) + ',\n';
    json += '    "bottom": ' + fig.bottom.toFixed(1) + ',\n';
    json += '    "right": ' + fig.right.toFixed(1) + ',\n';
    json += '    "width": ' + fig.width.toFixed(1) + ',\n';
    json += '    "height": ' + fig.height.toFixed(1) + '\n';
    json += '  }';
    if (f < figures.length - 1) json += ',';
    json += '\n';
    outputFile.write(json);
}
outputFile.write("]\n");
outputFile.close();

alert("Done! Found " + figures.length + " figures with labels.\nSaved to: " + outputFile.fsName);


// Find all text frames and lines connected to this image
function findAllRelatedItems(imgBounds, textFrames, graphicLines, pageBounds) {
    var top = imgBounds[0];
    var left = imgBounds[1];
    var bottom = imgBounds[2];
    var right = imgBounds[3];
    
    var imgCenterX = (left + right) / 2;
    var imgCenterY = (top + bottom) / 2;
    var imgWidth = right - left;
    var imgHeight = bottom - top;
    
    // Search radius - larger for bigger images
    var searchRadius = Math.max(200, Math.max(imgWidth, imgHeight) * 0.8);
    
    // Iteratively expand bounds to include connected items
    var changed = true;
    var iterations = 0;
    var maxIterations = 5;
    
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        // Check each text frame
        for (var t = 0; t < textFrames.length; t++) {
            var tf = textFrames[t];
            var tfBounds = tf.bounds;
            
            // Skip body text (long paragraphs)
            if (tf.length > 200) continue;
            
            // Skip if already included
            if (tfBounds[0] >= top && tfBounds[2] <= bottom &&
                tfBounds[1] >= left && tfBounds[3] <= right) {
                continue;
            }
            
            // Check if this text frame is near current figure bounds
            var dist = distanceToBounds(tfBounds, [top, left, bottom, right]);
            
            // Include if close enough (labels are usually within searchRadius)
            if (dist < searchRadius) {
                // Also check if it's a label (short text, not body copy)
                var isLabel = tf.length < 100;
                var isCaption = tf.content.indexOf("Afbeelding") === 0 || 
                               tf.content.indexOf("Figuur") === 0;
                
                if (isLabel || isCaption) {
                    // Expand bounds to include this text frame
                    var newTop = Math.min(top, tfBounds[0]);
                    var newLeft = Math.min(left, tfBounds[1]);
                    var newBottom = Math.max(bottom, tfBounds[2]);
                    var newRight = Math.max(right, tfBounds[3]);
                    
                    if (newTop !== top || newLeft !== left || 
                        newBottom !== bottom || newRight !== right) {
                        top = newTop;
                        left = newLeft;
                        bottom = newBottom;
                        right = newRight;
                        changed = true;
                    }
                }
            }
        }
        
        // Check each graphic line (leader lines connecting labels)
        for (var g = 0; g < graphicLines.length; g++) {
            var gl = graphicLines[g];
            var glBounds = gl.bounds;
            
            // Skip if already included
            if (glBounds[0] >= top && glBounds[2] <= bottom &&
                glBounds[1] >= left && glBounds[3] <= right) {
                continue;
            }
            
            // Include lines that touch or are near the current bounds
            var dist = distanceToBounds(glBounds, [top, left, bottom, right]);
            if (dist < 50) { // Lines should be close
                top = Math.min(top, glBounds[0]);
                left = Math.min(left, glBounds[1]);
                bottom = Math.max(bottom, glBounds[2]);
                right = Math.max(right, glBounds[3]);
                changed = true;
            }
        }
    }
    
    // Add small padding
    var padding = 15;
    top = Math.max(pageBounds[0], top - padding);
    left = Math.max(pageBounds[1], left - padding);
    bottom = Math.min(pageBounds[2], bottom + padding);
    right = Math.min(pageBounds[3], right + padding);
    
    return [top, left, bottom, right];
}

// Calculate minimum distance between two rectangles
function distanceToBounds(bounds1, bounds2) {
    // bounds: [top, left, bottom, right]
    var dx = 0;
    var dy = 0;
    
    // Horizontal distance
    if (bounds1[3] < bounds2[1]) {
        dx = bounds2[1] - bounds1[3]; // bounds1 is to the left
    } else if (bounds1[1] > bounds2[3]) {
        dx = bounds1[1] - bounds2[3]; // bounds1 is to the right
    }
    
    // Vertical distance
    if (bounds1[2] < bounds2[0]) {
        dy = bounds2[0] - bounds1[2]; // bounds1 is above
    } else if (bounds1[0] > bounds2[2]) {
        dy = bounds1[0] - bounds2[2]; // bounds1 is below
    }
    
    return Math.sqrt(dx * dx + dy * dy);
}







