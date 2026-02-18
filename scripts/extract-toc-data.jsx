// extract-toc-data.jsx
// Extracts chapter and section titles with page numbers from the active InDesign document
// Output: JSON file with TOC structure

#target indesign

(function() {
    if (app.documents.length === 0) {
        alert("Geen document open. Open eerst een boek in InDesign.");
        return;
    }
    
    var doc = app.activeDocument;
    var docName = doc.name.replace(/\.(indd|idml)$/i, "");
    
    // Look for paragraph styles that indicate chapter/section headings
    var chapterStyles = ["Hoofdstuktitel", "ChapterTitle", "H1", "Titel_Hoofdstuk", "HS_titel"];
    var sectionStyles = ["Paragraaftitel", "SectionTitle", "H2", "Titel_Paragraaf", "PAR_titel", "kop 1"];
    var subSectionStyles = ["SubParagraaftitel", "H3", "Titel_Subparagraaf", "kop 2"];
    
    var tocItems = [];
    
    // Iterate through all stories
    for (var s = 0; s < doc.stories.length; s++) {
        var story = doc.stories[s];
        
        for (var p = 0; p < story.paragraphs.length; p++) {
            var para = story.paragraphs[p];
            var styleName = para.appliedParagraphStyle.name;
            var text = para.contents.replace(/[\r\n]+/g, " ").replace(/^\s+|\s+$/g, "");
            
            if (text.length === 0) continue;
            
            var level = 0;
            
            // Check if it's a chapter heading
            for (var i = 0; i < chapterStyles.length; i++) {
                if (styleName.toLowerCase().indexOf(chapterStyles[i].toLowerCase()) !== -1) {
                    level = 1;
                    break;
                }
            }
            
            // Check if it's a section heading
            if (level === 0) {
                for (var i = 0; i < sectionStyles.length; i++) {
                    if (styleName.toLowerCase().indexOf(sectionStyles[i].toLowerCase()) !== -1) {
                        level = 2;
                        break;
                    }
                }
            }
            
            // Check if it's a subsection heading
            if (level === 0) {
                for (var i = 0; i < subSectionStyles.length; i++) {
                    if (styleName.toLowerCase().indexOf(subSectionStyles[i].toLowerCase()) !== -1) {
                        level = 3;
                        break;
                    }
                }
            }
            
            if (level > 0) {
                // Get page number
                var pageNum = "";
                try {
                    var frame = para.parentTextFrames[0];
                    if (frame && frame.parentPage) {
                        pageNum = frame.parentPage.name;
                    }
                } catch (e) {}
                
                // Extract number prefix if present (e.g., "1.2 Title" -> num="1.2", label="Title")
                var num = "";
                var label = text;
                var match = text.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
                if (match) {
                    num = match[1];
                    label = match[2];
                } else {
                    // Try to extract chapter number
                    match = text.match(/^(\d+)\s+(.+)$/);
                    if (match) {
                        num = match[1];
                        label = match[2];
                    }
                }
                
                tocItems.push({
                    level: level,
                    num: num,
                    label: label,
                    page: pageNum,
                    style: styleName
                });
            }
        }
    }
    
    // Build JSON output
    var output = {
        bookId: docName,
        extractedAt: new Date().toISOString(),
        items: tocItems
    };
    
    var jsonStr = "{\n";
    jsonStr += '  "bookId": "' + escapeJson(output.bookId) + '",\n';
    jsonStr += '  "extractedAt": "' + output.extractedAt + '",\n';
    jsonStr += '  "items": [\n';
    
    for (var i = 0; i < tocItems.length; i++) {
        var item = tocItems[i];
        jsonStr += '    {"level": ' + item.level + ', "num": "' + escapeJson(item.num) + '", "label": "' + escapeJson(item.label) + '", "page": "' + escapeJson(item.page) + '"}';
        if (i < tocItems.length - 1) jsonStr += ",";
        jsonStr += "\n";
    }
    
    jsonStr += "  ]\n}";
    
    // Save to file
    var outputFolder = Folder(doc.filePath || Folder.desktop);
    var outputFile = new File(outputFolder.fsName + "/" + docName + "_toc.json");
    
    outputFile.open("w");
    outputFile.encoding = "UTF-8";
    outputFile.write(jsonStr);
    outputFile.close();
    
    alert("TOC geëxtraheerd!\n\n" + tocItems.length + " items gevonden.\n\nOpgeslagen als:\n" + outputFile.fsName);
    
    function escapeJson(str) {
        if (!str) return "";
        return String(str)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
    }
})();



