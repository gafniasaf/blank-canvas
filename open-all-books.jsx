// Open all InDesign books from the designs folder
var designsFolder = Folder("/Users/asafgafni/Desktop/InDesign/TestRun/designs");
var files = designsFolder.getFiles("*.indd");
var opened = [];
var errors = [];

for (var i = 0; i < files.length; i++) {
    try {
        var f = files[i];
        // Check if already open
        var alreadyOpen = false;
        for (var j = 0; j < app.documents.length; j++) {
            if (app.documents[j].fullName && app.documents[j].fullName.fsName === f.fsName) {
                alreadyOpen = true;
                break;
            }
        }
        
        if (!alreadyOpen) {
            app.open(f);
            opened.push(f.name);
        } else {
            opened.push(f.name + " (already open)");
        }
    } catch (e) {
        errors.push(f.name + ": " + e.message);
    }
}

// List all open documents
var result = [];
result.push("=== OPEN DOCUMENTS ===");
result.push("Total: " + app.documents.length);
result.push("");

for (var k = 0; k < app.documents.length; k++) {
    var doc = app.documents[k];
    result.push((k + 1) + ". " + doc.name);
    result.push("   Pages: " + doc.pages.length);
}

if (errors.length > 0) {
    result.push("");
    result.push("=== ERRORS ===");
    for (var e = 0; e < errors.length; e++) {
        result.push(errors[e]);
    }
}

result.join("\n");


































