// Relink all images and save documents
var basePath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/";
var outputPath = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/";

// Create output directory
var outputFolder = new Folder(outputPath);
if (!outputFolder.exists) {
    outputFolder.create();
}

var results = {
    documents: [],
    summary: {
        totalDocs: 0,
        relinked: 0,
        saved: 0,
        errors: []
    }
};

if (app.documents.length === 0) {
    results.error = "No documents open";
} else {
    results.summary.totalDocs = app.documents.length;
    
    // Map document names to their Links folder paths
    var docToLinksMap = {
        "MBO A&F 4_9789083251370_03.2024.indd": basePath + "MBO A&F 4_9789083251370_03/Links",
        "MBO A&F 3_9789083251363_03.2024.indd": basePath + "MBO A&F 3_9789083251363_03/Links",
        "MBO Communicatie_9789083251387_03.2024.indd": basePath + "MBO Communicatie_9789083251387_03/Links",
        "MBO Persoonlijke Verzorging_9789083412023_03.2024.indd": basePath + "MBO Persoonlijke Verzorging_9789083412023_03/Links",
        "MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd": basePath + "MBO Praktijkgestuurd klinisch redeneren_9789083412030_03/Links"
    };
    
    for (var d = 0; d < app.documents.length; d++) {
        var doc = app.documents[d];
        var docName = doc.name;
        var docResult = {
            name: docName,
            relinked: 0,
            missing: 0,
            saved: false,
            error: null
        };
        
        // Find Links folder for this document
        var linksFolderPath = docToLinksMap[docName];
        
        if (!linksFolderPath) {
            docResult.error = "No Links folder mapping found for: " + docName;
            results.summary.errors.push(docResult.error);
            results.documents.push(docResult);
            continue;
        }
        
        var linksFolder = new Folder(linksFolderPath);
        
        if (!linksFolder.exists) {
            docResult.error = "Links folder does not exist: " + linksFolderPath;
            results.summary.errors.push(docResult.error);
            results.documents.push(docResult);
            continue;
        }
        
        // Relink all links
        for (var i = 0; i < doc.links.length; i++) {
            var link = doc.links[i];
            var linkName = link.name;
            
            // Try to find the file in the Links folder
            var linkFile = new File(linksFolder.fsName + "/" + linkName);
            
            if (linkFile.exists) {
                try {
                    link.relink(linkFile);
                    docResult.relinked++;
                    results.summary.relinked++;
                } catch(e) {
                    docResult.missing++;
                }
            } else {
                // Try case-insensitive search
                var found = false;
                var files = linksFolder.getFiles();
                for (var f = 0; f < files.length; f++) {
                    if (files[f].name.toLowerCase() == linkName.toLowerCase()) {
                        try {
                            link.relink(files[f]);
                            docResult.relinked++;
                            results.summary.relinked++;
                            found = true;
                            break;
                        } catch(e) {}
                    }
                }
                if (!found) {
                    docResult.missing++;
                }
            }
        }
        
        // Update modified links
        for (var u = 0; u < doc.links.length; u++) {
            var link = doc.links[u];
            if (link.status == LinkStatus.LINK_OUT_OF_DATE) {
                try {
                    link.update();
                } catch(e) {}
            }
        }
        
        // Save document
        try {
            var saveFile = new File(outputPath + docName);
            doc.save(saveFile);
            docResult.saved = true;
            results.summary.saved++;
        } catch(e) {
            docResult.error = "Save failed: " + e.message;
            results.summary.errors.push(docName + ": " + e.message);
        }
        
        results.documents.push(docResult);
    }
}

// Build output string
var output = "=== Relink & Save Results ===\n\n";
output += "Total documents: " + results.summary.totalDocs + "\n";
output += "Successfully relinked: " + results.summary.relinked + " links\n";
output += "Successfully saved: " + results.summary.saved + " documents\n";
output += "Errors: " + results.summary.errors.length + "\n\n";

for (var r = 0; r < results.documents.length; r++) {
    var res = results.documents[r];
    output += "--- " + res.name + " ---\n";
    output += "Relinked: " + res.relinked + " links\n";
    output += "Missing: " + res.missing + " links\n";
    output += "Saved: " + (res.saved ? "Yes" : "No") + "\n";
    if (res.error) {
        output += "Error: " + res.error + "\n";
    }
    output += "\n";
}

if (results.summary.errors.length > 0) {
    output += "=== Errors ===\n";
    for (var e = 0; e < results.summary.errors.length; e++) {
        output += "- " + results.summary.errors[e] + "\n";
    }
}

output;
