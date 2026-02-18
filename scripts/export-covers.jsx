// export-covers.jsx
// Export front and back covers from all book cover INDD files to PNG

#target indesign

(function() {
    var coverFolder = new Folder("/Users/asafgafni/Downloads/MBO 2024/Cover");
    var outputFolder = new Folder("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/covers");
    
    if (!outputFolder.exists) {
        outputFolder.create();
    }
    
    // Map of INDD files to book IDs
    var coverFiles = [
        {
            file: "Communicatie advies en instructie in de zorg_170x240_9789083251387_04.2024.indd",
            id: "communicatie"
        },
        {
            file: "Wetgeving en beleid in de zorg voor het mbo_170x240_9789083412061_04.2024.indd",
            id: "wetgeving"
        },
        {
            file: "Persoonlijke verzorging, wonen en huishouden voor het mbo_195x265_9789083412023_04.2024.indd",
            id: "persoonlijke_verzorging"
        },
        {
            file: "Praktijkgestuurd klinisch redeneren voor het mbo_170x240_9789083412030_04.2024.indd",
            id: "klinisch_redeneren"
        },
        {
            file: "Methodisch werken en kwaliteitsverbetering in de zorg voor het mbo_170x240_9789083251394_04.2024.indd",
            id: "methodisch_werken"
        },
        {
            file: "Pathologie voor het mbo_195x265_9789083412016_04.2024.indd",
            id: "pathologie"
        }
    ];
    
    var results = [];
    
    for (var i = 0; i < coverFiles.length; i++) {
        var config = coverFiles[i];
        var inddFile = new File(coverFolder.fsName + "/" + config.file);
        
        if (!inddFile.exists) {
            results.push(config.id + ": FILE NOT FOUND - " + config.file);
            continue;
        }
        
        try {
            // Open the document
            var doc = app.open(inddFile, false); // false = don't show window
            
            // Set up PNG export options
            app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;
            app.pngExportPreferences.exportResolution = 300;
            app.pngExportPreferences.pngColorSpace = PNGColorSpaceEnum.RGB;
            app.pngExportPreferences.pngQuality = PNGQualityEnum.MAXIMUM;
            app.pngExportPreferences.transparentBackground = false;
            app.pngExportPreferences.antiAlias = true;
            app.pngExportPreferences.useDocumentBleeds = false;
            
            // Export front cover (page 1)
            if (doc.pages.length >= 1) {
                app.pngExportPreferences.pageString = "1";
                var frontFile = new File(outputFolder.fsName + "/" + config.id + "_cover_front.png");
                doc.exportFile(ExportFormat.PNG_FORMAT, frontFile, false);
                results.push(config.id + " front: OK");
            }
            
            // Export back cover (page 2 or last page)
            if (doc.pages.length >= 2) {
                app.pngExportPreferences.pageString = "2";
                var backFile = new File(outputFolder.fsName + "/" + config.id + "_cover_back.png");
                doc.exportFile(ExportFormat.PNG_FORMAT, backFile, false);
                results.push(config.id + " back: OK");
            } else {
                results.push(config.id + " back: ONLY 1 PAGE");
            }
            
            // Close without saving
            doc.close(SaveOptions.NO);
            
        } catch (e) {
            results.push(config.id + ": ERROR - " + e.message);
        }
    }
    
    // Show results
    alert("Cover Export Complete\n\n" + results.join("\n") + "\n\nOutput: " + outputFolder.fsName);
})();



