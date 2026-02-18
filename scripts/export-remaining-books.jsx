// Export remaining books with high-res images
#target indesign

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

var books = [
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Communicatie_9789083251387_03/MBO Communicatie_9789083251387_03.2024.indd",
        output: "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_COMMUNICATIE_HIRES_v2.pdf"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Methodisch werken_9789083251394_03/MBO Methodisch werken_9789083251394_03.2024.indd",
        output: "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_METHODISCH_WERKEN_HIRES_v2.pdf"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Persoonlijke Verzorging_9789083412023_03/MBO Persoonlijke Verzorging_9789083412023_03.2024.indd",
        output: "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_PERSOONLIJKE_VERZORGING_HIRES_v2.pdf"
    },
    {
        source: "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 3_9789083251363_03/MBO A&F 3_9789083251363_03.2024.indd",
        output: "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_AF3_HIRES_v2.pdf"
    }
];

for (var i = 0; i < books.length; i++) {
    var book = books[i];
    try {
        $.writeln("Opening: " + book.source);
        var doc = app.open(new File(book.source), false);
        
        $.writeln("Document has " + doc.pages.length + " pages");
        
        // Create custom preset by duplicating High Quality Print
        var presetName = "TempHighRes_" + new Date().getTime();
        var basePreset = app.pdfExportPresets.itemByName("[High Quality Print]");
        var customPreset = basePreset.duplicate(presetName);
        
        // Configure for maximum quality
        customPreset.colorBitmapSampling = Sampling.NONE;
        customPreset.grayscaleBitmapSampling = Sampling.NONE;
        customPreset.monochromeBitmapSampling = Sampling.NONE;
        customPreset.colorBitmapCompression = BitmapCompression.ZIP;
        customPreset.grayscaleBitmapCompression = BitmapCompression.ZIP;
        customPreset.monochromeBitmapCompression = MonoBitmapCompression.ZIP;
        
        $.writeln("Exporting to: " + book.output);
        doc.exportFile(ExportFormat.PDF_TYPE, new File(book.output), false, customPreset);
        
        // Cleanup
        customPreset.remove();
        doc.close(SaveOptions.NO);
        
        $.writeln("SUCCESS: Exported");
    } catch(e) {
        $.writeln("ERROR exporting " + book.source + ": " + e.message);
    }
}

$.writeln("ALL DONE");



