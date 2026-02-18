// Export figure metadata for the currently configured INDD (image bounds only)
// Reads config from: /Users/asafgafni/Desktop/InDesign/TestRun/_export_config.json
//
// Outputs:
// - config.metadataPath (JSON array)
// - config.neededPagesPath (newline-separated page names)
//
// IMPORTANT: This script does not modify the document.
#target indesign

(function () {
  var CONFIG_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/_export_config.json";

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  function readJsonFile(path) {
    var f = File(path);
    if (!f.exists) return null;
    f.open("r");
    var txt = f.read();
    f.close();
    try {
      // ExtendScript JSON support can be inconsistent; eval works for plain JSON.
      return eval("(" + txt + ")");
    } catch (e) {
      return null;
    }
  }

  function safeStr(x) {
    try { return String(x); } catch (e) { return ""; }
  }

  function ensureParentFolder(filePath) {
    var f = File(filePath);
    var folder = f.parent;
    if (folder && !folder.exists) folder.create();
  }

  var oldInteraction = null;
  try { oldInteraction = app.scriptPreferences.userInteractionLevel; } catch (eOld) {}
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI) {}

  var cfg = readJsonFile(CONFIG_PATH);
  if (!cfg) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore1) {}
    alert("Could not read config:\n" + CONFIG_PATH);
    return;
  }

  var docPath = safeStr(cfg.docPath || "");
  var metadataPath = safeStr(cfg.metadataPath || "");
  var neededPagesPath = safeStr(cfg.neededPagesPath || "");
  var silent = !!cfg.silent;
  var closeDocAfter = !!cfg.closeDocAfter;

  if (!docPath || !metadataPath || !neededPagesPath) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore2) {}
    alert("Config missing docPath/metadataPath/neededPagesPath.\nConfig:\n" + CONFIG_PATH);
    return;
  }

  var docFile = File(docPath);
  if (!docFile.exists) {
    try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore3) {}
    alert("INDD not found:\n" + docPath);
    return;
  }

  // Find already-open doc by full path, else open
  var doc = null;
  for (var i = 0; i < app.documents.length; i++) {
    try {
      if (app.documents[i].fullName && app.documents[i].fullName.fsName === docFile.fsName) {
        doc = app.documents[i];
        break;
      }
    } catch (eMatch) {}
  }
  if (!doc) {
    try {
      doc = app.open(docFile, false);
    } catch (eOpen) {
      try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore4) {}
      alert("Failed to open:\n" + docPath + "\n\n" + eOpen);
      return;
    }
  }

  // Ensure output dirs
  ensureParentFolder(metadataPath);
  ensureParentFolder(neededPagesPath);

  var figures = [];
  var pagesWithFigures = {};

  // Process pages
  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var pageName = safeStr(page.name);
    var pageBounds = null;
    try { pageBounds = page.bounds; } catch (ePB) { pageBounds = null; }
    if (!pageBounds) continue;

    var pageWidthUnits = pageBounds[3] - pageBounds[1];
    var pageHeightUnits = pageBounds[2] - pageBounds[0];

    var items = null;
    try { items = page.allPageItems; } catch (eItems) { items = null; }
    if (!items) continue;

    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      try {
        var ctor = safeStr(it.constructor && it.constructor.name);
        if (ctor !== "Rectangle" && ctor !== "Polygon" && ctor !== "Oval") continue;

        var hasImg = false;
        var imgName = "";
        try {
          if (it.images && it.images.length > 0) {
            hasImg = true;
            try { imgName = safeStr(it.images[0].itemLink.name); } catch (eN1) { imgName = "image"; }
          } else if (it.graphics && it.graphics.length > 0) {
            hasImg = true;
            try { imgName = safeStr(it.graphics[0].itemLink.name); } catch (eN2) { imgName = "graphic"; }
          }
        } catch (eHas) {}
        if (!hasImg) continue;

        var b = null;
        try { b = it.geometricBounds; } catch (eB) { b = null; }
        if (!b) continue;

        // Image bounds relative to page (same units as pageBounds, typically mm)
        var top = b[0] - pageBounds[0];
        var left = b[1] - pageBounds[1];
        var bottom = b[2] - pageBounds[0];
        var right = b[3] - pageBounds[1];

        var w = right - left;
        var h = bottom - top;

        // Skip extremely tiny items (likely bullets/icons). Threshold is in page units.
        if (w < 3 && h < 3) continue;

        figures.push({
          page: pageName,
          pageIndex: p,
          imageName: imgName,
          top: top,
          left: left,
          bottom: bottom,
          right: right,
          width: w,
          height: h,
          pageWidthUnits: pageWidthUnits,
          pageHeightUnits: pageHeightUnits
        });
        pagesWithFigures[pageName] = true;
      } catch (eIt) {
        // keep going
      }
    }
  }

  // Write metadata JSON
  var out = File(metadataPath);
  try { out.encoding = "UTF-8"; } catch (eEnc1) {}
  out.open("w");
  out.write("[\n");
  for (var k = 0; k < figures.length; k++) {
    var fig = figures[k];
    var line = "  {\n";
    line += "    \"page\": \"" + safeStr(fig.page).replace(/\"/g, "\\\"") + "\",\n";
    line += "    \"pageIndex\": " + fig.pageIndex + ",\n";
    line += "    \"imageName\": \"" + safeStr(fig.imageName).replace(/\"/g, "\\\"") + "\",\n";
    line += "    \"top\": " + Number(fig.top).toFixed(2) + ",\n";
    line += "    \"left\": " + Number(fig.left).toFixed(2) + ",\n";
    line += "    \"bottom\": " + Number(fig.bottom).toFixed(2) + ",\n";
    line += "    \"right\": " + Number(fig.right).toFixed(2) + ",\n";
    line += "    \"width\": " + Number(fig.width).toFixed(2) + ",\n";
    line += "    \"height\": " + Number(fig.height).toFixed(2) + ",\n";
    line += "    \"pageWidthUnits\": " + Number(fig.pageWidthUnits).toFixed(2) + ",\n";
    line += "    \"pageHeightUnits\": " + Number(fig.pageHeightUnits).toFixed(2) + "\n";
    line += "  }";
    if (k < figures.length - 1) line += ",";
    line += "\n";
    out.write(line);
  }
  out.write("]\n");
  out.close();

  // Write needed pages
  var pages = [];
  for (var key in pagesWithFigures) {
    if (pagesWithFigures.hasOwnProperty(key)) pages.push(key);
  }
  pages.sort();
  var pOut = File(neededPagesPath);
  try { pOut.encoding = "UTF-8"; } catch (eEnc2) {}
  pOut.open("w");
  for (var z = 0; z < pages.length; z++) {
    pOut.write(pages[z] + "\n");
  }
  pOut.close();

  // Optionally close document (without saving)
  if (closeDocAfter) {
    try { doc.close(SaveOptions.NO); } catch (eClose) {}
  }

  try { if (oldInteraction !== null) app.scriptPreferences.userInteractionLevel = oldInteraction; } catch (eRestore5) {}

  if (!silent) {
    alert("Metadata done.\n\nFigures: " + figures.length + "\nPages with figures: " + pages.length);
  } else {
    $.writeln("Metadata done. Figures=" + figures.length + " Pages=" + pages.length);
  }
})();


