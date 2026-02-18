#target "InDesign"
(function() {
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    var src = File("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/07-VTH_Combined_03.2024.indd");
    var out = File("/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4/07-VTH_Combined_03.2024.idml");
    if (src.exists && !out.exists) {
        var doc = app.open(src, false);
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, out, false);
        doc.close(SaveOptions.NO);
    }
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;
})();











