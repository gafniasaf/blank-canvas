// ============================================================
// GROUP IMAGES WITH CALLOUT LABELS
// ============================================================
// Purpose:
// - Scan the document for images and their associated callout labels
// - Callout labels = short text frames pointing to anatomical structures
//   (not the "Afbeelding X.Y" captions below the image)
// - Also includes lines, arrows, and other graphical elements overlapping the image
// - Groups each image with its callouts so they move together
//
// Mode:
// - DRY_RUN = true: Only report what would be grouped (safe)
// - DRY_RUN = false: Actually create groups
//
// Run:
// - From InDesign: File > Scripts > run this script
// ============================================================

#targetengine "session"

(function () {
  // ============== CONFIGURATION ==============
  var DRY_RUN = true; // Set to false to actually create groups
  var MAX_CALLOUT_WORD_COUNT = 12; // Max words for a callout label
  var OVERLAP_THRESHOLD = 0.1; // Min overlap ratio to consider items related
  var PROXIMITY_MARGIN = 30; // Points: items within this margin of image bounds are included
  // ============================================

  // --------------------------
  // Utilities
  // --------------------------
  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "_" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function trimStr(s) { try { return safeStr(s).replace(/^\s+|\s+$/g, ""); } catch (e) { return safeStr(s); } }

  function normalizeText(s) {
    var t = safeStr(s || "");
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/\u00AD/g, ""); } catch (e0) {}
    try { t = t.replace(/\r\n/g, "\n"); } catch (e1) {}
    try { t = t.replace(/\r/g, "\n"); } catch (e2) {}
    try { t = t.replace(/[\u0000-\u001F]/g, " "); } catch (eCtl) {}
    try { t = t.replace(/[ \t]+/g, " "); } catch (e3) {}
    return trimStr(t);
  }

  function wordCount(s) {
    var t = normalizeText(s);
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function boundsOf(pi) {
    try { return pi.geometricBounds; } catch (e) { return null; }
  }

  function boundsOverlap(a, b) {
    // Check if bounds a and b overlap
    if (!a || !b) return false;
    // a, b: [top, left, bottom, right]
    if (a[2] < b[0] || a[0] > b[2]) return false; // No vertical overlap
    if (a[3] < b[1] || a[1] > b[3]) return false; // No horizontal overlap
    return true;
  }

  function boundsWithinMargin(itemBounds, imageBounds, margin) {
    // Check if itemBounds is within margin of imageBounds
    if (!itemBounds || !imageBounds) return false;
    var expandedBounds = [
      imageBounds[0] - margin,
      imageBounds[1] - margin,
      imageBounds[2] + margin,
      imageBounds[3] + margin
    ];
    return boundsOverlap(itemBounds, expandedBounds);
  }

  function getItemType(item) {
    try { return safeStr(item.constructor.name); } catch (e) { return ""; }
  }

  // --------------------------
  // Callout detection helpers
  // --------------------------
  function isFigureCaption(text) {
    // These are the captions BELOW the image - we want to EXCLUDE these
    var t = normalizeText(text);
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(t)) return true;
    return false;
  }

  function isCaptionStyle(styleName) {
    var sl = safeStr(styleName).toLowerCase();
    if (sl.indexOf("bijschrift") !== -1) return true;
    if (sl.indexOf("caption") !== -1) return true;
    return false;
  }

  function isCalloutLabel(tf) {
    // A callout label is a SHORT text frame that is NOT a figure caption
    try { if (tf.constructor.name !== "TextFrame") return false; } catch (e) { return false; }

    var t = "";
    try { t = normalizeText(tf.contents); } catch (e0) { t = ""; }
    if (!t || t.length < 1) return false;

    // Exclude figure captions
    if (isFigureCaption(t)) return false;

    // Check style - exclude caption styles
    var styleName = "";
    try {
      if (tf.paragraphs && tf.paragraphs.length > 0 && tf.paragraphs[0].appliedParagraphStyle) {
        styleName = safeStr(tf.paragraphs[0].appliedParagraphStyle.name);
      }
    } catch (eS) {}
    if (isCaptionStyle(styleName)) return false;

    // Callouts are short - typically 1-3 words, max 12
    var wc = wordCount(t);
    if (wc > MAX_CALLOUT_WORD_COUNT) return false;

    // No multi-line callouts (those are usually paragraphs)
    if (t.indexOf("\n") !== -1 && wc > 6) return false;

    return true;
  }

  function isGraphicalElement(item) {
    // Lines, arrows, polygons, ovals that could be pointers/connectors
    var type = getItemType(item);
    if (type === "GraphicLine") return true;
    if (type === "Polygon") return true;
    if (type === "Oval") return true;
    // Rectangles without graphics could be shape elements
    if (type === "Rectangle") {
      try {
        if (!item.allGraphics || item.allGraphics.length === 0) return true;
      } catch (e) {}
    }
    return false;
  }

  function isAlreadyGrouped(item) {
    try {
      var parent = item.parent;
      if (parent && parent.constructor && parent.constructor.name === "Group") {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function getTopLevelGroup(item) {
    // If item is in a group, return the top-level group
    var cur = item;
    try {
      while (cur && cur.parent && cur.parent.constructor && safeStr(cur.parent.constructor.name) === "Group") {
        cur = cur.parent;
      }
    } catch (e) {}
    return cur;
  }

  // --------------------------
  // Collect all images on a page
  // --------------------------
  function collectImagesOnPage(page) {
    var images = [];
    try {
      var allItems = page.allPageItems;
      for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        try {
          // Check if it's a frame with a placed graphic
          var type = getItemType(item);
          if (type === "Rectangle" || type === "Oval" || type === "Polygon") {
            if (item.allGraphics && item.allGraphics.length > 0) {
              var graphic = item.allGraphics[0];
              // Check if it has a link (external file)
              try {
                if (graphic.itemLink && graphic.itemLink.name) {
                  images.push({
                    frame: item,
                    graphic: graphic,
                    linkName: safeStr(graphic.itemLink.name),
                    bounds: boundsOf(item)
                  });
                }
              } catch (eL) {
                // Embedded image without link
                images.push({
                  frame: item,
                  graphic: graphic,
                  linkName: "(embedded)",
                  bounds: boundsOf(item)
                });
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return images;
  }

  // --------------------------
  // Find all callouts and graphical elements related to an image
  // --------------------------
  function findRelatedItems(imageInfo, page) {
    var related = [];
    var imgBounds = imageInfo.bounds;
    if (!imgBounds) return related;

    var seen = {}; // Track by item ID to avoid duplicates

    try {
      var allItems = page.allPageItems;
      for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (item === imageInfo.frame) continue;

        // Skip items that are already in a group with this image
        if (getTopLevelGroup(item) === getTopLevelGroup(imageInfo.frame)) continue;

        var itemBounds = boundsOf(item);
        if (!itemBounds) continue;

        // Check if item is within proximity of the image
        if (!boundsWithinMargin(itemBounds, imgBounds, PROXIMITY_MARGIN)) continue;

        var type = getItemType(item);
        var include = false;

        // Check if it's a callout text frame
        if (type === "TextFrame" && isCalloutLabel(item)) {
          include = true;
        }

        // Check if it's a graphical element (line, arrow, etc.)
        if (isGraphicalElement(item)) {
          include = true;
        }

        if (include) {
          // Use top-level group if in a group
          var topItem = getTopLevelGroup(item);
          var id = "";
          try { id = safeStr(topItem.id); } catch (eId) { id = "item_" + i; }

          if (!seen[id]) {
            seen[id] = true;
            var text = "";
            if (type === "TextFrame") {
              try { text = normalizeText(item.contents); } catch (eT) { text = ""; }
            }
            related.push({
              item: topItem,
              type: getItemType(topItem),
              text: text,
              bounds: boundsOf(topItem)
            });
          }
        }
      }
    } catch (e) {}

    return related;
  }

  // --------------------------
  // Main processing
  // --------------------------
  var log = [];
  log.push("=== GROUP IMAGES WITH CALLOUT LABELS ===");
  log.push("Mode: " + (DRY_RUN ? "DRY RUN (no changes)" : "LIVE (will create groups)"));
  log.push("Timestamp: " + isoStamp());
  log.push("Config: MAX_CALLOUT_WORD_COUNT=" + MAX_CALLOUT_WORD_COUNT + ", PROXIMITY_MARGIN=" + PROXIMITY_MARGIN + "pt");
  log.push("");

  // Check for open document
  if (app.documents.length === 0) {
    alert("No document open. Please open a document first.");
    return;
  }

  var doc = app.activeDocument;
  log.push("Document: " + safeStr(doc.name));
  log.push("Pages: " + doc.pages.length);
  log.push("");

  var stats = {
    imagesTotal: 0,
    imagesAlreadyGrouped: 0,
    imagesWithCallouts: 0,
    totalCallouts: 0,
    totalGraphicalElements: 0,
    groupsCreated: 0,
    imagesWithoutCallouts: 0
  };

  // Process each page
  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageNum = p + 1;

    var images = collectImagesOnPage(page);

    for (var i = 0; i < images.length; i++) {
      var imgInfo = images[i];
      stats.imagesTotal++;

      // Check if already grouped with callouts
      if (isAlreadyGrouped(imgInfo.frame)) {
        stats.imagesAlreadyGrouped++;
        continue;
      }

      // Find related items (callouts and graphical elements)
      var related = findRelatedItems(imgInfo, page);

      if (related.length > 0) {
        stats.imagesWithCallouts++;

        var calloutCount = 0;
        var graphicCount = 0;
        var calloutTexts = [];

        for (var r = 0; r < related.length; r++) {
          if (related[r].type === "TextFrame") {
            calloutCount++;
            calloutTexts.push(related[r].text);
          } else {
            graphicCount++;
          }
        }

        stats.totalCallouts += calloutCount;
        stats.totalGraphicalElements += graphicCount;

        log.push("Page " + pageNum + ": Image with callouts");
        log.push("  Link: " + imgInfo.linkName);
        log.push("  Bounds: [" + imgInfo.bounds.join(", ") + "]");
        log.push("  Callout labels (" + calloutCount + "): " + (calloutTexts.length > 0 ? calloutTexts.join(", ") : "(none)"));
        log.push("  Graphical elements: " + graphicCount);

        // Create group if not dry run
        if (!DRY_RUN) {
          try {
            var itemsToGroup = [imgInfo.frame];
            for (var g = 0; g < related.length; g++) {
              itemsToGroup.push(related[g].item);
            }
            var group = page.groups.add(itemsToGroup);
            stats.groupsCreated++;
            log.push("  → GROUP CREATED");
          } catch (eGroup) {
            log.push("  ERROR creating group: " + safeStr(eGroup));
          }
        }
        log.push("");
      } else {
        stats.imagesWithoutCallouts++;
      }
    }
  }

  // Summary
  log.push("=== SUMMARY ===");
  log.push("Total images found: " + stats.imagesTotal);
  log.push("Already grouped: " + stats.imagesAlreadyGrouped);
  log.push("Images with callouts: " + stats.imagesWithCallouts);
  log.push("Images without callouts: " + stats.imagesWithoutCallouts);
  log.push("Total callout labels found: " + stats.totalCallouts);
  log.push("Total graphical elements found: " + stats.totalGraphicalElements);
  if (!DRY_RUN) {
    log.push("Groups created: " + stats.groupsCreated);
  } else {
    log.push("");
    log.push("(Dry run - no groups created. Set DRY_RUN = false to create groups)");
  }
  log.push("");

  // Guidance for next steps
  if (stats.imagesWithCallouts > 0 && DRY_RUN) {
    log.push("=== NEXT STEPS ===");
    log.push("To actually create the groups:");
    log.push("1. Open the script in a text editor");
    log.push("2. Change 'var DRY_RUN = true;' to 'var DRY_RUN = false;'");
    log.push("3. Save the script and run it again");
    log.push("");
    log.push("IMPORTANT: Make a backup of your document before running in LIVE mode!");
  }

  // Write report
  var reportName = "group_images_callouts__" + isoStamp() + ".txt";
  writeTextToDesktop(reportName, log.join("\n"));

  // Show summary dialog
  var summary = "Images found: " + stats.imagesTotal +
    "\nAlready grouped: " + stats.imagesAlreadyGrouped +
    "\nWith callouts: " + stats.imagesWithCallouts +
    "\nWithout callouts: " + stats.imagesWithoutCallouts +
    "\n\nCallout labels: " + stats.totalCallouts +
    "\nGraphical elements: " + stats.totalGraphicalElements;

  if (!DRY_RUN) {
    summary += "\n\nGroups created: " + stats.groupsCreated;
  } else {
    summary += "\n\n(Dry run - set DRY_RUN = false to create groups)";
  }

  summary += "\n\nReport saved to Desktop: " + reportName;

  alert("Group Images with Callouts\n\n" + summary);
})();











