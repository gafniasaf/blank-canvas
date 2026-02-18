// ============================================================
// SAFE REWRITE PIPELINE v5 (START FROM ORIGINAL LAYOUT)
// ============================================================
// Purpose:
// - Open the ORIGINAL book InDesign file.
// - Replace only MAIN-STORY paragraphs using rewrites_for_indesign.json
// - SKIP label/callout frames (small standalone frames near figures, grouped labels, etc.)
// - Preserve anchored objects (\uFFFC) and caption numbering prefixes
// - Optionally fix bold markers and bullet lists
//
// Output:
// - Saves to ~/Desktop/Generated_Books/<docName>_REWRITTEN_V5_SAFE.indd (or next version)
// - Writes logs:
//   - ~/Desktop/rewrite_v5_safe_summary.txt
//   - ~/Desktop/rewrite_v5_safe_replaced.tsv
//
// Run from InDesign Scripts panel (avoid AppleEvents timeouts).
// ============================================================

#targetengine "session"

(function () {
  if (app.documents.length === 0) {
    alert("Open the ORIGINAL InDesign document first.");
    return;
  }

  var doc = app.activeDocument;
  var startTime = new Date().getTime();
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (eUI0) { oldUI = null; }
  // Avoid prompts (missing fonts, etc.) from blocking the pipeline.
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI1) {}

  // ----------------------------
  // Config
  // ----------------------------
  // Defaults (can be overridden by wrappers via app.scriptArgs):
  // - BIC_REWRITES_JSON_PATH: absolute path to the JSON to apply
  // - BIC_OUTPUT_FOLDER: absolute path to the folder where output INDD is written
  var REWRITES_JSON = File(Folder.desktop + "/rewrites_for_indesign.json");
  var OUTPUT_FOLDER = new Folder(Folder.desktop + "/Generated_Books");
  try {
    if (app && app.scriptArgs) {
      var p = null;
      try { p = app.scriptArgs.getValue("BIC_REWRITES_JSON_PATH"); } catch (eP) { p = null; }
      if (p !== null && p !== undefined && String(p) !== "") {
        REWRITES_JSON = File(String(p));
      }
      var od = null;
      try { od = app.scriptArgs.getValue("BIC_OUTPUT_FOLDER"); } catch (eO) { od = null; }
      if (od !== null && od !== undefined && String(od) !== "") {
        OUTPUT_FOLDER = new Folder(String(od));
      }
    }
  } catch (eArgs) {}

  // Story eligibility heuristics (tuned to avoid labels/callouts)
  var MIN_STORY_WORDS = 25;
  // Allow shorter paragraphs to be considered for matching (some valid body paras are short).
  // Safety: label/caption frames are still excluded; matching requires exact/legacy/fuzzy constraints.
  var MIN_PARA_CHARS = 10;
  // Allow shorter bullet paragraphs to be rewritten (needed for short bullet items like "vitamine B1.").
  // Safety: still uses exact/legacy/fuzzy matching inside chapter scope; labels/captions are skipped separately.
  // Bullets can be extremely short (e.g., "vitamine B1"), so we keep this very low.
  var MIN_BULLET_PARA_CHARS = 3;
  // Hard rule in this project: fuzzy matches are forbidden (they can silently misplace content).
  // Keep this OFF by default. If you ever enable it for debugging, the applied-rewrites gate will hard-fail.
  var ENABLE_FUZZY = false;
  try {
    if (app && app.scriptArgs) {
      var af = null;
      try { af = app.scriptArgs.getValue("BIC_ALLOW_FUZZY"); } catch (eAF) { af = null; }
      if (af !== null && af !== undefined && String(af) !== "") {
        var sAf = String(af).toLowerCase();
        ENABLE_FUZZY = (sAf === "1" || sAf === "true" || sAf === "yes");
      }
    }
  } catch (eFz) {}
  var MIN_SINGLE_FRAME_AREA = 20000;  // points^2
  var MIN_SINGLE_FRAME_W = 180;       // points
  var MIN_SINGLE_FRAME_H = 80;        // points
  var MAX_ROTATION_ABS = 1.0;         // degrees; label frames often rotated

  // Skip tiny standalone frames (labels)
  var MAX_LABEL_FRAME_W = 700;
  var MAX_LABEL_FRAME_H = 420;
  var MAX_LABEL_PARA_CHARS = 300;

  // ----------------------------
  // Helpers
  // ----------------------------
  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }
  function trimmed(s) {
    s = s || "";
    try { s = s.replace(/\s+/g, " "); } catch (e0) {}
    try { s = s.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return s;
  }
  function safeName(name) {
    return (name || "")
      .replace(/\.indd$/i, "")
      .replace(/[^a-z0-9 _-]/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }
  function gb(o) { try { return o.geometricBounds; } catch (e0) { return null; } }
  function w(b) { return b ? Math.abs(b[3] - b[1]) : 0; }
  function h(b) { return b ? Math.abs(b[2] - b[0]) : 0; }
  function area(b) { return b ? Math.abs((b[2] - b[0]) * (b[3] - b[1])) : 0; }

  function withPoints(doc, fn) {
    var vp = null, oh = null, ov = null;
    try {
      vp = doc.viewPreferences;
      oh = vp.horizontalMeasurementUnits;
      ov = vp.verticalMeasurementUnits;
      vp.horizontalMeasurementUnits = MeasurementUnits.POINTS;
      vp.verticalMeasurementUnits = MeasurementUnits.POINTS;
    } catch (e0) {}
    var res = null;
    try { res = fn(); } catch (e1) { throw e1; }
    try {
      if (vp && oh !== null) vp.horizontalMeasurementUnits = oh;
      if (vp && ov !== null) vp.verticalMeasurementUnits = ov;
    } catch (e2) {}
    return res;
  }

  function isCaptionText(text) {
    return /^(Afbeelding|Figuur|Tabel|Schema)\s+\d+/i.test(text || "");
  }

  function isBulletParagraph(para) {
    try {
      var sn = "";
      try { sn = (para && para.appliedParagraphStyle) ? String(para.appliedParagraphStyle.name || "") : ""; } catch (e0) { sn = ""; }
      sn = sn.toLowerCase();
      if (sn.indexOf("_bullets") !== -1) return true;
      if (sn.indexOf("bullet") !== -1) return true;
    } catch (e1) {}
    // Fallback: leading bullet char in text content (rare in this template, but safe).
    try {
      var t = "";
      try { t = String(para.contents || ""); } catch (e2) { t = ""; }
      if (t && t.length && t.charAt(0) === "\u2022") return true;
    } catch (e3) {}
    return false;
  }

  function isChapterHeaderStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("chapter header") !== -1 || s.indexOf("hoofdstuk") !== -1;
  }

  function isBulletStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("_bullets") !== -1 || s.indexOf("bullet") !== -1;
  }

  function splitSemicolonItems(text) {
    var s = "";
    try { s = String(text || ""); } catch (e0) { s = ""; }
    var raw = [];
    try { raw = s.split(";"); } catch (e1) { raw = []; }
    var items = [];
    var endsWithSemi = false;
    try { endsWithSemi = (s.length > 0 && s.charAt(s.length - 1) === ";"); } catch (e2) { endsWithSemi = false; }
    for (var i = 0; i < raw.length; i++) {
      var part = "";
      try { part = trimmed(raw[i]); } catch (e3) { part = ""; }
      if (!part) continue;
      // Re-attach delimiter for all but the last logical item.
      if (i < raw.length - 1) items.push(part + ";");
      else items.push(endsWithSemi ? (part + ";") : part);
    }
    return items;
  }

  // --- GREP helpers (for marker page offsets) ---
  function resetFindPrefs() {
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
    try { app.changeTextPreferences = NothingEnum.nothing; } catch (e2) {}
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e3) {}
    try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e4) {}
  }
  function setFindCaseInsensitive() {
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e0) {}
    try { app.findChangeTextOptions.caseSensitive = false; } catch (e1) {}
    // Be explicit about including all content types; prior scripts can change these globals.
    try { app.findChangeGrepOptions.includeFootnotes = true; } catch (e2) {}
    try { app.findChangeGrepOptions.includeHiddenLayers = true; } catch (e3) {}
    try { app.findChangeGrepOptions.includeLockedLayersForFind = true; } catch (e4) {}
    try { app.findChangeGrepOptions.includeLockedStoriesForFind = true; } catch (e5) {}
    try { app.findChangeGrepOptions.includeMasterPages = true; } catch (e6) {}
    try { app.findChangeTextOptions.includeFootnotes = true; } catch (e7) {}
    try { app.findChangeTextOptions.includeHiddenLayers = true; } catch (e8) {}
    try { app.findChangeTextOptions.includeLockedLayersForFind = true; } catch (e9) {}
    try { app.findChangeTextOptions.includeLockedStoriesForFind = true; } catch (e10) {}
    try { app.findChangeTextOptions.includeMasterPages = true; } catch (e11) {}
  }
  function findGrepDoc(doc, pat) {
    resetFindPrefs();
    setFindCaseInsensitive();
    app.findGrepPreferences.findWhat = pat;
    var res = [];
    try { res = doc.findGrep(); } catch (e) { res = []; }
    resetFindPrefs();
    return res;
  }
  function pageOfTextObj(textObj) {
    try {
      var tf = textObj.parentTextFrames[0];
      if (tf && tf.parentPage) return tf.parentPage;
    } catch (e) {}
    return null;
  }
  function markerPageOffset(doc, markerRe) {
    // markerRe is a GREP string, e.g. "^1\\.1"
    var f = findGrepDoc(doc, markerRe);
    if (!f || !f.length) return -1;
    for (var i = 0; i < f.length; i++) {
      var pg = pageOfTextObj(f[i]);
      if (!pg) continue;
      var off = -1;
      try { off = pg.documentOffset; } catch (e0) { off = -1; }
      if (off < 0) continue;
      // Return the first match that resolves to a real page.
      // This matches InDesign's internal story-ordering (and avoids jumping to TOC/front-matter matches).
      return off;
    }
    return -1;
  }

  function markerPageOffsetNearestBefore(doc, markerRe, beforeOff, lookbackPages) {
    // Find the closest marker match at or before beforeOff (within lookbackPages).
    // This is used to capture unnumbered chapter-intro pages like "2 De huid" that appear
    // shortly BEFORE the first numbered subchapter marker "2.1 ...".
    if (beforeOff === null || beforeOff === undefined) return -1;
    if (beforeOff < 0) return -1;
    var lb = (lookbackPages !== null && lookbackPages !== undefined) ? lookbackPages : 8;
    if (lb < 1) lb = 1;
    var minOff = beforeOff - lb;
    if (minOff < 0) minOff = 0;
    var best = -1;
    var f = findGrepDoc(doc, markerRe);
    if (!f || !f.length) return -1;
    for (var i = 0; i < f.length; i++) {
      var pg = pageOfTextObj(f[i]);
      if (!pg) continue;
      var off = -1;
      try { off = pg.documentOffset; } catch (eOff) { off = -1; }
      if (off < 0) continue;
      if (off < minOff || off > beforeOff) continue;
      if (off > best) best = off;
    }
    return best;
  }

  function storyWordCountInPageRange(story, startOff, endOff) {
    var wc = 0;
    if (!story) return 0;
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = pageOffsetForPara(para);
      if (off < 0) continue;
      if (off < startOff || off > endOff) continue;
      try { wc += para.words.length; } catch (eW) {}
    }
    return wc;
  }

  // Clean text: remove <?ACE ?> tags, object placeholders, and normalize whitespace.
  function cleanText(text) {
    if (!text) return "";
    try { text = text.replace(/<\?ACE\s*\d*\s*\?>/gi, ""); } catch (e0) {}
    // Remove control characters that often appear in exported text (e.g. "\u0007" shows as "" in InDesign),
    // and soft hyphens, to make matching stable across IDML/InDD variants.
    try { text = text.replace(/[\u0000-\u001F\u007F]/g, " "); } catch (eCtl) {}
    try { text = text.replace(/\u00AD/g, ""); } catch (eShy) {}
    // Remove bold markers
    try { text = text.replace(/<<BOLD_START>>/g, ""); } catch (e1) {}
    try { text = text.replace(/<<BOLD_END>>/g, ""); } catch (e2) {}
    // Remove special object placeholder character (anchored object marker)
    try { text = text.replace(/\uFFFC/g, ""); } catch (e3) {}
    try { text = text.replace(/\s+/g, " "); } catch (e4) {}
    try { text = text.replace(/^\s+|\s+$/g, ""); } catch (e5) {}
    return text;
  }

  function cleanTextKeepMarkers(text) {
    if (!text) return "";
    try { text = text.replace(/<\?ACE\s*\d*\s*\?>/gi, ""); } catch (e0) {}
    // IMPORTANT: keep \n (forced line breaks) intact. Remove other control chars only (e.g. "\u0007").
    // Do NOT remove \n here, otherwise Option-A "\n\nIn de praktijk:" structure is destroyed.
    try { text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " "); } catch (eCtl) {}
    try { text = text.replace(/\u00AD/g, ""); } catch (eShy) {}
    try { text = text.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return text;
  }

  // Normalize FULL paragraph into a stable matching payload
  function normalizeFull(text) {
    if (!text) return "";
    var s = text.toLowerCase();
    // remove paragraph returns/tabs
    try { s = s.replace(/[\r\n\t]/g, " "); } catch (e0) {}
    // Fold common diacritics so minor accent differences (e.g. "één" vs "een") don't break matching.
    try { s = s.replace(/[àáâãäå]/g, "a"); } catch (eD1) {}
    try { s = s.replace(/æ/g, "ae"); } catch (eD2) {}
    try { s = s.replace(/ç/g, "c"); } catch (eD3) {}
    try { s = s.replace(/[èéêë]/g, "e"); } catch (eD4) {}
    try { s = s.replace(/[ìíîï]/g, "i"); } catch (eD5) {}
    try { s = s.replace(/ñ/g, "n"); } catch (eD6) {}
    try { s = s.replace(/[òóôõöø]/g, "o"); } catch (eD7) {}
    try { s = s.replace(/œ/g, "oe"); } catch (eD8) {}
    try { s = s.replace(/[ùúûü]/g, "u"); } catch (eD9) {}
    try { s = s.replace(/[ýÿ]/g, "y"); } catch (eD10) {}
    try { s = s.replace(/ß/g, "ss"); } catch (eD11) {}
    // Replace punctuation with spaces (NOT empty string) to avoid false mismatches:
    // - In DB exports we sometimes encode bullet/list separators with ";".
    // - In InDesign those separators may be spaces/line breaks/bullets.
    // If we delete punctuation outright, words can get glued (e.g., "celkern;eukaryoten" -> "celkerneukaryoten").
    // Replacing with space keeps word boundaries stable across sources.
    try { s = s.replace(/[^a-z0-9\s]/g, " "); } catch (e1) {}
    // collapse whitespace
    try { s = s.replace(/\s+/g, " "); } catch (e2) {}
    try { s = s.replace(/^\s+|\s+$/g, ""); } catch (e3) {}
    return s;
  }

  // Simple FNV-1a 32-bit hash
  function fnv1a32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // h *= 16777619 (with 32-bit overflow)
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    // 8 hex
    var hex = (h >>> 0).toString(16);
    return ("00000000" + hex).slice(-8);
  }

  function buildKey(originalParagraphText) {
    var n = normalizeFull(cleanText(originalParagraphText));
    if (!n) return "";
    // Include length to reduce rare hash collisions further
    return String(n.length) + ":" + fnv1a32(n);
  }

  function isLikelyMainStory(story) {
    try {
      if (!story) return false;
      if (story.words && story.words.length < MIN_STORY_WORDS) return false;
      var containers = story.textContainers;
      if (!containers || containers.length === 0) return false;
      // Threaded story => almost always main text (labels are usually single-frame stories)
      if (containers.length > 1) return true;

      // Single text frame story: allow only if it's a reasonably large frame and not rotated
      var tf = containers[0];
      if (ctorName(tf) !== "TextFrame") return false;
      var b = gb(tf);
      if (!b) return false;
      var ww = w(b), hh = h(b), aa = area(b);
      if (aa < MIN_SINGLE_FRAME_AREA) return false;
      if (ww < MIN_SINGLE_FRAME_W || hh < MIN_SINGLE_FRAME_H) return false;
      var rot = 0;
      try { rot = tf.rotationAngle; } catch (e0) { rot = 0; }
      if (Math.abs(rot) > MAX_ROTATION_ABS) return false;
      return true;
    } catch (eTop) {
      return false;
    }
  }

  function isLikelyLabelParagraph(para) {
    // Extra guard: even inside eligible stories, skip paragraphs that look like label/callout text frames
    try {
      if (!para || !para.parentTextFrames || para.parentTextFrames.length === 0) return false;
      var tf = para.parentTextFrames[0];
      if (ctorName(tf) !== "TextFrame") return false;
      // If the story is a single tiny frame, we should have skipped at story level,
      // but this adds protection for edge cases.
      var b = gb(tf);
      if (!b) return false;
      if (w(b) <= MAX_LABEL_FRAME_W && h(b) <= MAX_LABEL_FRAME_H) {
        var t = "";
        try { t = trimmed(para.contents || ""); } catch (e0) { t = ""; }
        if (!t) return false;
        if (isCaptionText(t)) return false;

        // IMPORTANT:
        // Some legitimate main-story content is placed in small frames (e.g. boxed bullets/sidebars),
        // and uses normal body styles (_Bullets / Basis). We MUST NOT treat those as "labels".
        //
        // True figure labels are usually VERY short (single words/letters) even if mis-styled.
        // So for body-ish styles, only skip when the text is extremely short.
        var styleName = "";
        try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
        var sLow = String(styleName || "").toLowerCase();
        var isBodyish =
          (sLow.indexOf("basis") !== -1) ||
          (sLow.indexOf("_bullets") !== -1) ||
          (sLow.indexOf("bullet") !== -1);

        if (isBodyish) {
          // Keep safety for truly label-like fragments, but allow real prose/bullets.
          if (t.length <= 40) return true;
          return false;
        }

        if (t.length <= MAX_LABEL_PARA_CHARS) {
          // If it's short and not a caption, treat as label-ish.
          return true;
        }
      }
    } catch (e1) {}
    return false;
  }

  function containsAnchoredObjects(text) {
    if (!text) return false;
    return text.indexOf("\uFFFC") !== -1;
  }

  function preserveNumberedCaptionPrefix(originalText, rewriteText) {
    if (!originalText || !rewriteText) return rewriteText;
    var m = originalText.match(/^(Afbeelding|Figuur|Tabel|Schema)\s+\d+\s*[\.,]\s*\d+/i);
    if (!m) return rewriteText;
    var prefix = m[0].replace(/\s+/g, " ").replace(/\s*([\.,])\s*/g, "$1").trim();
    var stripped = rewriteText.replace(/^\s*(Afbeelding|Figuur|Tabel|Schema)(\s+\d+\s*[\.,\-]?\s*\d+)?\s*/i, "");
    stripped = stripped.replace(/^\s*[:\-]\s*/g, "");
    stripped = stripped.replace(/^\s+|\s+$/g, "");
    var normRewriteStart = rewriteText.replace(/\s+/g, " ").replace(/\s*([\.,])\s*/g, "$1").trim();
    if (normRewriteStart.toLowerCase().indexOf(prefix.toLowerCase()) === 0) return rewriteText;
    if (!stripped) {
      var origSuffix = originalText.replace(m[0], "").replace(/^\s*[:\-]\s*/g, "").replace(/^\s+|\s+$/g, "");
      stripped = origSuffix;
    }
    return prefix + (stripped ? (" " + stripped) : "");
  }

  // Replace text inside a paragraph while preserving anchored object characters (\uFFFC).
  // Same approach as v4, but returns boolean and never falls back to para.contents (which can delete anchors).
  function replaceParagraphTextPreservingAnchors(para, newText) {
    if (!para) return false;
    if (newText === undefined || newText === null) newText = "";

    // IMPORTANT:
    // When a paragraph contains anchored objects, splitting the entire rewrite text proportionally can corrupt:
    // - the Option A layer blocks ("\n\n<<BOLD_START>>In de praktijk:<<BOLD_END>> ...")
    // - spacing around sentence punctuation (missing spaces)
    // So we keep any layer-block tail intact and append it *after* anchor-safe replacement of the base text.
    var baseText = String(newText);
    var addonText = "";
    try {
      var iPr = baseText.indexOf("\n\n<<BOLD_START>>In de praktijk:<<BOLD_END>>");
      var iVe = baseText.indexOf("\n\n<<BOLD_START>>Verdieping:<<BOLD_END>>");
      var iBg = baseText.indexOf("\n\n<<BOLD_START>>Achtergrond:<<BOLD_END>>");
      var cut = -1;
      if (iPr >= 0) cut = iPr;
      if (iVe >= 0 && (cut < 0 || iVe < cut)) cut = iVe;
      if (iBg >= 0 && (cut < 0 || iBg < cut)) cut = iBg;
      if (cut >= 0) {
        addonText = baseText.substring(cut);
        baseText = baseText.substring(0, cut);
      }
    } catch (eAdd0) {}

    var chars = para.characters;
    var len = chars.length;
    if (len === 0) {
      try { para.contents = newText; } catch (e0) { return false; }
      return true;
    }

    var endIdx = len - 1;
    try { if (chars[endIdx].contents === "\r") endIdx = len - 2; } catch (e1) {}
    if (endIdx < 0) endIdx = len - 1;

    var anchorIdxs = [];
    for (var i = 0; i <= endIdx; i++) {
      try { if (chars[i].contents === "\uFFFC") anchorIdxs.push(i); } catch (e2) {}
    }
    if (anchorIdxs.length === 0) {
      try { para.contents = newText; } catch (e3) { return false; }
      return true;
    }

    var segments = [];
    var cursor = 0;
    for (var a = 0; a < anchorIdxs.length; a++) {
      var idx = anchorIdxs[a];
      segments.push({ start: cursor, end: idx - 1 });
      cursor = idx + 1;
    }
    segments.push({ start: cursor, end: endIdx });

    var origLens = [];
    var totalOrig = 0;
    for (var s = 0; s < segments.length; s++) {
      var segLen = 0;
      if (segments[s].start <= segments[s].end) segLen = (segments[s].end - segments[s].start + 1);
      origLens.push(segLen);
      totalOrig += segLen;
    }
    if (totalOrig <= 0) totalOrig = 1;

    var totalNew = baseText.length;
    var newParts = [];
    var used = 0;
    for (var p = 0; p < segments.length; p++) {
      var isLast = (p === segments.length - 1);
      var take = isLast
        ? (totalNew - used)
        : Math.round(totalNew * (origLens[p] / totalOrig));
      if (take < 0) take = 0;
      if (used + take > totalNew) take = totalNew - used;

      var end = used + take;
      if (!isLast) {
        // Adjust cut to a nearby whitespace boundary to avoid splitting inside words/punctuation.
        // Prefer forward to keep ordering stable, then backward as fallback.
        var maxSearch = 40;
        var best = end;
        var found = false;
        for (var step = 0; step <= maxSearch; step++) {
          var pos = end + step;
          if (pos >= totalNew) break;
          var ch = baseText.charAt(pos);
          if (ch === " " || ch === "\n" || ch === "\t") {
            best = Math.min(totalNew, pos + 1); // include whitespace in previous part
            found = true;
            break;
          }
        }
        if (!found) {
          for (var step2 = 0; step2 <= maxSearch; step2++) {
            var pos2 = end - step2;
            if (pos2 <= used) break;
            var ch2 = baseText.charAt(pos2);
            if (ch2 === " " || ch2 === "\n" || ch2 === "\t") {
              best = Math.min(totalNew, pos2 + 1);
              break;
            }
          }
        }
        if (best > used) end = best;
      } else {
        end = totalNew;
      }

      newParts.push(baseText.substring(used, end));
      used = end;
    }

    for (var r = segments.length - 1; r >= 0; r--) {
      var seg = segments[r];
      var part = newParts[r] || "";
      if (seg.start <= seg.end) {
        try {
          chars.itemByRange(seg.start, seg.end).contents = part;
        } catch (e4) {
          return false;
        }
      } else {
        try {
          var ipIndex = seg.start;
          if (ipIndex < 0) ipIndex = 0;
          if (ipIndex > para.insertionPoints.length - 1) ipIndex = para.insertionPoints.length - 1;
          para.insertionPoints[ipIndex].contents = part;
        } catch (e5) {}
      }
    }

    // Append any layer-block tail intact at the end (before the paragraph return).
    if (addonText && addonText.length) {
      try {
        var chars2 = para.characters;
        var len2 = chars2.length;
        if (len2 > 0) {
          var insertAt = len2 - 1;
          try { if (chars2[insertAt].contents !== "\r") insertAt = len2; } catch (eX) { insertAt = len2 - 1; }
          var ipIndex = insertAt;
          if (ipIndex < 0) ipIndex = 0;
          if (ipIndex > para.insertionPoints.length - 1) ipIndex = para.insertionPoints.length - 1;
          para.insertionPoints[ipIndex].contents = addonText;
        } else {
          // Fallback: paragraph became empty somehow
          para.contents = baseText + addonText;
        }
      } catch (eAdd1) {}
    }

    return true;
  }

  function applyBoldFormatting(doc) {
    var count = 0;
    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = "<<BOLD_START>>In de praktijk:<<BOLD_END>>";
      app.changeTextPreferences.changeTo = "In de praktijk:";
      app.changeTextPreferences.fontStyle = "Bold";
      var found1 = doc.changeText();
      count += found1.length;
    } catch (e0) {}

    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = "<<BOLD_START>>Verdieping:<<BOLD_END>>";
      app.changeTextPreferences.changeTo = "Verdieping:";
      app.changeTextPreferences.fontStyle = "Bold";
      var foundV = doc.changeText();
      count += foundV.length;
    } catch (eV) {}

    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = "<<BOLD_START>>Achtergrond:<<BOLD_END>>";
      app.changeTextPreferences.changeTo = "Achtergrond:";
      app.changeTextPreferences.fontStyle = "Bold";
      var found2 = doc.changeText();
      count += found2.length;
    } catch (e1) {}

    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
    } catch (e2) {}
    return count;
  }

  function fixBulletLists(doc) {
    var count = 0;
    var bulletChar = "\u2022";

    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = "- **";
      app.changeTextPreferences.changeTo = bulletChar + " ";
      var found1 = doc.changeText();
      count += found1.length;
    } catch (e0) {}

    try {
      app.findGrepPreferences = NothingEnum.nothing;
      app.changeGrepPreferences = NothingEnum.nothing;
      app.findGrepPreferences.findWhat = "\\r- ";
      app.changeGrepPreferences.changeTo = "\\r" + bulletChar + " ";
      var found2 = doc.changeGrep();
      count += found2.length;
    } catch (e1) {}

    // Remove leftover bold markers ** (only if present)
    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = "**";
      app.changeTextPreferences.changeTo = "";
      doc.changeText();
    } catch (e2) {}

    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findGrepPreferences = NothingEnum.nothing;
      app.changeGrepPreferences = NothingEnum.nothing;
    } catch (e3) {}

    return count;
  }

  function applyJustificationRules(doc) {
    // Enforce:
    // - All body-story paragraphs in CH1: LEFT_JUSTIFIED (justify with last line aligned left)
    //   (User request: follow original book layout; avoid ragged-right paragraphs.)
    // - singleWordJustification: LEFT_ALIGN (best effort)
    // Safety:
    // - Only on eligible stories (same heuristics as replacement)
    // - Skip label-ish paragraphs and captions
    var stats = {
      paras_considered: 0,
      paras_layer_left_align: 0,
      paras_body_left_justified: 0,
      paras_single_word_left: 0,
      paras_skipped_labelish: 0,
      paras_skipped_caption: 0,
      errors: 0
    };

    withPoints(doc, function () {
      var sStart = 0;
      var sEnd = doc.stories.length;
      // If we have a chapter_filter scope, DO NOT touch other chapters.
      try {
        if (chapterScope) {
          sStart = chapterScope.storyIndex;
          sEnd = chapterScope.storyIndex + 1;
        }
      } catch (eScope0) {}

      for (var s = sStart; s < sEnd; s++) {
        var story = doc.stories[s];
        if (!isLikelyMainStory(story)) continue;

        var pStart = 0;
        var pEnd = story.paragraphs.length;
        try {
          if (chapterScope && s === chapterScope.storyIndex) {
            pStart = chapterScope.paraStart;
            pEnd = chapterScope.paraEnd;
          }
        } catch (eScope1) {}

        for (var p = pStart; p < pEnd; p++) {
          var para = story.paragraphs[p];
          var txt = "";
          try { txt = trimmed(para.contents || ""); } catch (eT) { txt = ""; }
          if (!txt || txt.length < MIN_PARA_CHARS) continue;

          if (isLikelyLabelParagraph(para)) { stats.paras_skipped_labelish++; continue; }
          if (isCaptionText(txt)) { stats.paras_skipped_caption++; continue; }

          stats.paras_considered++;

          try {
            if (para.justification !== Justification.LEFT_JUSTIFIED) {
              para.justification = Justification.LEFT_JUSTIFIED;
              stats.paras_body_left_justified++;
            }
          } catch (eJ) { stats.errors++; }
        }
      }
    });

    // Ensure single-word justification is LEFT_ALIGN even for short paragraphs we skipped above.
    withPoints(doc, function () {
      function setSwjLeftAlign(para) {
        if (!para || !para.isValid) return false;
        // Try direct assignment first.
        try { para.singleWordJustification = Justification.LEFT_ALIGN; return true; } catch (e0) {}
        // Some objects reject direct assignment; try via properties.
        try { para.properties = { singleWordJustification: Justification.LEFT_ALIGN }; return true; } catch (e1) {}
        // Last resort: set on the applied paragraph style (aligns with original book defaults).
        try {
          var ps = para.appliedParagraphStyle;
          if (ps && ps.isValid) { ps.singleWordJustification = Justification.LEFT_ALIGN; return true; }
        } catch (e2) {}
        return false;
      }

      var sStart = 0;
      var sEnd = doc.stories.length;
      try {
        if (chapterScope) { sStart = chapterScope.storyIndex; sEnd = chapterScope.storyIndex + 1; }
      } catch (eScope0) {}

      for (var s2 = sStart; s2 < sEnd; s2++) {
        var story2 = doc.stories[s2];
        if (!isLikelyMainStory(story2)) continue;

        var pStart2 = 0;
        var pEnd2 = story2.paragraphs.length;
        var startOff = -1;
        var endOff = -1;
        try {
          if (chapterScope && s2 === chapterScope.storyIndex) {
            // Prefer page-offset scoping (more robust than paragraph-index scoping).
            startOff = (chapterScope.startOff !== undefined && chapterScope.startOff !== null) ? chapterScope.startOff : -1;
            endOff = (chapterScope.endOff !== undefined && chapterScope.endOff !== null) ? chapterScope.endOff : -1;
            // Still keep paraStart/paraEnd as a hint for performance, but do not rely on it for correctness.
            pStart2 = 0;
            pEnd2 = story2.paragraphs.length;
          }
        } catch (eScope1) {}

        for (var p2 = pStart2; p2 < pEnd2; p2++) {
          var para2 = story2.paragraphs[p2];
          if (!para2 || !para2.isValid) continue;
          // Chapter-filter safety: only touch paragraphs that actually live on CH1 pages.
          if (startOff >= 0 && endOff >= 0) {
            var off2 = -1;
            try { off2 = pageOffsetForPara(para2); } catch (eOff2) { off2 = -1; }
            if (off2 < startOff || off2 > endOff) continue;
          }
          if (setSwjLeftAlign(para2)) stats.paras_single_word_left++;
        }
      }
    });

    return stats;
  }

  function validateChapterBoundaryPages(doc) {
    // CHAPTER boundary validation is only meaningful when we are intentionally running a chapter-scoped apply.
    // (Otherwise, whole-book templates often have intentional master-thread frames and this would be noisy.)
    var result = { chapters_found: 0, chapters: [], failures: [] };
    if (!(chapterFilterNum > 0)) return result;

    // Ensure we have a scope + body story.
    var scope = chapterScope;
    if (!scope) {
      try { scope = findChapterScope(doc, chapterFilterNum); } catch (eS0) { scope = null; }
    }
    if (!scope) return result;
    var bodyStory = null;
    try { bodyStory = doc.stories[scope.storyIndex]; } catch (eBS) { bodyStory = null; }
    if (!bodyStory) return result;

    function pageHasAnyGraphics(pageOffset) {
      if (pageOffset < 0 || pageOffset >= doc.pages.length) return false;
      var pg = doc.pages[pageOffset];
      if (!pg || !pg.isValid) return false;
      // Include master items via allPageItems.
      try {
        var items = pg.allPageItems;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it || !it.isValid) continue;
          try { if (it.allGraphics && it.allGraphics.length > 0) return true; } catch (eG) {}
        }
      } catch (eAll) {}
      return false;
    }

    // Marker offsets: use the first numbered section as anchor, then expand to include intro pages.
    var ch = String(chapterFilterNum);
    var chNext = String(chapterFilterNum + 1);
    var startNumberedOff = markerPageOffset(doc, "^" + ch + "\\.1");
    if (startNumberedOff < 0) startNumberedOff = scope.startOff;
    var startIntroOff = markerPageOffsetNearestBefore(doc, "^" + ch + "(?:\\.|\\b)", startNumberedOff, 8);
    var chStartOff = (startIntroOff >= 0) ? startIntroOff : startNumberedOff;

    var nextNumberedOff = markerPageOffset(doc, "^" + chNext + "\\.1");
    var nextIntroOff = (nextNumberedOff >= 0) ? markerPageOffsetNearestBefore(doc, "^" + chNext + "(?:\\.|\\b)", nextNumberedOff, 10) : -1;
    var nextStartOff = (nextIntroOff >= 0) ? nextIntroOff : nextNumberedOff;

    // Start image page: nearest graphic page before the first TEXT marker that has 0 body-story words.
    var startImageOff = -1;
    for (var po = startNumberedOff - 1; po >= 0 && po >= startNumberedOff - 12; po--) {
      if (!pageHasAnyGraphics(po)) continue;
      if (countStoryWordsOnPage(doc, bodyStory, po) === 0) { startImageOff = po; break; }
    }
    if (startImageOff < 0) startImageOff = startNumberedOff - 1;

    // Blank end page for this chapter: page immediately before the next chapter intro page (if present).
    var blankEndOff = (nextStartOff >= 0) ? (nextStartOff - 1) : -1;

    var startImageWords = countStoryWordsOnPage(doc, bodyStory, startImageOff);
    var blankEndWords = countStoryWordsOnPage(doc, bodyStory, blankEndOff);
    var nextStartWords = countStoryWordsOnPage(doc, bodyStory, nextStartOff);

    result.chapters_found = 1;
    result.chapters.push({
      chapter: ch,
      markerPageOffset: chStartOff,
      startImagePageOffset: startImageOff,
      blankEndPageOffset: blankEndOff,
      nextChapterStartPageOffset: nextStartOff,
      startImageWords: startImageWords,
      blankEndWords: blankEndWords,
      nextStartWords: nextStartWords
    });

    if (startImageOff >= 0 && startImageWords > 0) {
      result.failures.push("Chapter " + ch + " start image page has BODY-STORY words: pageOff=" + startImageOff + " words=" + startImageWords);
    }
    if (blankEndOff >= 0 && blankEndWords > 0) {
      result.failures.push("Chapter " + ch + " end blank page has BODY-STORY words: pageOff=" + blankEndOff + " words=" + blankEndWords);
    }
    if (nextStartOff >= 0 && nextStartWords > 0) {
      result.failures.push("Next chapter start image/intro page has BODY-STORY words: pageOff=" + nextStartOff + " words=" + nextStartWords);
    }

    return result;
  }

  function countStoryWordsOnPage(doc, story, pageOffset) {
    if (!story) return 0;
    if (pageOffset < 0) return 0;
    if (pageOffset >= doc.pages.length) return 0;
    var pg = doc.pages[pageOffset];
    if (!pg || !pg.isValid) return 0;
    var words = 0;
    try {
      var tfs = pg.textFrames;
      for (var i = 0; i < tfs.length; i++) {
        var tf = tfs[i];
        if (!tf || !tf.isValid) continue;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (!st || st !== story) continue;
        try { words += tf.words.length; } catch (eW) {}
      }
    } catch (e0) {}
    return words;
  }

  function removeStoryTextFramesFromPage(doc, story, pageOffset) {
    if (!story) return 0;
    if (pageOffset < 0) return 0;
    if (pageOffset >= doc.pages.length) return 0;
    var pg = doc.pages[pageOffset];
    if (!pg || !pg.isValid) return 0;
    var removed = 0;
    try {
      // Remove in reverse so indices don't shift.
      var tfs = pg.textFrames;
      for (var i = tfs.length - 1; i >= 0; i--) {
        var tf = tfs[i];
        if (!tf || !tf.isValid) continue;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (!st || st !== story) continue;
        // Best-effort unlock (masters/layers can be locked in templates)
        try { tf.locked = false; } catch (eL0) {}
        try { if (tf.itemLayer) tf.itemLayer.locked = false; } catch (eL1) {}
        try { tf.remove(); removed++; } catch (eR) {}
      }
    } catch (e0) {}
    return removed;
  }

  function bypassStoryTextFramesOnPage(doc, story, pageOffset) {
    // Detach MAIN-STORY text frames on a page from the thread WITHOUT deleting story content.
    // This is critical for "chapter start image pages": the page may contain a threaded text frame from a master.
    // Removing the frame would delete layout items or content; bypassing rethreads prev -> next to skip the page.
    var res = { frames: 0, bypassed: 0, errors: 0 };
    if (!story) return res;
    if (pageOffset < 0 || pageOffset >= doc.pages.length) return res;
    var pg = doc.pages[pageOffset];
    if (!pg || !pg.isValid) return res;
    var frames = [];
    try {
      for (var i = 0; i < pg.textFrames.length; i++) {
        var tf = pg.textFrames[i];
        if (!tf || !tf.isValid) continue;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (!st || st !== story) continue;
        frames.push(tf);
      }
    } catch (e0) {}
    res.frames = frames.length;
    // Process in reverse to reduce surprises when rethreading sequential frames.
    for (var j = frames.length - 1; j >= 0; j--) {
      var tf2 = frames[j];
      if (!tf2 || !tf2.isValid) continue;
      try {
        // Best-effort: unlock frame/layer so rethreading works even when masters/layers are locked.
        try { tf2.locked = false; } catch (eL0) {}
        try { if (tf2.itemLayer) tf2.itemLayer.locked = false; } catch (eL1) {}

        var prev = tf2.previousTextFrame;
        var next = tf2.nextTextFrame;
        if (prev && prev.isValid) {
          try { prev.locked = false; } catch (eL2) {}
          try { if (prev.itemLayer) prev.itemLayer.locked = false; } catch (eL3) {}
          if (next && next.isValid) {
            try { next.locked = false; } catch (eL4) {}
            try { if (next.itemLayer) next.itemLayer.locked = false; } catch (eL5) {}
            prev.nextTextFrame = next;
            // Some InDesign builds do NOT auto-update next.previousTextFrame; set it explicitly.
            try { next.previousTextFrame = prev; } catch (ePrev) {}
            // Detach the skipped frame from both sides (best-effort).
            try { tf2.previousTextFrame = NothingEnum.nothing; } catch (eDet0) {}
            try { tf2.nextTextFrame = NothingEnum.nothing; } catch (eDet1) {}
            res.bypassed++;
          } else {
            // End of thread; detach
            try { prev.nextTextFrame = NothingEnum.nothing; } catch (eEnd) {}
            try { tf2.previousTextFrame = NothingEnum.nothing; } catch (eDet2) {}
            try { tf2.nextTextFrame = NothingEnum.nothing; } catch (eDet3) {}
            res.bypassed++;
          }
        }
      } catch (e1) {
        res.errors++;
      }
    }
    return res;
  }

  function enforceChapterBoundaryForCh1(doc) {
    // Enforce user's structural rule around CH1/CH2:
    // - CH1 start image page (page before ^1.1) must have 0 BODY-STORY words
    // - CH1 must end with a BLANK page (page before CH2 start image page)
    //
    // We do NOT touch labels/callouts. We only remove text frames that belong to the MAIN BODY story.
    var res = {
      did_run: false,
      ch1_start_image_pageOff: -1,
      ch1_start_words_before: 0,
      ch1_start_words_after: 0,
      removed_start_frames: 0,
      ch1_blank_end_inserted: 0,
      ch1_blank_end_pageOff_after: -1,
      notes: [],
      errors: 0
    };

    try {
      if (!(chapterFilterNum === 1)) return res;
      res.did_run = true;

      // Ensure we have a CH1 scope + body story index (even if JSON didn't include chapter_filter).
      var scope = chapterScope;
      if (!scope) {
        try { scope = findChapterScope(doc, 1); } catch (eScope1) { scope = null; }
      }
      if (!scope) return res;

      var bodyStory = null;
      try { bodyStory = doc.stories[scope.storyIndex]; } catch (eS0) { bodyStory = null; }
      if (!bodyStory) return res;

      // Anchor CH1 start at the first numbered section marker (^1.1), then find the start image page before it.
      var markerOff = markerPageOffset(doc, "^1\\.1");
      if (markerOff < 0) markerOff = scope.startOff;
      if (markerOff < 0) return res;

      function pageHasAnyGraphics(pageOffset) {
        if (pageOffset < 0 || pageOffset >= doc.pages.length) return false;
        var pg = doc.pages[pageOffset];
        if (!pg || !pg.isValid) return false;
        // Include master items via allPageItems.
        try {
          var items = pg.allPageItems;
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it || !it.isValid) continue;
            try { if (it.allGraphics && it.allGraphics.length > 0) return true; } catch (eG) {}
          }
        } catch (eAll) {}
        return false;
      }

      // CH1 start image page: find nearest page BEFORE the ^1.1 marker that has graphics and 0 body-story words.
      // (In some books, markerOff-1 is an intro text page, not the image-only start page.)
      var ch1StartImageOff = -1;
      for (var offBack = markerOff - 1; offBack >= 0 && offBack >= markerOff - 10; offBack--) {
        if (!pageHasAnyGraphics(offBack)) continue;
        var w = countStoryWordsOnPage(doc, bodyStory, offBack);
        if (w === 0) { ch1StartImageOff = offBack; break; }
      }
      if (ch1StartImageOff < 0) ch1StartImageOff = markerOff - 1; // fallback
      res.ch1_start_image_pageOff = ch1StartImageOff;
      res.ch1_start_words_before = countStoryWordsOnPage(doc, bodyStory, ch1StartImageOff);
      if (ch1StartImageOff >= 0 && res.ch1_start_words_before > 0) {
        // Prefer bypass (keeps master layout), then fall back to removal only if still non-zero.
        var bpStart = bypassStoryTextFramesOnPage(doc, bodyStory, ch1StartImageOff);
        try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRecS0) {}
        try { if (doc && doc.recompose) doc.recompose(); } catch (eRecS1) {}
        res.ch1_start_words_after = countStoryWordsOnPage(doc, bodyStory, ch1StartImageOff);
        if (res.ch1_start_words_after > 0) {
          res.removed_start_frames = removeStoryTextFramesFromPage(doc, bodyStory, ch1StartImageOff);
          try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRecS2) {}
          try { if (doc && doc.recompose) doc.recompose(); } catch (eRecS3) {}
          res.ch1_start_words_after = countStoryWordsOnPage(doc, bodyStory, ch1StartImageOff);
        }
        res.notes.push("CH1 start image cleanup: bypassed=" + bpStart.bypassed + "/" + bpStart.frames + " errors=" + bpStart.errors + " removed_frames=" + res.removed_start_frames + " words_before=" + res.ch1_start_words_before + " words_after=" + res.ch1_start_words_after);
      }

      // CH2 INTRO marker page offset (e.g. "2 De huid") is typically shortly BEFORE "^2.1".
      // We MUST keep the chapter-start page IMAGE-ONLY (no BODY story text flowing onto it).
      var off21 = markerPageOffset(doc, "^2\\.1");
      // Guard: in chapter-only files (or docs with TOC/front matter), "^2.1" can appear BEFORE CH1 start
      // (e.g. TOC entry "2.1 ..."). In that case we MUST NOT run CH2-boundary enforcement, or we'd risk
      // bypassing/removing frames on front-matter pages.
      try {
        if (off21 >= 0 && off21 <= markerOff) {
          res.notes.push("Skipping CH2 boundary enforcement: ^2.1 marker appears before CH1 start (likely TOC/chapter-only doc)");
          return res;
        }
      } catch (eSkipOff21) {}
      // If our computed CH1 scope already reaches the end of the document, we likely don't have CH2 in this file.
      try {
        if (scope && scope.endOff !== null && scope.endOff !== undefined && scope.endOff >= (doc.pages.length - 1)) {
          res.notes.push("Skipping CH2 boundary enforcement: chapter scope reaches end of document (chapter-only doc)");
          return res;
        }
      } catch (eSkipScope) {}
      var ch2IntroOff = -1;
      if (off21 >= 0) {
        ch2IntroOff = markerPageOffsetNearestBefore(doc, "^2(?:\\.|\\b)", off21, 10);
      }
      if (ch2IntroOff < 0) {
        // fallback: first "^2" match (less safe, but better than skipping)
        ch2IntroOff = markerPageOffset(doc, "^2(?:\\.|\\b)");
      }
      if (ch2IntroOff < 0) return res;
      // Same guard for the intro marker: ignore anything at/before CH1 start (TOC, etc).
      try {
        if (ch2IntroOff <= markerOff) {
          res.notes.push("Skipping CH2 boundary enforcement: CH2 intro marker appears before CH1 start (likely TOC/chapter-only doc)");
          return res;
        }
      } catch (eSkipIntro) {}

      // CH1 blank end page should be immediately before the CH2 intro page.
      var ch1BlankEndOff = ch2IntroOff - 1;

      // Ensure CH2 intro page has NO body-story text (bypass body-thread frames).
      var wCh2Before = countStoryWordsOnPage(doc, bodyStory, ch2IntroOff);
      if (wCh2Before > 0) {
        var bp2 = bypassStoryTextFramesOnPage(doc, bodyStory, ch2IntroOff);
        try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRec2a) {}
        try { if (doc && doc.recompose) doc.recompose(); } catch (eRec2b) {}
        var wCh2After = countStoryWordsOnPage(doc, bodyStory, ch2IntroOff);
        // If still non-zero, last resort: remove those frames from the page.
        var rm2 = 0;
        if (wCh2After > 0) {
          rm2 = removeStoryTextFramesFromPage(doc, bodyStory, ch2IntroOff);
          try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRec2c) {}
          try { if (doc && doc.recompose) doc.recompose(); } catch (eRec2d) {}
          wCh2After = countStoryWordsOnPage(doc, bodyStory, ch2IntroOff);
        }
        res.notes.push("CH2 intro cleanup: pageOff=" + ch2IntroOff + " bypassed=" + bp2.bypassed + "/" + bp2.frames + " errors=" + bp2.errors + " removed_frames=" + rm2 + " words_before=" + wCh2Before + " words_after=" + wCh2After);
      }

      // If CH1 blank end page has body story words, insert a blank page BEFORE the CH2 chapter-start spread.
      var blankWords = countStoryWordsOnPage(doc, bodyStory, ch1BlankEndOff);
      if (ch1BlankEndOff >= 0 && blankWords > 0) {
        // Prefer bypass, then fall back to removing body-story frames.
        var bpBlank = bypassStoryTextFramesOnPage(doc, bodyStory, ch1BlankEndOff);
        try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRecB0) {}
        try { if (doc && doc.recompose) doc.recompose(); } catch (eRecB1) {}
        var blankAfter = countStoryWordsOnPage(doc, bodyStory, ch1BlankEndOff);
        var removedBlank = 0;
        if (blankAfter > 0) {
          removedBlank = removeStoryTextFramesFromPage(doc, bodyStory, ch1BlankEndOff);
          try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRecB2) {}
          try { if (doc && doc.recompose) doc.recompose(); } catch (eRecB3) {}
          blankAfter = countStoryWordsOnPage(doc, bodyStory, ch1BlankEndOff);
        }
        res.notes.push("CH1 blank end cleanup: pageOff=" + ch1BlankEndOff + " bypassed=" + bpBlank.bypassed + "/" + bpBlank.frames + " errors=" + bpBlank.errors + " removed_frames=" + removedBlank + " words_before=" + blankWords + " words_after=" + blankAfter);
        blankWords = blankAfter;
      }
      // Last resort: insert an extra blank page before the CH2 start block.
      var insertBeforeOff = ch2IntroOff;
      if (insertBeforeOff >= 0 && blankWords > 0) {
        try {
          doc.pages.add(LocationOptions.BEFORE, doc.pages[insertBeforeOff]);
          res.ch1_blank_end_inserted = 1;
          // After insertion, the CH2 start block shifts by +1, and the inserted page becomes the blank end page.
          res.ch1_blank_end_pageOff_after = insertBeforeOff;
          res.notes.push("Inserted CH1 blank end page before CH2 intro page (oldBlankWords=" + blankWords + ")");
        } catch (eAdd) {
          res.errors++;
          res.notes.push("Failed to insert blank end page: " + String(eAdd));
        }
      }
    } catch (eTop) {
      res.errors++;
      res.notes.push("enforceChapterBoundaryForCh1 error: " + String(eTop));
    }

    return res;
  }

  function scanForSuspiciousGlue(doc) {
    // Detect likely bad concatenations such as "woord.zin" (missing space after sentence end).
    // This is a heuristic: treat as QA signal, not a guaranteed error.
    var res = {
      paras_scanned: 0,
      hits: 0,
      samples: [] // string[]
    };
    function snippetAround(text, idx) {
      var start = Math.max(0, idx - 40);
      var end = Math.min(text.length, idx + 40);
      var s = text.substring(start, end);
      try { s = s.replace(/\s+/g, " "); } catch (e0) {}
      return s;
    }

    withPoints(doc, function () {
      var sStart = 0;
      var sEnd = doc.stories.length;
      try {
        if (chapterScope) {
          sStart = chapterScope.storyIndex;
          sEnd = chapterScope.storyIndex + 1;
        }
      } catch (eScope0) {}

      for (var s = sStart; s < sEnd; s++) {
        var story = doc.stories[s];
        if (!isLikelyMainStory(story)) continue;
        var pStart = 0;
        var pEnd = story.paragraphs.length;
        try {
          if (chapterScope && s === chapterScope.storyIndex) {
            pStart = chapterScope.paraStart;
            pEnd = chapterScope.paraEnd;
          }
        } catch (eScope1) {}

        for (var p = pStart; p < pEnd; p++) {
          var para = story.paragraphs[p];
          if (!para || !para.isValid) continue;
          if (isLikelyLabelParagraph(para)) continue;

          var txt = "";
          try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
          txt = trimmed(txt);
          if (!txt || txt.length < MIN_PARA_CHARS) continue;
          if (isCaptionText(txt)) continue;

          res.paras_scanned++;

          // Look for punctuation + lowercase without space (basic Latin + common accented)
          var m = txt.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9][.!?][a-zà-öø-ÿ]/);
          if (m) {
            res.hits++;
            if (res.samples.length < 20) {
              var idx = txt.indexOf(m[0]);
              res.samples.push(
                "page=" + pageNameForPara(para) + " :: " + snippetAround(txt, idx)
              );
            }
          }
        }
      }
    });
    return res;
  }

  function isLetterChar(ch) {
    try { return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(String(ch || "")); } catch (e0) { return false; }
  }

  function fixPunctuationSpacingInScope(doc) {
    // Fix common "glue" issues like "woord.Zin" / "woord,zin" / "woord:zin" in CH1 body story only.
    // This is safe and deterministic and avoids touching labels/callouts by scoping to chapterScope + main story.
    var res = { paras_scanned: 0, paras_changed: 0, changes: 0, samples: [] };

    function pushSample(para, before, after) {
      if (res.samples.length >= 8) return;
      res.samples.push(
        "page=" + pageNameForPara(para) + " :: " +
          "before=\"" + String(before).substring(0, 120) + "\" -> after=\"" + String(after).substring(0, 120) + "\""
      );
    }

    function insertSpaces(t) {
      var s = String(t || "");
      if (!s) return s;
      // quick precheck to avoid work
      if (
        s.indexOf(".,") === -1 &&
        !s.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9][.!?][A-Za-zÀ-ÖØ-öø-ÿ]/) &&
        !s.match(/[,;:][A-Za-zÀ-ÖØ-öø-ÿ]/)
      ) {
        return s;
      }

      var out = "";
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);

        // Sentence punctuation: insert space if next is a letter and no whitespace in between.
        if ((ch === "." || ch === "!" || ch === "?") && i + 1 < s.length) {
          var next = s.charAt(i + 1);
          if (isLetterChar(next)) {
            var prev = (i - 1 >= 0) ? s.charAt(i - 1) : "";
            var next2 = (i + 2 < s.length) ? s.charAt(i + 2) : "";
            // Protect dotted abbreviations like "o.a." / "d.w.z.":
            // letter '.' letter '.'  -> do NOT insert a space after the first dot.
            if (ch === "." && isLetterChar(prev) && isLetterChar(next) && next2 === ".") {
              out += ch;
            } else {
              out += ch + " ";
              res.changes++;
            }
            continue;
          }
        }

        // Comma/semicolon/colon: insert space if next is a letter.
        if ((ch === "," || ch === ";" || ch === ":") && i + 1 < s.length) {
          var n2 = s.charAt(i + 1);
          if (isLetterChar(n2)) {
            out += ch + " ";
            res.changes++;
            continue;
          }
        }

        out += ch;
      }

      // Remove spaces before punctuation (keep \n structure)
      try { out = out.replace(/[ \t]+([,.;:!?])/g, "$1"); } catch (e0) {}
      // Collapse repeated spaces
      try { out = out.replace(/ {2,}/g, " "); } catch (e1) {}
      return out;
    }

    withPoints(doc, function () {
      if (!chapterScope) return;
      var story = null;
      try { story = doc.stories[chapterScope.storyIndex]; } catch (eS) { story = null; }
      if (!story) return;

      var pStart = chapterScope.paraStart;
      var pEnd = chapterScope.paraEnd;
      for (var p = pStart; p < pEnd; p++) {
        var para = story.paragraphs[p];
        if (!para || !para.isValid) continue;
        // NOTE: We are already scoped to the MAIN story + chapterScope.
        // Do NOT skip "label-ish" geometry here: in narrow columns some real body paragraphs can
        // be misclassified, which would leave true punctuation issues unfixed.

        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;

        // Keep trailing CR
        var hasCR = false;
        if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
        if (!txt) continue;
        if (isCaptionText(trimmed(txt))) continue;

        res.paras_scanned++;
        var fixed = insertSpaces(txt);
        if (fixed !== txt) {
          try {
            para.contents = fixed + (hasCR ? "\r" : "");
            res.paras_changed++;
            pushSample(para, txt, fixed);
          } catch (eSet) {}
        }
      }
    });

    return res;
  }

  function fixMissingSpaceAfterSentencePunctUpperInScope(doc) {
    // Targeted safety net for validate-ch1.jsx rule:
    // /([a-zà-ÿ])([.!?])([A-ZÀ-Ý])/  -> insert a space after sentence punctuation.
    // We do this as a separate pass because some layouts can cause conservative skips in other fixers.
    var res = { paras_scanned: 0, paras_changed: 0, samples: [] };
    withPoints(doc, function () {
      if (!chapterScope) return;
      var story = null;
      try { story = doc.stories[chapterScope.storyIndex]; } catch (eS) { story = null; }
      if (!story) return;
      var pStart = chapterScope.paraStart;
      var pEnd = chapterScope.paraEnd;
      var re = /([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g;
      for (var p = pStart; p < pEnd; p++) {
        var para = story.paragraphs[p];
        if (!para || !para.isValid) continue;
        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        var hasCR = false;
        if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
        if (!txt) continue;
        if (!re.test(txt)) continue;
        re.lastIndex = 0;
        res.paras_scanned++;
        var fixed = txt.replace(re, "$1$2 $3");
        if (fixed !== txt) {
          try {
            para.contents = fixed + (hasCR ? "\r" : "");
            res.paras_changed++;
            if (res.samples.length < 6) {
              res.samples.push("page=" + pageNameForPara(para) + " :: " + String(fixed).substring(0, 120));
            }
          } catch (eSet) {}
        }
      }
    });
    return res;
  }

  function fixValidateWhitespaceSpacingInScope(doc) {
    // Make validate-ch1.jsx's whitespace rules deterministic:
    // - ([a-zà-ÿ])([.!?])([A-ZÀ-Ý])  -> insert space after sentence punctuation
    // - ([A-Za-zÀ-ÿ]);([A-Za-zÀ-ÿ])  -> insert space after semicolon
    // - ([A-Za-zÀ-ÿ]),([A-Za-zÀ-ÿ])  -> insert space after comma
    // - :([A-Za-zÀ-ÿ])              -> insert space after colon (avoid times like 12:30)
    //
    // Scope: CH1 pages only (by page offsets), within the CH1 body story.
    var res = { paras_scanned: 0, paras_changed: 0, changes: 0, samples: [] };
    withPoints(doc, function () {
      if (!chapterScope) return;
      var story = null;
      try { story = doc.stories[chapterScope.storyIndex]; } catch (eS) { story = null; }
      if (!story) return;
      var startOff = (chapterScope.startOff !== undefined && chapterScope.startOff !== null) ? chapterScope.startOff : -1;
      var endOff = (chapterScope.endOff !== undefined && chapterScope.endOff !== null) ? chapterScope.endOff : -1;
      if (startOff < 0 || endOff < 0) return;

      function pushSample(para, before, after) {
        if (res.samples.length >= 8) return;
        res.samples.push("page=" + pageNameForPara(para) + " :: " + String(before).substring(0, 110) + " -> " + String(after).substring(0, 110));
      }

      var reSent = /([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g;
      var reSemi = /([A-Za-z\u00C0-\u00FF]);([A-Za-z\u00C0-\u00FF])/g;
      var reComma = /([A-Za-z\u00C0-\u00FF]),([A-Za-z\u00C0-\u00FF])/g;
      var reColon = /:([A-Za-z\u00C0-\u00FF])/g;

      for (var p = 0; p < story.paragraphs.length; p++) {
        var para = story.paragraphs[p];
        if (!para || !para.isValid) continue;
        var off = -1;
        try { off = pageOffsetForPara(para); } catch (eOff) { off = -1; }
        if (off < startOff || off > endOff) continue;

        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        var hasCR = false;
        if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
        if (!txt) continue;
        if (isCaptionText(trimmed(txt))) continue;

        res.paras_scanned++;
        var before = txt;
        var fixed = txt;
        try { fixed = fixed.replace(reSent, "$1$2 $3"); } catch (eR0) {}
        try { fixed = fixed.replace(reSemi, "$1; $2"); } catch (eR1) {}
        try { fixed = fixed.replace(reComma, "$1, $2"); } catch (eR2) {}
        try { fixed = fixed.replace(reColon, ": $1"); } catch (eR3) {}
        // Remove spaces before punctuation, collapse repeats
        try { fixed = fixed.replace(/[ \t]+([,.;:!?])/g, "$1"); } catch (eC0) {}
        try { fixed = fixed.replace(/ {2,}/g, " "); } catch (eC1) {}

        if (fixed !== before) {
          try {
            para.contents = fixed + (hasCR ? "\r" : "");
            res.paras_changed++;
            pushSample(para, before, fixed);
          } catch (eSet) {}
        }
      }
    });
    return res;
  }

  function pageNameForPara(para) {
    try {
      // Best-effort: find first parent text frame page
      if (para.parentTextFrames && para.parentTextFrames.length) {
        var tf = para.parentTextFrames[0];
        var pg = tf.parentPage;
        if (pg && pg.isValid) return pg.name;
      }
    } catch (e0) {}
    return "";
  }

  function pageOffsetForPara(para) {
    try {
      // Prefer insertionPoint → parentTextFrame to avoid mis-attributing paragraphs in threaded/master frames.
      if (para && para.insertionPoints && para.insertionPoints.length) {
        var ip = para.insertionPoints[0];
        // IMPORTANT: parentTextFrames can contain multiple frames (and ordering is not guaranteed).
        // Choose the earliest page offset among them to keep offsets monotonic across a story.
        var bestOff = -1;
        try {
          var tfs = ip.parentTextFrames;
          for (var i = 0; tfs && i < tfs.length; i++) {
            var tf0 = tfs[i];
            if (!tf0 || !tf0.isValid) continue;
            var pg0 = null;
            try { pg0 = tf0.parentPage; } catch (ePg0) { pg0 = null; }
            if (!pg0 || !pg0.isValid) continue;
            var off0 = -1;
            try { off0 = pg0.documentOffset; } catch (eOff0) { off0 = -1; }
            if (off0 < 0) continue;
            if (bestOff < 0 || off0 < bestOff) bestOff = off0;
          }
        } catch (eTFs) {}
        if (bestOff >= 0) return bestOff;
      }
    } catch (e0) {}
    try {
      // Fallback via parentTextFrames (some InDesign objects don't expose insertionPoints reliably)
      if (para && para.parentTextFrames && para.parentTextFrames.length) {
        var bestOff2 = -1;
        try {
          var tfs2 = para.parentTextFrames;
          for (var j = 0; tfs2 && j < tfs2.length; j++) {
            var tf1 = tfs2[j];
            if (!tf1 || !tf1.isValid) continue;
            var pg1 = null;
            try { pg1 = tf1.parentPage; } catch (ePg1) { pg1 = null; }
            if (!pg1 || !pg1.isValid) continue;
            var off1 = -1;
            try { off1 = pg1.documentOffset; } catch (eOff1) { off1 = -1; }
            if (off1 < 0) continue;
            if (bestOff2 < 0 || off1 < bestOff2) bestOff2 = off1;
          }
        } catch (eTFs2) {}
        if (bestOff2 >= 0) return bestOff2;
      }
    } catch (e1) {}
    return -1;
  }

  // ----------------------------
  // Load rewrites
  // ----------------------------
  if (!REWRITES_JSON.exists) {
    alert("Missing Desktop/rewrites_for_indesign.json");
    return;
  }

  var jsonContent = "";
  REWRITES_JSON.open("r");
  jsonContent = REWRITES_JSON.read();
  REWRITES_JSON.close();

  var rewrites = null;
  try { rewrites = eval("(" + jsonContent + ")"); } catch (eJson) {}
  if (!rewrites || !rewrites.paragraphs) {
    alert("Invalid rewrites_for_indesign.json (expected { paragraphs: [...] })");
    return;
  }

  // Build maps
  // NOTE: exact keys can collide for short bullet items that recur in different subparagraphs
  // (e.g., "zweetklieren;"). To avoid mis-attribution and semicolon multi-apply mismatches,
  // we store MULTIPLE candidates per key and choose using local numbered-heading context.
  var rewriteMap = {};      // key -> [ { rewritten: string, meta: {...} } ]
  var rewriteMapLegacy = {}; // fallback: first 80 normalized chars -> rewritten
  var rewriteMetaLegacy80 = {}; // prefix80 -> meta
  var rewriteMapLegacy30 = {}; // fallback: first 30 normalized chars -> rewritten (more tolerant)
  var rewriteMetaLegacy30 = {}; // prefix30 -> meta
  var rewriteById = {}; // paragraph_id -> { paragraph_id, chapter, paragraph_number, style_name, original, rewritten }
  var rewriteUsedById = {}; // paragraph_id -> count
  var expectedUsesById = {}; // paragraph_id -> expected apply count (semicolon list => item count)

  function addRewriteCandidate(key, rewritten, meta) {
    if (!key) return;
    if (rewritten === null || rewritten === undefined) return;
    if (!rewriteMap.hasOwnProperty(key) || !(rewriteMap[key] instanceof Array)) rewriteMap[key] = [];
    rewriteMap[key].push({ rewritten: rewritten, meta: meta });
  }

  var mapSize = 0;
  for (var i = 0; i < rewrites.paragraphs.length; i++) {
    var r = rewrites.paragraphs[i];
    if (!r || !r.original || !r.rewritten) continue;
    var pid = "";
    try { if (r.paragraph_id !== null && r.paragraph_id !== undefined) pid = String(r.paragraph_id); } catch (ePid) { pid = ""; }
    var meta = {
      paragraph_id: pid,
      chapter: (r.chapter !== null && r.chapter !== undefined) ? String(r.chapter) : "",
      paragraph_number: r.paragraph_number,
      subparagraph_number: (r.subparagraph_number !== null && r.subparagraph_number !== undefined) ? r.subparagraph_number : null,
      style_name: (r.style_name !== null && r.style_name !== undefined) ? String(r.style_name) : ""
    };
    // Bullet multi-apply detection (semicolon-encoded bullet lists):
    // - Some JSON bullet paragraphs represent multiple bullet items using semicolons.
    // - InDesign typically stores those as multiple bullet paragraphs.
    // We detect this once per JSON paragraph and:
    // - Set expectedUsesById to itemCount
    // - Register per-item exact + legacy fallbacks
    // - AVOID registering combined legacy fallbacks that can incorrectly apply the FULL semicolon-joined rewrite
    //   to a single bullet paragraph (causes applied-rewrites verification failures).
    var isBulletMulti = false;
    var oItems = null;
    var wItems = null;
    try {
      if (isBulletStyleName(meta.style_name)) {
        oItems = splitSemicolonItems(String(r.original));
        wItems = splitSemicolonItems(String(r.rewritten));
        if (oItems.length >= 2 && wItems.length === oItems.length) isBulletMulti = true;
      }
    } catch (eBM0) { isBulletMulti = false; oItems = null; wItems = null; }
    if (pid) {
      rewriteById[pid] = {
        paragraph_id: pid,
        chapter: meta.chapter,
        paragraph_number: meta.paragraph_number,
        subparagraph_number: meta.subparagraph_number,
        style_name: meta.style_name,
        original: String(r.original),
        rewritten: String(r.rewritten)
      };
      // Expected apply count per paragraph_id:
      // - normal paragraphs apply once
      // - semicolon-encoded bullet list paragraphs apply once per item
      expectedUsesById[pid] = 1;
      try {
        if (isBulletMulti && oItems) expectedUsesById[pid] = oItems.length;
      } catch (eEU0) {}
    }
    var key = buildKey(r.original);
    if (key && key.length) {
      addRewriteCandidate(key, r.rewritten, meta);
    }
    // legacy fallback
    if (isBulletMulti && oItems && wItems) {
      // Register per-item legacy fallbacks (NOT combined).
      for (var bi0 = 0; bi0 < oItems.length; bi0++) {
        var oIt = oItems[bi0];
        var wIt = wItems[bi0];
        var legacyI = normalizeFull(cleanText(oIt)).substring(0, 80);
        if (legacyI && legacyI.length >= 30) { rewriteMapLegacy[legacyI] = wIt; rewriteMetaLegacy80[legacyI] = meta; }
        var legacy30I = normalizeFull(cleanText(oIt)).substring(0, 30);
        if (legacy30I && legacy30I.length >= 20) { rewriteMapLegacy30[legacy30I] = wIt; rewriteMetaLegacy30[legacy30I] = meta; }
      }
    } else {
      var legacy = normalizeFull(cleanText(r.original)).substring(0, 80);
      if (legacy && legacy.length >= 30) { rewriteMapLegacy[legacy] = r.rewritten; rewriteMetaLegacy80[legacy] = meta; }
      // shorter legacy (handles drift/corruption like missing spaces or list separators)
      var legacy30 = normalizeFull(cleanText(r.original)).substring(0, 30);
      if (legacy30 && legacy30.length >= 20) { rewriteMapLegacy30[legacy30] = r.rewritten; rewriteMetaLegacy30[legacy30] = meta; }
    }

    // Special-case: some bullets are represented in the JSON as semicolon-separated items,
    // but appear in InDesign as multiple short bullet paragraphs. If BOTH original+rewritten
    // contain semicolons with the same item count, add per-item keys so we can match each
    // bullet paragraph without needing paragraph merges.
    try {
      if (isBulletMulti && oItems && wItems) {
        for (var bi = 0; bi < oItems.length; bi++) {
          var ok2 = buildKey(oItems[bi]);
          if (ok2 && ok2.length) {
            addRewriteCandidate(ok2, wItems[bi], meta);
          }
        }
      }
    } catch (eSplit) {}
  }
  for (var k in rewriteMap) if (rewriteMap.hasOwnProperty(k)) mapSize++;

  // ----------------------------
  // Prepare logs
  // ----------------------------
  var summaryPath = Folder.desktop.fsName + "/rewrite_v5_safe_summary.txt";
  var tsvPath = Folder.desktop.fsName + "/rewrite_v5_safe_replaced.tsv";
  var tsvDetailedPath = Folder.desktop.fsName + "/rewrite_v5_safe_replaced_detailed.tsv";
  var coveragePath = Folder.desktop.fsName + "/rewrite_v5_safe_json_coverage.tsv";
  var progressPath = Folder.desktop.fsName + "/rewrite_v5_safe_progress.log";
  function writeFile(path, text) {
    try {
      var f = new File(path);
      try { if (f.exists) f.remove(); } catch (e0) {}
      // Be explicit: write logs as UTF-8 with Unix line endings.
      // Some rewrites contain Unicode (e.g. arrows like '→'); without UTF-8 this can silently fail.
      try { f.encoding = "UTF-8"; } catch (eEnc0) {}
      try { f.lineFeed = "Unix"; } catch (eLf0) {}
      f.open("w");
      f.write(text);
      f.close();
      return true;
    } catch (e1) { return false; }
  }
  function appendFile(path, text) {
    try {
      var f = new File(path);
      try { f.encoding = "UTF-8"; } catch (eEnc1) {}
      try { f.lineFeed = "Unix"; } catch (eLf1) {}
      f.open("a");
      f.write(text);
      f.close();
      return true;
    } catch (e0) { return false; }
  }
  writeFile(tsvPath, "page\tstoryIndex\tparaIndex\toldLen\tnewLen\tusedAnchors\tusedLegacyKey\n");
  writeFile(tsvDetailedPath, "page\tstoryIndex\tparaIndex\tmatchType\tparagraph_id\talso_used_paragraph_id\tchapter\tparagraph_number\tsubparagraph_number\tstyle_name\toldLen\tnewLen\tusedAnchors\tusedLegacyKey\tafter_key\tafter_snippet\n");
  writeFile(progressPath, "");
  appendFile(progressPath, String(new Date()) + " :: start\n");

  // ----------------------------
  // Rewrite
  // ----------------------------
  var stats = {
    stories_total: doc.stories.length,
    stories_eligible: 0,
    stories_skipped: 0,
    paras_checked: 0,
    paras_short: 0,
    paras_label_skipped: 0,
    paras_matched: 0,
    paras_replaced: 0,
    paras_skipped_no_match: 0,
    replace_errors: 0,
    anchors_preserved_replaces: 0,
    legacy_key_used_80: 0,
    legacy_key_used_30: 0,
    fuzzy_used: 0,
    bold_applied: 0,
    bullets_fixed: 0,
    justification: null,
    chapter_boundary: null,
    glue_scan: null
  };

  // ----------------------------
  // Optional CHAPTER scope + fuzzy matching (robust apply)
  // ----------------------------
  var chapterFilterNum = -1;
  try {
    if (rewrites && rewrites.chapter_filter) chapterFilterNum = parseInt(String(rewrites.chapter_filter), 10);
  } catch (eCh0) { chapterFilterNum = -1; }
  if (!(chapterFilterNum > 0)) chapterFilterNum = -1;

  // Wrapper override: allow external wrappers (e.g. run-ch1-rewrite-v5-safe.jsx) to force a chapter scope
  // without mutating Desktop/rewrites_for_indesign.json.
  try {
    if (!(chapterFilterNum > 0)) {
      // 1) Preferred: app.scriptArgs (works across doScript engines)
      try {
        if (app && app.scriptArgs) {
          var v = null;
          try { v = app.scriptArgs.getValue("BIC_CHAPTER_FILTER"); } catch (eGet) { v = null; }
          if (v !== null && v !== undefined && String(v) !== "") {
            chapterFilterNum = parseInt(String(v), 10);
            if (!(chapterFilterNum > 0)) chapterFilterNum = -1;
          }
        }
      } catch (eSA) {}

      // 2) Fallback: $.global (may not work if script runs in a different engine)
      if (!(chapterFilterNum > 0) && $.global && $.global.__BIC_CHAPTER_FILTER) {
        chapterFilterNum = parseInt(String($.global.__BIC_CHAPTER_FILTER), 10);
        if (!(chapterFilterNum > 0)) chapterFilterNum = -1;
      }
    }
  } catch (eChG) { chapterFilterNum = -1; }

  function findFirstParaIndexMatching(story, re, startAt) {
    if (!story || !re) return -1;
    var start = startAt || 0;
    if (start < 0) start = 0;
    try {
      for (var p = start; p < story.paragraphs.length; p++) {
        var para = story.paragraphs[p];
        var txt = "";
        try { txt = trimmed(para.contents || ""); } catch (e0) { txt = ""; }
        if (!txt) continue;
        if (re.test(txt)) return p;
      }
    } catch (e1) {}
    return -1;
  }

  function findFirstChapterHeaderParaIndex(story, chNum, startAt) {
    if (!story) return -1;
    var re = null;
    try { re = new RegExp("^" + String(chNum) + "(?:\\\\.|\\\\b)"); } catch (eR) { re = null; }
    if (!re) return -1;
    var start = startAt || 0;
    if (start < 0) start = 0;
    try {
      for (var p = start; p < story.paragraphs.length; p++) {
        var para = story.paragraphs[p];
        var styleName = "";
        try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
        if (!isChapterHeaderStyleName(styleName)) continue;
        var txt = "";
        try { txt = trimmed(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        if (re.test(txt)) return p;
      }
    } catch (e2) {}
    return -1;
  }

  function findChapterScope(doc, chNum) {
    // Robust CHAPTER scope:
    // - Determine chapter page range by markers "^<ch>.1" and "^<ch+1>.1" ANYWHERE in the document,
    //   but EXPAND start/end to include unnumbered chapter-intro pages like "2 <title>" that often
    //   appear shortly before "2.1 <title>".
    //   (Markers are often in a separate header story, not inside the body story.)
    // - Determine the BODY story as the story with the most words within that page range.
    // - Scope by paragraph indices in that body story whose start page offsets fall within [startOff, endOff].
    var ch = String(chNum);
    var chNext = String(chNum + 1);

    var startNumberedOff = markerPageOffset(doc, "^" + ch + "\\.1");
    if (startNumberedOff < 0) {
      // Fallback: if ".1" isn't present, use the chapter header marker itself.
      startNumberedOff = markerPageOffset(doc, "^" + ch + "(?:\\.|\\b)");
    }
    if (startNumberedOff < 0) return null;

    // Expand backward to include unnumbered intro page near the first numbered marker.
    var startIntroOff = markerPageOffsetNearestBefore(doc, "^" + ch + "(?:\\.|\\b)", startNumberedOff, 8);
    var startOff = (startIntroOff >= 0) ? startIntroOff : startNumberedOff;

    // IMPORTANT:
    // In chapter-only baselines (our normal pipeline), the next chapter marker is absent.
    // Falling back to "^2(?:\\.|\\b)" is unsafe because it matches numbered list items ("2 ...") inside the chapter.
    // Therefore: only use "^<ch+1>\\.1" as the end marker; if absent, scope to the document end.
    var nextNumberedOff = markerPageOffset(doc, "^" + chNext + "\\.1");
    var endOff = (doc.pages.length - 1);
    if (nextNumberedOff >= 0) {
      // Expand backward to include unnumbered next-chapter intro page near the first numbered marker.
      var nextIntroOff = markerPageOffsetNearestBefore(doc, "^" + chNext + "(?:\\.|\\b)", nextNumberedOff, 10);
      var endMarkerOff = (nextIntroOff >= 0) ? nextIntroOff : nextNumberedOff;
      endOff = (endMarkerOff >= 0) ? (endMarkerOff - 1) : (doc.pages.length - 1);
    }
    if (endOff < startOff) endOff = doc.pages.length - 1;

    var bestStoryIndex = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var story = doc.stories[s];
      if (!isLikelyMainStory(story)) continue;
      var wc = 0;
      try { wc = storyWordCountInPageRange(story, startOff, endOff); } catch (eWC) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; bestStoryIndex = s; }
    }
    if (bestStoryIndex < 0) return null;

    var body = doc.stories[bestStoryIndex];
    var pc = 0;
    try { pc = body.paragraphs.length; } catch (eP) { pc = 0; }

    // Determine paragraph index window by scanning all paragraphs (offsets can be non-monotonic when
    // a paragraph spans multiple frames and parentTextFrames ordering changes).
    var paraStart = -1;
    var paraEnd = -1; // inclusive
    for (var p = 0; p < pc; p++) {
      var off = pageOffsetForPara(body.paragraphs[p]);
      if (off < 0) continue;
      if (off < startOff || off > endOff) continue;
      if (paraStart < 0) paraStart = p;
      paraEnd = p;
    }
    if (paraStart < 0) return null;
    paraEnd = paraEnd + 1; // make exclusive

    return {
      storyIndex: bestStoryIndex,
      paraStart: paraStart,
      paraEnd: paraEnd,
      startOff: startOff,
      endOff: endOff,
      chapter: String(chNum)
    };
  }

  // Chapter scope is computed INSIDE withPoints() so geometry-based heuristics use POINTS units.
  // (Outside withPoints, measurement units can vary and isLikelyMainStory() can misclassify stories.)
  var chapterScope = null;

  // Stopword set (Dutch) for fuzzy token overlap.
  var STOP = {
    "de":1,"het":1,"een":1,"en":1,"van":1,"in":1,"op":1,"je":1,"jij":1,"wij":1,"we":1,"er":1,"zijn":1,"is":1,"dat":1,"die":1,"dit":1,
    "als":1,"maar":1,"voor":1,"door":1,"naar":1,"om":1,"te":1,"met":1,"bij":1,"ook":1,"wel":1,"niet":1,"dan":1,"aan":1,"uit":1,"tot":1,
    "of":1,"dus":1,"zoals":1,"hier":1,"daar":1,"namelijk":1,"deze":1,"alle":1,"alleen":1,"meer":1,"minder":1,"nog":1,"al":1
  };

  function tokenInfoFromText(text) {
    var norm = normalizeFull(cleanText(text));
    var parts = [];
    try { parts = norm.split(" "); } catch (e0) { parts = []; }
    var map = {};
    var count = 0;
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i];
      if (!t) continue;
      if (t.length < 4) continue;
      if (STOP[t]) continue;
      if (!map[t]) {
        map[t] = 1;
        count++;
        if (count >= 140) break;
      }
    }
    return { tokens: map, count: count };
  }

  var fuzzyTargets = [];
  var fuzzyBuilt = false;
  var usedRewriteKeys = {}; // rewriteKey -> 1 (only used when chapterScope is enabled)
  var targetIndexByRewriteKey = {}; // rewriteKey -> index in fuzzyTargets
  var tokenFreq = {}; // token -> count across fuzzyTargets (used to prefer rare tokens in fuzzy matching)

  function rewriteKeyForText(text) {
    if (!text) return "";
    var s = String(text);
    // Include length to reduce collisions.
    return String(s.length) + ":" + fnv1a32(s);
  }

  function markRewriteUsedIfScoped(rewriteText, matchMeta) {
    if (!chapterScope) return true; // gating only when chapter_filter scoping is active

    // Prefer gating by paragraph_id usage (prevents over-applying semicolon bullet lists and avoids blocking
    // legitimate repeats where rewritten text is identical across different paragraph_ids).
    try {
      var pid = "";
      try { pid = (matchMeta && matchMeta.paragraph_id !== null && matchMeta.paragraph_id !== undefined) ? String(matchMeta.paragraph_id) : ""; } catch (ePid) { pid = ""; }
      if (pid) {
        var used = 0;
        try { used = rewriteUsedById[pid] ? rewriteUsedById[pid] : 0; } catch (eU0) { used = 0; }
        var exp = 1;
        try { exp = expectedUsesById[pid] ? expectedUsesById[pid] : 1; } catch (eE0) { exp = 1; }
        if (used >= exp) return false;
        return true;
      }
    } catch (eMetaGate) {}

    // Fallback: gate by rewrite text fingerprint (kept for safety in rare meta-missing cases).
    var rk = rewriteKeyForText(rewriteText);
    if (!rk) return true;
    if (usedRewriteKeys[rk]) return false;
    usedRewriteKeys[rk] = 1;

    // Mark corresponding fuzzy target as used so fuzzy doesn't reuse it (only relevant if ENABLE_FUZZY=true).
    try {
      if (targetIndexByRewriteKey.hasOwnProperty(rk)) {
        var idx = targetIndexByRewriteKey[rk];
        if (idx !== null && idx !== undefined && idx >= 0 && idx < fuzzyTargets.length) {
          fuzzyTargets[idx].used = true;
        }
      }
    } catch (eU) {}
    return true;
  }

  function fuzzyFindRewriteForParaText(docParaText) {
    if (!chapterScope) return null;
    if (!fuzzyTargets || fuzzyTargets.length === 0) return null;
    var di = tokenInfoFromText(docParaText);
    if (!di || di.count < 6) return null;

    // If the doc paragraph contains tokens that are rare across all rewrite targets,
    // require at least one of those rare tokens to overlap. This prevents fuzzy from
    // confusing generic transport/metabolisme paragraphs and improves accuracy.
    var rare = {};
    var hasRare = false;
    try {
      for (var rt in di.tokens) {
        if (!di.tokens.hasOwnProperty(rt)) continue;
        var f = 0;
        try { f = tokenFreq[rt] || 0; } catch (eF0) { f = 0; }
        if (f > 0 && f <= 2) { rare[rt] = 1; hasRare = true; }
      }
    } catch (eRare0) {}

    var bestIdx = -1;
    var bestScore = 0;
    var bestOverlap = 0;
    var secondScore = 0;

    for (var i = 0; i < fuzzyTargets.length; i++) {
      var tgt = fuzzyTargets[i];
      if (!tgt || tgt.used) continue;
      if (hasRare) {
        var ro = 0;
        for (var rTok in rare) {
          if (rare.hasOwnProperty(rTok) && tgt.tokens[rTok]) { ro = 1; break; }
        }
        if (ro <= 0) continue;
      }
      var overlap = 0;
      for (var tok in di.tokens) {
        if (di.tokens.hasOwnProperty(tok) && tgt.tokens[tok]) overlap++;
      }
      if (overlap <= 0) continue;
      var denom = tgt.tokenCount > 0 ? tgt.tokenCount : 1;
      var score = overlap / denom;
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestIdx = i;
        bestOverlap = overlap;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    // Conservative gate: require enough overlap + clear winner.
    // If the paragraph contains rare anchor tokens, we can be slightly more permissive
    // because the candidate set is already strongly constrained.
    if (bestIdx >= 0) {
      // When rare tokens are present (e.g., a subparagraph's key term like "osmose"),
      // overlap can be smaller while still being a safe match.
      var minOverlap = hasRare ? 4 : 8;
      var minScore = hasRare ? 0.12 : 0.22;
      var minGap = hasRare ? 0.02 : 0.05;
      if (bestOverlap >= minOverlap && bestScore >= minScore && (bestScore - secondScore) >= minGap) {
        try { fuzzyTargets[bestIdx].used = true; } catch (eU) {}
        return fuzzyTargets[bestIdx].rewritten;
      }
    }
    return null;
  }

  withPoints(doc, function () {
    // Compute scope now that units are set to points.
    try {
      var dbg = "";
      try { dbg += "chapterFilterNum=" + String(chapterFilterNum); } catch (eD0) {}
      try { dbg += " rewrites.chapter_filter=" + String(rewrites && rewrites.chapter_filter ? rewrites.chapter_filter : ""); } catch (eD1) {}
      try { dbg += " marker(^1\\.1)=" + String(markerPageOffset(doc, "^1\\.1")); } catch (eD2) {}
      try { dbg += " marker(^2\\.1)=" + String(markerPageOffset(doc, "^2\\.1")); } catch (eD3) {}
      try { dbg += " marker(^1(?:\\.|\\b))=" + String(markerPageOffset(doc, "^1(?:\\.|\\b)")); } catch (eD4) {}
      try { dbg += " marker(^2(?:\\.|\\b))=" + String(markerPageOffset(doc, "^2(?:\\.|\\b)")); } catch (eD5) {}
      appendFile(progressPath, String(new Date()) + " :: chapter_scope_debug " + dbg + "\n");
    } catch (eDbg) {}
    if (!chapterScope && chapterFilterNum > 0) {
      try { chapterScope = findChapterScope(doc, chapterFilterNum); } catch (eScope) { chapterScope = null; }
    }
    try {
      appendFile(
        progressPath,
        String(new Date()) + " :: chapter_scope " +
          (chapterScope
            ? ("storyIndex=" + chapterScope.storyIndex + " startOff=" + chapterScope.startOff + " endOff=" + chapterScope.endOff + " paraStart=" + chapterScope.paraStart + " paraEnd=" + chapterScope.paraEnd)
            : "null") +
          "\n"
      );
    } catch (eLogScope) {}
    // Build fuzzy targets once (only when scoped, and only if explicitly enabled).
    if (chapterScope && ENABLE_FUZZY && !fuzzyBuilt) {
      for (var fi = 0; fi < rewrites.paragraphs.length; fi++) {
        var rr = rewrites.paragraphs[fi];
        if (!rr || !rr.original || !rr.rewritten) continue;
        var ti = tokenInfoFromText(rr.original);
        var rk = rewriteKeyForText(rr.rewritten);
        if (!targetIndexByRewriteKey.hasOwnProperty(rk)) {
          targetIndexByRewriteKey[rk] = fuzzyTargets.length;
        }
        // Update token frequency map (unique tokens only).
        try {
          for (var tt in ti.tokens) {
            if (!ti.tokens.hasOwnProperty(tt)) continue;
            tokenFreq[tt] = (tokenFreq[tt] || 0) + 1;
          }
        } catch (eTF) {}
        fuzzyTargets.push({
          paragraph_id: (rr.paragraph_id !== null && rr.paragraph_id !== undefined) ? String(rr.paragraph_id) : "",
          chapter: (rr.chapter !== null && rr.chapter !== undefined) ? String(rr.chapter) : "",
          paragraph_number: rr.paragraph_number,
          subparagraph_number: (rr.subparagraph_number !== null && rr.subparagraph_number !== undefined) ? rr.subparagraph_number : null,
          style_name: (rr.style_name !== null && rr.style_name !== undefined) ? String(rr.style_name) : "",
          original: rr.original,
          rewritten: rr.rewritten,
          rewriteKey: rk,
          tokens: ti.tokens,
          tokenCount: ti.count,
          used: false
        });
      }
      fuzzyBuilt = true;
    }

    // When chapter_filter is present in the JSON, scope strictly to that chapter range in the main story.
    var storyStart = 0;
    var storyEnd = doc.stories.length;
    if (chapterScope) {
      storyStart = chapterScope.storyIndex;
      storyEnd = chapterScope.storyIndex + 1;
    }

    // Two-pass strategy:
    // Pass 1: exact + legacy matching only (NO fuzzy). This prevents fuzzy from "stealing" a rewrite
    // before we encounter its true exact/legacy paragraph later in the story.
    // Pass 2: last-resort fuzzy matching for any remaining unmatched paragraphs.
    //
    // This is critical for correctness: a single fuzzy hit early in the story can otherwise mark the
    // rewrite as "used" and block the later exact match, silently misplacing content.
    var replacedParas = {}; // key "s:p" -> 1 (so pass 2 won't touch already replaced paragraphs)
    // Track current numbered subparagraph context (e.g. "2.1.3 ...") while walking the story,
    // so we can disambiguate identical short bullet items that recur in different subparagraphs.
    var currentParaNum = null; // integer (the ".1" in "2.1.3")
    var currentSubNum = null;  // integer or null (the ".3" in "2.1.3")

    function updateNumberContextFromText(t) {
      if (!(chapterFilterNum > 0)) return;
      var s = "";
      try { s = String(t || ""); } catch (e0) { s = ""; }
      if (!s) return;
      // Match "2.1" or "2.1.3" at paragraph start.
      var re = null;
      try { re = new RegExp("^" + String(chapterFilterNum) + "\\\\.(\\\\d+)(?:\\\\.(\\\\d+))?\\\\b"); } catch (eR) { re = null; }
      if (!re) return;
      var m = null;
      try { m = s.match(re); } catch (eM) { m = null; }
      if (!m) return;
      var pn = -1;
      try { pn = parseInt(String(m[1] || ""), 10); } catch (eP) { pn = -1; }
      if (!(pn >= 0)) return;
      currentParaNum = pn;
      var sn = null;
      if (m.length >= 3 && m[2] !== null && m[2] !== undefined && String(m[2]) !== "") {
        var tmp = -1;
        try { tmp = parseInt(String(m[2] || ""), 10); } catch (eS) { tmp = -1; }
        if (tmp >= 0) sn = tmp;
      }
      currentSubNum = sn;
    }

    function canUseMeta(meta) {
      if (!meta) return true;
      var pid = "";
      try { pid = (meta.paragraph_id !== null && meta.paragraph_id !== undefined) ? String(meta.paragraph_id) : ""; } catch (e0) { pid = ""; }
      if (!pid) return true;
      var used = 0;
      try { used = rewriteUsedById[pid] ? rewriteUsedById[pid] : 0; } catch (e1) { used = 0; }
      var exp = 1;
      try { exp = expectedUsesById[pid] ? expectedUsesById[pid] : 1; } catch (e2) { exp = 1; }
      return used < exp;
    }

    function scoreMeta(meta) {
      var sc = 0;
      if (!meta) return sc;
      // Prefer candidates from the current chapter when running in chapter-scoped mode.
      // This prevents cross-chapter leakage for repeated short bullet items (e.g. "water.").
      try {
        if (chapterFilterNum > 0) {
          var mch = "";
          try { mch = (meta.chapter !== null && meta.chapter !== undefined) ? String(meta.chapter) : ""; } catch (eCh0) { mch = ""; }
          if (mch && mch === String(chapterFilterNum)) sc += 100;
          else if (mch) sc -= 50;
        }
      } catch (eCh1) {}
      // Prefer the candidate whose numbered-heading context matches where we are in the story.
      if (currentParaNum !== null && currentParaNum !== undefined) {
        try {
          if (meta.paragraph_number !== null && meta.paragraph_number !== undefined && String(meta.paragraph_number) === String(currentParaNum)) sc += 20;
        } catch (e0) {}
      }
      if (currentSubNum !== null && currentSubNum !== undefined) {
        try {
          if (meta.subparagraph_number !== null && meta.subparagraph_number !== undefined && String(meta.subparagraph_number) === String(currentSubNum)) sc += 10;
        } catch (e1) {}
      }
      return sc;
    }

    function chooseCandidate(cands) {
      if (!cands || !(cands instanceof Array) || cands.length === 0) return null;
      var best = null;
      var bestScore = -9999;
      for (var iC = 0; iC < cands.length; iC++) {
        var c = cands[iC];
        if (!c) continue;
        var meta = null;
        try { meta = c.meta || null; } catch (eM0) { meta = null; }
        if (!canUseMeta(meta)) continue;
        var sc = scoreMeta(meta);
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
      if (best) return best;
      // Fallback: return first non-exhausted candidate (if any)
      for (var jC = 0; jC < cands.length; jC++) {
        var c2 = cands[jC];
        if (!c2) continue;
        var m2 = null;
        try { m2 = c2.meta || null; } catch (eM1) { m2 = null; }
        if (!canUseMeta(m2)) continue;
        return c2;
      }
      return null;
    }

    for (var pass = 1; pass <= 2; pass++) {
      var allowFuzzy = (pass === 2) && ENABLE_FUZZY;
      try { appendFile(progressPath, String(new Date()) + " :: replace_pass " + String(pass) + " allowFuzzy=" + (allowFuzzy ? "1" : "0") + "\n"); } catch (ePassLog) {}

      for (var s = storyStart; s < storyEnd; s++) {
      var story = doc.stories[s];
      if (!isLikelyMainStory(story)) {
        stats.stories_skipped++;
        continue;
      }
      stats.stories_eligible++;

      var pStart = 0;
      var pEnd = story.paragraphs.length;
      if (chapterScope && s === chapterScope.storyIndex) {
        pStart = chapterScope.paraStart;
        pEnd = chapterScope.paraEnd;
      }

      for (var p = pStart; p < pEnd; p++) {
        var rpKey = String(s) + ":" + String(p);
        try { if (replacedParas[rpKey]) continue; } catch (eRp0) {}
        var para = story.paragraphs[p];
        // Only count once (pass 1). Pass 2 is a targeted fuzzy cleanup pass.
        if (!allowFuzzy) stats.paras_checked++;

        var originalText = "";
        try { originalText = para.contents; } catch (e0) { originalText = ""; }
        // Preserve paragraph terminator (critical): setting para.contents without the trailing "\r"
        // can merge the next paragraph into this one in some InDesign layouts.
        var hadParaReturn = false;
        try { hadParaReturn = (originalText.charAt(originalText.length - 1) === "\r"); } catch (eCR0) { hadParaReturn = false; }

        // Update numbered-heading context (e.g. "2.1.3 ...") for disambiguating repeated short bullet items.
        try { updateNumberContextFromText(trimmed(originalText)); } catch (eCtx) {}

        // Skip label-ish paragraphs (defense-in-depth)
        if (isLikelyLabelParagraph(para)) {
          stats.paras_label_skipped++;
          continue;
        }

        var key = buildKey(originalText);
        var candList = key ? rewriteMap[key] : null;
        var chosen = (candList && (candList instanceof Array) && candList.length) ? chooseCandidate(candList) : null;
        var rewrite = chosen ? chosen.rewritten : null;
        var matchType = rewrite ? "exact" : "";
        var matchMeta = chosen ? (chosen.meta || null) : null;
        var usedLegacy = false;

        // Minimum-length gate (safety):
        // - For normal paragraphs we skip very short paragraphs to avoid touching numbering/labels.
        // - BUT if we have an EXACT key match, it's safe to apply even if short (e.g. mis-styled bullet items like "eelt;").
        var minLen = MIN_PARA_CHARS;
        try { if (isBulletParagraph(para)) minLen = MIN_BULLET_PARA_CHARS; } catch (eMin0) {}
        if (!rewrite && (!originalText || originalText.length < minLen)) {
          stats.paras_short++;
          continue;
        }
        if (!rewrite) {
          var legacyKey80 = normalizeFull(cleanText(originalText)).substring(0, 80);
          rewrite = (legacyKey80 && legacyKey80.length >= 30) ? rewriteMapLegacy[legacyKey80] : null;
          if (rewrite) {
            usedLegacy = true;
            matchType = "legacy80";
            matchMeta = rewriteMetaLegacy80[legacyKey80] || null;
            stats.legacy_key_used_80++;
          } else {
            var legacyKey30 = normalizeFull(cleanText(originalText)).substring(0, 30);
            rewrite = (legacyKey30 && legacyKey30.length >= 20) ? rewriteMapLegacy30[legacyKey30] : null;
            if (rewrite) {
              usedLegacy = true;
              matchType = "legacy30";
              matchMeta = rewriteMetaLegacy30[legacyKey30] || null;
              stats.legacy_key_used_30++;
            }
          }
        }

        // Last-resort fuzzy match (ONLY in pass 2, and ONLY inside chapter scope)
        if (allowFuzzy && !rewrite) {
          var fuzzy = fuzzyFindRewriteForParaText(originalText);
          if (fuzzy) {
            rewrite = fuzzy;
            matchType = "fuzzy";
            // Attempt to recover paragraph_id via rewriteKey -> fuzzyTargets index.
            try {
              var rk = rewriteKeyForText(rewrite);
              if (targetIndexByRewriteKey.hasOwnProperty(rk)) {
                var fIdx = targetIndexByRewriteKey[rk];
                if (fIdx !== null && fIdx !== undefined && fIdx >= 0 && fIdx < fuzzyTargets.length) {
                  matchMeta = fuzzyTargets[fIdx];
                }
              }
            } catch (eFMeta) {}
            stats.fuzzy_used++;
          }
        }

        if (!rewrite) {
          stats.paras_skipped_no_match++;
          continue;
        }

        // Special-case: sometimes the baseline merges two basis paragraphs under the same subparagraph into ONE long paragraph.
        // Example in CH1: 1.4.3 "Osmose is ..." + "Als je een stof oplost in 100 ml water ..." appear in a single baseline paragraph.
        // In that case we merge the two rewrites into a single same-paragraph rewrite (using \\n\\n only) and mark both JSON ids as used.
        var alsoUsedRid = "";
        try {
          if (chapterScope && matchMeta && matchMeta.chapter && (matchMeta.paragraph_number !== null && matchMeta.paragraph_number !== undefined)) {
            var spn = null;
            try { spn = (matchMeta.subparagraph_number !== null && matchMeta.subparagraph_number !== undefined) ? matchMeta.subparagraph_number : null; } catch (eSp0) { spn = null; }
            if (spn !== null && spn !== undefined) {
              var normDoc = normalizeFull(cleanText(originalText));
              var hasOsm = (normDoc.indexOf("osmose") !== -1);
              var has100 = (normDoc.indexOf("100") !== -1 && normDoc.indexOf("ml") !== -1);
              if (hasOsm && has100) {
                var rrOsm = null;
                var rrSol = null;
                for (var mi = 0; mi < rewrites.paragraphs.length; mi++) {
                  var rrM = rewrites.paragraphs[mi];
                  if (!rrM || !rrM.original || !rrM.rewritten) continue;
                  try {
                    if (String(rrM.chapter || "") !== String(matchMeta.chapter || "")) continue;
                    if (String(rrM.paragraph_number || "") !== String(matchMeta.paragraph_number || "")) continue;
                    if (String(rrM.subparagraph_number || "") !== String(spn || "")) continue;
                  } catch (eCmp0) { continue; }
                  var st = "";
                  try { st = String(rrM.style_name || ""); } catch (eSt0) { st = ""; }
                  if (st.indexOf("Basis") === -1 && st.indexOf("basis") === -1) continue;
                  var oTxt = "";
                  try { oTxt = String(rrM.original || ""); } catch (eOT0) { oTxt = ""; }
                  if (oTxt.indexOf("Osmose is") === 0) rrOsm = rrM;
                  if (oTxt.indexOf("Als je een stof oplost") === 0) rrSol = rrM;
                }

                if (rrOsm && rrSol) {
                  var rkO = rewriteKeyForText(String(rrOsm.rewritten || ""));
                  var rkS = rewriteKeyForText(String(rrSol.rewritten || ""));
                  var canMerge = true;
                  try { if (rkO && usedRewriteKeys[rkO]) canMerge = false; } catch (eUK0) {}
                  try { if (rkS && usedRewriteKeys[rkS]) canMerge = false; } catch (eUK1) {}

                  if (canMerge) {
                    function splitLayerBlocks(text) {
                      var PR = "<<BOLD_START>>In de praktijk:<<BOLD_END>>";
                      var VE = "<<BOLD_START>>Verdieping:<<BOLD_END>>";
                      var s = "";
                      try { s = String(text || ""); } catch (e0) { s = ""; }
                      var idxPr = -1, idxVe = -1;
                      try { idxPr = s.indexOf(PR); } catch (e1) { idxPr = -1; }
                      try { idxVe = s.indexOf(VE); } catch (e2) { idxVe = -1; }
                      var idx = -1;
                      if (idxPr >= 0 && idxVe >= 0) idx = (idxPr < idxVe) ? idxPr : idxVe;
                      else idx = (idxPr >= 0) ? idxPr : idxVe;
                      if (idx < 0) return { base: s, tail: "" };
                      var cut = idx;
                      try {
                        if (cut >= 2 && s.charAt(cut - 1) === "\n" && s.charAt(cut - 2) === "\n") cut = cut - 2;
                      } catch (e3) {}
                      return { base: s.substring(0, cut), tail: s.substring(cut) };
                    }

                    var oParts = splitLayerBlocks(String(rrOsm.rewritten || ""));
                    var sParts = splitLayerBlocks(String(rrSol.rewritten || ""));
                    var merged = trimmed(oParts.base);
                    var sBase = trimmed(sParts.base);
                    if (sBase) merged = merged ? (merged + "\n\n" + sBase) : sBase;
                    var sTail = trimmed(sParts.tail);
                    if (sTail) merged = merged ? (merged + "\n\n" + sTail) : sTail;
                    var oTail = trimmed(oParts.tail);
                    if (oTail) merged = merged ? (merged + "\n\n" + oTail) : oTail;

                    // Reserve the component rewrites so they can't be applied elsewhere in chapter scope.
                    try { markRewriteUsedIfScoped(String(rrOsm.rewritten || ""), rrOsm); } catch (eRes0) {}
                    try { markRewriteUsedIfScoped(String(rrSol.rewritten || ""), rrSol); } catch (eRes1) {}

                    // Apply merged rewrite and count both ids as "used" in coverage.
                    rewrite = merged;
                    matchType = (matchType ? (matchType + "+merge") : "merge");

                    try {
                      // Use Osmose as the primary match for logs, and mark Solution as also-used.
                      if (rrOsm.paragraph_id !== null && rrOsm.paragraph_id !== undefined) {
                        matchMeta = {
                          paragraph_id: String(rrOsm.paragraph_id),
                          chapter: String(matchMeta.chapter || ""),
                          paragraph_number: matchMeta.paragraph_number,
                          subparagraph_number: spn,
                          style_name: String(rrOsm.style_name || matchMeta.style_name || "")
                        };
                      }
                    } catch (eMM0) {}
                    try { if (rrSol.paragraph_id !== null && rrSol.paragraph_id !== undefined) alsoUsedRid = String(rrSol.paragraph_id); } catch (eAR0) { alsoUsedRid = ""; }
                  }
                }
              }
            }
          }
        } catch (eMerge0) {}

        // In chapter-scoped mode, each rewrite should apply at most once.
        // This prevents fuzzy matching from reusing the same rewrite on unrelated paragraphs.
        if (!markRewriteUsedIfScoped(rewrite, matchMeta)) {
          stats.paras_skipped_no_match++;
          continue;
        }
        stats.paras_matched++;

        try {
          var pStyle = null;
          try { pStyle = para.appliedParagraphStyle; } catch (ePS0) { pStyle = null; }

          var cleanRewrite = cleanTextKeepMarkers(rewrite);
          cleanRewrite = preserveNumberedCaptionPrefix(originalText, cleanRewrite);

          var usedAnchors = false;
          var ok = true;
          if (containsAnchoredObjects(originalText)) {
            usedAnchors = true;
            ok = replaceParagraphTextPreservingAnchors(para, cleanRewrite);
            if (ok) stats.anchors_preserved_replaces++;
          } else {
            // IMPORTANT: keep the paragraph return to avoid merging paragraphs.
            var toSet = cleanRewrite + (hadParaReturn ? "\r" : "");
            try { para.contents = toSet; } catch (eSet) { ok = false; }
          }

          if (!ok) {
            stats.replace_errors++;
            continue;
          }

          // Restore paragraph style
          try { if (pStyle) para.appliedParagraphStyle = pStyle; } catch (ePS1) {}

          stats.paras_replaced++;
          // Mark which JSON paragraph was applied (best effort).
          var rid = "";
          var rch = "";
          var rpn = "";
          var rsn = "";
          var rst = "";
          try {
            if (matchMeta) {
              if (matchMeta.paragraph_id !== null && matchMeta.paragraph_id !== undefined) rid = String(matchMeta.paragraph_id);
              if (matchMeta.chapter !== null && matchMeta.chapter !== undefined) rch = String(matchMeta.chapter);
              if (matchMeta.paragraph_number !== null && matchMeta.paragraph_number !== undefined) rpn = String(matchMeta.paragraph_number);
              if (matchMeta.subparagraph_number !== null && matchMeta.subparagraph_number !== undefined) rsn = String(matchMeta.subparagraph_number);
              if (matchMeta.style_name !== null && matchMeta.style_name !== undefined) rst = String(matchMeta.style_name);
            }
          } catch (eMeta0) {}
          if (rid) {
            try { rewriteUsedById[rid] = (rewriteUsedById[rid] ? (rewriteUsedById[rid] + 1) : 1); } catch (eUse0) {}
          }
          if (alsoUsedRid) {
            try { rewriteUsedById[alsoUsedRid] = (rewriteUsedById[alsoUsedRid] ? (rewriteUsedById[alsoUsedRid] + 1) : 1); } catch (eUse1) {}
          }
          appendFile(
            tsvPath,
            pageNameForPara(para) + "\t" + s + "\t" + p + "\t" +
              String(originalText.length) + "\t" + String(cleanRewrite.length) + "\t" +
              (usedAnchors ? "1" : "0") + "\t" + (usedLegacy ? "1" : "0") + "\n"
          );
          appendFile(
            tsvDetailedPath,
            pageNameForPara(para) + "\t" + s + "\t" + p + "\t" +
              (matchType || "") + "\t" + (rid || "") + "\t" + (alsoUsedRid || "") + "\t" + (rch || "") + "\t" + (rpn || "") + "\t" + (rsn || "") + "\t" + (rst || "") + "\t" +
              String(originalText.length) + "\t" + String(cleanRewrite.length) + "\t" +
              (usedAnchors ? "1" : "0") + "\t" + (usedLegacy ? "1" : "0") + "\t" +
              // Proof: fingerprint of what actually ended up in the paragraph (normalized, marker-free).
              buildKey(String(para.contents || "")) + "\t" +
              tsvSafeCell(cleanText(String(para.contents || ""))) + "\n"
          );
          // Mark paragraph as replaced so later passes don't touch it.
          try { replacedParas[rpKey] = 1; } catch (eRp1) {}
        } catch (eR) {
          stats.replace_errors++;
        }
      }
    }
    }
  });
  appendFile(progressPath, String(new Date()) + " :: replacement_done replaced=" + stats.paras_replaced + "\n");

  // Optional: fix isolated bullet paragraphs in CH1 body story (known recurring anomaly).
  // This keeps edits scoped and prevents "floating single bullet item" artifacts.
  stats.isolated_bullets_fixed = 0;
  try {
    if (chapterFilterNum === 1) {
      var fixFile = File("/Users/asafgafni/Desktop/InDesign/TestRun/fix-ch1-isolated-bullets.jsx");
      if (fixFile && fixFile.exists) {
        var res = app.doScript(fixFile, ScriptLanguage.JAVASCRIPT);
        try {
          var mFix = String(res || "").match(/Isolated bullet paragraphs fixed:\\s*(\\d+)/i);
          if (mFix) stats.isolated_bullets_fixed = parseInt(mFix[1], 10) || 0;
        } catch (eParse) {}
      }
    }
  } catch (eIso) {}

  // Post processing (same spirit as v4)
  stats.bold_applied = applyBoldFormatting(doc);
  appendFile(progressPath, String(new Date()) + " :: bold_done count=" + stats.bold_applied + "\n");
  stats.bullets_fixed = fixBulletLists(doc);
  appendFile(progressPath, String(new Date()) + " :: bullets_done count=" + stats.bullets_fixed + "\n");
  // Chapter boundary: validate → fix → validate again (so summary reflects final state)
  stats.chapter_boundary_before = validateChapterBoundaryPages(doc);
  appendFile(progressPath, String(new Date()) + " :: chapter_boundary_before_done\n");
  stats.chapter_boundary_fix = enforceChapterBoundaryForCh1(doc);
  appendFile(progressPath, String(new Date()) + " :: chapter_boundary_fix_done\n");
  stats.chapter_boundary = validateChapterBoundaryPages(doc);
  appendFile(progressPath, String(new Date()) + " :: chapter_boundary_after_done\n");
  stats.spacing_fix = fixPunctuationSpacingInScope(doc);
  appendFile(progressPath, String(new Date()) + " :: spacing_fix_done changed=" + stats.spacing_fix.paras_changed + "\n");
  stats.spacing_fix_upper = fixMissingSpaceAfterSentencePunctUpperInScope(doc);
  appendFile(progressPath, String(new Date()) + " :: spacing_fix_upper_done changed=" + stats.spacing_fix_upper.paras_changed + "\n");
  stats.spacing_fix_validate = fixValidateWhitespaceSpacingInScope(doc);
  appendFile(progressPath, String(new Date()) + " :: spacing_fix_validate_done changed=" + stats.spacing_fix_validate.paras_changed + "\n");
  // Important: fixPunctuationSpacingInScope may reset per-paragraph singleWordJustification in some layouts.
  // Re-apply justification + single-word rules AFTER spacing fixes so the final output matches book layout.
  stats.justification = applyJustificationRules(doc);
  appendFile(progressPath, String(new Date()) + " :: justification_done (post_spacing)\n");
  // Glue scan can be slow on large documents. If chapter_filter is present, it will be scoped,
  // but keep it optional to prevent unexpected hangs.
  stats.glue_scan = null;
  try {
    if (chapterFilterNum > 0) {
      stats.glue_scan = scanForSuspiciousGlue(doc);
      appendFile(progressPath, String(new Date()) + " :: glue_scan_done\n");
    } else {
      appendFile(progressPath, String(new Date()) + " :: glue_scan_skipped (no chapter_filter)\n");
    }
  } catch (eGlue) {
    appendFile(progressPath, String(new Date()) + " :: glue_scan_error " + String(eGlue) + "\n");
    stats.glue_scan = null;
  }

  // Save new output file
  if (!OUTPUT_FOLDER.exists) OUTPUT_FOLDER.create();
  var docBase = safeName(doc.name).replace(/_ORIGINAL/i, "").replace(/_REWRITTEN/i, "");
  var outBase = OUTPUT_FOLDER.fsName + "/" + docBase;
  var outFile = File(outBase + "_REWRITTEN_V5_SAFE.indd");
  if (outFile.exists) {
    var v = 2;
    while (v < 200) {
      var candidate = File(outBase + "_REWRITTEN_V5_SAFE_V" + v + ".indd");
      if (!candidate.exists) { outFile = candidate; break; }
      v++;
    }
  }
  var saveOk = false;
  var saveErr = "";
  appendFile(progressPath, String(new Date()) + " :: save_start out=" + (outFile ? outFile.fsName : "(null)") + "\n");
  try {
    // Prefer saveACopy: safer for "start from original" workflows and avoids occasional save() hangs on large docs.
    doc.saveACopy(outFile);
    saveOk = true;
  } catch (eSave1) {
    saveErr = String(eSave1);
  }
  if (!saveOk) {
    // Fallback: try save() (may change doc name/location)
    try {
      doc.save(outFile);
      saveOk = true;
    } catch (eSave2) {
      if (saveErr) saveErr += " | ";
      saveErr += String(eSave2);
    }
  }
  appendFile(progressPath, String(new Date()) + " :: save_done ok=" + (saveOk ? "1" : "0") + "\n");

  var duration = Math.round((new Date().getTime() - startTime) / 1000);

  // JSON coverage report (which rewrites were actually applied)
  function tsvSafeCell(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    try { t = t.replace(/\t/g, " "); } catch (e1) {}
    // Remove all known line terminators (including Unicode line separators) to prevent broken TSV rows.
    try { t = t.replace(/[\r\n]/g, " "); } catch (e2) {}
    try { t = t.replace(/[\u2028\u2029]/g, " "); } catch (e3) {}
    // Remove other control chars that can sneak in from InDesign exports.
    try { t = t.replace(/[\u0000-\u001F\u007F]/g, " "); } catch (e4) {}
    try { t = t.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); } catch (e5) {}
    // Keep TSV ASCII-friendly (avoid Unicode ellipsis encoding issues).
    if (t.length > 160) t = t.substring(0, 160) + "...";
    return t;
  }
  var usedCount = 0;
  var unusedCount = 0;
  try {
    writeFile(coveragePath, "paragraph_id\tchapter\tparagraph_number\tstyle_name\tused_count\toriginal_snippet\trewritten_snippet\n");
    for (var ci = 0; ci < rewrites.paragraphs.length; ci++) {
      var rr2 = rewrites.paragraphs[ci];
      if (!rr2) continue;
      var pid2 = "";
      try { if (rr2.paragraph_id !== null && rr2.paragraph_id !== undefined) pid2 = String(rr2.paragraph_id); } catch (ePid2) { pid2 = ""; }
      var u = 0;
      try { if (pid2 && rewriteUsedById[pid2]) u = rewriteUsedById[pid2]; } catch (eU0) { u = 0; }
      if (u > 0) usedCount++; else unusedCount++;
      appendFile(
        coveragePath,
        pid2 + "\t" +
          ((rr2.chapter !== null && rr2.chapter !== undefined) ? String(rr2.chapter) : "") + "\t" +
          ((rr2.paragraph_number !== null && rr2.paragraph_number !== undefined) ? String(rr2.paragraph_number) : "") + "\t" +
          ((rr2.style_name !== null && rr2.style_name !== undefined) ? String(rr2.style_name) : "") + "\t" +
          String(u) + "\t" +
          tsvSafeCell(rr2.original) + "\t" +
          tsvSafeCell(rr2.rewritten) + "\n"
      );
    }
  } catch (eCov) {}

  var summary = [];
  summary.push("=== SAFE REWRITE PIPELINE v5 ===");
  summary.push("Doc: " + doc.name);
  summary.push("Duration: " + duration + "s");
  summary.push("Rewrite map keys: " + mapSize);
  try {
    summary.push("JSON coverage: used=" + usedCount + "/" + mapSize + " unused=" + unusedCount + " (see " + coveragePath + ")");
  } catch (eCovSum) {}
  summary.push("");
  summary.push("Stories total: " + stats.stories_total);
  summary.push("Stories eligible: " + stats.stories_eligible);
  summary.push("Stories skipped: " + stats.stories_skipped);
  summary.push("");
  summary.push("Paragraphs checked: " + stats.paras_checked);
  summary.push("Too short: " + stats.paras_short);
  summary.push("Label-skipped: " + stats.paras_label_skipped);
  summary.push("Matched: " + stats.paras_matched);
  summary.push("Replaced: " + stats.paras_replaced);
  summary.push("No match: " + stats.paras_skipped_no_match);
  summary.push("Replace errors: " + stats.replace_errors);
  summary.push("Anchors-preserved replaces: " + stats.anchors_preserved_replaces);
  summary.push("Legacy key used (80): " + stats.legacy_key_used_80);
  summary.push("Legacy key used (30): " + stats.legacy_key_used_30);
  summary.push("Fuzzy used: " + stats.fuzzy_used);
  summary.push("");
  summary.push("Bold headers applied: " + stats.bold_applied);
  summary.push("Bullets fixed: " + stats.bullets_fixed);
  try {
    if (stats.justification) {
      summary.push(
        "Justification: considered=" + stats.justification.paras_considered +
          " layer_left_align=" + stats.justification.paras_layer_left_align +
          " body_left_justified=" + stats.justification.paras_body_left_justified +
          " single_word_left=" + stats.justification.paras_single_word_left +
          " skipped_labelish=" + stats.justification.paras_skipped_labelish +
          " skipped_caption=" + stats.justification.paras_skipped_caption +
          " errors=" + stats.justification.errors
      );
    }
  } catch (eJSum) {}
  try {
    if (stats.chapter_boundary) {
      summary.push("Chapter boundary: chapters_found=" + stats.chapter_boundary.chapters_found + " failures=" + stats.chapter_boundary.failures.length);
      if (stats.chapter_boundary.failures.length) {
        summary.push("Chapter boundary failures:");
        for (var iF = 0; iF < stats.chapter_boundary.failures.length && iF < 20; iF++) {
          summary.push("  - " + stats.chapter_boundary.failures[iF]);
        }
      }
    }
  } catch (eCB) {}
  try {
    if (stats.glue_scan) {
      summary.push("Glue scan: paras_scanned=" + stats.glue_scan.paras_scanned + " hits=" + stats.glue_scan.hits);
      if (stats.glue_scan.samples && stats.glue_scan.samples.length) {
        summary.push("Glue scan samples:");
        for (var g = 0; g < stats.glue_scan.samples.length; g++) {
          summary.push("  - " + stats.glue_scan.samples[g]);
        }
      }
    }
  } catch (eG) {}
  summary.push("");
  summary.push("Saved: " + (saveOk ? (outFile ? outFile.fsName : "(unknown)") : "(FAILED)"));
  if (!saveOk) summary.push("Save error: " + saveErr);
  summary.push("Replaced TSV: " + tsvPath);
  summary.push("Replaced TSV (detailed): " + tsvDetailedPath);

  writeFile(summaryPath, summary.join("\n"));
  appendFile(progressPath, String(new Date()) + " :: summary_written\n");

  // If save succeeded, close the modified ORIGINAL without saving and open the rewritten output.
  // This prevents accidental prompts and keeps the baseline file untouched.
  if (saveOk) {
    try { doc.close(SaveOptions.NO); } catch (eClose0) {}
    try {
      var outDoc = app.open(outFile, false);
      try { app.activeDocument = outDoc; } catch (eAD0) {}
    } catch (eOpen0) {}
  }

  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI2) {}
})();

