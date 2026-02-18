// ============================================================
// EXPORT: Figure Overlays (callouts only, no captions baked)
// ============================================================
// Purpose:
// - Reads existing new_pipeline/extract/figure_manifest_ch<N>.json files
// - Opens the canonical INDD (manifest-driven via books/manifest.json)
// - For each figure, exports a high-res PNG that includes:
//     - the placed image
//     - overlapping callouts (pijltjes + onderdeelnamen) as page items
//   but EXCLUDES:
//     - the figure caption text ("Afbeelding X.Y ...")
//     - main body story text frames (using bodyStory.index from the figure manifest)
//
// Output:
// - new_pipeline/assets/figures_overlays/<book_id>/ch<N>/<FigureId>.png
// - Desktop report: export_figure_overlays__<book_id>__<timestamp>.txt
//
// Run (recommended via AppleScript wrapper):
// - InDesign: app.doScript(File("<this file>"), ScriptLanguage.JAVASCRIPT)
//
// ScriptArgs (optional):
// - BIC_BOOK_ID:      book_id in books/manifest.json (required)
// - BIC_CHAPTERS:     "1,2,3" (optional; default: all figure_manifest_ch*.json found)
// - BIC_FORCE:        "true" to overwrite existing PNGs (optional)
// - BIC_PPI:          "600" (optional; default: 600)
// - BIC_MARGIN_MM:    "6" (optional; default: 6mm)
// ============================================================

#targetengine "session"

