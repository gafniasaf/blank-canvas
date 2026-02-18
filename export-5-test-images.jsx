// Export 5 test images with their labels
// Simpler approach: select items, group them, export group

#targetengine "session"

(function () {
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (e) {}
  }

  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/test_5_images";
  
  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function getBounds(item) { try { return item.geometricBounds; } catch (e) { return null; } }
  
  function ensureFolder(path) {
    var f = Folder(path);
    if (!f.exists) f.create();
    return f.exists;
  }
  
  function writeLog(text) {
    var f = File(Folder.desktop + "/export_5_test_log.txt");
    f.encoding = "UTF-8";
    if (f.open("w")) { f.write(text); f.close(); }
  }
  
  // Check if bounds overlap
  function boundsOverlap(b1, b2, margin) {
    if (!b1 || !b2) return false;
    return !(b2[2] < b1[0] - margin || b2[0] > b1[2] + margin || 
             b2[3] < b1[1] - margin || b2[1] > b1[3] + margin);
  }
  
  // Merge bounds
  function mergeBounds(arr) {
    if (!arr || arr.length === 0) return null;
    var t = arr[0][0], l = arr[0][1], b = arr[0][2], r = arr[0][3];
    for (var i = 1; i < arr.length; i++) {
      if (arr[i][0] < t) t = arr[i][0];
      if (arr[i][1] < l) l = arr[i][1];
      if (arr[i][2] > b) b = arr[i][2];
      if (arr[i][3] > r) r = arr[i][3];
    }
    return [t, l, b, r];
  }
  
  ensureFolder(OUTPUT_DIR);
  
  var log = [];
  log.push("=== EXPORT 5 TEST IMAGES ===");
  log.push("Started: " + new Date());
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) {
    log.push("ERROR: File not found");
    writeLog(log.join("\n"));
    restoreUI();
    alert("File not found!");
    return;
  }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) {
    log.push("ERROR: Could not open document");
    writeLog(log.join("\n"));
    restoreUI();
    alert("Could not open document!");
    return;
  }
  
  log.push("Document opened");
  
  // Target images to export (known to have labels based on inspection)
  var targetImages = [
    { name: "CH6_Img4", desc: "Heart with labels" },
    { name: "Ch01_Img9", desc: "DNA transcription" },
    { name: "Ch10_Img", desc: "Kidney" },
    { name: "Ch1_Img07", desc: "Golgi" },
    { name: "Ch01_Img8", desc: "DNA helix" }
  ];
  
  var LABEL_MARGIN = 150; // Points to look for labels
  var exported = 0;
  
  // Search for target images
  for (var pi = 0; pi < doc.pages.length && exported < 5; pi++) {
    var page = doc.pages[pi];
    var pageItems = [];
    try { pageItems = page.allPageItems; } catch (e) { continue; }
    
    // Find images on this page
    for (var i = 0; i < pageItems.length && exported < 5; i++) {
      var item = pageItems[i];
      var ctor = safeStr(item.constructor.name);
      if (ctor !== "Image") continue;
      
      var imgName = "";
      try { imgName = safeStr(item.itemLink.name); } catch (e) {}
      
      // Check if this is one of our targets
      var isTarget = false;
      for (var ti = 0; ti < targetImages.length; ti++) {
        if (imgName.indexOf(targetImages[ti].name) >= 0) {
          isTarget = true;
          break;
        }
      }
      if (!isTarget) continue;
      
      log.push("Found: " + imgName + " on page " + (pi + 1));
      
      var imgBounds = getBounds(item);
      if (!imgBounds) continue;
      
      // Find all related items (labels, lines)
      var relatedItems = [item];
      var allBounds = [imgBounds];
      
      for (var j = 0; j < pageItems.length; j++) {
        var other = pageItems[j];
        if (other === item) continue;
        
        var otherCtor = safeStr(other.constructor.name);
        var otherBounds = getBounds(other);
        if (!otherBounds) continue;
        
        // Check if it's near the image
        if (!boundsOverlap(imgBounds, otherBounds, LABEL_MARGIN)) continue;
        
        // Include text frames (labels) and lines
        if (otherCtor === "TextFrame") {
          var content = "";
          try { content = safeStr(other.contents); } catch (e) {}
          // Skip long text (body text)
          if (content.length > 100) continue;
          // Skip captions
          if (content.indexOf("Afbeelding") === 0) continue;
          
          relatedItems.push(other);
          allBounds.push(otherBounds);
          log.push("  + Label: " + content.substring(0, 30));
        } else if (otherCtor === "GraphicLine" || otherCtor === "Polygon") {
          relatedItems.push(other);
          allBounds.push(otherBounds);
        }
      }
      
      log.push("  Total items: " + relatedItems.length);
      
      // Calculate combined bounds
      var combinedBounds = mergeBounds(allBounds);
      var padPt = 20;
      var w = combinedBounds[3] - combinedBounds[1] + padPt * 2;
      var h = combinedBounds[2] - combinedBounds[0] + padPt * 2;
      
      // Create temp document
      var tmpDoc = null;
      try {
        tmpDoc = app.documents.add();
        tmpDoc.documentPreferences.facingPages = false;
        tmpDoc.documentPreferences.pageWidth = w + "pt";
        tmpDoc.documentPreferences.pageHeight = h + "pt";
        tmpDoc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        tmpDoc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
      } catch (e) {
        log.push("  ERROR creating temp doc: " + e);
        continue;
      }
      
      var tmpPage = tmpDoc.pages[0];
      
      // Duplicate items to temp doc
      var dupCount = 0;
      for (var k = 0; k < relatedItems.length; k++) {
        try {
          var orig = relatedItems[k];
          var origBounds = getBounds(orig);
          
          // Duplicate
          var dup = orig.duplicate(tmpPage);
          
          // Calculate new position
          var newLeft = origBounds[1] - combinedBounds[1] + padPt;
          var newTop = origBounds[0] - combinedBounds[0] + padPt;
          
          // Move to new position
          dup.move(undefined, [newLeft - origBounds[1], newTop - origBounds[0]]);
          dupCount++;
        } catch (e) {
          log.push("  Skip item: " + e);
        }
      }
      
      log.push("  Duplicated: " + dupCount + " items");
      
      if (dupCount === 0) {
        try { tmpDoc.close(SaveOptions.NO); } catch (e) {}
        continue;
      }
      
      // Export
      var baseName = imgName.replace(/\.[^.]+$/, "").replace(/[\/\\:*?"<>|]/g, "_");
      var outPath = OUTPUT_DIR + "/" + baseName + "_WITH_LABELS.png";
      var outFile = File(outPath);
      
      try {
        app.pngExportPreferences.exportResolution = 300;
        app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH;
        app.pngExportPreferences.transparentBackground = true;
      } catch (e) {}
      
      var exportOK = false;
      try {
        tmpDoc.exportFile(ExportFormat.PNG_FORMAT, outFile, false);
        exportOK = true;
      } catch (e1) {
        try {
          tmpDoc.exportFile(ExportFormat.PNG, outFile, false);
          exportOK = true;
        } catch (e2) {
          log.push("  Export error: " + e2);
        }
      }
      
      try { tmpDoc.close(SaveOptions.NO); } catch (e) {}
      
      if (exportOK && outFile.exists) {
        exported++;
        log.push("  EXPORTED: " + baseName);
      }
    }
  }
  
  doc.close(SaveOptions.NO);
  
  log.push("");
  log.push("=== DONE ===");
  log.push("Exported: " + exported + " images");
  log.push("Location: " + OUTPUT_DIR);
  writeLog(log.join("\n"));
  
  restoreUI();
  alert("Done! Exported " + exported + " images.\n\nSee: " + OUTPUT_DIR);
})();









