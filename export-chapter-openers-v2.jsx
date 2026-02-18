/**
 * Export Chapter Opener Pages as JPEG images (v2)
 * 
 * This script finds each chapter's opening page by looking for:
 * 1. Pages with "•Hoofdstukcijfer" or "•Hoofdstuktitel" paragraph styles
 * 2. Pages using B-Master (chapter opener master page)
 * 
 * Run this in InDesign with the A&F N4 book open.
 */

#target "indesign"

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
    var foundPageIndices = {};
    
    $.writeln("Scanning " + pages.length + " pages for chapter openers...");
    
    // Method 1: Find pages with chapter number/title paragraph styles
    for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        var pageItems = page.allPageItems;
        
        for (var j = 0; j < pageItems.length; j++) {
            var item = pageItems[j];
            if (item.constructor.name === "TextFrame") {
                try {
                    var paras = item.paragraphs;
                    for (var k = 0; k < paras.length; k++) {
                        var para = paras[k];
                        if (!para.appliedParagraphStyle) continue;
                        var styleName = para.appliedParagraphStyle.name;
                        
                        // Look for chapter number or title styles
                        if (styleName.indexOf("Hoofdstukcijfer") >= 0 || 
                            styleName.indexOf("Hoofdstuktitel") >= 0 ||
                            styleName.indexOf("hoofdstukcijfer") >= 0 ||
                            styleName.indexOf("hoofdstuktitel") >= 0) {
                            
                            if (!foundPageIndices[i]) {
                                var text = para.contents.replace(/[\r\n\t]/g, ' ').substring(0, 30);
                                chapterPages.push({
                                    pageIndex: i,
                                    pageName: page.name,
                                    source: "style:" + styleName,
                                    preview: text
                                });
                                foundPageIndices[i] = true;
                                $.writeln("  Found chapter page (style): " + page.name + " - " + text);
                            }
                            break;
                        }
                    }
                } catch (e) {
                    // Skip problematic text frames
                }
            }
        }
    }
    
    // Method 2: Find pages using B-Master (typical chapter opener master)
    for (var i = 0; i < pages.length; i++) {
        if (foundPageIndices[i]) continue;
        
        var page = pages[i];
        if (page.appliedMaster) {
            var masterName = page.appliedMaster.name;
            if (masterName.indexOf("B-") === 0 || masterName.indexOf("B ") === 0) {
                chapterPages.push({
                    pageIndex: i,
                    pageName: page.name,
                    source: "master:" + masterName,
                    preview: "(B-Master page)"
                });
                foundPageIndices[i] = true;
                $.writeln("  Found chapter page (master): " + page.name + " - " + masterName);
            }
        }
    }
    
    // Sort by page index
    chapterPages.sort(function(a, b) { return a.pageIndex - b.pageIndex; });
    
    $.writeln("\nFound " + chapterPages.length + " chapter opener pages.");
    
    // Limit to first occurrence per chapter (chapters start on odd pages typically)
    var uniqueOpeners = [];
    var lastPageIndex = -100;
    for (var i = 0; i < chapterPages.length; i++) {
        var info = chapterPages[i];
        // Skip if this page is very close to the previous one (same chapter spread)
        if (info.pageIndex - lastPageIndex > 3) {
            uniqueOpeners.push(info);
            lastPageIndex = info.pageIndex;
        }
    }
    
    $.writeln("Filtered to " + uniqueOpeners.length + " unique chapter openers.");
    
    // Set export preferences
    var exportPrefs = app.jpegExportPreferences;
    exportPrefs.jpegQuality = JPEGOptionsQuality.MAXIMUM;
    exportPrefs.exportResolution = 150;
    exportPrefs.jpegColorSpace = JpegColorSpaceEnum.RGB;
    exportPrefs.antiAlias = true;
    exportPrefs.simulateOverprint = false;
    exportPrefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
    
    // Export each chapter opener page
    for (var i = 0; i < uniqueOpeners.length; i++) {
        var info = uniqueOpeners[i];
        var page = pages[info.pageIndex];
        var chapterNum = i + 1;
        
        var outFile = new File(OUTPUT_DIR + "chapter_" + chapterNum + "_opener.jpg");
        
        try {
            exportPrefs.pageString = page.name;
            doc.exportFile(ExportFormat.JPG, outFile, false);
            $.writeln("Exported chapter " + chapterNum + ": " + outFile.fsName + " (page " + page.name + ")");
        } catch (e) {
            $.writeln("ERROR exporting page " + page.name + ": " + e.message);
        }
    }
    
    $.writeln("\nDone! Exported " + uniqueOpeners.length + " chapter opener images.");
    alert("Exported " + uniqueOpeners.length + " chapter opener images to:\n" + OUTPUT_DIR);
})();











