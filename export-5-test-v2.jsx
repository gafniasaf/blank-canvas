// Export 5 test images with their labels - FIXED positioning

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
  
  function boundsOverlap(b1, b2, margin) {
    if (!b1 || !b2) return false;
    return !(b2[2] < b1[0] - margin || b2[0] > b1[2] + margin || 
             b2[3] < b1[1] - margin || b2[1] > b1[3] + margin);
  }
  
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
  log.push("=== EXPORT 5 TEST IMAGES v2 ===");
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
  
  log.push("Document opened: " + doc.name);
  
  var targetNames = ["CH6_Img4", "Ch01_Img9", "Ch10_Img2", "Ch1_Img07", "Ch01_Img8"];
  var LABEL_MARGIN = 150;
  var exported = 0;
  
  for (var pi = 0; pi < doc.pages.length && exported < 5; pi++) {
    var page = doc.pages[pi];
    var pageItems = [];
    try { pageItems = page.allPageItems; } catch (e) { continue; }
    
    for (var i = 0; i < pageItems.length && exported < 5; i++) {
      var item = pageItems[i];
      var ctor = safeStr(item.constructor.name);
      if (ctor !== "Image") continue;
      
      var imgName = "";
      try { imgName = safeStr(item.itemLink.name); } catch (e) {}
      
      var isTarget = false;
      for (var ti = 0; ti < targetNames.length; ti++) {
        if (imgName.indexOf(targetNames[ti]) >= 0) {
          isTarget = true;
          break;
        }
      }
      if (!isTarget) continue;
      
      log.push("");
      log.push("Found: " + imgName + " on page " + (pi + 1));
      
      var imgBounds = getBounds(item);
      if (!imgBounds) continue;
      log.push("  Image bounds: [" + imgBounds.join(", ") + "]");
      
      // Collect related items
      var relatedItems = [item];
      var allBounds = [imgBounds];
      
      for (var j = 0; j < pageItems.length; j++) {
        var other = pageItems[j];
        if (other === item) continue;
        
        var otherCtor = safeStr(other.constructor.name);
        var otherBounds = getBounds(other);
        if (!otherBounds) continue;
        
        if (!boundsOverlap(imgBounds, otherBounds, LABEL_MARGIN)) continue;
        
        if (otherCtor === "TextFrame") {
          var content = "";
          try { content = safeStr(other.contents); } catch (e) {}
          if (content.length > 100) continue;
          if (content.indexOf("Afbeelding") === 0) continue;
          
          relatedItems.push(other);
          allBounds.push(otherBounds);
          log.push("  + Label: " + content.substring(0, 40));
        } else if (otherCtor === "GraphicLine") {
          relatedItems.push(other);
          allBounds.push(otherBounds);
          log.push("  + Line");
        }
      }
      
      log.push("  Total items: " + relatedItems.length);
      
      // Calculate combined bounds
      var combined = mergeBounds(allBounds);
      log.push("  Combined bounds: [" + combined.join(", ") + "]");
      
      var padPt = 24;
      var w = combined[3] - combined[1] + padPt * 2;
      var h = combined[2] - combined[0] + padPt * 2;
      log.push("  Page size: " + w + " x " + h + " pt");
      
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
      
      // Duplicate and position items
      var dupCount = 0;
      for (var k = 0; k < relatedItems.length; k++) {
        try {
          var orig = relatedItems[k];
          var origBounds = getBounds(orig);
          
          // Duplicate to temp page
          var dup = orig.duplicate(tmpPage);
          
          // Calculate where it should be in the new document
          // New top = original top - combined top + padding
          // New left = original left - combined left + padding
          var targetTop = origBounds[0] - combined[0] + padPt;
          var targetLeft = origBounds[1] - combined[1] + padPt;
          
          // Set position using geometricBounds
          var dupBounds = getBounds(dup);
          var dupH = dupBounds[2] - dupBounds[0];
          var dupW = dupBounds[3] - dupBounds[1];
          
          dup.geometricBounds = [targetTop, targetLeft, targetTop + dupH, targetLeft + dupW];
          dupCount++;
        } catch (e) {
          log.push("  Error with item " + k + ": " + safeStr(e).substring(0, 50));
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
      try { if (outFile.exists) outFile.remove(); } catch (e) {}
      
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
        log.push("  Export attempt 1 failed: " + safeStr(e1).substring(0, 50));
        try {
          tmpDoc.exportFile(ExportFormat.PNG, outFile, false);
          exportOK = true;
        } catch (e2) {
          log.push("  Export attempt 2 failed: " + safeStr(e2).substring(0, 50));
        }
      }
      
      try { tmpDoc.close(SaveOptions.NO); } catch (e) {}
      
      if (exportOK && outFile.exists) {
        exported++;
        log.push("  SUCCESS: " + outFile.name);
      } else {
        log.push("  FAILED to export");
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
  alert("Done! Exported " + exported + " images.\n\nCheck log on Desktop.");
})();









