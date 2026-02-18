// Export all open documents to IDML in the same folder as the document
var count = 0;
for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i];
    if (doc.saved) {
        var idmlFile = new File(doc.fullName.fsName.replace(".indd", ".idml"));
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
        count++;
    }
}
"Exported " + count + " documents to IDML";
