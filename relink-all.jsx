// Relink all links and update modified ones, then save
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

var output = "=== Relink & Save All Documents ===\n\n";

for (var d = 0; d < app.documents.length; d++) {
    var doc = app.documents[d];
    var docName = doc.name;
    
    output += "--- " + docName + " ---\n";
    output += "Total links: " + doc.links.length + "\n";
    
    var linksFolderPath = docToLinksMap[docName];
    
    if (!linksFolderPath) {
        output += "SKIP: No Links folder mapping\n\n";
        continue;
    }
    
    var linksFolder = new Folder(linksFolderPath);
    
    if (!linksFolder.exists) {
        output += "ERROR: Links folder does not exist\n\n";
        continue;
    }
    
    // Build file index
    var fileIndex = {};
    var files = linksFolder.getFiles();
    for (var f = 0; f < files.length; f++) {
        var fileName = files[f].name.toLowerCase();
        fileIndex[fileName] = files[f];
    }
    
    var relinked = 0;
    var updated = 0;
    var missing = 0;
    var ok = 0;
    
    // Process all links
    for (var i = 0; i < doc.links.length; i++) {
        var link = doc.links[i];
        var linkName = link.name;
        var status = link.status;
        
        if (status == LinkStatus.LINK_MISSING) {
            // Try to relink
            var found = false;
            var lowerName = linkName.toLowerCase();
            
            if (fileIndex[lowerName]) {
                try {
                    link.relink(fileIndex[lowerName]);
                    relinked++;
                    found = true;
                } catch(e) {}
            }
            
            if (!found) {
                missing++;
            }
        } else if (status == LinkStatus.LINK_OUT_OF_DATE) {
            // Update the link
            try {
                link.update();
                updated++;
            } catch(e) {
                // If update fails, try relinking
                var lowerName = linkName.toLowerCase();
                if (fileIndex[lowerName]) {
                    try {
                        link.relink(fileIndex[lowerName]);
                        relinked++;
                    } catch(e2) {
                        missing++;
                    }
                } else {
                    missing++;
                }
            }
        } else {
            ok++;
        }
    }
    
    output += "Relinked: " + relinked + "\n";
    output += "Updated: " + updated + "\n";
    output += "OK: " + ok + "\n";
    output += "Still missing: " + missing + "\n";
    
    // Save document
    try {
        var saveFile = new File(outputPath + docName);
        doc.save(saveFile);
        output += "Saved: " + saveFile.name + "\n";
    } catch(e) {
        output += "ERROR saving: " + e.message + "\n";
    }
    
    output += "\n";
}

output;
