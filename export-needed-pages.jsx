// Export only the pages that have figures (based on metadata)
#target indesign

// Pages we need (from Python analysis)
var neededPages = ["1","100","101","102","103","104","105","106","107","11","110","111","112","113","114","115","116","117","118","119","12","120","121","122","123","124","125","127","128","129","130","131","132","133","134","135","136","137","138","139","14","140","141","143","144","145","146","147","148","149","15","150","151","152","153","154","155","156","157","158","16","160","161","162","163","164","165","166","167","168","169","17","170","171","172","173","174","175","176","177","178","179","18","180","181","182","183","184","19","2","20","21","221","222","223","224","225","226","227","228","229","23","230","231","232","233","234","235","236","237","238","239","24","240","241","242","243","244","245","246","247","248","249","25","250","251","252","253","254","255","256","257","258","259","26","260","261","262","263","264","265","266","267","268","269","27","270","271","272","273","274","275","276","277","278","279","28","280","281","282","283","284","29","30","31","32","33","35","36","37","38","39","4","40","41","42","43","44","45","46","47","48","49","5","50","51","52","53","54","55","56","57","58","59","6","60","61","62","63","64","65","66","67","68","69","7","70","71","72","73","74","75","76","77","78","79","80","81","82","83","84","85","86","87","88","89","9","90","91","92","93","94","95","96","97","98","99","iii","ix","v","vi","vii","viii","x","xi","xii","xiii","xiv","xv","xvi","xvii","xviii"];

var doc;
for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].name.indexOf("MBO A&F 4_9789083251370_03.2024") >= 0) {
        doc = app.documents[i];
        break;
    }
}

if (!doc) {
    alert("Document not open!");
} else {
    var outputFolder = new Folder("/Users/asafgafni/Desktop/page_exports");
    if (!outputFolder.exists) outputFolder.create();
    
    var exported = 0;
    var total = neededPages.length;
    
    // Create lookup for page names
    var neededLookup = {};
    for (var n = 0; n < neededPages.length; n++) {
        neededLookup[neededPages[n]] = true;
    }
    
    for (var p = 0; p < doc.pages.length; p++) {
        var page = doc.pages[p];
        var pageName = page.name;
        
        if (neededLookup[pageName]) {
            var jpgFile = new File(outputFolder + "/page_" + pageName + ".jpg");
            
            // Skip if already exported
            if (jpgFile.exists) {
                continue;
            }
            
            app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
            app.jpegExportPreferences.exportResolution = 150;
            app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
            app.jpegExportPreferences.pageString = pageName;
            
            doc.exportFile(ExportFormat.JPG, jpgFile);
            exported++;
            
            if (exported % 20 === 0) {
                $.writeln("Exported " + exported + " pages...");
            }
        }
    }
    
    alert("Done! Exported " + exported + " new pages.");
}







