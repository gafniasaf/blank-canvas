// ============================================================
// SCAN IMAGE CALLOUTS - Per Chapter
// ============================================================
// A simplified script to scan images and their callout labels
// Works on the ACTIVE document, processes chapter by chapter
// 
// Run: Double-click from InDesign Scripts panel
// ============================================================

(function () {
  // Config
  var CHAPTER = 1; // Change this to scan different chapters
  
  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function trimStr(s) { return safeStr(s).replace(/^\s+|\s+$/g, ""); }
  
  function normalizeText(s) {
    var t = safeStr(s || "");
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    t = t.replace(/\u00AD/g, "");
    t = t.replace(/\r/g, " ");
    t = t.replace(/[ \t]+/g, " ");
    return trimStr(t);
  }
  
  function boundsOf(pi) {
    try { return pi.geometricBounds; } catch (e) { return null; }
  }
  
  function getItemType(item) {
    try { return safeStr(item.constructor.name); } catch (e) { return ""; }
  }
  
  function isShortLabel(tf) {
    try { if (tf.constructor.name !== "TextFrame") return false; } catch (e) { return false; }
    var t = normalizeText(tf.contents);
    if (!t || t.length < 1 || t.length > 100) return false;
    // Skip figure captions
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(t)) return false;
    // Must be short (callout labels are typically 1-5 words)
    var words = t.split(/\s+/).length;
    if (words > 8) return false;
    return true;
  }
  
  function isAlreadyGrouped(item) {
    try {
      if (item.parent && item.parent.constructor.name === "Group") return true;
    } catch (e) {}
    return false;
  }
  
  function boundsOverlap(a, b, margin) {
    if (!a || !b) return false;
    margin = margin || 0;
    var ea = [a[0] - margin, a[1] - margin, a[2] + margin, a[3] + margin];
    if (ea[2] < b[0] || ea[0] > b[2]) return false;
    if (ea[3] < b[1] || ea[1] > b[3]) return false;
    return true;
  }

  // Check for open document
  if (app.documents.length === 0) {
    alert("No document open!");
    return;
  }
  
  var doc = app.activeDocument;
  var log = [];
  log.push("=== SCAN IMAGE CALLOUTS ===");
  log.push("Document: " + safeStr(doc.name));
  log.push("Chapter: " + CHAPTER);
  log.push("");
  
  // Find chapter page range (approximate based on typical book structure)
  // For A&F 4, chapters start roughly every 20-30 pages
  var startPage = 0;
  var endPage = Math.min(30, doc.pages.length - 1);
  
  // Try to find chapter markers in text
  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    try {
      var items = page.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (getItemType(item) === "TextFrame") {
          var t = normalizeText(item.contents);
          // Look for chapter heading pattern
          var chMatch = t.match(/^(\d+)\s+(Cellen|Weefsels|Anatomie|Fysiologie|Bloed|Hart|Long|Spijsvertering|Nier|Zenuw|Hormoon|Huid|Beweging|Voortplanting)/i);
          if (chMatch) {
            var chNum = parseInt(chMatch[1], 10);
            if (chNum === CHAPTER) {
              startPage = p;
            } else if (chNum === CHAPTER + 1) {
              endPage = p - 1;
              break;
            }
          }
        }
      }
    } catch (e) {}
  }
  
  log.push("Scanning pages " + (startPage + 1) + " to " + (endPage + 1));
  log.push("");
  
  var stats = {
    images: 0,
    imagesGrouped: 0,
    imagesWithNearbyLabels: 0,
    labelsFound: 0
  };
  
  var results = [];
  
  // Process pages in range
  for (var p = startPage; p <= endPage && p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageNum = p + 1;
    
    // Collect images on this page
    var images = [];
    var textFrames = [];
    var graphicLines = [];
    
    try {
      var items = page.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var type = getItemType(item);
        
        if (type === "Rectangle" || type === "Oval" || type === "Polygon") {
          try {
            if (item.allGraphics && item.allGraphics.length > 0) {
              var g = item.allGraphics[0];
              var linkName = "";
              try { linkName = g.itemLink ? safeStr(g.itemLink.name) : "(embedded)"; } catch (eL) {}
              images.push({
                frame: item,
                bounds: boundsOf(item),
                linkName: linkName,
                grouped: isAlreadyGrouped(item)
              });
            }
          } catch (e) {}
        } else if (type === "TextFrame") {
          textFrames.push(item);
        } else if (type === "GraphicLine") {
          graphicLines.push(item);
        }
      }
    } catch (e) {}
    
    // For each image, find nearby labels
    for (var im = 0; im < images.length; im++) {
      var img = images[im];
      stats.images++;
      
      if (img.grouped) {
        stats.imagesGrouped++;
        continue;
      }
      
      var nearbyLabels = [];
      var nearbyLines = 0;
      
      // Find text frames near this image
      for (var tf = 0; tf < textFrames.length; tf++) {
        var frame = textFrames[tf];
        if (!isShortLabel(frame)) continue;
        if (isAlreadyGrouped(frame)) continue;
        
        var fb = boundsOf(frame);
        if (boundsOverlap(img.bounds, fb, 40)) {
          nearbyLabels.push(normalizeText(frame.contents));
          stats.labelsFound++;
        }
      }
      
      // Count nearby lines
      for (var gl = 0; gl < graphicLines.length; gl++) {
        var line = graphicLines[gl];
        var lb = boundsOf(line);
        if (boundsOverlap(img.bounds, lb, 40)) {
          nearbyLines++;
        }
      }
      
      if (nearbyLabels.length > 0 || nearbyLines > 0) {
        stats.imagesWithNearbyLabels++;
        results.push({
          page: pageNum,
          link: img.linkName,
          labels: nearbyLabels,
          lines: nearbyLines
        });
      }
    }
  }
  
  // Build report
  log.push("=== RESULTS ===");
  log.push("Total images: " + stats.images);
  log.push("Already grouped: " + stats.imagesGrouped);
  log.push("With nearby labels: " + stats.imagesWithNearbyLabels);
  log.push("Total labels found: " + stats.labelsFound);
  log.push("");
  
  log.push("=== IMAGES WITH CALLOUTS ===");
  for (var r = 0; r < results.length; r++) {
    var res = results[r];
    log.push("Page " + res.page + ": " + res.link);
    if (res.labels.length > 0) {
      log.push("  Labels: " + res.labels.join(", "));
    }
    if (res.lines > 0) {
      log.push("  Lines/arrows: " + res.lines);
    }
  }
  
  // Write report
  var stamp = new Date().toISOString().replace(/[:.]/g, "").substring(0, 15);
  var reportFile = File(Folder.desktop + "/scan_callouts_ch" + CHAPTER + "__" + stamp + ".txt");
  reportFile.encoding = "UTF-8";
  if (reportFile.open("w")) {
    reportFile.write(log.join("\n"));
    reportFile.close();
  }
  
  // Show summary
  alert("Scan Complete!\n\n" +
    "Images: " + stats.images + "\n" +
    "Already grouped: " + stats.imagesGrouped + "\n" +
    "With nearby labels: " + stats.imagesWithNearbyLabels + "\n\n" +
    "Report saved to Desktop");
})();