(function () {
  // --------------------------
  // Non-interactive safety
  // --------------------------
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (eUI0) { __prevUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI1) {}
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (eUI2) {}
  }

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
  function ensureFolder(absDir) {
    try {
      var f = Folder(absDir);
      if (!f.exists) f.create();
      return true;
    } catch (e) { return false; }
  }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function readTextFile(absPath) {
    try {
      var f = File(absPath);
      f.encoding = "UTF-8";
      if (!f.exists) return "";
      if (f.open("r")) {
        var t = f.read();
        f.close();
        return String(t || "");
      }
    } catch (e) {}
    return "";
  }

  function parseJson(text) {
    // ExtendScript JSON support varies; prefer JSON.parse but fallback to eval.
    try { if (typeof JSON !== "undefined" && JSON && JSON.parse) return JSON.parse(text); } catch (e1) {}
    try { return eval("(" + text + ")"); } catch (e2) {}
    return null;
  }

  function normalizeText(s) {
    var t = safeStr(s || "");
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/\u00AD/g, ""); } catch (e0) {}
    try { t = t.replace(/\r\n/g, "\n"); } catch (e1) {}
    try { t = t.replace(/\r/g, "\n"); } catch (e2) {}
    try { t = t.replace(/[\u0000-\u001F]/g, " "); } catch (eCtl) {}
    try { t = t.replace(/[ \t]+/g, " "); } catch (e3) {}
    try { t = t.replace(/\n{2,}/g, "\n"); } catch (e4) {}
    return trimStr(t);
  }

  function wordCount(s) {
    var t = normalizeText(s || "");
    if (!t) return 0;
    try { t = t.replace(/[^\S\r\n]+/g, " "); } catch (e) {}
    var parts = t.split(" ");
    var c = 0;
    for (var i = 0; i < parts.length; i++) {
      if (trimStr(parts[i])) c++;
    }
    return c;
  }

  function mmToPt(mm) {
    // 1mm = 2.834645669... pt
    return Number(mm || 0) * 2.834645669291339;
  }

  function boundsExpand(b, pad) {
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  }

  function boundsUnion(a, b) {
    return [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ];
  }

  function boundsIntersect(a, b) {
    // a and b: [top, left, bottom, right]
    return !(a[3] < b[1] || a[1] > b[3] || a[2] < b[0] || a[0] > b[2]);
  }

  function lower(s) { try { return safeStr(s).toLowerCase(); } catch (e) { return ""; } }

  function getArg(name) {
    try {
      if (app.scriptArgs && app.scriptArgs.isDefined(name)) return app.scriptArgs.getValue(name);
    } catch (e) {}
    return "";
  }

  function splitCsvInts(s) {
    var t = trimStr(s || "");
    if (!t) return [];
    var parts = t.split(",");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var n = parseInt(trimStr(parts[i]), 10);
      if (isFinite(n) && n > 0) out.push(n);
    }
    return out;
  }

  function repoRootFromThisScript() {
    try {
      var f = File($.fileName);
      // .../repo/new_pipeline/extract/<this>.jsx
      return f.parent.parent.parent.fsName;
    } catch (e) {
      return "";
    }
  }

  function findBookInManifest(manifestObj, bookId) {
    try {
      var books = manifestObj && manifestObj.books ? manifestObj.books : [];
      for (var i = 0; i < books.length; i++) {
        if (safeStr(books[i].book_id) === safeStr(bookId)) return books[i];
      }
    } catch (e) {}
    return null;
  }

  function listFigureManifestFiles(extractDirAbs, chaptersFilter) {
    var out = [];
    try {
      var d = Folder(extractDirAbs);
      if (!d.exists) return out;
      var files = d.getFiles();
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!(f instanceof File)) continue;
        var nm = safeStr(f.name);
        var m = nm.match(/^figure_manifest_ch(\d+)\.json$/i);
        if (!m) continue;
        var ch = parseInt(m[1], 10);
        if (!isFinite(ch) || ch <= 0) continue;
        if (chaptersFilter && chaptersFilter.length) {
          var ok = false;
          for (var j = 0; j < chaptersFilter.length; j++) if (chaptersFilter[j] === ch) ok = true;
          if (!ok) continue;
        }
        out.push({ chapter: ch, abs: f.fsName });
      }
    } catch (e) {}
    // sort by chapter
    out.sort(function (a, b) { return a.chapter - b.chapter; });
    return out;
  }

  function decodeLinkPath(linkPath) {
    var p = safeStr(linkPath || "");
    if (p.indexOf("file:") === 0) p = p.replace(/^file:/, "");
    try { p = decodeURIComponent(p); } catch (e0) { try { p = p.replace(/%20/g, " "); } catch (e1) {} }
    if (p.indexOf("//") === 0) p = p.substring(1);
    // normalize slashes
    try { p = p.replace(/\\/g, "/"); } catch (e2) {}
    return p;
  }

  function endsWithIgnoreCase(s, suf) {
    var a = lower(s);
    var b = lower(suf);
    if (!a || !b) return false;
    if (a.length < b.length) return false;
    return a.substring(a.length - b.length) === b;
  }

  function findBaseImageItemOnPage(page, linkName, linkPathDecoded) {
    // IMPORTANT: use allPageItems so we can find anchored/inline image containers.
    // Also: explicitly avoid TextFrames as "base", because text frames can contain anchored graphics
    // (and would cause us to export huge chunks of the body story).
    var items = [];
    try { items = page.allPageItems; } catch (e0) { items = []; }
    var best = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var ctor = "";
      try { ctor = safeStr(it.constructor.name); } catch (eCtor) { ctor = ""; }
      if (ctor === "TextFrame") continue;
      var gs = null;
      try { gs = it.allGraphics; } catch (e1) { gs = null; }
      if (!gs || !gs.length) continue;
      var match = false;
      for (var g = 0; g < gs.length; g++) {
        var lk = null;
        try { lk = gs[g].itemLink; } catch (e2) { lk = null; }
        if (!lk) continue;
        var nm = "";
        var fp = "";
        try { nm = safeStr(lk.name); } catch (e3) { nm = ""; }
        try { fp = safeStr(lk.filePath); } catch (e4) { fp = ""; }
        try { fp = fp.replace(/\\/g, "/"); } catch (e5) {}
        if (linkName && lower(nm) === lower(linkName)) match = true;
        if (!match && linkName && endsWithIgnoreCase(fp, "/" + linkName)) match = true;
        if (!match && linkPathDecoded && fp && lower(fp) === lower(linkPathDecoded)) match = true;
        if (!match && linkPathDecoded) {
          // Some InDesign links store only basename paths; try suffix match.
          var bn = linkPathDecoded;
          try { bn = bn.replace(/^.*\//, ""); } catch (e6) {}
          if (bn && endsWithIgnoreCase(fp, "/" + bn)) match = true;
        }
        if (match) break;
      }
      if (!match) continue;
      // Prefer the smallest matching item (groups that wrap multiple items can be huge).
      var b = null;
      try { b = it.geometricBounds; } catch (eB) { b = null; }
      if (!b) continue;
      var area = Math.max(1, (b[2] - b[0])) * Math.max(1, (b[3] - b[1]));
      if (!best) { best = { it: it, area: area }; continue; }
      if (area < best.area) best = { it: it, area: area };
    }
    return best ? best.it : null;
  }

  function isCaptionTextFrame(tf, captionBodyNorm, captionLabelNorm) {
    var styleName = "";
    try {
      if (tf.paragraphs && tf.paragraphs.length) styleName = safeStr(tf.paragraphs[0].appliedParagraphStyle.name);
    } catch (e1) { styleName = ""; }
    var sn = lower(styleName);
    if (sn.indexOf("_annotation") !== -1) return true;
    if (sn.indexOf("bijschrift") !== -1) return true;
    if (sn.indexOf("caption") !== -1) return true;
    var t = "";
    try { t = normalizeText(tf.contents); } catch (e2) { t = ""; }
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(t)) return true;
    // If the caption was split (label elsewhere), treat an exact/near-exact match of the caption body as caption too.
    try {
      var cb = normalizeText(captionBodyNorm || "");
      if (cb) {
        if (t === cb) return true;
        // Near match: contains caption body and is roughly the same length (avoid false positives).
        if (t.indexOf(cb) !== -1) {
          var wcT = wordCount(t);
          var wcC = wordCount(cb);
          if (wcT > 0 && wcC > 0 && wcT <= wcC + 3) return true;
        }
      }
      var cl = normalizeText(captionLabelNorm || "");
      if (cl) {
        // "Afbeelding 2.1:" might appear without colon in some frames
        var cl2 = cl.replace(/:\s*$/g, "");
        if (cl2 && lower(t).indexOf(lower(cl2)) === 0) return true;
      }
    } catch (e3) {}
    return false;
  }

  function shouldIncludeAsOverlay(pageItem, bodyStoryIndex, captionBodyNorm, captionLabelNorm) {
    if (!pageItem) return false;

    // Must be on a page (ignore pasteboard / master-only artifacts)
    var pp = null;
    try { pp = pageItem.parentPage; } catch (e0) { pp = null; }
    if (!pp) return false;

    var ctor = "";
    try { ctor = safeStr(pageItem.constructor.name); } catch (e1) { ctor = ""; }
    if (ctor === "TextFrame") {
      // Exclude main body story frames
      try {
        if (pageItem.parentStory && isFinite(bodyStoryIndex)) {
          var idx = -999;
          try { idx = pageItem.parentStory.index; } catch (eIdx) { idx = -999; }
          if (idx === bodyStoryIndex) return false;
        }
      } catch (e2) {}

      // Exclude caption frames
      try { if (isCaptionTextFrame(pageItem, captionBodyNorm, captionLabelNorm)) return false; } catch (e3) {}

      // Include only short callout-ish text frames
      var t = "";
      try { t = normalizeText(pageItem.contents); } catch (e4) { t = ""; }
      if (!t) return false;
      if (t.indexOf("\n") !== -1) return false;
      if (wordCount(t) > 18) return false;
      return true;
    }
    // Non-text page items (lines/arrows/polygons/groups) are ok
    return true;
  }

  function topMostGroup(item) {
    // Normalize nested items to their outermost Group container to avoid duplicating
    // both a group and its children from allPageItems.
    var cur = item;
    try {
      while (cur && cur.parent && cur.parent.constructor && safeStr(cur.parent.constructor.name) === "Group") {
        cur = cur.parent;
      }
    } catch (e) {}
    return cur || item;
  }

  function exportPageItemsToPng(pageItems, outAbsPath, resolutionPpi) {
    if (!pageItems || !pageItems.length) return false;

    // Compute union bounds (in POINTS — we force the source doc to points)
    var ub = null;
    for (var i = 0; i < pageItems.length; i++) {
      var b = null;
      try { b = pageItems[i].geometricBounds; } catch (eB) { b = null; }
      if (!b) continue;
      if (!ub) ub = [b[0], b[1], b[2], b[3]];
      else ub = boundsUnion(ub, b);
    }
    if (!ub) return false;

    var padPt = 24; // consistent padding so callouts aren't cropped
    var h = Math.max(10, ub[2] - ub[0]);
    var w = Math.max(10, ub[3] - ub[1]);

    var outFile = File(outAbsPath);
    try { if (outFile.exists) outFile.remove(); } catch (eRm) {}
    try { if (outFile.parent && !outFile.parent.exists) outFile.parent.create(); } catch (eDir) {}

    var tmp = null;
    try { tmp = app.documents.add(); } catch (eNew) { tmp = null; }
    if (!tmp) return false;

    try {
      tmp.documentPreferences.facingPages = false;
      tmp.documentPreferences.pagesPerDocument = 1;
      try {
        tmp.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        tmp.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        tmp.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
      } catch (eUnits) {}
      tmp.documentPreferences.pageHeight = (h + padPt * 2) + "pt";
      tmp.documentPreferences.pageWidth = (w + padPt * 2) + "pt";
    } catch (ePrefs) {}

    var p0 = null;
    try { p0 = tmp.pages[0]; } catch (ePg) { p0 = null; }
    if (!p0) { try { tmp.close(SaveOptions.NO); } catch (eC0) {} return false; }

    // Duplicate items
    var dups = [];
    for (var di = 0; di < pageItems.length; di++) {
      var dup = null;
      try { dup = pageItems[di].duplicate(p0); } catch (eDup) { dup = null; }
      if (dup) dups.push(dup);
    }
    if (!dups.length) { try { tmp.close(SaveOptions.NO); } catch (eC1) {} return false; }

    // Translate all duplicates so union top-left lands at padding
    var dx = padPt - ub[1];
    var dy = padPt - ub[0];
    for (var mi = 0; mi < dups.length; mi++) {
      try { dups[mi].move(undefined, [dx, dy]); } catch (eMove) {}
    }

    // Export settings
    try { app.pngExportPreferences.exportResolution = resolutionPpi; } catch (eRes) {}
    try { app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH; } catch (eQ) {}
    try { app.pngExportPreferences.transparentBackground = true; } catch (eT) {}

    var ok = false;
    try {
      try { tmp.exportFile(ExportFormat.PNG_FORMAT, outFile, false); ok = true; } catch (e1) {}
      if (!ok) { try { tmp.exportFile(ExportFormat.PNG, outFile, false); ok = true; } catch (e2) {} }
      if (!ok) { try { tmp.exportFile(ExportFormat.PNG_TYPE, outFile, false); ok = true; } catch (e3) {} }
    } catch (eExp) { ok = false; }

    try { tmp.close(SaveOptions.NO); } catch (eC2) {}
    try { return ok && outFile.exists; } catch (eEx) { return ok; }
  }

  // --------------------------
  // Main
  // --------------------------
  var BOOK_ID = trimStr(getArg("BIC_BOOK_ID"));
  if (!BOOK_ID) {
    restoreUI();
    throw new Error("BIC_BOOK_ID is required");
  }

  var chaptersArg = trimStr(getArg("BIC_CHAPTERS"));
  var chaptersFilter = splitCsvInts(chaptersArg);

  var force = lower(trimStr(getArg("BIC_FORCE"))) === "true";
  var ppi = parseInt(trimStr(getArg("BIC_PPI")) || "600", 10);
  if (!isFinite(ppi) || ppi < 72) ppi = 600;
  var marginMm = parseFloat(trimStr(getArg("BIC_MARGIN_MM")) || "6");
  if (!isFinite(marginMm) || marginMm < 0) marginMm = 6;
  var marginPt = mmToPt(marginMm);

  var STAMP = isoStamp();
  var REPORT = "export_figure_overlays__" + BOOK_ID + "__" + STAMP + ".txt";
  var log = [];
  log.push("=== EXPORT FIGURE OVERLAYS (NO CAPTION) ===");
  log.push("Started: " + (new Date()).toString());
  log.push("book_id: " + BOOK_ID);
  log.push("chaptersFilter: " + (chaptersFilter.length ? chaptersFilter.join(",") : "(all)"));
  log.push("ppi: " + String(ppi) + " marginMm: " + String(marginMm));
  log.push("");
  writeTextToDesktop(REPORT, log.join("\n"));

  var REPO_ROOT = repoRootFromThisScript();
  if (!REPO_ROOT) {
    log.push("ERROR: Could not determine repo root from script path.");
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("Could not determine repo root");
  }

  var manifestPath = REPO_ROOT + "/books/manifest.json";
  var manifestText = readTextFile(manifestPath);
  if (!manifestText) {
    log.push("ERROR: books/manifest.json not found at: " + manifestPath);
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("books/manifest.json missing");
  }
  var manifestObj = parseJson(manifestText);
  if (!manifestObj) {
    log.push("ERROR: Failed to parse books/manifest.json");
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("Failed to parse books/manifest.json");
  }
  var book = findBookInManifest(manifestObj, BOOK_ID);
  if (!book) {
    log.push("ERROR: Book not found in manifest: " + BOOK_ID);
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("Book not found in manifest");
  }
  var inddPath = safeStr(book.canonical_n4_indd_path || book.baseline_full_indd_path || "");
  if (!inddPath) {
    log.push("ERROR: Manifest entry missing canonical_n4_indd_path for: " + BOOK_ID);
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("Manifest missing canonical_n4_indd_path");
  }

  var INDD = File(inddPath);
  if (!INDD.exists) {
    log.push("ERROR: INDD not found: " + inddPath);
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("INDD not found");
  }
  log.push("INDD: " + INDD.fsName);

  var extractDirAbs = File($.fileName).parent.fsName;
  var manifestFiles = listFigureManifestFiles(extractDirAbs, chaptersFilter);
  if (!manifestFiles.length) {
    log.push("ERROR: No figure_manifest_ch*.json files found in: " + extractDirAbs);
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("No figure manifests found");
  }
  log.push("Figure manifest files: " + manifestFiles.length);

  // Output base: new_pipeline/assets/figures_overlays/<book_id>/
  var outBase = REPO_ROOT + "/new_pipeline/assets/figures_overlays/" + BOOK_ID;
  ensureFolder(outBase);
  log.push("OUT_BASE: " + outBase);
  log.push("");

  var doc = null;
  try { doc = app.open(INDD, true); } catch (eOpen1) { try { doc = app.open(INDD); } catch (eOpen2) { doc = null; } }
  if (!doc) {
    log.push("ERROR: Failed to open INDD.");
    writeTextToDesktop(REPORT, log.join("\n"));
    restoreUI();
    throw new Error("Failed to open INDD");
  }
  try { app.activeDocument = doc; } catch (eAct) {}

  // Force source doc measurement units to POINTS for consistent bounds math (no saves).
  var prevH = null, prevV = null, prevOrigin = null;
  try {
    prevH = doc.viewPreferences.horizontalMeasurementUnits;
    prevV = doc.viewPreferences.verticalMeasurementUnits;
    prevOrigin = doc.viewPreferences.rulerOrigin;
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
  } catch (eUnits2) {}

  var total = 0, exported = 0, skippedExists = 0, missingBase = 0, errors = 0;

  try {
    for (var mfIdx = 0; mfIdx < manifestFiles.length; mfIdx++) {
      var mf = manifestFiles[mfIdx];
      var mfText = readTextFile(mf.abs);
      var mfObj = parseJson(mfText);
      if (!mfObj) {
        errors++;
        log.push("WARN: Failed to parse manifest: " + mf.abs);
        continue;
      }
      var chNum = mf.chapter;
      var figures = mfObj.figures || [];
      var bodyStoryIndex = -1;
      try { bodyStoryIndex = mfObj.bodyStory ? mfObj.bodyStory.index : -1; } catch (eBs) { bodyStoryIndex = -1; }

      log.push("CH" + String(chNum) + ": figures=" + String(figures.length) + " bodyStory.index=" + String(bodyStoryIndex));

      var outChDir = outBase + "/ch" + String(chNum);
      ensureFolder(outChDir);

      for (var fi = 0; fi < figures.length; fi++) {
        var fig = figures[fi];
        total++;

        var labelRaw = "";
        try { labelRaw = safeStr(fig.caption && (fig.caption.label || fig.caption.raw) || ""); } catch (eLab) { labelRaw = ""; }
        var figureId = "Figure_" + String(total);
        try {
          // Normalize "Afbeelding 2.1:" -> "Afbeelding_2.1"
          var m = normalizeText(labelRaw).match(/^(Afbeelding|Figuur)\s+(\d+(?:\.\d+)?)/i);
          if (m) figureId = (m[1] + "_" + m[2]).replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.-]/g, "");
          else if (fig.image && fig.image.atomicPath) {
            var bn = safeStr(fig.image.atomicPath).replace(/^.*[\/\\]/, "");
            figureId = bn.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]/g, "_");
          }
        } catch (eId) {}

        var outAbs = outChDir + "/" + figureId + ".png";
        var outFile = File(outAbs);
        if (outFile.exists && !force) { skippedExists++; continue; }

        var pageOff = -1;
        try { pageOff = fig.page ? fig.page.documentOffset : -1; } catch (ePg0) { pageOff = -1; }
        if (!isFinite(pageOff) || pageOff < 0 || pageOff >= doc.pages.length) {
          errors++;
          log.push("WARN: bad pageOffset for " + figureId + ": " + String(pageOff));
          continue;
        }

        var page = null;
        try { page = doc.pages[pageOff]; } catch (ePg1) { page = null; }
        if (!page) { errors++; log.push("WARN: missing page for " + figureId); continue; }

        var linkName = "";
        var linkPathDecoded = "";
        try { linkName = safeStr(fig.image && fig.image.linkName || ""); } catch (eLn) { linkName = ""; }
        try { linkPathDecoded = decodeLinkPath(fig.image && fig.image.linkPath || ""); } catch (eLp) { linkPathDecoded = ""; }

        var baseItem = findBaseImageItemOnPage(page, linkName, linkPathDecoded);
        if (!baseItem) {
          missingBase++;
          log.push("WARN: base image not found for " + figureId + " pageOff=" + String(pageOff) + " linkName=" + linkName);
          continue;
        }

        // Promote base item to its top-most group (if nested) for stable export bounds.
        var baseTop = topMostGroup(baseItem);
        var baseBounds = null;
        try { baseBounds = baseTop.geometricBounds; } catch (eBB) { baseBounds = null; }
        if (!baseBounds) { missingBase++; log.push("WARN: base bounds missing for " + figureId); continue; }

        var scope = boundsExpand(baseBounds, marginPt);

        // Collect overlay items within the figure scope (exclude body story + captions)
        var items = [];
        var seen = {};
        function pushUnique(it) {
          if (!it) return;
          var id = null;
          try { id = it.id; } catch (eId2) { id = null; }
          var k = id !== null ? String(id) : null;
          if (k && seen[k]) return;
          if (k) seen[k] = true;
          items.push(it);
        }

        pushUnique(baseTop);

        var captionBodyNorm = "";
        var captionLabelNorm = "";
        try { captionBodyNorm = safeStr(fig.caption && fig.caption.body || ""); } catch (eCB) { captionBodyNorm = ""; }
        try { captionLabelNorm = safeStr(fig.caption && fig.caption.label || fig.caption && fig.caption.raw || ""); } catch (eCL) { captionLabelNorm = ""; }

        var pItems = [];
        try { pItems = page.allPageItems; } catch (ePI) { pItems = []; }
        for (var pi = 0; pi < pItems.length; pi++) {
          var it = pItems[pi];
          if (!it) continue;
          // Normalize nested items to their outermost group to avoid duplicates.
          var top = topMostGroup(it);
          if (!top) continue;
          if (top === baseTop) continue;
          var b2 = null;
          try { b2 = top.geometricBounds; } catch (eB2) { b2 = null; }
          if (!b2) continue;
          if (!boundsIntersect(b2, scope)) continue;
          if (!shouldIncludeAsOverlay(top, bodyStoryIndex, captionBodyNorm, captionLabelNorm)) continue;
          pushUnique(top);
        }

        var ok = false;
        try { ok = exportPageItemsToPng(items, outAbs, ppi); } catch (eExp2) { ok = false; }
        if (ok) exported++;
        else { errors++; log.push("WARN: export failed for " + figureId + " -> " + outAbs); }
      }
      log.push("");
      writeTextToDesktop(REPORT, log.join("\n"));
    }
  } finally {
    try {
      if (doc) doc.close(SaveOptions.NO);
    } catch (eClose) {}
    try {
      if (doc && prevH !== null) doc.viewPreferences.horizontalMeasurementUnits = prevH;
      if (doc && prevV !== null) doc.viewPreferences.verticalMeasurementUnits = prevV;
      if (doc && prevOrigin !== null) doc.viewPreferences.rulerOrigin = prevOrigin;
    } catch (eRestoreUnits) {}
    restoreUI();
  }

  log.push("DONE.");
  log.push("total_figures_seen: " + String(total));
  log.push("exported: " + String(exported));
  log.push("skipped_exists: " + String(skippedExists));
  log.push("missing_base: " + String(missingBase));
  log.push("errors: " + String(errors));
  writeTextToDesktop(REPORT, log.join("\n"));
})();


