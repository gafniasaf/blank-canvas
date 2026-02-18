/**
 * Export Chapter Opener Pages as JPEG images
 * 
 * This script finds each chapter's opening page (identified by "Hoofdstuk" style)
 * and exports it as a JPEG image for use in the Prince PDF pipeline.
 * 
 * Run this in InDesign with the A&F N4 book open.
 */

#target "indesign"
#targetengine "session"

(function() {
    var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/images/chapter_openers/";
    
    // Create output directory if needed
    var outputFolder = new Folder(OUTPUT_DIR);
    if (!outputFolder.exists) {
        outputFolder.create();
    }
    
    var doc = app.activeDocument;
    var pages = doc.pages;
    var chapterPages = [];
    
    // Find chapter opener pages by looking for pages with "Hoofdstuk" paragraph style
    // or pages that use a chapter opener master (B-Master typically)
    for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        var pageItems = page.allPageItems;
        
        for (var j = 0; j < pageItems.length; j++) {
            var item = pageItems[j];
            if (item.constructor.name === "TextFrame") {
                var paras = item.paragraphs;
                for (var k = 0; k < paras.length; k++) {
                    var para = paras[k];
                    var styleName = para.appliedParagraphStyle.name;
                    // Look for chapter title or chapter number styles
                    if (styleName.indexOf("Hoofdstuk") >= 0 || 
                        styleName.indexOf("hoofdstuk") >= 0 ||
                        styleName.indexOf("Chapter") >= 0) {
                        // Found a chapter opener page
                        var text = para.contents.replace(/[\r\n]/g, ' ').substring(0, 50);
                        chapterPages.push({
                            pageIndex: i,
                            pageName: page.name,
                            styleName: styleName,
                            preview: text
                        });
                        break;
                    }
                }
            }
        }
    }
    
    // Also look specifically for pages using chapter opener master pages
    var masterNames = ["B-Master", "C-Master", "Hoofdstuk"];
    for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        if (page.appliedMaster) {
            var masterName = page.appliedMaster.name;
            for (var m = 0; m < masterNames.length; m++) {
                if (masterName.indexOf(masterNames[m]) >= 0) {
                    var found = false;
                    for (var c = 0; c < chapterPages.length; c++) {
                        if (chapterPages[c].pageIndex === i) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        chapterPages.push({
                            pageIndex: i,
                            pageName: page.name,
                            masterName: masterName,
                            preview: "(master-based opener)"
                        });
                    }
                    break;
                }
            }
        }
    }
    
    // Sort by page index
    chapterPages.sort(function(a, b) { return a.pageIndex - b.pageIndex; });
    
    // Log found pages
    $.writeln("Found " + chapterPages.length + " potential chapter opener pages:");
    for (var i = 0; i < chapterPages.length; i++) {
        $.writeln("  Page " + chapterPages[i].pageName + " (index " + chapterPages[i].pageIndex + "): " + (chapterPages[i].preview || chapterPages[i].masterName));
    }
    
    // Export each chapter opener page
    var exportPrefs = app.jpegExportPreferences;
    exportPrefs.jpegQuality = JPEGOptionsQuality.MAXIMUM;
    exportPrefs.exportResolution = 150; // Good balance for speed/quality
    exportPrefs.jpegColorSpace = JpegColorSpaceEnum.RGB;
    exportPrefs.antiAlias = true;
    exportPrefs.simulateOverprint = false;
    
    var chapterNum = 1;
    for (var i = 0; i < chapterPages.length; i++) {
        var info = chapterPages[i];
        var page = pages[info.pageIndex];
        
        // Export this page as JPEG
        var outFile = new File(OUTPUT_DIR + "chapter_" + chapterNum + "_opener.jpg");
        
        try {
            // Select pages to export
            exportPrefs.pageString = page.name;
            exportPrefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
            
            doc.exportFile(ExportFormat.JPG, outFile, false);
            $.writeln("Exported: " + outFile.fsName);
            chapterNum++;
        } catch (e) {
            $.writeln("ERROR exporting page " + page.name + ": " + e.message);
        }
    }
    
    alert("Exported " + (chapterNum - 1) + " chapter opener images to:\n" + OUTPUT_DIR);
})();











