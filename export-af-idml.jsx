// Export A&F N3 and N4 to IDML for analysis
var outputFolder = Folder("/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/curriculum-analysis");
if (!outputFolder.exists) {
    outputFolder.create();
}

var results = [];
var exported = 0;

for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i];
    var name = doc.name;
    
    // Only export A&F books
    if (name.indexOf("A&F") !== -1 || name.indexOf("Anatomie") !== -1) {
        try {
            var idmlName = name.replace(".indd", ".idml").replace(/ /g, "-");
            var idmlFile = File(outputFolder.fsName + "/" + idmlName);
            doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
            exported++;
            results.push("OK: " + idmlName + " (" + doc.pages.length + " pages)");
        } catch (e) {
            results.push("ERROR: " + name + " - " + e.message);
        }
    }
}

results.push("");
results.push("Exported " + exported + " A&F books to:");
results.push(outputFolder.fsName);

results.join("\n");


































