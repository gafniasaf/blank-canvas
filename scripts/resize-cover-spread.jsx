/**
 * Resize Cover Spread Script
 * 
 * Resizes a cover spread to new dimensions and scales all content proportionally.
 * Includes standard 3mm bleed for print.
 * 
 * Configuration is at the top of the script - modify as needed.
 */

// ============================================
// CONFIGURATION - Modify these values as needed
// ============================================

var CONFIG = {
    // Source file path
    sourceFile: "/Users/asafgafni/Downloads/MBO 2024/Cover/Praktijkgestuurd klinisch redeneren voor het mbo_170x240_9789083412030_04.2024.indd",
    
    // Target dimensions (in mm)
    targetHeight: 297,           // Total height
    targetWidth: 437,            // Total width (back + spine + front)
    spineWidth: 17,              // Spine width
    
    // Bleed (in mm) - standard for print
    bleedTop: 3,
    bleedBottom: 3,
    bleedInside: 0,              // No bleed on spine side
    bleedOutside: 3,
    
    // Output settings
    outputSuffix: "_RESIZED_297x437_spine17mm",
    
    // Safety margin from edges (in mm) for content
    safetyMargin: 5
};

// ============================================
// MAIN SCRIPT
// ============================================

(function() {
    // Check if InDesign is running
    if (app.name !== "Adobe InDesign") {
        alert("This script must be run in Adobe InDesign.");
        return;
    }
    
    // Confirm with user
    var confirmMsg = "This script will:\n\n" +
        "1. Open: " + CONFIG.sourceFile.split("/").pop() + "\n" +
        "2. Resize to: " + CONFIG.targetWidth + "mm × " + CONFIG.targetHeight + "mm\n" +
        "3. Spine width: " + CONFIG.spineWidth + "mm\n" +
        "4. Add " + CONFIG.bleedOutside + "mm bleed\n" +
        "5. Scale all content proportionally\n" +
        "6. Save as a new file\n\n" +
        "Continue?";
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    try {
        // Open the source file
        $.writeln("Opening source file...");
        var sourceFile = new File(CONFIG.sourceFile);
        
        if (!sourceFile.exists) {
            alert("Source file not found:\n" + CONFIG.sourceFile);
            return;
        }
        
        var doc = app.open(sourceFile);
        
        // Store original dimensions
        var originalWidth = doc.documentPreferences.pageWidth;
        var originalHeight = doc.documentPreferences.pageHeight;
        
        $.writeln("Original dimensions: " + originalWidth + " × " + originalHeight);
        
        // Convert target dimensions to points (InDesign's internal unit)
        var mmToPoints = 2.834645669291339;
        var targetWidthPt = CONFIG.targetWidth * mmToPoints;
        var targetHeightPt = CONFIG.targetHeight * mmToPoints;
        
        // Calculate scale factors
        var scaleX = targetWidthPt / originalWidth;
        var scaleY = targetHeightPt / originalHeight;
        
        // For covers, stretch to fill - use separate X and Y scales
        // This will fill the entire new page size
        $.writeln("Scale factors - X: " + scaleX + ", Y: " + scaleY);
        $.writeln("Using non-uniform scaling to fill page");
        
        // Change document preferences
        doc.documentPreferences.pageWidth = targetWidthPt;
        doc.documentPreferences.pageHeight = targetHeightPt;
        
        // Set bleed
        doc.documentPreferences.documentBleedTopOffset = CONFIG.bleedTop * mmToPoints;
        doc.documentPreferences.documentBleedBottomOffset = CONFIG.bleedBottom * mmToPoints;
        doc.documentPreferences.documentBleedInsideOrLeftOffset = CONFIG.bleedInside * mmToPoints;
        doc.documentPreferences.documentBleedOutsideOrRightOffset = CONFIG.bleedOutside * mmToPoints;
        
        // Process each spread
        for (var s = 0; s < doc.spreads.length; s++) {
            var spread = doc.spreads[s];
            
            // Process each page in the spread
            for (var p = 0; p < spread.pages.length; p++) {
                var page = spread.pages[p];
                
                // Scale all page items on this page
                var pageItems = page.allPageItems;
                
                $.writeln("Processing page " + (p + 1) + " with " + pageItems.length + " items");
                
                for (var i = 0; i < pageItems.length; i++) {
                    var item = pageItems[i];
                    
                    try {
                        // Get current bounds [y1, x1, y2, x2]
                        var bounds = item.geometricBounds;
                        
                        // Calculate center point of the item
                        var centerX = (bounds[1] + bounds[3]) / 2;
                        var centerY = (bounds[0] + bounds[2]) / 2;
                        
                        // Calculate new center position (scaled)
                        var newCenterX = centerX * scaleX;
                        var newCenterY = centerY * scaleY;
                        
                        // Calculate item dimensions
                        var itemWidth = bounds[3] - bounds[1];
                        var itemHeight = bounds[2] - bounds[0];
                        
                        // Scale item dimensions to fill (non-uniform)
                        var newItemWidth = itemWidth * scaleX;
                        var newItemHeight = itemHeight * scaleY;
                        
                        // Calculate new bounds
                        var newBounds = [
                            newCenterY - (newItemHeight / 2),  // y1
                            newCenterX - (newItemWidth / 2),   // x1
                            newCenterY + (newItemHeight / 2),  // y2
                            newCenterX + (newItemWidth / 2)    // x2
                        ];
                        
                        // Apply new bounds
                        item.geometricBounds = newBounds;
                        
                        // If it's a text frame, scale the text (use average scale for text)
                        if (item.constructor.name === "TextFrame") {
                            scaleTextFrame(item, (scaleX + scaleY) / 2);
                        }
                        
                    } catch (itemError) {
                        $.writeln("Could not scale item " + i + ": " + itemError.message);
                    }
                }
            }
            
            // Also process items directly on the spread (not on pages)
            var spreadItems = spread.pageItems;
            for (var si = 0; si < spreadItems.length; si++) {
                var spreadItem = spreadItems[si];
                
                // Check if this item is directly on the spread (not via a page)
                if (spreadItem.parent.constructor.name === "Spread") {
                    try {
                        var bounds = spreadItem.geometricBounds;
                        var centerX = (bounds[1] + bounds[3]) / 2;
                        var centerY = (bounds[0] + bounds[2]) / 2;
                        
                        var newCenterX = centerX * scaleX;
                        var newCenterY = centerY * scaleY;
                        
                        var itemWidth = bounds[3] - bounds[1];
                        var itemHeight = bounds[2] - bounds[0];
                        
                        var newItemWidth = itemWidth * scaleX;
                        var newItemHeight = itemHeight * scaleY;
                        
                        var newBounds = [
                            newCenterY - (newItemHeight / 2),
                            newCenterX - (newItemWidth / 2),
                            newCenterY + (newItemHeight / 2),
                            newCenterX + (newItemWidth / 2)
                        ];
                        
                        spreadItem.geometricBounds = newBounds;
                        
                        if (spreadItem.constructor.name === "TextFrame") {
                            scaleTextFrame(spreadItem, (scaleX + scaleY) / 2);
                        }
                    } catch (spreadItemError) {
                        $.writeln("Could not scale spread item " + si + ": " + spreadItemError.message);
                    }
                }
            }
        }
        
        // Generate output filename
        var outputPath = CONFIG.sourceFile.replace(/\.indd$/i, CONFIG.outputSuffix + ".indd");
        var outputFile = new File(outputPath);
        
        // Save as copy
        doc.saveACopy(outputFile);
        
        $.writeln("Saved resized document to: " + outputPath);
        
        // Close the original without saving changes
        doc.close(SaveOptions.NO);
        
        alert("Success!\n\nResized cover saved to:\n" + outputPath.split("/").pop() + "\n\n" +
              "New dimensions: " + CONFIG.targetWidth + "mm × " + CONFIG.targetHeight + "mm\n" +
              "Spine: " + CONFIG.spineWidth + "mm\n" +
              "Bleed: " + CONFIG.bleedOutside + "mm\n\n" +
              "Please open the new file and verify the layout.");
        
    } catch (e) {
        alert("Error: " + e.message + "\n\nLine: " + e.line);
        $.writeln("Error: " + e.message);
    }
})();

/**
 * Scale text within a text frame
 */
function scaleTextFrame(textFrame, scale) {
    try {
        // Scale point size of all text
        var texts = textFrame.texts;
        for (var t = 0; t < texts.length; t++) {
            var text = texts[t];
            var paras = text.paragraphs;
            
            for (var p = 0; p < paras.length; p++) {
                var para = paras[p];
                
                // Scale point size
                var currentSize = para.pointSize;
                if (typeof currentSize === "number") {
                    para.pointSize = currentSize * scale;
                }
                
                // Scale leading if it's a specific value (not auto)
                var currentLeading = para.leading;
                if (typeof currentLeading === "number") {
                    para.leading = currentLeading * scale;
                }
            }
        }
    } catch (textError) {
        $.writeln("Could not scale text: " + textError.message);
    }
}

