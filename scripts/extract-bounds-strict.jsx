// ============================================================
// EXTRACT STRICT FIGURE BOUNDS (POINTS) - STYLE AWARE - DEBUG
// ============================================================

#targetengine "session"

(function () {
  // Suppress dialogs
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  var logFile = File(Folder.desktop + "/extract_bounds_log.txt");
  function log(msg) {
    logFile.open("a");
    logFile.write(msg + "\n");
    logFile.close();
  }
  
  log("Script started.");

  function jsonStringify(obj) {
    var t = typeof (obj);
    if (t !== "object" || obj === null) {
      if (t == "string") return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
      return String(obj);
    } else {
      var n, v, json = [], arr = (obj && obj.constructor == Array);
      for (n in obj) {
        v = obj[n]; t = typeof(v);
        if (t == "string") v = '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
        else if (t == "object" && v !== null) v = jsonStringify(v);
        json.push((arr ? "" : '"' + n + '":') + String(v));
      }
      return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");
    }
  }

  function writeJson(path, obj) {
    var f = File(path);
    f.encoding = "UTF-8";
    if (f.open("w")) { 
        f.write(jsonStringify(obj)); 
        f.close(); 
        log("JSON written to " + path);
    } else {
        log("ERROR: Could not open JSON file for writing: " + path);
    }
  }
  
  function isBodyStyle(styleName) {
    if (!styleName) return false;
    var s = styleName.toLowerCase();
    if (s.indexOf("basis") !== -1) return true;
    if (s.indexOf("body") !== -1) return true;
    if (s.indexOf("bullet") !== -1) return true;
    if (s.indexOf("numbered") !== -1) return true;
    if (s.indexOf("header") !== -1) return true;
    if (s.indexOf("titel") !== -1) return true;
    if (s.indexOf("introductie") !== -1) return true;
    if (s.indexOf("inhoud") !== -1) return true;
    if (s.indexOf("normal") !== -1) return true;
    return false;
  }

  function isLabelStyle(styleName) {
    if (!styleName) return false;
    var s = styleName.toLowerCase();
    if (s.indexOf("label") !== -1) return true;
    if (s.indexOf("annotation") !== -1) return true;
    if (s.indexOf("freightsans") !== -1) return true;
    if (s.indexOf("white") !== -1) return true;
    return false;
  }

  var srcPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var outputPath = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_strict_bounds.json";
  
  if (!File(srcPath).exists) {
      log("Source file not found: " + srcPath);
      return;
  }
  
  try {
    log("Opening document...");
    var doc = app.open(File(srcPath), false);
    
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
    
    var figures = [];
    var links = doc.links;
    log("Processing " + links.length + " links...");
    
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.status === LinkStatus.LINK_MISSING) continue;
      if (!link.name.match(/\.(tif|tiff|png|jpg|jpeg|psd|ai|eps)$/i)) continue;
      
      var parent = link.parent;
      if (!parent || !parent.parent) continue;
      var frame = parent.parent; 
      
      if (!frame.hasOwnProperty("geometricBounds")) continue;
      
      var page = frame.parentPage;
      if (!page || page.constructor.name !== "Page") continue;
      
      var pageIndex = page.documentOffset + 1;
      
      var b = frame.geometricBounds; // [y1, x1, y2, x2]
      var top = b[0], left = b[1], bottom = b[2], right = b[3];
      
      // Normalize bounds
      if (top > bottom) { var t = top; top = bottom; bottom = t; }
      if (left > right) { var t = left; left = right; right = t; }

      var width = right - left;
      var height = bottom - top;
      
      if (width < 30 || height < 30) continue; 
      
      if (pageIndex === 307) {
          log("Found image on p307: " + link.name + " Bounds: " + top + ", " + left + ", " + bottom + ", " + right);
      }

      var buffer = 30; 
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
        
        if (item.appliedObjectStyle && item.appliedObjectStyle.name.indexOf("Text Column") !== -1) continue;

        var pStyleName = "";
        if (item.paragraphs.length > 0) {
            pStyleName = item.paragraphs[0].appliedParagraphStyle.name;
        }

        var isLabel = isLabelStyle(pStyleName);
        var isBody = isBodyStyle(pStyleName);

        var include = false;
        if (isLabel) include = true;
        else if (isBody) include = false;
        else {
            if (item.previousTextFrame != null || item.nextTextFrame != null) include = false;
            else {
                var iB = item.geometricBounds;
                var iH = iB[2] - iB[0];
                var iW = iB[3] - iB[1];
                if (iH > 400 || iW > 400) include = false;
                else if (item.contents.length > 300) include = false;
                else include = true;
            }
        }
        
        if (!include) continue;

        var iB = item.geometricBounds;
        var iTop = Number(iB[0]), iLeft = Number(iB[1]), iBottom = Number(iB[2]), iRight = Number(iB[3]);
        // Normalize item bounds too
        if (iTop > iBottom) { var t = iTop; iTop = iBottom; iBottom = t; }
        if (iLeft > iRight) { var t = iLeft; iLeft = iRight; iRight = t; }

        var intersects = !(iLeft > searchRight || iRight < searchLeft || iTop > searchBottom || iBottom < searchTop);
        
        if (intersects) {
          if (iTop < cropTop) cropTop = iTop;
          if (iLeft < cropLeft) cropLeft = iLeft;
          if (iBottom > cropBottom) cropBottom = iBottom;
          if (iRight > cropRight) cropRight = iRight;
        }
      }
      
      var pageBounds = page.bounds; 
      if (cropTop < pageBounds[0]) cropTop = pageBounds[0];
      if (cropLeft < pageBounds[1]) cropLeft = pageBounds[1];
      if (cropBottom > pageBounds[2]) cropBottom = pageBounds[2];
      if (cropRight > pageBounds[3]) cropRight = pageBounds[3];

      figures.push({
        image: link.name,
        pageIndex: pageIndex,
        bounds: [cropTop, cropLeft, cropBottom, cropRight]
      });
    }
    
    doc.close(SaveOptions.NO);
    writeJson(outputPath, { figures: figures });
    log("Done.");
    
  } catch (e) {
    log("ERROR: " + e.message + " (Line " + e.line + ")");
  }
})();
