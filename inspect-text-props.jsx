// Inspect text properties on page 208 - color, size, font
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var LOG = "/Users/asafgafni/Desktop/text_props.txt";
  
  var log = [];
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  var pageIndex = 207; // page 208
  var page = doc.pages[pageIndex];
  
  log.push("=== TEXT FRAMES ON PAGE 208 ===\n");
  
  for (var j = 0; j < page.allPageItems.length; j++) {
    var item = page.allPageItems[j];
    if (item.constructor.name !== "TextFrame") continue;
    
    var txt = "";
    try { txt = item.contents.substring(0, 40); } catch (e) {}
    
    // Skip long body text
    if (txt.length > 35 && txt.indexOf("Afbeelding") !== 0) continue;
    
    log.push("--- TextFrame " + j + " ---");
    log.push("Content: \"" + txt + "\"");
    
    // Get bounds
    try {
      var b = item.geometricBounds;
      log.push("Bounds: [" + b[0].toFixed(1) + ", " + b[1].toFixed(1) + ", " + b[2].toFixed(1) + ", " + b[3].toFixed(1) + "]");
    } catch (e) {}
    
    // Get text properties from first character
    try {
      var chars = item.characters;
      if (chars.length > 0) {
        var c = chars[0];
        
        // Font
        try { log.push("Font: " + c.appliedFont.name); } catch (e) { log.push("Font: (error)"); }
        
        // Size
        try { log.push("Size: " + c.pointSize + " pt"); } catch (e) { log.push("Size: (error)"); }
        
        // Fill color
        try {
          var fc = c.fillColor;
          if (fc) {
            log.push("Fill Color Name: " + fc.name);
            if (fc.colorValue) {
              log.push("Fill Color Value: " + fc.colorValue.join(", "));
            }
            if (fc.model) {
              log.push("Color Model: " + fc.model);
            }
          }
        } catch (e) { log.push("Fill Color: (error) " + e); }
        
        // Stroke color
        try {
          var sc = c.strokeColor;
          if (sc) {
            log.push("Stroke Color: " + sc.name);
          }
        } catch (e) {}
        
        // Fill tint
        try { log.push("Fill Tint: " + c.fillTint + "%"); } catch (e) {}
      }
    } catch (e) {
      log.push("Error getting text props: " + e);
    }
    
    // Frame fill
    try {
      if (item.fillColor) {
        log.push("Frame Fill: " + item.fillColor.name);
      }
    } catch (e) {}
    
    log.push("");
  }
  
  // Write log
  var logFile = File(LOG);
  logFile.open("w");
  logFile.write(log.join("\n"));
  logFile.close();
  
  doc.close(SaveOptions.NO);
  
  alert("Done! See: " + LOG);
})();








