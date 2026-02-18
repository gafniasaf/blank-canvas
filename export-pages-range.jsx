// Export pages 195-220 as individual JPEGs
#target indesign

var doc = app.activeDocument;
var outputFolder = new Folder("/Users/asafgafni/Desktop/page_exports");
if (!outputFolder.exists) outputFolder.create();

var startPage = 195;
var endPage = 220;

for (var i = 0; i < doc.pages.length; i++) {
    var page = doc.pages[i];
    var pageNum = parseInt(page.name);
    
    if (pageNum >= startPage && pageNum <= endPage) {
        var jpgFile = new File(outputFolder + "/page_" + page.name + ".jpg");
        
        // Set JPEG export options
        app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
        app.jpegExportPreferences.exportResolution = 150;
        app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
        app.jpegExportPreferences.pageString = page.name;
        
        doc.exportFile(ExportFormat.JPG, jpgFile);
    }
}

alert("Done! Exported pages " + startPage + "-" + endPage + " to Desktop/page_exports/");







