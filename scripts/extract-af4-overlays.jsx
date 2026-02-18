// ============================================================
// EXTRACT FIGURE LABELS & OVERLAYS FROM INDESIGN
// ============================================================
// Scans the active document for figures and their associated text labels.
// Exports a JSON manifest with:
// - Figure image link path
// - Page number
// - Image frame coordinates (geometric bounds)
// - Associated text frames (labels/captions) within the figure area
//   - Text content
//   - Relative position to the image
//   - Font/style info
//
// This allows us to reconstruct labeled figures at high resolution
// outside of InDesign.
// ============================================================

#targetengine "session"

(function () {
  var prevUI = null;
  try { prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  
  function restoreUI() {
    try { if (prevUI !== null) app.scriptPreferences.userInteractionLevel = prevUI; } catch (e) {}
  }
  
  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? "0" + String(n) : String(n); }
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + 
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  
  // Robust JSON stringify
  function jsonStringify(obj) {
    var t = typeof (obj);
    if (t !== "object" || obj === null) {
      // simple data type
      if (t == "string") {
        // ESCAPE SPECIAL CHARS
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
      // recurse array or object
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

  function writeJson(filename, obj) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(jsonStringify(obj)); f.close(); }
      return f.fsName;
    } catch (e) {
      return null;
    }
  }
  
  var log = [];
  log.push("Extracting Figure Overlays...");
  
  // Open A&F
  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var srcFile = File(srcPath);
  
  if (!srcFile.exists) {
    alert("Source file not found: " + srcPath);
    restoreUI();
    return;
  }
  
  try {
    var doc = app.open(srcFile, false);
    
    var figures = [];
    var links = doc.links;
    
    // Iterate all links to find images
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.status === LinkStatus.LINK_MISSING) continue;
      
      var linkName = link.name;
      // Filter for relevant image types
      if (!linkName.match(/\.(tif|tiff|png|jpg|jpeg|psd|ai|eps)$/i)) continue;
      
      var parent = link.parent; // The image object (e.g., Image, EPS, PDF)
      if (!parent || !parent.parent) continue;
      
      var frame = parent.parent; // The containing frame (SplineItem/Rectangle)
      if (!(frame instanceof SplineItem || frame instanceof Rectangle || frame instanceof Polygon || frame instanceof Oval)) continue;
      
      var page = frame.parentPage;
      if (!page) continue; // On pasteboard?
      
      // Geometric bounds: [y1, x1, y2, x2] (top, left, bottom, right)
      var imgBounds = frame.geometricBounds;
      var top = imgBounds[0];
      var left = imgBounds[1];
      var bottom = imgBounds[2];
      var right = imgBounds[3];
      var width = right - left;
      var height = bottom - top;
      
      // Skip tiny icons/logos
      if (width < 20 || height < 20) continue;
      
      // Look for text frames that overlap or are near this image
      // Define a search area slightly larger than the image
      var buffer = 10; // 10mm buffer
      var searchTop = top - buffer;
      var searchLeft = left - buffer;
      var searchBottom = bottom + buffer;
      var searchRight = right + buffer;
      
      var overlays = [];
      
      // Scan all text frames on the page
      var pageItems = page.allPageItems;
      for (var j = 0; j < pageItems.length; j++) {
        var item = pageItems[j];
        if (!(item instanceof TextFrame)) continue;
        
        var tfBounds = item.geometricBounds;
        var tfTop = tfBounds[0];
        var tfLeft = tfBounds[1];
        var tfBottom = tfBounds[2];
        var tfRight = tfBounds[3];
        
        // Simple intersection check
        var intersects = !(tfLeft > searchRight || 
                           tfRight < searchLeft || 
                           tfTop > searchBottom || 
                           tfBottom < searchTop);
                           
        if (intersects) {
          // It's a candidate label/caption
          // Calculate relative position (0-1 scale relative to image top-left)
          var relX = (tfLeft - left);
          var relY = (tfTop - top);
          
          overlays.push({
            content: item.contents,
            bounds: [tfTop, tfLeft, tfBottom, tfRight],
            relX: relX,
            relY: relY,
            width: tfRight - tfLeft,
            height: tfBottom - tfTop,
            // Try to get style info if possible
            style: (item.paragraphs.length > 0) ? item.paragraphs[0].appliedParagraphStyle.name : "Unknown"
          });
        }
      }
      
      figures.push({
        image: linkName,
        linkPath: link.filePath,
        page: page.name,
        bounds: [top, left, bottom, right], // Absolute page coords
        dimensions: { width: width, height: height },
        overlays: overlays
      });
    }
    
    doc.close(SaveOptions.NO);
    
    // Export manifest
    var outName = "af4_figure_overlays_" + isoStamp() + ".json";
    var outPath = writeJson(outName, { figures: figures });
    
    alert("Extraction complete!\nFound " + figures.length + " figures.\nSaved to Desktop/" + outName);
    
  } catch (e) {
    alert("Error: " + e.message + "\nLine: " + e.line);
  } finally {
    restoreUI();
  }
})();


