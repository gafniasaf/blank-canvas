// ============================================================
// EXPORT: Chapter Openers (per chapter number)
// ============================================================
// Purpose:
// - Export the *correct* chapter opener pages for a given INDD, keyed by chapter number.
// - Outputs: chapter_<N>_opener.jpg (where N matches the canonical chapter number)
//
// Inputs (scriptArgs):
// - BIC_INDD_PATH: absolute path to the INDD
// - BIC_CHAPTERS: comma-separated chapter numbers (e.g. "1,2,3")
// - BIC_OUT_DIR: absolute output directory for JPGs
// - BIC_PPI: optional JPG export resolution (default: 150)
//
// SAFE:
// - Opens INDD read-only intent (no saves)
// - Closes without saving
// ============================================================

#targetengine "session"

(function () {
  var __prevUI = null;
  try { __prevUI = app.scriptPreferences.userInteractionLevel; } catch (eUI0) { __prevUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI1) {}
  function restoreUI() {
    try { if (__prevUI !== null) app.scriptPreferences.userInteractionLevel = __prevUI; } catch (eUI2) {}
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
    try { t = t.replace(/\n{2,}/g, "\n"); } catch (e4) {}
    return trimStr(t);
  }

  function hasScriptArg(key) {
    try { return app && app.scriptArgs && app.scriptArgs.isDefined && app.scriptArgs.isDefined(key); } catch (e) { return false; }
  }
  function getScriptArg(key) {
    try {
      if (hasScriptArg(key)) return safeStr(app.scriptArgs.getValue(key));
    } catch (e) {}
    return "";
  }

  function ensureFolder(absPath) {
    try {
      var f = Folder(absPath);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  function log(msg) {
    try { $.writeln(String(msg)); } catch (e) {}
  }

  function parseChaptersCsv(s) {
    var raw = trimStr(s || "");
    if (!raw) return [];
    var parts = raw.split(",");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var n = 0;
      try { n = Number(trimStr(parts[i])); } catch (e) { n = 0; }
      if (n && n > 0) out.push(Math.floor(n));
    }
    return out;
  }

  function resetFind() {
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
  }
  function setCaseInsensitive() {
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e) {}
    try { app.findChangeTextOptions.caseSensitive = false; } catch (e2) {}
  }
  function findGrep(doc, pat) {
    resetFind();
    setCaseInsensitive();
    app.findGrepPreferences.findWhat = pat;
    var res = [];
    try { res = doc.findGrep(); } catch (e) { res = []; }
    resetFind();
    return res;
  }

  function paraStyleName(para) {
    try { return safeStr(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (e) { return ""; }
  }

  function paraStartPageOffset(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
    return -1;
  }

  function isChapterHeaderStyleName(styleName) {
    var s = safeStr(styleName || "").toLowerCase();
    // Common chapter-opener style fragments across our MBO books
    if (s.indexOf("hoofdstukcijfer") !== -1) return true;
    if (s.indexOf("hoofdstuktitel") !== -1) return true;
    if (s.indexOf("chapter header") !== -1) return true;
    if (s.indexOf("chapter") !== -1 && s.indexOf("header") !== -1) return true;
    if (s.indexOf("hoofdstuk") !== -1 && (s.indexOf("titel") !== -1 || s.indexOf("cijfer") !== -1)) return true;
    // Fallback: generic "hoofdstuk" or "titel" styles
    if (s.indexOf("hoofdstuk") !== -1) return true;
    if (s.indexOf("titel") !== -1 && s.indexOf("hoofdstuk") !== -1) return true;
    return false;
  }

  function matchesChapterNumber(text, chapterNum) {
    var t = normalizeText(text || "");
    if (!t) return false;
    var n = String(chapterNum);
    // Accept:
    // - "Hoofdstuk 7"
    // - "7"
    // - "7. Titel" (some templates)
    // Reject:
    // - "7.1" (section)
    var re1 = null;
    try { re1 = new RegExp("^(?:Hoofdstuk\\s+)?" + n + "(?:\\b|\\.|:)(?!\\d)"); } catch (eR1) { re1 = null; }
    if (re1 && re1.test(t)) return true;
    // Some templates place the number alone but with surrounding whitespace
    var re2 = null;
    try { re2 = new RegExp("^" + n + "$"); } catch (eR2) { re2 = null; }
    if (re2 && re2.test(t)) return true;
    return false;
  }

  function findChapterOpenerPageOffset(doc, chapterNum, minOffOrNull) {
    var best = -1;
    var bestScore = -1; // prefer true chapter header styles, but allow fallback matches
    var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;

    for (var s = 0; s < doc.stories.length; s++) {
      var story = doc.stories[s];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
      for (var p = 0; p < pc; p++) {
        var para = story.paragraphs[p];
        var styleName = paraStyleName(para);
        var off = paraStartPageOffset(para);
        if (off < 0) continue;
        if (minOff >= 0 && off < minOff) continue;

        var txt = normalizeText(para.contents);
        if (!txt) continue;
        if (!matchesChapterNumber(txt, chapterNum)) continue;
        // Score: prefer explicit chapter header styles, but accept any matching paragraph as a fallback.
        var score = isChapterHeaderStyleName(styleName) ? 2 : 1;
        if (score > bestScore) {
          bestScore = score;
          best = off;
        } else if (score === bestScore) {
          if (best < 0 || off < best) best = off;
        }
      }
    }
    return best;
  }

  function isOpenerMasterName(masterName) {
    var s = safeStr(masterName || "").toLowerCase();
    // Common across our MBO books:
    // - "C-Hoofdstukopening"
    // - "Chapter opener"
    if (s.indexOf("hoofdstukopening") !== -1) return true;
    if (s.indexOf("chapter") !== -1 && s.indexOf("open") !== -1) return true;
    if (s.indexOf("opener") !== -1) return true;
    return false;
  }

  function pageMasterName(page) {
    try {
      // appliedMaster is usually a MasterSpread
      return safeStr(page && page.appliedMaster ? page.appliedMaster.name : "");
    } catch (e) {}
    return "";
  }

  function pageHasChapterNumber(page, chapterNum) {
    if (!page) return false;
    var tfs = [];
    try { tfs = page.textFrames; } catch (eTF) { tfs = []; }
    for (var i = 0; i < tfs.length; i++) {
      var tf = tfs[i];
      if (!tf) continue;
      var paras = [];
      try { paras = tf.paragraphs; } catch (eP) { paras = []; }
      // Only check the first handful of paragraphs per frame (opener frames are short).
      var lim = Math.min(12, paras.length || 0);
      for (var p = 0; p < lim; p++) {
        var para = paras[p];
        var txt = "";
        try { txt = normalizeText(para.contents); } catch (eT) { txt = ""; }
        if (!txt) continue;
        if (matchesChapterNumber(txt, chapterNum)) return true;
      }
    }
    return false;
  }

  function findChapterOpenerPageOffsetByMaster(doc, chapterNum, minOffOrNull) {
    var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;
    try {
      for (var i = 0; i < doc.pages.length; i++) {
        var page = doc.pages[i];
        if (!page) continue;
        var off = -1;
        try { off = page.documentOffset; } catch (eOff) { off = -1; }
        if (off < 0) continue;
        if (minOff >= 0 && off < minOff) continue;
        var mn = pageMasterName(page);
        if (!isOpenerMasterName(mn)) continue;
        if (pageHasChapterNumber(page, chapterNum)) return off;
      }
    } catch (e) {}
    return -1;
  }

  function fallbackSectionStartPageOffset(doc, chapterNum, minOffOrNull) {
    var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;
    var pat = "^" + String(chapterNum) + "\\.1";
    var res = findGrep(doc, pat);
    if (!res || res.length === 0) return -1;
    for (var i = 0; i < res.length; i++) {
      try {
        var pg = null;
        try { var tf = res[i].parentTextFrames[0]; if (tf && tf.parentPage) pg = tf.parentPage; } catch (eTF) { pg = null; }
        if (!pg) continue;
        var off = pg.documentOffset;
        if (off < 0) continue;
        if (minOff >= 0 && off < minOff) continue;
        return off;
      } catch (e) {}
    }
    return -1;
  }

  // --------------------------
  // Main
  // --------------------------
  var inddPath = trimStr(getScriptArg("BIC_INDD_PATH"));
  var outDirAbs = trimStr(getScriptArg("BIC_OUT_DIR"));
  var chaptersArg = trimStr(getScriptArg("BIC_CHAPTERS"));
  var ppiArg = trimStr(getScriptArg("BIC_PPI"));

  if (!inddPath || !outDirAbs) {
    restoreUI();
    log("❌ Missing scriptArgs. Required: BIC_INDD_PATH, BIC_OUT_DIR. Optional: BIC_CHAPTERS, BIC_PPI");
    return;
  }

  var chapters = parseChaptersCsv(chaptersArg);
  if (!chapters || chapters.length === 0) {
    // Best effort: export first 30 openers if not specified (avoid infinite scans)
    chapters = [];
    for (var chN = 1; chN <= 30; chN++) chapters.push(chN);
  }

  var ppi = 150;
  if (ppiArg) {
    try { ppi = Math.max(72, Math.min(600, Number(ppiArg))); } catch (eP) { ppi = 150; }
  }

  ensureFolder(outDirAbs);

  var INDD = File(inddPath);
  if (!INDD.exists) {
    restoreUI();
    log("❌ INDD not found: " + inddPath);
    return;
  }

  var doc = null;
  try { doc = app.open(INDD, true); } catch (eOpen1) { try { doc = app.open(INDD); } catch (eOpen2) { doc = null; } }
  if (!doc) {
    restoreUI();
    log("❌ Failed to open INDD: " + inddPath);
    return;
  }

  try { app.activeDocument = doc; } catch (eAct) {}

  // Export prefs
  try {
    app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.MAXIMUM;
    app.jpegExportPreferences.exportResolution = ppi;
    app.jpegExportPreferences.jpegColorSpace = JpegColorSpaceEnum.RGB;
    app.jpegExportPreferences.antiAlias = true;
    app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  } catch (ePrefs) {}

  var exported = 0;
  var failures = 0;
  var lastMinOff = -1;

  for (var i = 0; i < chapters.length; i++) {
    var chNum = chapters[i];
    // Prefer opener master pages (C-Hoofdstukopening etc). This avoids accidentally picking
    // “normal” pages with headings like "1. ..." in later parts/appendices.
    var off = findChapterOpenerPageOffsetByMaster(doc, chNum, lastMinOff);
    if (off < 0) {
      off = findChapterOpenerPageOffset(doc, chNum, lastMinOff);
    }
    if (off < 0) {
      off = fallbackSectionStartPageOffset(doc, chNum, lastMinOff);
    }
    if (off < 0) {
      failures++;
      continue;
    }

    var page = null;
    try { page = doc.pages[off]; } catch (ePg) { page = null; }
    if (!page) {
      failures++;
      continue;
    }

    var outFile = File(outDirAbs + "/chapter_" + String(chNum) + "_opener.jpg");
    try {
      app.jpegExportPreferences.pageString = safeStr(page.name);
      doc.exportFile(ExportFormat.JPG, outFile, false);
      if (outFile.exists) exported++;
    } catch (eExp) {
      failures++;
    }

    // Ensure next chapters don't accidentally pick earlier pages.
    lastMinOff = off + 1;
  }

  try { doc.close(SaveOptions.NO); } catch (eClose) {}
  restoreUI();

  log("✅ Chapter openers export complete. Exported=" + exported + " Failed=" + failures + " Out=" + outDirAbs);
})();


