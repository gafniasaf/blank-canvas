// Export all INDD files to IDML
var sourceFolder = "/Users/asafgafni/Desktop/InDesign/TestRun/designs/";
var outputFolder = "/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/test-data/";

var files = [
    {input: "MBO Communicatie_9789083251387_03.2024.indd", output: "MBO-Communicatie.idml"},
    {input: "MBO Persoonlijke Verzorging_9789083412023_03.2024.indd", output: "MBO-Persoonlijke-Verzorging.idml"},
    {input: "MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd", output: "MBO-Klinisch-Redeneren.idml"}
];

var results = [];

for (var i = 0; i < files.length; i++) {
    var inddPath = sourceFolder + files[i].input;
    var idmlPath = outputFolder + files[i].output;
    
    try {
        var inddFile = File(inddPath);
        if (!inddFile.exists) {
            results.push("NOT FOUND: " + files[i].input);
            continue;
        }
        
        var doc = app.open(inddFile);
        var idmlFile = File(idmlPath);
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
        doc.close(SaveOptions.NO);
        results.push("EXPORTED: " + files[i].output);
    } catch (e) {
        results.push("ERROR " + files[i].input + ": " + e.message);
    }
}

results.join("\n");


































