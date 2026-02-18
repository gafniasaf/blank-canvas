var doc = app.documents.itemByName("MBO Communicatie_9789083251387_03.2024.indd");
if (doc.isValid) {
    var idmlFile = new File(doc.fullName.fsName.replace(".indd", ".idml"));
    doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
    "OK";
} else {
    "Document not found";
}
