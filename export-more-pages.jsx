// Export pages 185-194 from the full book
#target indesign

var doc = null;
for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].name.indexOf("MBO A&F 4_9789083251370_03.2024") >= 0) {
        doc = app.documents[i];
        break;
    }
}

if (!doc) {
    alert("Book not found!");
} else {
    var outputFolder = new Folder("/Users/asafgafni/Desktop/page_exports");
    
    var startPage = 185;
    var endPage = 194;
    var exported = 0;

    for (var i = 0; i < doc.pages.length; i++) {
        var page = doc.pages[i];
        var pageNum = parseInt(page.name);
        
        if (!isNaN(pageNum) && pageNum >= startPage && pageNum <= endPage) {
            var jpgFile = new File(outputFolder + "/page_" + page.name + ".jpg");
            
            app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
            app.jpegExportPreferences.exportResolution = 150;
            app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
            app.jpegExportPreferences.pageString = page.name;
            
            doc.exportFile(ExportFormat.JPG, jpgFile);
            exported++;
        }
    }

    alert("Exported " + exported + " pages (185-194)");
}







