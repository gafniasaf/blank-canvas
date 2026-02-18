// Inspect a specific page to understand how labels are structured

#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  
  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function getBounds(item) { try { return item.geometricBounds; } catch (e) { return null; } }
  
  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) {
    alert("File not found");
    return;
  }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) { doc = null; }
  }
  if (!doc) { alert("Could not open"); return; }
  
  // Find an image named MAF_CH6_Img4 (the heart)
  var log = [];
  log.push("=== INSPECTING HEART IMAGE PAGE ===");
  
  // Search all pages for this image
  for (var pi = 0; pi < doc.pages.length; pi++) {
    var page = doc.pages[pi];
    var pageItems = [];
    try { pageItems = page.allPageItems; } catch (e) { continue; }
    
    for (var i = 0; i < pageItems.length; i++) {
      var item = pageItems[i];
      var ctor = "";
      try { ctor = safeStr(item.constructor.name); } catch (e) { continue; }
      
      if (ctor === "Image") {
        try {
          var link = item.itemLink;
          if (link && safeStr(link.name).indexOf("CH6_Img4") >= 0) {
            log.push("Found heart image on page " + (pi + 1));
            var imgBounds = getBounds(item);
            log.push("Image bounds: [" + imgBounds.join(", ") + "]");
            
            // Find ALL text frames on this page
            log.push("");
            log.push("ALL TEXT FRAMES ON THIS PAGE:");
            for (var j = 0; j < pageItems.length; j++) {
              var tf = pageItems[j];
              var tfCtor = "";
              try { tfCtor = safeStr(tf.constructor.name); } catch (e) { continue; }
              
              if (tfCtor === "TextFrame") {
                var tfBounds = getBounds(tf);
                var content = "";
                try { content = safeStr(tf.contents).substring(0, 80); } catch (e) {}
                log.push("  TextFrame bounds: [" + (tfBounds ? tfBounds.join(", ") : "?") + "]");
                log.push("    Content: " + content);
                
                // Check distance from image
                if (imgBounds && tfBounds) {
                  var dist = Math.sqrt(
                    Math.pow((tfBounds[0] + tfBounds[2])/2 - (imgBounds[0] + imgBounds[2])/2, 2) +
                    Math.pow((tfBounds[1] + tfBounds[3])/2 - (imgBounds[1] + imgBounds[3])/2, 2)
                  );
                  log.push("    Distance from image center: " + Math.round(dist) + " pt");
                }
              }
            }
            
            // Find ALL graphic lines on this page
            log.push("");
            log.push("ALL LINES ON THIS PAGE:");
            for (var k = 0; k < pageItems.length; k++) {
              var line = pageItems[k];
              var lineCtor = "";
              try { lineCtor = safeStr(line.constructor.name); } catch (e) { continue; }
              
              if (lineCtor === "GraphicLine") {
                var lineBounds = getBounds(line);
                log.push("  GraphicLine bounds: [" + (lineBounds ? lineBounds.join(", ") : "?") + "]");
              }
            }
            
            writeTextToDesktop("inspect_heart_page.txt", log.join("\n"));
            doc.close(SaveOptions.NO);
            alert("Done! See inspect_heart_page.txt on Desktop");
            return;
          }
        } catch (e) {}
      }
    }
  }
  
  log.push("Heart image not found");
  writeTextToDesktop("inspect_heart_page.txt", log.join("\n"));
  doc.close(SaveOptions.NO);
  alert("Heart image not found");
})();









