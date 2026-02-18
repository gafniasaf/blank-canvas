// Copy/Paste Export Method - Most Robust
#target indesign

var doc = app.activeDocument;
var outputFolder = new Folder("/Users/asafgafni/Desktop/extracted_figures/high_res");
if (!outputFolder.exists) outputFolder.create();

// Ensure high quality PNG
app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
app.pngExportPreferences.exportResolution = 300;
app.pngExportPreferences.transparentBackground = true;

// Test pages
var testPages = ["11", "15", "21", "189"];

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    
    // Filter pages
    var process = false;
    for(var t=0; t<testPages.length; t++) if(page.name == testPages[t]) process = true;
    if(!process) continue;
    
    // Process items
    var items = page.allPageItems;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        
        // Find images
        var isImage = false;
        try { if(item.images.length > 0 || item.graphics.length > 0) isImage = true; } catch(e){}
        
        if (isImage) {
            // Found image, select it and nearby items
            app.select(NothingEnum.NOTHING);
            
            try {
                // Select main image
                item.select(SelectionOptions.ADD_TO);
                
                var imgBounds = item.geometricBounds;
                var imgW = imgBounds[3] - imgBounds[1];
                var imgH = imgBounds[2] - imgBounds[0];
                if (imgW < 50 || imgH < 50) continue; // Skip tiny
                
                // Select nearby labels
                var searchMargin = 150;
                for (var j = 0; j < items.length; j++) {
                    var other = items[j];
                    if (other === item) continue;
                    
                    var ob = other.geometricBounds;
                    // Proximity check
                    if (ob[2] >= imgBounds[0]-searchMargin && ob[0] <= imgBounds[2]+searchMargin &&
                        ob[3] >= imgBounds[1]-searchMargin && ob[1] <= imgBounds[3]+searchMargin) {
                        
                        var include = false;
                        if (other.constructor.name == "TextFrame") {
                            if (other.contents.length < 200 || other.contents.indexOf("Afbeelding") == 0) include = true;
                        } else if (other.constructor.name == "GraphicLine") {
                            include = true;
                        }
                        
                        if (include) {
                            try { other.select(SelectionOptions.ADD_TO); } catch(e){}
                        }
                    }
                }
                
                if (app.selection.length > 0) {
                    // Copy
                    app.copy();
                    
                    // New Doc
                    var tempDoc = app.documents.add();
                    tempDoc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
                    tempDoc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
                    // Make it big enough
                    tempDoc.documentPreferences.pageWidth = 1000;
                    tempDoc.documentPreferences.pageHeight = 1000;
                    
                    // Paste
                    app.paste();
                    
                    // Export page
                    var fname = "p" + page.name + "_fig_" + i + ".png";
                    var file = new File(outputFolder + "/" + fname);
                    tempDoc.pages[0].exportFile(ExportFormat.PNG_FORMAT, file);
                    
                    // Close without saving
                    tempDoc.close(SaveOptions.NO);
                    
                    $.writeln("Exported " + fname);
                }
                
            } catch(e) {
                $.writeln("Error: " + e);
            }
        }
    }
}

alert("Done!");







