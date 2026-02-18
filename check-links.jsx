// Check all open documents for missing links, fonts, and styles
// Build output as a string since JSON is not available

var output = "";

if (app.documents.length === 0) {
    output = "ERROR: No documents open in InDesign";
} else {
    output += "=== InDesign Document Check ===\n";
    output += "Total open documents: " + app.documents.length + "\n\n";
    
    var totalMissing = 0;
    var totalModified = 0;
    var totalMissingFonts = 0;
    
    for (var d = 0; d < app.documents.length; d++) {
        var doc = app.documents[d];
        output += "--- Document " + (d+1) + " ---\n";
        output += "Name: " + doc.name + "\n";
        
        try {
            if (doc.saved && doc.fullName) {
                output += "Path: " + doc.fullName.fsName + "\n";
            } else {
                output += "Path: (unsaved)\n";
            }
        } catch(e) {
            output += "Path: (unsaved)\n";
        }
        
        output += "Pages: " + doc.pages.length + "\n";
        output += "Paragraph Styles: " + doc.paragraphStyles.length + "\n";
        output += "Character Styles: " + doc.characterStyles.length + "\n";
        output += "Object Styles: " + doc.objectStyles.length + "\n";
        
        // Check links
        output += "\n[LINKS]\n";
        output += "Total links: " + doc.links.length + "\n";
        
        var missingLinks = [];
        var modifiedLinks = [];
        var okLinks = 0;
        
        for (var i = 0; i < doc.links.length; i++) {
            var link = doc.links[i];
            
            if (link.status == LinkStatus.LINK_MISSING) {
                missingLinks.push(link.name);
                totalMissing++;
            } else if (link.status == LinkStatus.LINK_OUT_OF_DATE) {
                modifiedLinks.push(link.name);
                totalModified++;
            } else {
                okLinks++;
            }
        }
        
        output += "OK: " + okLinks + "\n";
        output += "Missing: " + missingLinks.length + "\n";
        if (missingLinks.length > 0) {
            for (var m = 0; m < Math.min(missingLinks.length, 10); m++) {
                output += "  - " + missingLinks[m] + "\n";
            }
            if (missingLinks.length > 10) {
                output += "  ... and " + (missingLinks.length - 10) + " more\n";
            }
        }
        output += "Modified: " + modifiedLinks.length + "\n";
        if (modifiedLinks.length > 0) {
            for (var md = 0; md < Math.min(modifiedLinks.length, 10); md++) {
                output += "  - " + modifiedLinks[md] + "\n";
            }
            if (modifiedLinks.length > 10) {
                output += "  ... and " + (modifiedLinks.length - 10) + " more\n";
            }
        }
        
        // Check fonts
        output += "\n[FONTS]\n";
        output += "Total fonts used: " + doc.fonts.length + "\n";
        
        var missingFonts = [];
        var okFonts = 0;
        
        for (var f = 0; f < doc.fonts.length; f++) {
            var font = doc.fonts[f];
            
            if (font.status == FontStatus.NOT_AVAILABLE) {
                missingFonts.push(font.name);
                totalMissingFonts++;
            } else {
                okFonts++;
            }
        }
        
        output += "OK: " + okFonts + "\n";
        output += "Missing: " + missingFonts.length + "\n";
        if (missingFonts.length > 0) {
            for (var mf = 0; mf < missingFonts.length; mf++) {
                output += "  - " + missingFonts[mf] + "\n";
            }
        }
        
        output += "\n";
    }
    
    output += "=== SUMMARY ===\n";
    output += "Total Missing Links: " + totalMissing + "\n";
    output += "Total Modified Links: " + totalModified + "\n";
    output += "Total Missing Fonts: " + totalMissingFonts + "\n";
    
    if (totalMissing == 0 && totalModified == 0 && totalMissingFonts == 0) {
        output += "\n✓ All documents are OK - no missing links or fonts!\n";
    } else {
        output += "\n⚠ Issues found - see details above\n";
    }
}

function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) s = "doc";
    return s;
}
function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
}
function writeTextToDesktop(filename, text) {
    try {
        var f = File(Folder.desktop + "/" + filename);
        f.encoding = "UTF-8";
        f.lineFeed = "Unix";
        if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
}

try { $.writeln(output); } catch (eW0) {}
try {
    // app.activeDocument can throw in some automation contexts even when documents exist.
    // Use a safe fallback for report naming.
    var nameForFile = "no_doc";
    try {
        if (app.documents.length > 0) nameForFile = app.documents[0].name;
    } catch (eN) { nameForFile = "no_doc"; }
    writeTextToDesktop("check_links_report__" + safeFileName(nameForFile) + "__" + isoStamp() + ".txt", output);
} catch (eF0) {}

output;
