// MANUAL EXPORT - Double-click this file or run from InDesign Scripts panel
// Exports Chapter 7 to IDML

#target "InDesign"
alert("Starting export of Chapter 7...");

var src = File("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/07-VTH_Combined_03.2024.indd");
var out = File("/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4/07-VTH_Combined_03.2024.idml");

if (!src.exists) {
    alert("ERROR: Source file not found:\n" + src.fsName);
} else if (out.exists) {
    alert("IDML already exists - skipping");
} else {
    try {
        var doc = app.open(src);
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, out);
        doc.close(SaveOptions.NO);
        alert("SUCCESS!\nExported to:\n" + out.fsName);
    } catch(e) {
        alert("ERROR: " + e.message);
    }
}











