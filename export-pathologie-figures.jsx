// ============================================================
// EXPORT: Pathologie Figure Manifest (All Chapters)
// ============================================================
// Purpose:
// - Extract figures from each Pathologie chapter INDD file
// - Output: figure_manifest_pathologie.json with all figures across chapters
//
// Run:
// - From InDesign: File > Scripts > Run this script
// ============================================================

#targetengine "session"

(function () {
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (e) { __prevUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e) {}
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (e) {}
  }

  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function trimStr(s) { try { return safeStr(s).replace(/^\s+|\s+$/g, ""); } catch (e) { return safeStr(s); } }

  function normalizeText(s) {
    var t = safeStr(s || "");
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/\u00AD/g, ""); } catch (e) {}
    try { t = t.replace(/\r\n/g, "\n"); } catch (e) {}
    try { t = t.replace(/\r/g, "\n"); } catch (e) {}
    try { t = t.replace(/[\u0000-\u001F]/g, " "); } catch (e) {}
    try { t = t.replace(/[ \t]+/g, " "); } catch (e) {}
    try { t = t.replace(/\n{2,}/g, "\n"); } catch (e) {}
    return trimStr(t);
  }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function writeTextToPath(absPath, text) {
    try {
      var f = File(absPath);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      var parent = f.parent;
      try { if (parent && !parent.exists) parent.create(); } catch (e) {}
      if (f.open("w")) { f.write(String(text || "")); f.close(); return true; }
    } catch (e) {}
    return false;
  }

  function jsonEscape(s) {
    var t = safeStr(s);
    t = t.replace(/\\/g, "\\\\");
    t = t.replace(/\"/g, "\\\"");
    t = t.replace(/\n/g, "\\n");
    t = t.replace(/\r/g, "\\r");
    t = t.replace(/\t/g, "\\t");
    return t;
  }

  function isArray(x) { return x && x.constructor && x.constructor.name === "Array"; }

  function jsonStringify(val, indent, level) {
    indent = indent || 2;
    level = level || 0;
    function spaces(n) { var s = ""; for (var i = 0; i < n; i++) s += " "; return s; }
    var pad = spaces(level * indent);

    if (val === null) return "null";
    var t = typeof val;
    if (t === "number" || t === "boolean") return String(val);
    if (t === "string") return "\"" + jsonEscape(val) + "\"";
    if (t === "undefined") return "null";

    if (isArray(val)) {
      if (val.length === 0) return "[]";
      var outA = "[\n";
      for (var i = 0; i < val.length; i++) {
        outA += pad + spaces(indent) + jsonStringify(val[i], indent, level + 1);
        if (i !== val.length - 1) outA += ",";
        outA += "\n";
      }
      outA += pad + "]";
      return outA;
    }

    var keys = [];
    for (var k in val) if (val.hasOwnProperty(k)) keys.push(k);
    if (keys.length === 0) return "{}";
    keys.sort();
    var outO = "{\n";
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      outO += pad + spaces(indent) + "\"" + jsonEscape(key) + "\": " + jsonStringify(val[key], indent, level + 1);
      if (i !== keys.length - 1) outO += ",";
      outO += "\n";
    }
    outO += pad + "}";
    return outO;
  }

  function ensureFolder(absPath) {
    try {
      var f = Folder(absPath);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  // --------------------------
  // Figure extraction
  // --------------------------
  function boundsOf(item) {
    try { return item.geometricBounds; } catch (e) { return null; }
  }

  function pageOfItem(item) {
    try { return item.parentPage; } catch (e) { return null; }
  }

  function collectLinkedImages(doc) {
    var imgs = [];
    for (var i = 0; i < doc.links.length; i++) {
      var link = doc.links[i];
      var linkName = safeStr(link.name);
      if (!(/\.(png|jpg|jpeg|tif|tiff|psd|ai|eps)$/i.test(linkName))) continue;

      var linkPath = "";
      try { linkPath = link.filePath ? link.filePath.fsName : ""; } catch (e) { linkPath = ""; }
      if (!linkPath) {
        try { linkPath = safeStr(link.linkResourceURI); } catch (e) { linkPath = ""; }
      }

      var graphic = null;
      try { graphic = link.parent; } catch (e) { graphic = null; }
      var frame = null;
      try { frame = graphic.parent; } catch (e) { frame = null; }
      if (!frame) continue;

      var page = pageOfItem(frame);
      if (!page) continue;

      var b = boundsOf(frame);
      if (!b) continue;

      imgs.push({
        linkName: linkName,
        linkPath: linkPath,
        bounds: b,
        pageName: safeStr(page.name),
        pageIndex: page.documentOffset,
        frame: frame
      });
    }
    return imgs;
  }

  function splitFigureLabel(captionRaw) {
    var s = normalizeText(captionRaw);
    var m = null;
    try { m = s.match(/^((Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+(?:\.\d+)*)(\s*[:.])?\s*(.*)$/i); } catch (e) { m = null; }
    if (!m) return { label: "", body: s, raw: s };
    var labelCore = m[1] || "";
    var punct = m[3] || "";
    var rest = m[4] || "";
    var label = trimStr(labelCore + (punct ? punct : ":"));
    var body = trimStr(rest);
    return { label: label, body: body, raw: s };
  }

  function isCaptionStyle(styleName) {
    var s = (styleName || "").toLowerCase();
    return s.indexOf("bijschrift") !== -1 || s.indexOf("caption") !== -1 || s.indexOf("_annotation") !== -1 || s.indexOf("afbeeld") !== -1 || s.indexOf("figuur") !== -1;
  }

  function isCaptionText(text) {
    var t = normalizeText(text);
    if (!t || t.length > 400) return false;
    return /^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(t);
  }

  function collectCaptions(doc) {
    var captions = [];
    for (var si = 0; si < doc.stories.length; si++) {
      var story = doc.stories[si];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (e) { pc = 0; }
      for (var pi = 0; pi < pc; pi++) {
        var para = story.paragraphs[pi];
        var txt = normalizeText(para.contents);
        if (!txt) continue;

        var styleName = "";
        try { styleName = safeStr(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (e) { styleName = ""; }

        if (!isCaptionStyle(styleName) && !isCaptionText(txt)) continue;

        var page = null;
        try { var tf = para.parentTextFrames[0]; if (tf) page = tf.parentPage; } catch (e) {}
        if (!page) continue;

        var y = 0, x = 0;
        try { if (para.lines && para.lines.length > 0) { y = Number(para.lines[0].baseline); x = Number(para.lines[0].horizontalOffset); } } catch (e) {}

        var split = splitFigureLabel(txt);

        captions.push({
          text: txt,
          label: split.label,
          body: split.body,
          styleName: styleName,
          pageName: safeStr(page.name),
          pageIndex: page.documentOffset,
          x: x,
          y: y,
          storyIndex: si,
          paragraphIndex: pi
        });
      }
    }
    return captions;
  }

  function findImageForCaption(images, cap) {
    var best = null;
    var bestScore = 1e18;
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      var dp = Math.abs(img.pageIndex - cap.pageIndex);
      if (dp > 1) continue;

      var b = img.bounds;
      var imgBottom = b[2];
      var imgLeft = b[1];
      var imgRight = b[3];

      var gap = cap.y - imgBottom;
      if (gap < -250 || gap > 900) continue;

      var inX = (cap.x >= (imgLeft - 60) && cap.x <= (imgRight + 60));
      var dx = Math.abs(cap.x - imgLeft);

      var score = Math.max(0, gap) + dx * 0.2;
      if (!inX) score += 600;
      if (gap < 0) score += 1400;
      if (dp > 0) score += dp * 2000;

      if (score < bestScore) { bestScore = score; best = img; }
    }
    return best;
  }

  // --------------------------
  // Main
  // --------------------------
  var BASE_PATH = "/Users/asafgafni/Desktop/BookArchive/originals";
  var OUT_JSON = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/extract/figure_manifest_pathologie.json";
  var ASSET_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/figures/pathologie";
  var STAMP = isoStamp();
  var REPORT_NAME = "export_pathologie_figures__" + STAMP + ".txt";

  var log = [];
  log.push("=== EXPORT PATHOLOGIE FIGURES ===");
  log.push("Started: " + (new Date()).toString());
  log.push("");
  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  ensureFolder(ASSET_DIR);

  var chapterFiles = [];
  for (var ch = 1; ch <= 12; ch++) {
    var chStr = ch < 10 ? "0" + String(ch) : String(ch);
    var folder = "Pathologie_mbo_CH" + chStr + "_03";
    var filename = "pathologie_mbo_ch" + chStr + "_03_ORIGINAL.indd";
    var fullPath = BASE_PATH + "/" + folder + "/" + filename;
    chapterFiles.push({ chapter: ch, path: fullPath });
  }

  var allFigures = [];
  var failedChapters = [];

  for (var ci = 0; ci < chapterFiles.length; ci++) {
    var chInfo = chapterFiles[ci];
    var chNum = chInfo.chapter;
    var inddPath = chInfo.path;

    log.push("--- Chapter " + String(chNum) + " ---");
    log.push("INDD: " + inddPath);

    var inddFile = File(inddPath);
    if (!inddFile.exists) {
      log.push("ERROR: File not found");
      failedChapters.push(chNum);
      continue;
    }

    var doc = null;
    try { doc = app.open(inddFile, true); } catch (e) { doc = null; }
    if (!doc) {
      log.push("ERROR: Failed to open");
      failedChapters.push(chNum);
      continue;
    }

    try { app.activeDocument = doc; } catch (e) {}

    var images = collectLinkedImages(doc);
    var captions = collectCaptions(doc);

    log.push("Linked images: " + images.length);
    log.push("Caption candidates: " + captions.length);

    // Build best caption by label
    var bestByLabel = {};
    for (var i = 0; i < captions.length; i++) {
      var cap = captions[i];
      if (!cap.label) continue;
      if (!/^(Afbeelding|Figuur|Fig\.?)/i.test(cap.label)) continue;
      var key = cap.label;
      if (!bestByLabel[key] || cap.body.length > (bestByLabel[key].body || "").length) {
        bestByLabel[key] = cap;
      }
    }

    var labels = [];
    for (var k in bestByLabel) if (bestByLabel.hasOwnProperty(k)) labels.push(k);
    labels.sort();

    log.push("Unique figure labels: " + labels.length);

    var chapterFigures = [];
    for (var li = 0; li < labels.length; li++) {
      var lbl = labels[li];
      var cap = bestByLabel[lbl];
      var img = findImageForCaption(images, cap);

      var figObj = {
        chapter: chNum,
        label: cap.label,
        caption: cap.body,
        captionFull: cap.text,
        pageName: cap.pageName,
        pageIndex: cap.pageIndex,
        image: img ? {
          linkName: img.linkName,
          linkPath: img.linkPath,
          pageName: img.pageName
        } : null
      };

      chapterFigures.push(figObj);
      allFigures.push(figObj);
    }

    log.push("Figures extracted: " + chapterFigures.length);

    try { doc.close(SaveOptions.NO); } catch (e) {}
  }

  log.push("");
  log.push("=== SUMMARY ===");
  log.push("Total figures: " + allFigures.length);
  log.push("Failed chapters: " + failedChapters.join(", "));

  var manifest = {
    exportedAt: (new Date()).toISOString ? (new Date()).toISOString() : String(new Date()),
    book: "Pathologie MBO N4",
    totalFigures: allFigures.length,
    failedChapters: failedChapters,
    figures: allFigures
  };

  var json = jsonStringify(manifest, 2, 0);
  var ok = writeTextToPath(OUT_JSON, json);
  log.push("Wrote JSON: " + String(ok) + " -> " + OUT_JSON);

  writeTextToDesktop(REPORT_NAME, log.join("\n"));

  restoreUI();
  alert("Pathologie figure extraction complete!\n\nTotal figures: " + allFigures.length + "\nOutput: " + OUT_JSON + "\n\nReport saved to Desktop.");
})();











