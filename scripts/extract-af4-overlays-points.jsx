// ============================================================
// EXTRACT FIGURE LABELS & OVERLAYS FROM INDESIGN (POINTS) - v2 SMART
// ============================================================
// Scans the active document for figures and their associated text labels.
// Exports a JSON manifest with:
// - Figure image link path
// - Page number
// - Image frame coordinates (geometric bounds) in POINTS
//
// IMPROVEMENTS:
// - Excludes body text by checking for threading and length.
// - Ensures white background by defining strict crop.
// ============================================================

#targetengine "session"

(function () {
  var prevUI = null;
  try { prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  
  function restoreUI() {
    try { if (prevUI !== null) app.scriptPreferences.userInteractionLevel = prevUI; } catch (e) {}
  }
  
  function jsonStringify(obj) {
    var t = typeof (obj);
    if (t !== "object" || obj === null) {
      if (t == "string") {
        return '"' + obj.replace(/\\/g, '\\\\')
                        .replace(/"/g, '\\"')
                        .replace(/\n/g, '\\n')
                        .replace(/\r/g, '\\r')
                        .replace(/\t/g, '\\t')
                        .replace(/\f/g, '\\f')
                        .replace(/[\u0000-\u001f]/g, function(c) { return '\\u00' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }) + '"';
      }
      return String(obj);
    } else {
      var n, v, json = [], arr = (obj && obj.constructor == Array);
      for (n in obj) {
        v = obj[n]; 
        t = typeof(v);
        if (t == "string") {
            v = '"' + v.replace(/\\/g, '\\\\')
                        .replace(/"/g, '\\"')
                        .replace(/\n/g, '\\n')
                        .replace(/\r/g, '\\r')
                        .replace(/\t/g, '\\t')
                        .replace(/\f/g, '\\f')
                        .replace(/[\u0000-\u001f]/g, function(c) { return '\\u00' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }) + '"';
        } else if (t == "object" && v !== null) {
            v = jsonStringify(v);
        }
        json.push((arr ? "" : '"' + n + '":') + String(v));
      }
      return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");
    }
  }

  function writeJson(path, obj) {
    try {
      var f = File(path);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(jsonStringify(obj)); f.close(); }
      return f.fsName;
    } catch (e) {
      return null;
    }
  }
  
  // Open A&F
  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var srcFile = File(srcPath);
  var outputPath = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_overlays_points.json";

  if (!srcFile.exists) {
    restoreUI();
    return;
  }
  
  try {
    var doc = app.open(srcFile, false);
    
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN; 
    
    var figures = [];
    var links = doc.links;
    
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.status === LinkStatus.LINK_MISSING) continue;
      
      var linkName = link.name;
      if (!linkName.match(/\.(tif|tiff|png|jpg|jpeg|psd|ai|eps)$/i)) continue;
      
      var parent = link.parent;
      if (!parent || !parent.parent) continue;
      
      var frame = parent.parent;
      if (!(frame instanceof SplineItem || frame instanceof Rectangle || frame instanceof Polygon || frame instanceof Oval)) continue;
      
      var page = frame.parentPage;
      if (!page) continue;
      
      var pageIndex = page.documentOffset + 1; 
      
      var imgBounds = frame.geometricBounds;
      var top = imgBounds[0];
      var left = imgBounds[1];
      var bottom = imgBounds[2];
      var right = imgBounds[3];
      var width = right - left;
      var height = bottom - top;
      
      if (width < 20 || height < 20) continue; 
      
      // EXPAND BOUNDS to include nearby labels
      var buffer = 28; // ~10mm
      var searchTop = top - buffer;
      var searchLeft = left - buffer;
      var searchBottom = bottom + buffer;
      var searchRight = right + buffer;
      
      var cropTop = top;
      var cropLeft = left;
      var cropBottom = bottom;
      var cropRight = right;
      
      var pageItems = page.allPageItems;
      for (var j = 0; j < pageItems.length; j++) {
        var item = pageItems[j];
        if (!(item instanceof TextFrame)) continue;
        
        // --- FILTERING LOGIC ---
        
        // 1. Threading Check: Body text is usually threaded. Labels are usually not.
        if (item.previousTextFrame != null || item.nextTextFrame != null) {
            continue; // Skip threaded frames (likely body text)
        }
        
        // 2. Length Check: Labels are usually short.
        if (item.contents.length > 400) {
            continue; // Skip long text blocks
        }
        
        // 3. Style Check (Optional, if we knew style names)
        // var styleName = item.paragraphs[0].appliedParagraphStyle.name;
        // if (styleName.indexOf("Body") !== -1) continue;
        
        var tfBounds = item.geometricBounds;
        var tfTop = tfBounds[0];
        var tfLeft = tfBounds[1];
        var tfBottom = tfBounds[2];
        var tfRight = tfBounds[3];
        
        // Must intersect or be contained within the search area
        var intersects = !(tfLeft > searchRight || 
                           tfRight < searchLeft || 
                           tfTop > searchBottom || 
                           tfBottom < searchTop);
                           
        if (intersects) {
           // Expand crop to include this text
           if (tfTop < cropTop) cropTop = tfTop;
           if (tfLeft < cropLeft) cropLeft = tfLeft;
           if (tfBottom > cropBottom) cropBottom = tfBottom;
           if (tfRight > cropRight) cropRight = tfRight;
        }
      }
      
      figures.push({
        image: linkName,
        pageIndex: pageIndex, 
        bounds: [cropTop, cropLeft, cropBottom, cropRight], 
        originalBounds: [top, left, bottom, right]
      });
    }
    
    doc.close(SaveOptions.NO);
    writeJson(outputPath, { figures: figures });
    
  } catch (e) {
  } finally {
    restoreUI();
  }
})();
