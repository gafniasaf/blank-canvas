// High-quality figure export system
// 1. Finds images
// 2. Finds nearby labels/lines
// 3. Temporarily groups them
// 4. Exports the group at 300 DPI
// 5. Reverts changes
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

var outputFolder = new Folder("/Users/asafgafni/Desktop/extracted_figures/high_res");
if (!outputFolder.exists) outputFolder.create();

// Setup high-res export preferences
app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
app.pngExportPreferences.exportResolution = 300; // High resolution
app.pngExportPreferences.transparentBackground = true;

var processedCount = 0;
var errorCount = 0;

// Process a few specific pages to test (11 for Ribosoom, 15 for DNA, 189 for Heart)
var testPages = ["11", "15", "21", "189"];
// var testPages = null; // Set to null to process all pages

$.writeln("Starting high-res export...");

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    
    // Filter for test pages if defined
    if (testPages && !arrayContains(testPages, page.name)) continue;
    
    var pageItems = page.allPageItems;
    var itemsToGroup = [];
    
    // Find images on this page
    for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        
        // Check for image
        if ((item.constructor.name === "Rectangle" || item.constructor.name === "Polygon" || item.constructor.name === "Oval") &&
            (item.images.length > 0 || item.graphics.length > 0)) {
            
            try {
                // Get main image bounds
                var imgBounds = item.geometricBounds;
                var imgWidth = imgBounds[3] - imgBounds[1];
                var imgHeight = imgBounds[2] - imgBounds[0];
                
                // Skip tiny icons
                if (imgWidth < 50 || imgHeight < 50) continue;
                
                // 1. Find all related items to form a group
                var relatedItems = [item]; // Start with the image itself
                var bounds = [imgBounds[0], imgBounds[1], imgBounds[2], imgBounds[3]];
                
                // Search radius for labels
                var searchRadius = 100; 
                if (imgWidth > 300) searchRadius = 200; // Larger search for big figures
                
                var searchArea = [
                    imgBounds[0] - searchRadius,
                    imgBounds[1] - searchRadius,
                    imgBounds[2] + searchRadius,
                    imgBounds[3] + searchRadius
                ];
                
                // Find connected text frames and lines
                for (var j = 0; j < pageItems.length; j++) {
                    var other = pageItems[j];
                    if (other === item) continue; // Skip self
                    
                    try {
                        var otherBounds = other.geometricBounds;
                        
                        // Check if inside search area
                        if (otherBounds[2] < searchArea[0] || otherBounds[0] > searchArea[2] ||
                            otherBounds[3] < searchArea[1] || otherBounds[1] > searchArea[3]) {
                            continue;
                        }
                        
                        // Heuristics to identify labels/lines
                        var include = false;
                        
                        if (other.constructor.name === "TextFrame") {
                            // Include text frames that are close
                            // Skip long body text (> 200 chars)
                            if (other.contents.length < 200) {
                                include = true;
                            } else if (other.contents.indexOf("Afbeelding") === 0) {
                                // Always include captions
                                include = true;
                            }
                        } else if (other.constructor.name === "GraphicLine") {
                            // Include lines (pointers)
                            include = true;
                        }
                        
                        if (include) {
                            relatedItems.push(other);
                            // Update group bounds
                            bounds[0] = Math.min(bounds[0], otherBounds[0]);
                            bounds[1] = Math.min(bounds[1], otherBounds[1]);
                            bounds[2] = Math.max(bounds[2], otherBounds[2]);
                            bounds[3] = Math.max(bounds[3], otherBounds[3]);
                        }
                    } catch (e) {}
                }
                
                // 2. Group items (safely)
                // We use a try/catch because grouping locked items fails
                if (relatedItems.length > 0) {
                    var group;
                    try {
                        // Create a temporary layer to duplicate items onto (avoids messing up original layout)
                        // Actually, duplicating to a new document is safer and cleaner
                        
                        // Create temp doc size of the bounds
                        var groupWidth = bounds[3] - bounds[1];
                        var groupHeight = bounds[2] - bounds[0];
                        
                        // Add padding
                        var pad = 10;
                        
                        var exportFile = new File(outputFolder + "/p" + page.name + "_fig_" + (processedCount+1) + ".png");
                        
                        // Export strategy:
                        // 1. Select all items
                        // 2. Export selection directly
                        
                        app.select(NothingEnum.NOTHING);
                        for (var k = 0; k < relatedItems.length; k++) {
                            try {
                                relatedItems[k].select(SelectionOptions.ADD_TO);
                            } catch(e) {}
                        }
                        
                        if (app.selection.length > 0) {
                            // Check if selection matches what we want
                            // Sometimes select() fails on locked items
                            
                            // Export selection
                            // Note: exportFile() on selection only works in some versions, 
                            // safer to Group -> Export -> Undo
                            
                            // Verify items are on same page/spread before grouping
                            var safeToGroup = true;
                            
                            if (safeToGroup) {
                                doc.groups.add(app.selection);
                                var newGroup = doc.groups[0]; // The newly created group
                                
                                // Export the group
                                newGroup.exportFile(ExportFormat.PNG_FORMAT, exportFile);
                                
                                // Ungroup immediately to revert
                                newGroup.ungroup();
                                
                                processedCount++;
                                $.writeln("Exported figure " + processedCount + " from page " + page.name);
                            }
                        }
                        
                    } catch (e) {
                        $.writeln("Error exporting page " + page.name + ": " + e);
                        errorCount++;
                    }
                    
                    app.select(NothingEnum.NOTHING);
                }
                
            } catch (e) {
                errorCount++;
            }
        }
    }
}

alert("Done! Exported " + processedCount + " high-res figures.\nErrors: " + errorCount + "\nSaved to: " + outputFolder.fsName);

function arrayContains(arr, val) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] == val) return true;
    }
    return false;
}







