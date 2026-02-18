// Export Klinisch Redeneren with high-res images
#target indesign

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

var SOURCE_INDD = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03/MBO Praktijkgestuurd klinisch redeneren_9789083412030_03.2024.indd";
var OUTPUT_PDF = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/highres_exports/MBO_KLINISCH_REDENEREN_HIRES_v2.pdf";

try {
    $.writeln("Opening: " + SOURCE_INDD);
    var doc = app.open(new File(SOURCE_INDD), false);
    
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
    
    $.writeln("Exporting to: " + OUTPUT_PDF);
    doc.exportFile(ExportFormat.PDF_TYPE, new File(OUTPUT_PDF), false, customPreset);
    
    // Cleanup
    customPreset.remove();
    doc.close(SaveOptions.NO);
    
    $.writeln("SUCCESS: Exported " + doc.pages.length + " pages");
} catch(e) {
    $.writeln("FATAL ERROR: " + e.message);
}



