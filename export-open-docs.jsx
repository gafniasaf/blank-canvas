// Export all currently open documents to IDML
var outputFolder = "/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/test-data/";
var results = [];

for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i];
    try {
        // Create output filename by replacing .indd with .idml and spaces with dashes
        var baseName = doc.name;
        baseName = baseName.replace(".indd", "");
        baseName = baseName.replace(/ /g, "-");
        baseName = baseName.replace(/_/g, "-");
        
        var idmlPath = outputFolder + baseName + ".idml";
        var idmlFile = new File(idmlPath);
        
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
        results.push("OK: " + baseName + ".idml");
    } catch (e) {
        results.push("ERROR " + doc.name + ": " + e.message);
    }
}

// Close all documents without saving
while (app.documents.length > 0) {
    app.documents[0].close(SaveOptions.NO);
}

results.join("\n");


































