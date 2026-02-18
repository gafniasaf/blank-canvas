// Open specific InDesign books
var filesToOpen = [
    "/Users/asafgafni/Desktop/InDesign/TestRun/designs/MBO Communicatie_9789083251387_03.2024.indd",
    "/Users/asafgafni/Desktop/InDesign/TestRun/designs/MBO Persoonlijke Verzorging_9789083412023_03.2024.indd",
    "/Users/asafgafni/Desktop/InDesign/TestRun/designs/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd"
];

var opened = [];
var errors = [];

for (var i = 0; i < filesToOpen.length; i++) {
    try {
        var f = File(filesToOpen[i]);
        if (f.exists) {
            app.open(f);
            opened.push(f.name);
        } else {
            errors.push("File not found: " + filesToOpen[i]);
        }
    } catch (e) {
        errors.push(filesToOpen[i] + ": " + e.message);
    }
}

// List all open documents
var result = [];
result.push("=== ALL OPEN DOCUMENTS ===");
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


































