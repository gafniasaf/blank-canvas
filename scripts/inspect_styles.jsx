// Script to inspect styles in the document
#targetengine "session"

(function() {
    var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
    if (!File(srcPath).exists) return;

    var doc = app.open(File(srcPath), false);
    
    var pStyles = doc.allParagraphStyles;
    var oStyles = doc.allObjectStyles;
    
    var pStyleNames = [];
    for (var i = 0; i < pStyles.length; i++) {
        pStyleNames.push(pStyles[i].name);
    }
    
    var oStyleNames = [];
    for (var j = 0; j < oStyles.length; j++) {
        oStyleNames.push(oStyles[j].name);
    }
    
    doc.close(SaveOptions.NO);
    
    var f = File("/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/style_report.txt");
    f.open("w");
    f.write("PARAGRAPH STYLES:\n" + pStyleNames.join("\n") + "\n\nOBJECT STYLES:\n" + oStyleNames.join("\n"));
    f.close();
})();



