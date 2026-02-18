// Export pages 195-220 from the FULL A&F N4 book
#target indesign

// Find the full book document
var doc = null;
for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].name.indexOf("MBO A&F 4_9789083251370_03.2024") >= 0) {
        doc = app.documents[i];
        break;
    }
}

if (!doc) {
    alert("Full book not found! Opening it...");
    doc = app.open(File("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd"), false);
}

var outputFolder = new Folder("/Users/asafgafni/Desktop/page_exports");
if (!outputFolder.exists) outputFolder.create();

// Empty the folder first
var oldFiles = outputFolder.getFiles("*.jpg");
for (var i = 0; i < oldFiles.length; i++) {
    oldFiles[i].remove();
}

var startPage = 195;
var endPage = 220;
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

alert("Done! Exported " + exported + " pages to Desktop/page_exports/");







