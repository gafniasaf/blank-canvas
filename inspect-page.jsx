// Inspect page 208 to see what items exist and their visibility
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var LOG = "/Users/asafgafni/Desktop/page_inspect.txt";
  
  var log = [];
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  // List all layers and their visibility
  log.push("=== LAYERS ===");
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    log.push("Layer: " + layer.name + " | Visible: " + layer.visible + " | Locked: " + layer.locked);
  }
  
  // Go to page 208 (0-indexed = 207)
  var pageIndex = 207;
  var page = doc.pages[pageIndex];
  
  log.push("\n=== PAGE " + (pageIndex + 1) + " ITEMS ===");
  log.push("Total pageItems: " + page.pageItems.length);
  log.push("Total allPageItems: " + page.allPageItems.length);
  
  // List all items on the page
  for (var j = 0; j < page.allPageItems.length; j++) {
    var item = page.allPageItems[j];
    var itemType = item.constructor.name;
    var layerName = "";
    try { layerName = item.itemLayer.name; } catch (e) {}
    var visible = true;
    try { visible = item.visible; } catch (e) {}
    
    var info = "  " + j + ": " + itemType + " | Layer: " + layerName + " | Visible: " + visible;
    
    // If it's a text frame, show content preview
    if (itemType === "TextFrame") {
      try {
        var txt = item.contents.substring(0, 50).replace(/\n/g, " ");
        info += " | Text: \"" + txt + "...\"";
      } catch (e) {}
    }
    
    // If it has graphics, note it
    if (item.graphics && item.graphics.length > 0) {
      info += " | HasGraphic";
    }
    
    // Show bounds
    try {
      var b = item.geometricBounds;
      info += " | Bounds: [" + b[0].toFixed(1) + "," + b[1].toFixed(1) + "," + b[2].toFixed(1) + "," + b[3].toFixed(1) + "]";
    } catch (e) {}
    
    log.push(info);
  }
  
  // Write log
  var logFile = File(LOG);
  logFile.open("w");
  logFile.write(log.join("\n"));
  logFile.close();
  
  doc.close(SaveOptions.NO);
  
  alert("Inspection complete!\nSee: " + LOG);
})();








