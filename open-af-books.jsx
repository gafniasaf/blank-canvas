// Open A&F N3 and N4 books for comparison
var filesToOpen = [
    "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 3_9789083251363_03/MBO A&F 3_9789083251363_03.2024.indd",
    "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd"
];

var results = [];

for (var i = 0; i < filesToOpen.length; i++) {
    try {
        var f = File(filesToOpen[i]);
        if (f.exists) {
            app.open(f);
            results.push("Opened: " + f.name);
        } else {
            results.push("NOT FOUND: " + filesToOpen[i]);
        }
    } catch (e) {
        results.push("ERROR: " + e.message);
    }
}

// List all open documents with details
results.push("");
results.push("=== ALL OPEN DOCUMENTS ===");

for (var k = 0; k < app.documents.length; k++) {
    var doc = app.documents[k];
    results.push("");
    results.push((k + 1) + ". " + doc.name);
    results.push("   Pages: " + doc.pages.length);
    
    // Count text frames and characters
    var totalChars = 0;
    var totalFrames = 0;
    for (var s = 0; s < doc.stories.length; s++) {
        totalChars += doc.stories[s].characters.length;
        totalFrames++;
    }
    results.push("   Stories: " + totalFrames);
    results.push("   Characters: " + totalChars.toLocaleString());
}

results.join("\n");


































