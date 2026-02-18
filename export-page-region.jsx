// Export a specific page region (the heart image with its labels)
// Test script to verify the approach works

#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var OUTPUT = "/Users/asafgafni/Desktop/InDesign/TestRun/test_heart_with_labels.png";
  
  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function getBounds(item) { try { return item.geometricBounds; } catch (e) { return null; } }
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) { doc = null; }
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Page 208 has the heart
  var page = doc.pages[207]; // 0-indexed
  
  // Define the region to export (based on the inspection)
  // Image bounds: [-1, -26, 181, 232]
  // Labels are at x: 27-180, y: 61-119
  // Let's capture a region that includes both
  var regionTop = -10;    // A bit above the image
  var regionLeft = -35;   // A bit left of image
  var regionBottom = 175; // Include labels below
  var regionRight = 240;  // Include labels to the right
  
  // Set page export preferences
  try {
    app.pngExportPreferences.exportResolution = 300;
    app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH;
    app.pngExportPreferences.transparentBackground = false;
    app.pngExportPreferences.antiAlias = true;
    app.pngExportPreferences.exportingSpread = false;
    
    // Export page range
    app.pngExportPreferences.pageString = "208";
    app.pngExportPreferences.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;
  } catch (e) { alert("Error setting prefs: " + e); }
  
  // Create a rectangle to define the export area
  var exportRect = null;
  try {
    exportRect = page.rectangles.add();
    exportRect.geometricBounds = [regionTop, regionLeft, regionBottom, regionRight];
    exportRect.strokeWeight = 0;
    exportRect.fillColor = "None";
  } catch (e) { alert("Error creating rect: " + e); }
  
  // Select and export just this area
  var outFile = File(OUTPUT);
  try { if (outFile.exists) outFile.remove(); } catch (e) {}
  
  try {
    // Select all items we want to export
    app.select(NothingEnum.NOTHING);
    
    // Get all items in the region
    var itemsToSelect = [];
    var pageItems = page.allPageItems;
    for (var i = 0; i < pageItems.length; i++) {
      var item = pageItems[i];
      var b = getBounds(item);
      if (!b) continue;
      // Check if item overlaps with region
      if (b[2] > regionTop && b[0] < regionBottom && b[3] > regionLeft && b[1] < regionRight) {
        itemsToSelect.push(item);
      }
    }
    
    if (itemsToSelect.length > 0) {
      app.select(itemsToSelect);
      
      // Export selection as PNG
      // Unfortunately InDesign doesn't directly support exporting selection to PNG
      // We need to use a different approach - export via JPEG with selection
    }
  } catch (e) { alert("Error selecting: " + e); }
  
  // Clean up the temp rectangle
  try { if (exportRect) exportRect.remove(); } catch (e) {}
  
  // Alternative: Create a new document with just the items we want
  var tmpDoc = null;
  try {
    tmpDoc = app.documents.add();
    tmpDoc.documentPreferences.facingPages = false;
    tmpDoc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    tmpDoc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    
    var w = regionRight - regionLeft + 24;
    var h = regionBottom - regionTop + 24;
    tmpDoc.documentPreferences.pageWidth = w + "pt";
    tmpDoc.documentPreferences.pageHeight = h + "pt";
    
    var tmpPage = tmpDoc.pages[0];
    
    // Copy items from source page to temp doc
    var pageItems = page.allPageItems;
    var copied = 0;
    for (var i = 0; i < pageItems.length; i++) {
      var item = pageItems[i];
      var b = getBounds(item);
      if (!b) continue;
      
      // Skip if outside region
      if (b[2] < regionTop || b[0] > regionBottom || b[3] < regionLeft || b[1] > regionRight) continue;
      
      // Skip Groups to avoid nested copies (we'll get the children)
      var ctor = safeStr(item.constructor.name);
      if (ctor === "Group") continue;
      
      // Skip if parent is a group (will be copied with the group)
      try {
        if (item.parent && safeStr(item.parent.constructor.name) === "Group") continue;
      } catch (e) {}
      
      try {
        var dup = item.duplicate(tmpPage);
        // Reposition relative to our crop area
        var newTop = b[0] - regionTop + 12;
        var newLeft = b[1] - regionLeft + 12;
        dup.move(undefined, [newLeft - b[1], newTop - b[0]]);
        copied++;
      } catch (e) {
        // Skip items that can't be duplicated
      }
    }
    
    alert("Copied " + copied + " items. Exporting...");
    
    // Export the temp doc
    app.pngExportPreferences.exportResolution = 300;
    app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH;
    app.pngExportPreferences.transparentBackground = true;
    
    try {
      tmpDoc.exportFile(ExportFormat.PNG_FORMAT, outFile, false);
    } catch (e1) {
      try {
        tmpDoc.exportFile(ExportFormat.PNG, outFile, false);
      } catch (e2) {
        alert("Export failed: " + e2);
      }
    }
    
    tmpDoc.close(SaveOptions.NO);
  } catch (e) {
    alert("Error: " + e);
  }
  
  doc.close(SaveOptions.NO);
  
  if (outFile.exists) {
    alert("Success! Exported to:\n" + OUTPUT);
  } else {
    alert("Export may have failed. Check: " + OUTPUT);
  }
})();









