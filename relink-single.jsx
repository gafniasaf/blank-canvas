// Relink and save a single document (run multiple times for each document)
// Usage: Set docIndex variable to the document number (0-based)

var docIndex = 4;
var basePath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/";
var outputPath = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/";

var outputFolder = new Folder(outputPath);
if (!outputFolder.exists) {
    outputFolder.create();
}

var docToLinksMap = {
    "MBO A&F 4_9789083251370_03.2024.indd": basePath + "MBO A&F 4_9789083251370_03/Links",
    "MBO A&F 3_9789083251363_03.2024.indd": basePath + "MBO A&F 3_9789083251363_03/Links",
    "MBO Communicatie_9789083251387_03.2024.indd": basePath + "MBO Communicatie_9789083251387_03/Links",
    "MBO Persoonlijke Verzorging_9789083412023_03.2024.indd": basePath + "MBO Persoonlijke Verzorging_9789083412023_03/Links",
    "MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd": basePath + "MBO Praktijkgestuurd klinisch redeneren_9789083412030_03/Links"
};

var output = "";

if (app.documents.length == 0) {
    output = "ERROR: No documents open";
} else if (docIndex >= app.documents.length) {
    output = "ERROR: Document index " + docIndex + " out of range (0-" + (app.documents.length-1) + ")";
} else {
    var doc = app.documents[docIndex];
    var docName = doc.name;
    
    output += "Processing: " + docName + "\n";
    output += "Total links: " + doc.links.length + "\n";
    
    var linksFolderPath = docToLinksMap[docName];
    
    if (!linksFolderPath) {
        output += "ERROR: No Links folder mapping found\n";
    } else {
        var linksFolder = new Folder(linksFolderPath);
        
        if (!linksFolder.exists) {
            output += "ERROR: Links folder does not exist: " + linksFolderPath + "\n";
        } else {
            // Build file index for faster lookup
            var fileIndex = {};
            var files = linksFolder.getFiles();
            for (var f = 0; f < files.length; f++) {
                var fileName = files[f].name.toLowerCase();
                if (!fileIndex[fileName]) {
                    fileIndex[fileName] = files[f];
                }
            }
            
            var relinked = 0;
            var missing = 0;
            var updated = 0;
            
            // Relink missing and modified links
            for (var i = 0; i < doc.links.length; i++) {
                var link = doc.links[i];
                var linkName = link.name;
                
                if (link.status == LinkStatus.LINK_MISSING || link.status == LinkStatus.LINK_OUT_OF_DATE) {
                    var found = false;
                    
                    // Try exact match first
                    var linkFile = new File(linksFolder.fsName + "/" + linkName);
                    if (linkFile.exists) {
                        try {
                            link.relink(linkFile);
                            relinked++;
                            found = true;
                        } catch(e) {}
                    }
                    
                    // Try case-insensitive match
                    if (!found) {
                        var lowerName = linkName.toLowerCase();
                        if (fileIndex[lowerName]) {
                            try {
                                link.relink(fileIndex[lowerName]);
                                relinked++;
                                found = true;
                            } catch(e) {}
                        }
                    }
                    
                    if (!found) {
                        missing++;
                    }
                }
            }
            
            // Update all out-of-date links
            for (var u = 0; u < doc.links.length; u++) {
                var link = doc.links[u];
                if (link.status == LinkStatus.LINK_OUT_OF_DATE) {
                    try {
                        link.update();
                        updated++;
                    } catch(e) {}
                }
            }
            
            output += "Relinked: " + relinked + " links\n";
            output += "Updated: " + updated + " links\n";
            output += "Still missing: " + missing + " links\n";
            
            // Save document
            try {
                var saveFile = new File(outputPath + docName);
                doc.save(saveFile);
                output += "Saved: " + saveFile.fsName + "\n";
            } catch(e) {
                output += "ERROR saving: " + e.message + "\n";
            }
        }
    }
}

output;
