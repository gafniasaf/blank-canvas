// ============================================================
// EXPORT: CH1 Figure Manifest (Images + Labels + Captions + Anchors)
// ============================================================
// Purpose:
// - Extraction-only. Reads the canonical N4 INDD (Downloads) and exports a deterministic
//   manifest for Chapter 1 figures:
//   - image link path + filename
//   - caption text as displayed
//   - figure label/number as displayed (kept separate)
//   - anchor paragraph key (nearest body paragraph) to map into DB paragraphs later
//
// Output:
// - /Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/extract/figure_manifest_ch1.json
// - Desktop report: export_figure_manifest_ch1__<timestamp>.txt
//
// SAFE:
// - Opens the INDD read-only intent (no saves)
// - Does NOT modify document content
// - Closes without saving
//
// Run:
// - From InDesign: app.doScript(File("<this file>"), ScriptLanguage.JAVASCRIPT)
// ============================================================

#targetengine "session"

(function () {
  // ------------------------------------------------------------------
  // Non-interactive safety: suppress any InDesign modal dialogs while
  // opening the source INDD / resolving missing links / etc.
  // ------------------------------------------------------------------
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

  function normalizeText(s) {
    var t = safeStr(s || "");
    // Remove trailing paragraph break that InDesign includes in .contents
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    // Remove soft hyphens
    try { t = t.replace(/\u00AD/g, ""); } catch (e0) {}
    // Normalize line breaks
    try { t = t.replace(/\r\n/g, "\n"); } catch (e1) {}
    try { t = t.replace(/\r/g, "\n"); } catch (e2) {}
    // Replace other control characters (InDesign embeds some specials like \u0007) with spaces
    try { t = t.replace(/[\u0000-\u001F]/g, " "); } catch (eCtl) {}
    // Collapse whitespace
    try { t = t.replace(/[ \t]+/g, " "); } catch (e3) {}
    try { t = t.replace(/\n{2,}/g, "\n"); } catch (e4) {}
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
      try { if (parent && !parent.exists) parent.create(); } catch (e0) {}
      if (f.open("w")) { f.write(String(text || "")); f.close(); return true; }
    } catch (e) {}
    return false;
  }

  // Minimal JSON stringify for ExtendScript (safe for plain objects/arrays)
  function jsonEscape(s) {
    var t = safeStr(s);
    t = t.replace(/\\/g, "\\\\");
    t = t.replace(/\"/g, "\\\"");
    t = t.replace(/\u0008/g, "\\b");
    t = t.replace(/\u000c/g, "\\f");
    t = t.replace(/\n/g, "\\n");
    t = t.replace(/\r/g, "\\r");
    t = t.replace(/\t/g, "\\t");
    return t;
  }

  function isArray(x) { return x && x.constructor && x.constructor.name === "Array"; }

  function jsonStringify(val, indent, level) {
    indent = indent || 2;
    level = level || 0;
    function spaces(n) { var s = ""; for (var si = 0; si < n; si++) s += " "; return s; }
    var pad = spaces(level * indent);

    if (val === null) return "null";
    var t = typeof val;
    if (t === "number" || t === "boolean") return String(val);
    if (t === "string") return "\"" + jsonEscape(val) + "\"";
    if (t === "undefined") return "null";

    if (isArray(val)) {
      if (val.length === 0) return "[]";
      var outA = "[\n";
      for (var ai = 0; ai < val.length; ai++) {
        outA += pad + spaces(indent) + jsonStringify(val[ai], indent, level + 1);
        if (ai !== val.length - 1) outA += ",";
        outA += "\n";
      }
      outA += pad + "]";
      return outA;
    }

    // object
    var keys = [];
    for (var k in val) if (val.hasOwnProperty(k)) keys.push(k);
    if (keys.length === 0) return "{}";
    keys.sort();
    var outO = "{\n";
    for (var ki = 0; ki < keys.length; ki++) {
      var key = keys[ki];
      outO += pad + spaces(indent) + "\"" + jsonEscape(key) + "\": " + jsonStringify(val[key], indent, level + 1);
      if (ki !== keys.length - 1) outO += ",";
      outO += "\n";
    }
    outO += pad + "}";
    return outO;
  }

  // --------------------------
  // CH1 range + body story detection (adapted from inspect-ch1-parastyles.jsx)
  // --------------------------
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
  function pageOfText(textObj) {
    try { var tf = textObj.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e) {}
    return null;
  }
  function paraStartPageOffset(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
    return -1;
  }
  function isChapterHeaderStyleName(styleName) {
    var s = safeStr(styleName || "").toLowerCase();
    return s.indexOf("chapter header") !== -1 || s.indexOf("hoofdstuk") !== -1;
  }
  function findChapterHeaderPageOffset(doc, chapterNum, minOffOrNull) {
    var best = -1;
    var re = null;
    try { re = new RegExp("^" + String(chapterNum) + "(?:\\.|\\b)"); } catch (eR) { re = null; }
    if (!re) return -1;
    var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var story = doc.stories[s];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
      for (var p = 0; p < pc; p++) {
        var para = story.paragraphs[p];
        var styleName = "";
        try { styleName = safeStr(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
        if (!isChapterHeaderStyleName(styleName)) continue;
        var off = paraStartPageOffset(para);
        if (off < 0) continue;
        if (minOff >= 0 && off < minOff) continue;
        var t = normalizeText(para.contents);
        if (!t) continue;
        if (!re.test(t)) continue;
        if (best < 0 || off < best) best = off;
      }
    }
    return best;
  }
  function getChapterRange(doc, chapterNum) {
    // Generic chapter scope:
    // - Start marker: "^<chapter>.1"
    // - End marker: next chapter CHAPTER HEADER if present; fallback "^<chapter+1>.1"
    var ch = 1;
    try { ch = Number(chapterNum || 1); } catch (eCh) { ch = 1; }

    var startPat = "^" + String(ch) + "\\.1";
    var fStart = findGrep(doc, startPat);
    var pStart = (fStart && fStart.length > 0) ? pageOfText(fStart[0]) : null;
    var startOff = pStart ? pStart.documentOffset : -1;
    if (startOff < 0) {
      return { startOff: -1, endOff: -1, ok: false, reason: "Start marker not found: " + startPat };
    }

    var endOff = doc.pages.length - 1;
    var nextCh = ch + 1;
    if (nextCh > 0) {
      var nextHeaderOff = findChapterHeaderPageOffset(doc, nextCh, startOff);
      if (nextHeaderOff >= 0) {
        endOff = nextHeaderOff - 1;
      } else {
        var endPat = "^" + String(nextCh) + "\\.1";
        var fEnd = findGrep(doc, endPat);
        var pEnd = (fEnd && fEnd.length > 0) ? pageOfText(fEnd[0]) : null;
        if (pEnd) endOff = pEnd.documentOffset - 1;
      }
    }

    if (endOff < startOff) endOff = doc.pages.length - 1;
    return { startOff: startOff, endOff: endOff, ok: true };
  }
  function storyWordCountInRange(story, startOff, endOff) {
    var wc = 0;
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;
      try { wc += para.words.length; } catch (eW) {}
    }
    return wc;
  }
  function detectBodyStoryIndex(doc, startOff, endOff) {
    var best = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }

  function firstLineXY(para) {
    try {
      if (para.lines && para.lines.length > 0) {
        var line0 = para.lines[0];
        var y = 0, x = 0;
        try { y = Number(line0.baseline); } catch (eY) { y = 0; }
        try { x = Number(line0.horizontalOffset); } catch (eX) { x = 0; }
        return { ok: true, x: x, y: y };
      }
    } catch (e) {}
    return { ok: false, x: 0, y: 0 };
  }

  // --------------------------
  // Caption detection + pairing
  // --------------------------
  function looksLikeCaptionText(t) {
    var s = normalizeText(t);
    if (!s) return false;
    if (s.length > 400) return false;
    // Dutch figure labels
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+(?:\.\d+)*\s*[:.]/i.test(s)) return true;
    // Sometimes label is like \"Afbeelding 1.2\" without colon
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+(?:\.\d+)*\b/i.test(s)) return true;
    return false;
  }

  function isCaptionCandidateFrame(tf) {
    var t = "";
    try { t = normalizeText(tf.contents); } catch (e0) { t = ""; }
    if (!t) return false;
    if (t.length < 3) return false;
    if (t.length > 500) return false;
    var wc = 0;
    try { wc = tf.words.length; } catch (eW) { wc = 0; }
    if (wc > 80) return false;

    // Prefer known caption-ish styles, but don't require them
    var styleName = "";
    try { if (tf.paragraphs && tf.paragraphs.length > 0) styleName = safeStr(tf.paragraphs[0].appliedParagraphStyle ? tf.paragraphs[0].appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
    var sl = styleName.toLowerCase();
    // Exclude diagram label frames (very common false positive)
    if (sl === "labels" || sl.indexOf("labels") !== -1 || sl.indexOf("label") !== -1) return false;
    if (sl.indexOf("bijschrift") !== -1 || sl.indexOf("caption") !== -1 || sl.indexOf("figuur") !== -1 || sl.indexOf("afbeeld") !== -1) return true;

    // Or label-like text
    if (looksLikeCaptionText(t)) return true;

    // Or short descriptive text that often accompanies figures
    if (wc > 0 && wc <= 30) return true;

    return false;
  }

  function captionPenalty(tf) {
    var styleName = "";
    try { if (tf.paragraphs && tf.paragraphs.length > 0) styleName = safeStr(tf.paragraphs[0].appliedParagraphStyle ? tf.paragraphs[0].appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
    var sl = styleName.toLowerCase();
    if (sl === "labels" || sl.indexOf("labels") !== -1 || sl.indexOf("label") !== -1) return 2000;
    if (sl.indexOf("bijschrift") !== -1 || sl.indexOf("caption") !== -1) return -200;
    if (sl.indexOf("figuur") !== -1 || sl.indexOf("afbeeld") !== -1) return -100;
    return 0;
  }

  function splitFigureLabel(captionRaw) {
    var s = normalizeText(captionRaw);
    // Capture label incl. trailing colon/period if present
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

  function boundsOf(pi) {
    try { return pi.geometricBounds; } catch (e) { return null; }
  }

  function overlapRatioX(a, b) {
    // a,b: [y1,x1,y2,x2]
    try {
      var ax1 = a[1], ax2 = a[3];
      var bx1 = b[1], bx2 = b[3];
      var inter = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
      var aw = Math.max(1, ax2 - ax1);
      return inter / aw;
    } catch (e) {}
    return 0;
  }

  function findCaptionForImage(frame, page, candidateCaptionFrames) {
    // 1) Same group
    try {
      var parent = frame.parent;
      if (parent && parent.constructor && parent.constructor.name === "Group") {
        var items = parent.allPageItems;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          try {
            if (it && it.constructor && it.constructor.name === "TextFrame") {
              // Only accept strong caption signals inside groups; groups often contain diagram labels.
              var tt = "";
              try { tt = normalizeText(it.contents); } catch (eTT) { tt = ""; }
              if (!tt) continue;
              if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(tt)) return it;
              var sname = "";
              try { if (it.paragraphs && it.paragraphs.length > 0) sname = safeStr(it.paragraphs[0].appliedParagraphStyle ? it.paragraphs[0].appliedParagraphStyle.name : ""); } catch (eSN) { sname = ""; }
              var sl = sname.toLowerCase();
              if (sl.indexOf("bijschrift") !== -1 || sl.indexOf("caption") !== -1) return it;
            }
          } catch (e0) {}
        }
      }
    } catch (eG) {}

    // 2) Nearest caption-like frame on the page (below image, overlapping in X)
    var best = null;
    var bestScore = 1e18;
    var imgB = boundsOf(frame);
    if (!imgB) return null;
    var imgBottom = imgB[2];
    var imgTop = imgB[0];
    for (var c = 0; c < candidateCaptionFrames.length; c++) {
      var tf = candidateCaptionFrames[c];
      if (!isCaptionCandidateFrame(tf)) continue;
      var b = boundsOf(tf);
      if (!b) continue;
      var captionTop = b[0];
      var captionBottom = b[2];
      var gap = captionTop - imgBottom;
      // Prefer captions below the image (allow small negative overlap)
      if (gap < -10) continue;
      if (gap > 120) continue;
      var ox = overlapRatioX(imgB, b);
      if (ox < 0.25) continue;
      var score = gap + (1 - ox) * 50 + Math.abs((b[1]) - (imgB[1])) * 0.01 + captionPenalty(tf);
      // If caption is above image, heavily penalize
      if (captionBottom < imgTop) score += 5000;
      if (score < bestScore) { bestScore = score; best = tf; }
    }
    return best;
  }

  function findLabelNear(imageFrame, captionFrameOrNull, pageFrames) {
    // Look for a small text frame near the caption or image that contains a figure label like \"Afbeelding 1.4\"
    var imgB = boundsOf(imageFrame);
    if (!imgB) return "";
    var capB = captionFrameOrNull ? boundsOf(captionFrameOrNull) : null;

    var best = "";
    var bestScore = 1e18;
    for (var i = 0; i < pageFrames.length; i++) {
      var tf = pageFrames[i];
      if (!tf) continue;
      var t = "";
      try { t = normalizeText(tf.contents); } catch (e0) { t = ""; }
      if (!t) continue;
      if (t.length > 80) continue;
      if (!/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+(?:\.\d+)*\b/i.test(t)) continue;
      var b = boundsOf(tf);
      if (!b) continue;

      // Distance to caption if available, otherwise to image bottom
      var refY = capB ? capB[0] : imgB[2];
      var refX = capB ? capB[1] : imgB[1];
      var dy = Math.abs(b[0] - refY);
      var dx = Math.abs(b[1] - refX);
      var ox = overlapRatioX(imgB, b);
      var score = dy + dx * 0.2 + (1 - ox) * 50;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  // --------------------------
  // Anchor selection
  // --------------------------
  function buildBodyParagraphIndex(doc, bodyStoryIndex, startOff, endOff) {
    var res = [];
    if (bodyStoryIndex < 0) return res;
    var story = doc.stories[bodyStoryIndex];
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var i = 0; i < pc; i++) {
      var para = story.paragraphs[i];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;
      var pos = firstLineXY(para);
      if (!pos.ok) continue;
      var txt = normalizeText(para.contents);
      if (!txt) continue;
      res.push({ i: i, pageOff: off, x: pos.x, y: pos.y, text: txt });
    }
    return res;
  }

  function nearestAnchorPara(bodyParas, imgFrame, imgPageOff) {
    var imgB = boundsOf(imgFrame);
    if (!imgB) return null;
    var imgTop = imgB[0];
    var imgLeft = imgB[1];
    var best = null;
    var bestScore = 1e18;
    for (var i = 0; i < bodyParas.length; i++) {
      var p = bodyParas[i];
      if (p.pageOff !== imgPageOff) continue;
      // Prefer para above image
      var dy = 0;
      if (p.y <= imgTop + 3) dy = (imgTop - p.y);
      else dy = (p.y - imgTop) + 800; // penalize below-image anchors
      var dx = Math.abs(p.x - imgLeft) * 0.2;
      var score = dy + dx;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best) return best;

    // Fallback: closest across pages
    for (var j = 0; j < bodyParas.length; j++) {
      var q = bodyParas[j];
      var pagePenalty = Math.abs(q.pageOff - imgPageOff) * 2000;
      var dy2 = Math.abs(q.y - imgTop);
      var dx2 = Math.abs(q.x - imgLeft) * 0.2;
      var score2 = pagePenalty + dy2 + dx2 + 5000;
      if (score2 < bestScore) { bestScore = score2; best = q; }
    }
    return best;
  }

  function paraStyleName(para) {
    try { return safeStr(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (e) { return ""; }
  }

  function isCaptionParagraph(para) {
    var t = normalizeText(para.contents);
    if (!t) return false;
    // Often captions start with Afbeelding/Figuur, but not always.
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+(?:\.\d+)*/i.test(t)) return true;
    // Style-based caption detection
    var sn = paraStyleName(para).toLowerCase();
    if (!sn) return false;
    if (sn.indexOf("bijschrift") !== -1) return true;
    if (sn.indexOf("caption") !== -1) return true;
    if (sn.indexOf("_annotation") !== -1) return true;
    if (sn.indexOf("annotation") !== -1) return true;
    if (sn.indexOf("afbeeld") !== -1) return true;
    if (sn.indexOf("figuur") !== -1) return true;
    return false;
  }

  function buildBodyParagraphIndexFull(doc, bodyStoryIndex, startOff, endOff) {
    var res = [];
    if (bodyStoryIndex < 0) return res;
    var story = doc.stories[bodyStoryIndex];
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var i = 0; i < pc; i++) {
      var para = story.paragraphs[i];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;
      var pos = firstLineXY(para);
      if (!pos.ok) continue;
      var txt = normalizeText(para.contents);
      if (!txt) continue;
      res.push({ i: i, pageOff: off, x: pos.x, y: pos.y, text: txt, styleName: paraStyleName(para) });
    }
    return res;
  }

  function findCaptionNearImageFromBody(captionParas, imgFrame, imgPageOff) {
    var imgB = boundsOf(imgFrame);
    if (!imgB) return null;
    var imgBottom = imgB[2];
    var imgLeft = imgB[1];
    var best = null;
    var bestScore = 1e18;
    for (var i = 0; i < captionParas.length; i++) {
      var c = captionParas[i];
      if (c.pageOff !== imgPageOff) continue;
      // Captions usually below image; allow slight overlap
      var gap = c.y - imgBottom;
      if (gap < -12) continue;
      if (gap > 420) continue;
      var dx = Math.abs(c.x - imgLeft) * 0.2;
      var score = Math.max(0, gap) + dx;
      // Prefer captions with Afbeelding/Figuur label
      if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(c.text)) score -= 50;
      // Prefer caption-ish style
      var sn = (c.styleName || "").toLowerCase();
      if (sn.indexOf("_annotation") !== -1 || sn.indexOf("bijschrift") !== -1 || sn.indexOf("caption") !== -1) score -= 25;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) return best;

    // Fallback: captions can spill to adjacent page/column. Search +/- 1 page with a penalty.
    for (var j = 0; j < captionParas.length; j++) {
      var c2 = captionParas[j];
      var dp = Math.abs(c2.pageOff - imgPageOff);
      if (dp === 0 || dp > 1) continue;
      // allow larger gap across pages; the penalty dominates
      var gap2 = c2.y - imgBottom;
      if (gap2 < -12) continue;
      if (gap2 > 700) continue;
      var dx2 = Math.abs(c2.x - imgLeft) * 0.2;
      var score2 = Math.max(0, gap2) + dx2 + dp * 2000;
      if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(c2.text)) score2 -= 50;
      var sn2 = (c2.styleName || "").toLowerCase();
      if (sn2.indexOf("_annotation") !== -1 || sn2.indexOf("bijschrift") !== -1 || sn2.indexOf("caption") !== -1) score2 -= 25;
      if (score2 < bestScore) { bestScore = score2; best = c2; }
    }
    return best;
  }

  // --------------------------
  // Main
  // --------------------------
  function hasScriptArg(key) {
    try { return app && app.scriptArgs && app.scriptArgs.isDefined && app.scriptArgs.isDefined(key); } catch (e) { return false; }
  }
  function getScriptArg(key) {
    try {
      if (hasScriptArg(key)) return safeStr(app.scriptArgs.getValue(key));
    } catch (e) {}
    return "";
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
  function ensureFolder(absPath) {
    try {
      var f = Folder(absPath);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  // Defaults (legacy A&F4 behavior)
  var DEFAULT_INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var DEFAULT_OUT_DIR_ABS = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/extract";
  var DEFAULT_FIGURES_DIR_ABS = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/assets/figures";
  var DEFAULT_FIGURES_DIR_REL = "new_pipeline/assets/figures";

  var BOOK_ID = trimStr(getScriptArg("BIC_BOOK_ID")) || "MBO_AF4_2024_COMMON_CORE";
  var INDD_PATH = trimStr(getScriptArg("BIC_INDD_PATH")) || DEFAULT_INDD_PATH;
  var OUT_DIR_ABS = trimStr(getScriptArg("BIC_OUT_DIR")) || DEFAULT_OUT_DIR_ABS;
  var FIGURES_DIR_ABS = trimStr(getScriptArg("BIC_FIGURES_DIR")) || DEFAULT_FIGURES_DIR_ABS;
  var FIGURES_DIR_REL = trimStr(getScriptArg("BIC_FIGURES_REL")) || DEFAULT_FIGURES_DIR_REL;

  // If the caller didn't pass any args, keep legacy output names/paths for backwards compatibility.
  var LEGACY_MODE = !(hasScriptArg("BIC_BOOK_ID") || hasScriptArg("BIC_INDD_PATH") || hasScriptArg("BIC_OUT_DIR") || hasScriptArg("BIC_FIGURES_DIR") || hasScriptArg("BIC_FIGURES_REL") || hasScriptArg("BIC_CHAPTERS"));

  var INDD = File(INDD_PATH);
  var STAMP = isoStamp();
  var REPORT_ALL = (LEGACY_MODE ? "export_figure_manifest_all__" : ("export_figure_manifest_all__" + BOOK_ID + "__")) + STAMP + ".txt";

  var logAll = [];
  logAll.push("=== EXPORT FIGURE MANIFEST (MULTI-CHAPTER) ===");
  logAll.push("Started: " + (new Date()).toString());
  logAll.push("INDD: " + INDD.fsName);
  logAll.push("BOOK_ID: " + BOOK_ID);
  logAll.push("OUT_DIR_ABS: " + OUT_DIR_ABS);
  logAll.push("FIGURES_DIR_ABS: " + FIGURES_DIR_ABS);
  logAll.push("FIGURES_DIR_REL: " + FIGURES_DIR_REL);
  logAll.push("");
  // Early breadcrumb so we can see script execution even if it fails later
  writeTextToDesktop(REPORT_ALL, logAll.join("\n"));

  if (!INDD.exists) {
    logAll.push("ERROR: INDD not found.");
    writeTextToDesktop(REPORT_ALL, logAll.join("\n"));
    restoreUI();
    "ERROR: INDD not found";
    return;
  }

  // Ensure output dirs exist (best effort; exporter will still fail later if not writable)
  ensureFolder(OUT_DIR_ABS);
  ensureFolder(FIGURES_DIR_ABS);

  var doc = null;
  try { doc = app.open(INDD, true); } catch (eOpen1) { try { doc = app.open(INDD); } catch (eOpen2) { doc = null; } }
  if (!doc) {
    logAll.push("ERROR: Failed to open INDD.");
    writeTextToDesktop(REPORT_ALL, logAll.join("\n"));
    restoreUI();
    "ERROR: Failed to open INDD";
    return;
  }

  try { app.activeDocument = doc; } catch (eAct) {}

  // Hard gate: ensure we are on the intended document
  try {
    var openedDocName = "(no doc.name)";
    try { openedDocName = safeStr(doc.name); } catch (eDN) { openedDocName = "(no doc.name)"; }
    var expectedNameRaw = safeStr(INDD.name);
    var expectedName = expectedNameRaw;
    try { expectedName = decodeURIComponent(expectedNameRaw); } catch (eDec) { expectedName = expectedNameRaw.replace(/%20/g, " "); }
    logAll.push("Expected INDD.name (raw): " + expectedNameRaw);
    logAll.push("Expected INDD.name (dec): " + expectedName);
    logAll.push("Opened doc.name: " + openedDocName);
    // In some InDesign automation contexts doc.fullName can be inaccessible; doc.name is stable.
    if (openedDocName !== expectedName) {
      throw new Error("Document name mismatch. Refusing to run.");
    }
  } catch (eGate) {
    try { doc.close(SaveOptions.NO); } catch (eClose0) {}
    logAll.push("ERROR: Active document mismatch. Refusing to run.");
    writeTextToDesktop(REPORT_ALL, logAll.join("\n"));
    restoreUI();
    "ERROR: Active document mismatch";
    return;
  }

  var chapters = [];
  var chaptersArg = trimStr(getScriptArg("BIC_CHAPTERS"));
  var parsed = parseChaptersCsv(chaptersArg);
  if (parsed && parsed.length > 0) {
    chapters = parsed;
  } else {
    for (var chN = 1; chN <= 14; chN++) chapters.push(chN);
  }

  var failures = [];
  var successes = [];

  for (var ci = 0; ci < chapters.length; ci++) {
    var chapterNum = chapters[ci];
    var OUT_JSON = LEGACY_MODE
      ? (DEFAULT_OUT_DIR_ABS + "/figure_manifest_ch" + String(chapterNum) + ".json")
      : (OUT_DIR_ABS + "/figure_manifest_" + BOOK_ID + "_ch" + String(chapterNum) + ".json");
    var REPORT_NAME = "export_figure_manifest_ch" + String(chapterNum) + "__" + STAMP + ".txt";

    var log = [];
    log.push("=== EXPORT FIGURE MANIFEST CH" + String(chapterNum) + " ===");
    log.push("Started: " + (new Date()).toString());
    log.push("INDD: " + INDD.fsName);
    log.push("OUT:  " + OUT_JSON);
    if (!LEGACY_MODE) {
      log.push("BOOK_ID: " + BOOK_ID);
      log.push("FIGURES_DIR_ABS: " + FIGURES_DIR_ABS);
      log.push("FIGURES_DIR_REL: " + FIGURES_DIR_REL);
    }
    log.push("");
    // Early breadcrumb so we can see chapter execution even if it fails later
    writeTextToDesktop(REPORT_NAME, log.join("\n"));

    var range = getChapterRange(doc, chapterNum);
    if (!range || !range.ok || range.startOff < 0) {
      var reason = (range && range.reason) ? range.reason : "(unknown)";
      log.push("ERROR: Failed to detect chapter range. " + reason);
      failures.push("CH" + String(chapterNum) + ": range detection failed (" + reason + ")");
      writeTextToDesktop(REPORT_NAME, log.join("\n"));
      continue;
    }

    var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
    log.push("CH" + String(chapterNum) + " offsets: " + range.startOff + " -> " + range.endOff);
    log.push("Body story index=" + body.index + " words=" + body.words);
    log.push("");

    var bodyParas = buildBodyParagraphIndexFull(doc, body.index, range.startOff, range.endOff);
    log.push("Body para candidates: " + bodyParas.length);
    var buildCaptionParaCandidatesAllStories = function (doc, startOff, endOff) {
    var out = [];
    for (var si = 0; si < doc.stories.length; si++) {
      var story = doc.stories[si];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
      for (var pi2 = 0; pi2 < pc; pi2++) {
        var para = story.paragraphs[pi2];
        var off = paraStartPageOffset(para);
        if (off < startOff || off > endOff) continue;
        // Caption identification
        if (!isCaptionParagraph(para)) continue;
        var pos = firstLineXY(para);
        if (!pos.ok) continue;
        var txt = normalizeText(para.contents);
        if (!txt) continue;
        out.push({
          storyIndex: si,
          paragraphIndexInStory: pi2,
          pageOff: off,
          x: pos.x,
          y: pos.y,
          text: txt,
          styleName: paraStyleName(para)
        });
      }
    }
    return out;
    };

    var captionParas = buildCaptionParaCandidatesAllStories(doc, range.startOff, range.endOff);
    log.push("Caption para candidates (all stories): " + captionParas.length);

  // Build page textFrames cache (used only for label detection near images)
    var framesByOff = {}; // off -> [TextFrame]
    for (var pi = range.startOff; pi <= range.endOff; pi++) {
      var page = null;
      try { page = doc.pages[pi]; } catch (eP0) { page = null; }
      if (!page) continue;
      var frames = [];
      try { frames = page.textFrames; } catch (eTF) { frames = []; }
      framesByOff[String(pi)] = frames;
    }

  // ------------------------------------------------------------
  // Caption-driven figure extraction (one figure per caption label)
  // This avoids duplicates from multi-link figures and prevents
  // diagram label frames from being misclassified as captions.
  // ------------------------------------------------------------

  function collectImagesInRange(doc, range) {
    var imgs = [];
    for (var li = 0; li < doc.links.length; li++) {
      var link = doc.links[li];
      var linkName = safeStr(link.name);
      // Only consider common image formats
      if (!(/\.(png|jpg|jpeg|tif|tiff|psd|ai|eps)$/i.test(linkName))) continue;

      var linkPath = "";
      try { linkPath = link.filePath ? link.filePath.fsName : ""; } catch (eLP) { linkPath = ""; }
      if (!linkPath) {
        try { linkPath = safeStr(link.linkResourceURI); } catch (eURI) { linkPath = ""; }
      }

      // Resolve frame for this link
      var graphic = null;
      try { graphic = link.parent; } catch (eG0) { graphic = null; }
      var frame = null;
      try { frame = graphic.parent; } catch (eF0) { frame = null; }
      if (!frame) continue;

      var page = null;
      try { page = frame.parentPage; } catch (ePP) { page = null; }
      if (!page) continue;

      var off = -1;
      try { off = page.documentOffset; } catch (eOff) { off = -1; }
      if (off < range.startOff || off > range.endOff) continue;

      var b = null;
      try { b = frame.geometricBounds; } catch (eB0) { b = null; }
      if (!b) continue;

      imgs.push({
        linkName: linkName,
        linkPath: linkPath,
        bounds: b,
        pageName: safeStr(page.name),
        pageDocumentOffset: off,
        frame: frame
      });
    }
    return imgs;
  }

  function captionCandidateScore(c) {
    // lower is better
    var score = 1000;
    if (c.body && c.body.length > 0) score -= Math.min(300, c.body.length);
    var sn = (c.styleName || "").toLowerCase();
    if (sn.indexOf("_annotation") !== -1) score -= 200;
    if (sn.indexOf("bijschrift") !== -1 || sn.indexOf("caption") !== -1) score -= 150;
    if (/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(c.raw || "")) score -= 50;
    return score;
  }

  function buildBestCaptionsByLabel(doc, captionParas) {
    var best = {}; // label -> captionObj
    for (var i = 0; i < captionParas.length; i++) {
      var cp = captionParas[i];
      var raw = cp.text;
      var split = splitFigureLabel(raw);
      if (!split.label) continue;
      // Only figures (not tables) for now
      if (!/^(Afbeelding|Figuur|Fig\.?)/i.test(split.label)) continue;

      var obj = {
        label: split.label,
        raw: raw,
        body: split.body,
        styleName: cp.styleName,
        pageDocumentOffset: cp.pageOff,
        x: cp.x,
        y: cp.y,
        storyIndex: cp.storyIndex,
        paragraphIndexInStory: cp.paragraphIndexInStory
      };

      // If label-only, try to append the next paragraph as body (common in some layouts)
      if (!obj.body || obj.body.length === 0) {
        try {
          var sIdx = cp.storyIndex;
          var pIdx = cp.paragraphIndexInStory;
          var nxt = doc.stories[sIdx].paragraphs[pIdx + 1];
          if (nxt) {
            var nxtTxt = normalizeText(nxt.contents);
            if (nxtTxt && !/^(Afbeelding|Figuur|Fig\.?|Tabel)\s+\d+/i.test(nxtTxt)) {
              obj.body = nxtTxt;
              obj.raw = normalizeText((split.label + " " + nxtTxt));
            }
          }
        } catch (eNext) {}
      }

      var key = obj.label;
      var sc = captionCandidateScore(obj);
      if (!best[key] || sc < best[key].__score) {
        obj.__score = sc;
        best[key] = obj;
      }
    }
    return best;
  }

  function findBestImageForCaption(images, cap) {
    var best = null;
    var bestScore = 1e18;
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      var dp = Math.abs(img.pageDocumentOffset - cap.pageDocumentOffset);
      if (dp > 1) continue; // allow adjacent page spill
      var b = img.bounds;
      var imgBottom = b[2];
      var imgLeft = b[1];
      var imgRight = b[3];

      // Caption baseline should be below the image in most cases
      var gap = cap.y - imgBottom;
      if (gap < -250) continue; // allow captions above image sometimes
      if (gap > 900) continue;  // allow larger gaps for complex layouts

      // Prefer same column: cap.x should be within image horizontal extent (with slack)
      var inX = (cap.x >= (imgLeft - 60) && cap.x <= (imgRight + 60));
      var dx = Math.abs(cap.x - imgLeft);

      var score = Math.max(0, gap) + dx * 0.2;
      if (!inX) score += 600;
      if (gap < 0) score += 1400; // caption above image: penalize but allow
      if (dp > 0) score += dp * 2000; // adjacent page penalty

      if (score < bestScore) { bestScore = score; best = img; }
    }
    // Fallback: for layouts where captions are beside/above the image, pick the closest image
    // by geometric distance to the caption point.
    if (!best && images && images.length) {
      for (var j = 0; j < images.length; j++) {
        var img2 = images[j];
        var dp2 = Math.abs(img2.pageDocumentOffset - cap.pageDocumentOffset);
        if (dp2 > 2) continue;
        var bb = img2.bounds;
        var top = bb[0], left = bb[1], bottom = bb[2], right = bb[3];
        var dx2 = 0;
        if (cap.x < left) dx2 = left - cap.x;
        else if (cap.x > right) dx2 = cap.x - right;
        var dy2 = 0;
        if (cap.y < top) dy2 = top - cap.y;
        else if (cap.y > bottom) dy2 = cap.y - bottom;
        // Simple Manhattan distance in points, plus page-diff penalty.
        var score2 = (dx2 + dy2) + dp2 * 2500;
        if (score2 < bestScore) { bestScore = score2; best = img2; }
      }
    }
    return best;
  }

  function overlapRatioXBounds(a, b) {
    // a,b: [y1,x1,y2,x2]
    try {
      var ax1 = a[1], ax2 = a[3];
      var bx1 = b[1], bx2 = b[3];
      var inter = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
      var aw = Math.max(1, ax2 - ax1);
      return inter / aw;
    } catch (e) {}
    return 0;
  }

  function areaOfBounds(b) {
    try { return Math.max(0, (b[2] - b[0])) * Math.max(0, (b[3] - b[1])); } catch (e) { return 0; }
  }

  function findBestNonLinkedItemForCaption(doc, cap, bodyStoryIndex) {
    // For figures that are drawn in InDesign (no external link), find the best page item above the caption.
    var capBounds = null;
    try {
      var para = doc.stories[cap.storyIndex].paragraphs[cap.paragraphIndexInStory];
      var tf = null;
      try { tf = para.parentTextFrames[0]; } catch (eTF0) { tf = null; }
      if (tf) capBounds = tf.geometricBounds;
    } catch (eCB) { capBounds = null; }
    if (!capBounds) return null;

    var page = null;
    try { page = doc.pages[cap.pageDocumentOffset]; } catch (eP0) { page = null; }
    if (!page) return null;

    var items = [];
    try { items = page.allPageItems; } catch (eIt) { items = []; }

    var best = null;
    var bestScore = 1e18;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var typeName = "";
      try { typeName = it.constructor ? it.constructor.name : ""; } catch (eTN) { typeName = ""; }

      // Skip the caption frame itself (exact bounds match)
      var b = null;
      try { b = it.geometricBounds; } catch (eB) { b = null; }
      if (!b) continue;
      if (Math.abs(b[0] - capBounds[0]) < 0.5 && Math.abs(b[1] - capBounds[1]) < 0.5 && Math.abs(b[2] - capBounds[2]) < 0.5 && Math.abs(b[3] - capBounds[3]) < 0.5) {
        continue;
      }

      // Must be above caption (or very slightly overlapping)
      var gap = capBounds[0] - b[2];
      if (gap < -30) continue;
      if (gap > 1200) continue;

      // Must align horizontally with caption column
      var ox = overlapRatioXBounds(b, capBounds);
      if (ox < 0.15) continue;

      // Skip obvious body text frames
      if (typeName === "TextFrame") {
        try {
          if (it.parentStory && bodyStoryIndex >= 0 && it.parentStory === doc.stories[bodyStoryIndex]) continue;
        } catch (eBS) {}
      }

      var ar = areaOfBounds(b);
      if (ar < 1500) continue; // ignore tiny page items

      var penalty = 0;
      if (typeName === "TextFrame") penalty += 1000;
      if (typeName === "Group") penalty -= 300;

      // Prefer larger objects closer to caption
      var score = gap + (1 - ox) * 200 + penalty - ar * 0.00005;
      if (score < bestScore) { bestScore = score; best = it; }
    }

    // Fallback: if we didn't find anything with the strict "above + overlap" rules,
    // try a relaxed nearest-item search on the caption page and adjacent pages.
    if (!best) {
      var pagesToCheck = [];
      try { pagesToCheck.push(doc.pages[cap.pageDocumentOffset]); } catch (ePg0) {}
      try { if (cap.pageDocumentOffset > 0) pagesToCheck.push(doc.pages[cap.pageDocumentOffset - 1]); } catch (ePg1) {}
      try { pagesToCheck.push(doc.pages[cap.pageDocumentOffset + 1]); } catch (ePg2) {}

      for (var pi = 0; pi < pagesToCheck.length; pi++) {
        var pg = pagesToCheck[pi];
        if (!pg) continue;
        var its = [];
        try { its = pg.allPageItems; } catch (eIt2) { its = []; }
        for (var k = 0; k < its.length; k++) {
          var it2 = its[k];
          if (!it2) continue;
          var tn2 = "";
          try { tn2 = it2.constructor ? it2.constructor.name : ""; } catch (eTN2) { tn2 = ""; }

          var b2 = null;
          try { b2 = it2.geometricBounds; } catch (eB2) { b2 = null; }
          if (!b2) continue;

          // Skip the caption frame itself (exact bounds match)
          if (
            Math.abs(b2[0] - capBounds[0]) < 0.5 &&
            Math.abs(b2[1] - capBounds[1]) < 0.5 &&
            Math.abs(b2[2] - capBounds[2]) < 0.5 &&
            Math.abs(b2[3] - capBounds[3]) < 0.5
          ) continue;

          // Skip obvious body text frames
          if (tn2 === "TextFrame") {
            try {
              if (it2.parentStory && bodyStoryIndex >= 0 && it2.parentStory === doc.stories[bodyStoryIndex]) continue;
            } catch (eBS2) {}
          }

          var ar2 = areaOfBounds(b2);
          if (ar2 < 1500) continue;

          // Distance between rectangles (capBounds and b2)
          var dxr = 0;
          if (b2[1] > capBounds[3]) dxr = b2[1] - capBounds[3];
          else if (capBounds[1] > b2[3]) dxr = capBounds[1] - b2[3];
          var dyr = 0;
          if (b2[0] > capBounds[2]) dyr = b2[0] - capBounds[2];
          else if (capBounds[0] > b2[2]) dyr = capBounds[0] - b2[2];

          var pen2 = 0;
          if (tn2 === "TextFrame") pen2 += 1200;
          if (tn2 === "Group") pen2 -= 300;

          // Prefer nearby + larger items; penalize far away.
          var sc2 = (dxr + dyr) + pen2 - ar2 * 0.00005 + pi * 1500;
          if (sc2 < bestScore) { bestScore = sc2; best = it2; }
        }
      }
    }

    return best;
  }

  function ensureFolder(absPathFolder) {
    try {
      var f = Folder(absPathFolder);
      if (!f.exists) f.create();
      return f.exists;
    } catch (e) {}
    return false;
  }

  function safeFileStemFromLabel(label) {
    var s = normalizeText(label || "");
    s = s.replace(/[:.]+$/g, ""); // strip trailing punctuation
    s = s.replace(/\s+/g, "_");
    s = s.replace(/[^A-Za-z0-9._-]/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (!s) s = "figure";
    return s;
  }

  function boundsUnion(a, b) {
    if (!a) return b;
    if (!b) return a;
    return [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3])
    ];
  }

  function exportPageItemsAsPng(pageItems, outAbsPath, resolutionPpi) {
    resolutionPpi = resolutionPpi || 300;
    if (!pageItems || !pageItems.length) return false;

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
    } catch (ePrefs0) {}

    var p0 = null;
    try { p0 = tmp.pages[0]; } catch (ePg) { p0 = null; }
    if (!p0) { try { tmp.close(SaveOptions.NO); } catch (eC0) {} return false; }

    // Duplicate items into tmp doc
    var dups = [];
    for (var i = 0; i < pageItems.length; i++) {
      var it = pageItems[i];
      if (!it) continue;
      var dup = null;
      try { dup = it.duplicate(p0); } catch (eDup) { dup = null; }
      if (dup) dups.push(dup);
    }
    if (!dups.length) { try { tmp.close(SaveOptions.NO); } catch (eC1) {} return false; }

    // Compute union bounds in tmp coordinate space
    var ub = null;
    for (var j = 0; j < dups.length; j++) {
      var b = null;
      try { b = dups[j].geometricBounds; } catch (eB) { b = null; }
      if (!b) continue;
      ub = boundsUnion(ub, b);
    }
    if (!ub) { try { tmp.close(SaveOptions.NO); } catch (eC2) {} return false; }

    var pad = 18; // points
    var h = Math.max(10, ub[2] - ub[0]);
    var w = Math.max(10, ub[3] - ub[1]);
    try {
      tmp.documentPreferences.pageHeight = (h + pad * 2) + "pt";
      tmp.documentPreferences.pageWidth = (w + pad * 2) + "pt";
    } catch (eSize) {}

    // Translate items so union top-left lands at padding
    var dx = pad - ub[1];
    var dy = pad - ub[0];
    for (var k = 0; k < dups.length; k++) {
      try { dups[k].move(undefined, [dx, dy]); } catch (eMove) {}
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

    try { tmp.close(SaveOptions.NO); } catch (eC3) {}
    try { return ok && outFile.exists; } catch (eEx) { return ok; }
  }

  function exportPageItemAsPng(pageItem, outAbsPath, resolutionPpi) {
    resolutionPpi = resolutionPpi || 300;
    var b = null;
    try { b = pageItem.geometricBounds; } catch (eB) { b = null; }
    if (!b) return false;
    var pad = 12; // points; enough breathing room

    // IMPORTANT:
    // InDesign can interpret numeric dimensions in the current ruler units of the document.
    // If those units are PICAS, a value like "176" becomes 176 picas (12x larger than points),
    // producing huge PNGs with tiny artwork (lots of transparent margin), which then makes
    // figures look "small" and can appear to "mess up labels".
    //
    // We convert all geometry to POINTS and ensure the temporary export document is in POINTS.
    var srcDoc = null;
    try { srcDoc = app.activeDocument; } catch (eSrc) { srcDoc = null; }
    var hMu = null;
    var vMu = null;
    try { hMu = srcDoc && srcDoc.viewPreferences ? srcDoc.viewPreferences.horizontalMeasurementUnits : null; } catch (eHU) { hMu = null; }
    try { vMu = srcDoc && srcDoc.viewPreferences ? srcDoc.viewPreferences.verticalMeasurementUnits : null; } catch (eVU) { vMu = null; }

    function muToPtFactor(mu) {
      try {
        if (mu === MeasurementUnits.POINTS) return 1;
        if (mu === MeasurementUnits.PICAS) return 12;
        if (mu === MeasurementUnits.INCHES || mu === MeasurementUnits.INCHES_DECIMAL) return 72;
        if (mu === MeasurementUnits.MILLIMETERS) return 72 / 25.4;
        if (mu === MeasurementUnits.CENTIMETERS) return 72 / 2.54;
      } catch (eMu) {}
      return 1;
    }

    function toPt(n, mu) {
      var v = 0;
      try { v = Number(n); } catch (eNum) { v = 0; }
      return v * muToPtFactor(mu);
    }

    var topPt = toPt(b[0], vMu);
    var leftPt = toPt(b[1], hMu);
    var bottomPt = toPt(b[2], vMu);
    var rightPt = toPt(b[3], hMu);

    var h = Math.max(10, bottomPt - topPt);
    var w = Math.max(10, rightPt - leftPt);

    var outFile = File(outAbsPath);
    try { if (outFile.exists) outFile.remove(); } catch (eRm) {}
    try { if (outFile.parent && !outFile.parent.exists) outFile.parent.create(); } catch (eDir) {}

    // Fast path: export the page item directly. This is often more reliable than cross-document
    // duplication for complex Groups (tables/diagrams) that contain nested page items.
    try { app.pngExportPreferences.exportResolution = resolutionPpi; } catch (eRes0) {}
    try { app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH; } catch (eQ0) {}
    try { app.pngExportPreferences.transparentBackground = true; } catch (eT0) {}

    var directOk = false;
    try { pageItem.exportFile(ExportFormat.PNG_FORMAT, outFile, false); directOk = true; } catch (eD1) { directOk = false; }
    if (!directOk) { try { pageItem.exportFile(ExportFormat.PNG, outFile, false); directOk = true; } catch (eD2) { directOk = false; } }
    if (!directOk) { try { pageItem.exportFile(ExportFormat.PNG_TYPE, outFile, false); directOk = true; } catch (eD3) { directOk = false; } }
    try { if (directOk && outFile.exists) return true; } catch (eDEx) {}

    var tmp = null;
    try { tmp = app.documents.add(); } catch (eNew) { tmp = null; }
    if (!tmp) return false;
    try {
      tmp.documentPreferences.facingPages = false;
      tmp.documentPreferences.pagesPerDocument = 1;
      // Force tmp document rulers to POINTS so numeric page sizes and moves are interpreted correctly.
      try {
        tmp.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        tmp.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        tmp.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
      } catch (eUnits) {}

      // Set page size explicitly in points
      tmp.documentPreferences.pageHeight = (h + pad * 2) + "pt";
      tmp.documentPreferences.pageWidth = (w + pad * 2) + "pt";
    } catch (ePrefs) {}

    var p0 = null;
    try { p0 = tmp.pages[0]; } catch (ePg) { p0 = null; }
    if (!p0) { try { tmp.close(SaveOptions.NO); } catch (eC0) {} return false; }

    var dup = null;
    try { dup = pageItem.duplicate(p0); } catch (eDup) { dup = null; }
    // Some page items (especially nested groups) fail to duplicate across documents.
    // Fallback A: duplicate to spread (different overload).
    if (!dup) {
      try { dup = pageItem.duplicate(tmp.spreads[0]); } catch (eDup2) { dup = null; }
    }
    // Fallback B: copy/paste.
    if (!dup) {
      try {
        try { if (srcDoc) app.activeDocument = srcDoc; } catch (eAct0) {}
        try { pageItem.select(); } catch (eSel) {}
        try { app.copy(); } catch (eCopy) {}
        try { app.activeDocument = tmp; } catch (eAct1) {}
        try { app.paste(); } catch (ePaste) {}
        try {
          if (app.selection && app.selection.length > 0) dup = app.selection[0];
        } catch (ePick) { dup = null; }
      } catch (eCB) { dup = null; }
    }
    if (!dup) { try { tmp.close(SaveOptions.NO); } catch (eC1) {} return false; }

    // Move duplicated item so its top-left is at padding
    try {
      var db = dup.geometricBounds;
      var dx = pad - db[1];
      var dy = pad - db[0];
      // move expects [x,y] offset
      dup.move(undefined, [dx, dy]);
    } catch (eMove) {}

    // Export settings
    try { app.pngExportPreferences.exportResolution = resolutionPpi; } catch (eRes) {}
    // Best-effort quality settings (may vary by ID version)
    try { app.pngExportPreferences.pngQuality = PNGQualityEnum.HIGH; } catch (eQ) {}
    try { app.pngExportPreferences.transparentBackground = true; } catch (eT) {}

    var ok = false;
    try {
      // InDesign 2026: export is on Document, not Page
      try { tmp.exportFile(ExportFormat.PNG_FORMAT, outFile, false); ok = true; } catch (e1) {}
      if (!ok) { try { tmp.exportFile(ExportFormat.PNG, outFile, false); ok = true; } catch (e2) {} }
      if (!ok) { try { tmp.exportFile(ExportFormat.PNG_TYPE, outFile, false); ok = true; } catch (e3) {} }
    } catch (eExp) { ok = false; }

    try { tmp.close(SaveOptions.NO); } catch (eC2) {}
    try { return ok && outFile.exists; } catch (eEx) { return ok; }
  }

    var images = collectImagesInRange(doc, range);
    log.push("Image candidates (links in CH" + String(chapterNum) + " page range): " + images.length);

    var bestCaptions = buildBestCaptionsByLabel(doc, captionParas);
    var labels = [];
    for (var k in bestCaptions) if (bestCaptions.hasOwnProperty(k)) labels.push(k);
    labels.sort();
    log.push("Unique figure captions by label: " + labels.length);

    var figures = [];
    var missingImageForCaption = 0;
    var missingAnchor = 0;
    var atomicExported = 0;
    var atomicFailed = 0;

    // Figure output directory (book-aware when scriptArgs are provided)
    var FIG_DIR_ABS = LEGACY_MODE
      ? (DEFAULT_FIGURES_DIR_ABS + "/ch" + String(chapterNum))
      : (FIGURES_DIR_ABS + "/" + BOOK_ID + "/ch" + String(chapterNum));
    ensureFolder(FIG_DIR_ABS);

  for (var li2 = 0; li2 < labels.length; li2++) {
    var lbl = labels[li2];
    var cap = bestCaptions[lbl];
    var img2 = findBestImageForCaption(images, cap);
    var fallbackItem = null;
    var imageOut = null;
    var pageNameOut = "";
    var anchorTarget = null;
    var anchorPageOff = cap.pageDocumentOffset;

    if (img2) {
      imageOut = { kind: "link", linkName: img2.linkName, linkPath: img2.linkPath, bounds: img2.bounds };
      pageNameOut = img2.pageName;
      anchorTarget = img2.frame;
      anchorPageOff = img2.pageDocumentOffset;
    } else {
      // No linked image matched; attempt to find a drawn/grouped figure above the caption.
      fallbackItem = findBestNonLinkedItemForCaption(doc, cap, body.index);
      if (!fallbackItem) {
        missingImageForCaption++;
      } else {
        var fbType = "";
        try { fbType = fallbackItem.constructor ? fallbackItem.constructor.name : ""; } catch (eFT) { fbType = ""; }
        var fbBounds = null;
        try { fbBounds = fallbackItem.geometricBounds; } catch (eFB) { fbBounds = null; }
        imageOut = { kind: "pageItem", itemType: fbType, bounds: fbBounds };
        try { pageNameOut = safeStr(doc.pages[cap.pageDocumentOffset].name); } catch (ePN) { pageNameOut = ""; }
        anchorTarget = fallbackItem;
        anchorPageOff = cap.pageDocumentOffset;
      }
    }

    // Decide whether to export an atomic figure asset from InDesign (preserves internal labels and non-linked artwork)
    var asset = null;
    var exportTarget = anchorTarget;
    try {
      if (exportTarget && exportTarget.parent && exportTarget.parent.constructor && exportTarget.parent.constructor.name === "Group") {
        exportTarget = exportTarget.parent;
      }
    } catch (eParG) {}

    var shouldAtomic = false;
    if (imageOut && imageOut.kind === "pageItem") shouldAtomic = true;
    // If linked image is grouped, we likely have overlay labels/lines; export atomic
    try { if (anchorTarget && anchorTarget.parent && anchorTarget.parent.constructor && anchorTarget.parent.constructor.name === "Group") shouldAtomic = true; } catch (eG) {}

    if (shouldAtomic && exportTarget) {
      var stem = safeFileStemFromLabel(cap.label);
      var outAbs = FIG_DIR_ABS + "/" + stem + ".png";
      var outRel = LEGACY_MODE
        ? (FIGURES_DIR_REL + "/ch" + String(chapterNum) + "/" + stem + ".png")
        : (FIGURES_DIR_REL + "/" + BOOK_ID + "/ch" + String(chapterNum) + "/" + stem + ".png");
      var okExp = exportPageItemAsPng(exportTarget, outAbs, 300);
      // Fallback: if exporting the group as a single item fails, try exporting its child page items.
      // This is more robust for complex grouped artwork (tables/diagrams) that doesn't duplicate cleanly as one group.
      if (!okExp) {
        try {
          var kids = null;
          try { kids = exportTarget.allPageItems; } catch (eKids0) { kids = null; }
          if (kids && kids.length) {
            okExp = exportPageItemsAsPng(kids, outAbs, 300);
          }
        } catch (eKids1) { okExp = false; }
      }
      if (okExp) {
        atomicExported++;
        asset = { kind: "png", path: outRel, source: "indesign" };
        // Prefer atomic asset as the renderable image
        imageOut.atomicPath = outRel;
      } else {
        atomicFailed++;
      }
    }

    var anchor = anchorTarget ? nearestAnchorPara(bodyParas, anchorTarget, anchorPageOff) : null;
    if (!anchor) missingAnchor++;

    var beforeTxt = "";
    var afterTxt = "";
    if (anchor) {
      for (var bi = 0; bi < bodyParas.length; bi++) {
        if (bodyParas[bi].i === anchor.i) {
          if (bi > 0) beforeTxt = bodyParas[bi - 1].text;
          if (bi + 1 < bodyParas.length) afterTxt = bodyParas[bi + 1].text;
          break;
        }
      }
    }

    figures.push({
      page: { name: pageNameOut, documentOffset: cap.pageDocumentOffset },
      image: imageOut,
      asset: asset,
      caption: {
        raw: cap.raw,
        label: cap.label,
        body: cap.body,
        styleName: cap.styleName,
        bounds: null
      },
      anchor: anchor ? {
        paragraphIndexInBodyStory: anchor.i,
        pageDocumentOffset: anchor.pageOff,
        x: anchor.x,
        y: anchor.y,
        text: anchor.text,
        beforeText: beforeTxt,
        afterText: afterTxt
      } : null
    });
  }

    var manifest = {
      exportedAt: (new Date()).toISOString ? (new Date()).toISOString() : String(new Date()),
      sourceIndd: INDD.fsName,
      chapter: String(chapterNum),
      chapterRange: range,
      bodyStory: body,
      figures: figures
    };

    log.push("Figures (caption-driven): " + figures.length);
    log.push("Missing image for caption: " + missingImageForCaption);
    log.push("Missing anchor: " + missingAnchor);
    log.push("Atomic exports: ok=" + atomicExported + " failed=" + atomicFailed);

    var json = jsonStringify(manifest, 2, 0);
    var ok = writeTextToPath(OUT_JSON, json);
    log.push("");
    log.push("Wrote JSON: " + String(ok));

    writeTextToDesktop(REPORT_NAME, log.join("\n"));

    if (!ok) {
      failures.push("CH" + String(chapterNum) + ": failed to write JSON (" + OUT_JSON + ")");
      continue;
    }
    successes.push(OUT_JSON);
  }

  // Finalize
  try { doc.close(SaveOptions.NO); } catch (eCloseAll) {}
  logAll.push("");
  logAll.push("Chapters exported OK: " + String(successes.length));
  logAll.push("Chapters failed: " + String(failures.length));
  for (var fi = 0; fi < failures.length; fi++) logAll.push("FAIL: " + failures[fi]);
  writeTextToDesktop(REPORT_ALL, logAll.join("\n"));

  if (failures.length > 0) {
    "ERROR: Some chapters failed to export";
    restoreUI();
    return;
  }
  restoreUI();
  REPORT_ALL;
})();


