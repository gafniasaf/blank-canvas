// ============================================================
// EXPORT RAW PAGE GEOMETRY (POINTS)
// ============================================================
// Dumps every single page item (Images, TextFrames, etc.)
// with precise coordinates to JSON for external analysis.
// ============================================================

#targetengine "session"

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  function jsonStringify(obj) {
    var t = typeof (obj);
    if (t !== "object" || obj === null) {
      if (t == "string") return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, ' ') + '"';
      return String(obj);
    } else {
      var n, v, json = [], arr = (obj && obj.constructor == Array);
      for (n in obj) {
        v = obj[n]; t = typeof(v);
        if (t == "string") v = '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, ' ') + '"';
        else if (t == "object" && v !== null) v = jsonStringify(v);
        json.push((arr ? "" : '"' + n + '":') + String(v));
      }
      return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");
    }
  }

  function writeJson(path, obj) {
    var f = File(path);
    f.encoding = "UTF-8";
    if (f.open("w")) { f.write(jsonStringify(obj)); f.close(); }
  }
  
  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var outputPath = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_raw_geometry.json";
  
  if (!File(srcPath).exists) return;
  
  try {
    var doc = app.open(File(srcPath), false);
    
    // Units -> Points
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
    
    var pagesData = [];
    
    for (var i = 0; i < doc.pages.length; i++) {
      var page = doc.pages[i];
      var pageIndex = page.documentOffset + 1;
      
      var items = [];
      var pageItems = page.allPageItems;
      
      for (var j = 0; j < pageItems.length; j++) {
        var item = pageItems[j];
        var type = "unknown";
        var content = null;
        var imageLink = null;
        var isThreaded = false;
        
        // Determine type
        if (item instanceof TextFrame) {
            type = "text";
            content = item.contents;
            if (content.length > 50) content = content.substring(0, 50) + "..."; // Truncate for sanity
            isThreaded = (item.previousTextFrame != null || item.nextTextFrame != null);
        } else if (item instanceof Rectangle || item instanceof Polygon || item instanceof Oval) {
            // Check for images
            if (item.images.length > 0) {
                type = "image";
                if (item.images[0].itemLink) {
                    imageLink = item.images[0].itemLink.name;
                }
            } else if (item.pdfs.length > 0) {
                type = "image"; // Treat PDF placement as image
                if (item.pdfs[0].itemLink) imageLink = item.pdfs[0].itemLink.name;
            } else if (item.epszs.length > 0) {
                 type = "image";
                 if (item.epszs[0].itemLink) imageLink = item.epszs[0].itemLink.name;
            } else {
                type = "shape"; // Just a box
            }
        }
        
        // Skip irrelevant items
        if (type === "unknown" || type === "shape") continue;
        
        // Bounds
        var b = item.geometricBounds; // [y1, x1, y2, x2]
        // Normalize bounds (top, left, bottom, right)
        var bounds = { top: b[0], left: b[1], bottom: b[2], right: b[3] };
        
        items.push({
            id: item.id,
            type: type,
            bounds: bounds,
            content: content,
            imageLink: imageLink,
            isThreaded: isThreaded,
            charCount: (type === "text") ? item.contents.length : 0
        });
      }
      
      pagesData.push({
          pageIndex: pageIndex,
          items: items
      });
    }
    
    doc.close(SaveOptions.NO);
    writeJson(outputPath, { pages: pagesData });
    
  } catch (e) {
      // ignore
  }
})();

