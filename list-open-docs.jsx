// List all open documents in InDesign
var result = [];

if (app.documents.length === 0) {
    result.push("No documents open");
} else {
    result.push("Open documents: " + app.documents.length);
    result.push("");
    for (var i = 0; i < app.documents.length; i++) {
        var doc = app.documents[i];
        var pageCount = doc.pages.length;
        var path = doc.saved ? doc.fullName.fsName : "(unsaved)";
        result.push((i + 1) + ". " + doc.name);
        result.push("   Pages: " + pageCount);
        result.push("   Path: " + path);
        result.push("");
    }
}

result.join("\n");


































