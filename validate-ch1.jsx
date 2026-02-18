// Chapter 1 validation for the CH1 preview doc.
// Checks (CH1 only):
// - Links/fonts (doc-wide quick sanity)
// - Overset frames that are on CH1 pages
// - Headings "In de praktijk:" / "Verdieping:" are present & bold (CH1 only)
// - Paragraphs containing headings follow the same book layout (LEFT_JUSTIFIED). (No ragged-right blocks.)
// - Whitespace anomalies in CH1 paragraphs (double spaces, missing space after punctuation patterns)
//
// Does not save.

// When running automated suites, multiple documents may be open.
// Prefer validating the ACTIVE document to avoid accidentally validating an older baseline tab.
var PREFER_ACTIVE_DOC = true;
var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";
// Optional: scanning *all* CH1 stories can be slow in large docs; keep this off by default.
var INCLUDE_NON_BODY_DOUBLE_SPACE_INFO = false;
// Captions often intentionally contain double spaces (e.g., "Afbeelding 1.2␠␠...") and are layout-sensitive.
var IGNORE_CAPTION_DOUBLE_SPACES = true;
// Hard-fail if any layer heading ("In de praktijk:" / "Verdieping:") is not Option A compliant in the CH1 BODY story.
// Option A requirements (strict):
// - MUST be preceded by a blank line inside the SAME paragraph: "\n\n"
// - MUST start at beginning of a line (implied by "\n\n")
// - The label itself MUST be bold, and the first non-space character after the label MUST NOT be bold
var HARD_FAIL_ON_LAYER_HEADING_STRUCTURE = true;
// Hard-fail if CH1 body-story text leaks onto Chapter-2 opener/image pages near the ^2.1 boundary.
// This specifically catches the reported issue where "1.4 Transport en metabolisme" continues onto a page
// that uses the opener master + has CH2 image assets.
var HARD_FAIL_ON_CH2_IMAGE_PAGE_LEAK = true;
// Hard-fail if any CH1 body pages appear to be missing a body-story column frame (common cause of text jumping/leaking).
var HARD_FAIL_ON_MISSING_BODY_COLUMN_FRAMES = true;
// How many pages before ^2.1 to inspect for potential CH2 opener/image pages.
var CH2_LEAK_LOOKBACK_PAGES = 8;
// Master name heuristic for chapter-opener/image pages in this book template.
var CHAPTER_OPENER_MASTER_NAME = "B-Master";
// Master name for normal CH1 body pages (2-column layout as separate 1-col frames).
// Expected column frame X-bounds for this template (spread coordinates).
// We only compare left/right (x1/x2) with tolerance; top/bottom can vary on image pages.
var COL_TOL = 4; // points
var L_COL1 = { x1: 15,  x2: 93 };
var L_COL2 = { x1: 102, x2: 180 };
var R_COL1 = { x1: 210, x2: 288 };
var R_COL2 = { x1: 297, x2: 375 };

function getBaselineDocOrNull() {
  // Returns an open baseline doc if present, otherwise opens it (read-only intent).
  // Restores the previous activeDocument if we had to open it.
  var baselinePath = TARGET_DOC_PATH;
  if (!baselinePath) return null;
  var base = null;
  try {
    for (var i = 0; i < app.documents.length; i++) {
      var d = app.documents[i];
      try { if (d.fullName && d.fullName.fsName === baselinePath) { base = d; break; } } catch (e0) {}
    }
  } catch (e1) {}
  if (base) return base;
  // If we're already validating the baseline itself, don't re-open.
  try {
    var ad = app.activeDocument;
    if (ad && ad.fullName && ad.fullName.fsName === baselinePath) return ad;
  } catch (e2) {}

  var prev = null;
  try { prev = app.activeDocument; } catch (e3) { prev = null; }
  try {
    var f = File(baselinePath);
    if (f && f.exists) {
      // Open without showing a new window (best effort).
      try { base = app.open(f, false); } catch (eOpen0) { base = app.open(f); }
    }
  } catch (e4) { base = null; }
  try { if (prev) app.activeDocument = prev; } catch (e5) {}
  return base;
}

function getDocByPathOrActive(path) {
  var doc = null;
  if (PREFER_ACTIVE_DOC) {
    try { doc = app.activeDocument; } catch (e0) { doc = null; }
    if (doc) return doc;
  }
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) { doc = d; break; } } catch (e) {}
  }
  if (!doc) { try { doc = app.activeDocument; } catch (e2) { doc = null; } }
  // Some InDesign contexts (e.g., when opening docs without a window) can throw on app.activeDocument
  // even though documents exist. Fallback to the first open doc so automated suites don’t fail.
  if (!doc) {
    try { if (app.documents.length > 0) doc = app.documents[0]; } catch (e3) { doc = null; }
  }
  return doc;
}

function resetFind() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  try { app.changeTextPreferences = NothingEnum.nothing; } catch (e2) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e3) {}
  try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e4) {}
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
  try {
    var tf = textObj.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e) {}
  return null;
}

function getChapterRange(doc) {
  // CH1 scope:
  // - Start marker: "^1.1" (stable and avoids matching numbered lists like "1 ...", "2 ...")
  // - End marker: chapter-2 CHAPTER HEADER (style-aware) if present; fallback "^2.1"
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var endOff = -1;
  var ch2HeaderOff = findChapterHeaderPageOffset(doc, 2, startOff);
  if (ch2HeaderOff >= 0) {
    endOff = ch2HeaderOff - 1;
  } else {
    var f2 = findGrep(doc, "^2\\.1");
    var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
    endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
  }
  if (endOff < startOff) endOff = doc.pages.length - 1;

  return { startOff: startOff, endOff: endOff };
}

function paraStartPageOffset(para) {
  try {
    var ip = para.insertionPoints[0];
    var tf = ip.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage.documentOffset;
  } catch (e0) {}
  try {
    var tf2 = para.parentTextFrames[0];
    if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset;
  } catch (e1) {}
  return -1;
}

function isChapterHeaderStyleName(styleName) {
  var s = String(styleName || "").toLowerCase();
  return s.indexOf("chapter header") !== -1 || s.indexOf("hoofdstuk") !== -1;
}

function trimParaText(txt) {
  var t = "";
  try { t = String(txt || ""); } catch (e0) { t = ""; }
  if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
  try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
  return t;
}

function findChapterHeaderPageOffset(doc, chapterNum, minOffOrNull) {
  var best = -1;
  var re = null;
  try { re = new RegExp("^" + String(chapterNum) + "(?:\\\\.|\\\\b)"); } catch (eR) { re = null; }
  if (!re) return -1;
  var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var story = doc.stories[s];
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
      if (!isChapterHeaderStyleName(styleName)) continue;
      var off = paraStartPageOffset(para);
      if (off < 0) continue;
      if (minOff >= 0 && off < minOff) continue;
      var t = "";
      try { t = trimParaText(para.contents); } catch (eT) { t = ""; }
      if (!t) continue;
      if (!re.test(t)) continue;
      if (best < 0 || off < best) best = off;
    }
  }
  return best;
}

function isCaptionLikeParaText(txt) {
  var t = "";
  try { t = String(txt || ""); } catch (e0) { t = ""; }
  if (!t) return false;
  if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
  t = t.replace(/^\s+/, "");
  try { return !!t.match(/^Afbeelding\s+\d+(?:\.\d+)?\s{2,}/); } catch (e1) { return false; }
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
  var bestIdx = -1;
  var bestWords = -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var wc = storyWordCountInRange(doc.stories[s], startOff, endOff);
    if (wc > bestWords) { bestWords = wc; bestIdx = s; }
  }
  return { index: bestIdx, words: bestWords };
}

function auditLinks(doc) {
  var total = 0, missing = 0, outOfDate = 0;
  try { total = doc.links.length; } catch (e0) { total = 0; }
  for (var i = 0; i < total; i++) {
    var link = doc.links[i];
    var st = null;
    try { st = link.status; } catch (e1) { st = null; }
    if (st == LinkStatus.LINK_MISSING) missing++;
    else if (st == LinkStatus.LINK_OUT_OF_DATE) outOfDate++;
  }
  return { total: total, missing: missing, outOfDate: outOfDate };
}

function auditFonts(doc) {
  var total = 0, missing = 0;
  try { total = doc.fonts.length; } catch (e0) { total = 0; }
  for (var i = 0; i < total; i++) {
    var f = doc.fonts[i];
    var st = null;
    try { st = f.status; } catch (e1) { st = null; }
    if (st == FontStatus.NOT_AVAILABLE) missing++;
  }
  return { total: total, missing: missing };
}

function oversetFramesInRange(doc, startOff, endOff) {
  var count = 0;
  var sample = [];
  try {
    for (var i = 0; i < doc.textFrames.length; i++) {
      var tf = doc.textFrames[i];
      var ov = false;
      try { ov = !!tf.overflows; } catch (e0) { ov = false; }
      if (!ov) continue;
      var pg = null;
      var off = -1;
      try { pg = tf.parentPage; } catch (e1) { pg = null; }
      if (!pg) continue;
      try { off = pg.documentOffset; } catch (e2) { off = -1; }
      if (off < startOff || off > endOff) continue;
      count++;
      if (sample.length < 10) sample.push(String(pg.name));
    }
  } catch (e3) {}
  return { count: count, samplePages: sample };
}

function countBoldLabelsInRange(doc, label, startOff, endOff) {
  resetFind();
  try { app.findChangeTextOptions.caseSensitive = true; } catch (e0) {}
  app.findTextPreferences.findWhat = label;
  var f = [];
  try { f = doc.findText(); } catch (e1) { f = []; }
  resetFind();

  var total = 0;
  var boldOk = 0;
  for (var i = 0; i < f.length; i++) {
    var t = f[i];
    var pg = pageOfText(t);
    if (!pg) continue;
    var off = -1;
    try { off = pg.documentOffset; } catch (e2) { off = -1; }
    if (off < startOff || off > endOff) continue;
    total++;
    try {
      var fs = String(t.characters[0].fontStyle || "");
      if (fs.toLowerCase().indexOf("bold") !== -1) boldOk++;
    } catch (e3) {}
  }
  return { total: total, boldOk: boldOk };
}

function isBoldChar(ch) {
  try {
    var fs = String(ch.fontStyle || "");
    return fs.toLowerCase().indexOf("bold") !== -1;
  } catch (e) {
    return false;
  }
}

function inspectPageForGraphicsAndBodyText(doc, bodyStoryOrNull, pageOff) {
  // Uses allPageItems so master-based items are included.
  var res = {
    pageOff: pageOff,
    pageName: "?",
    master: "?",
    graphicsCount: 0,
    graphicLinks: [], // up to 6
    bodyWords: 0,
    bodyTextSamples: [] // up to 3
  };
  if (!doc) return res;
  if (pageOff < 0) return res;
  if (pageOff >= doc.pages.length) return res;
  var pg = null;
  try { pg = doc.pages[pageOff]; } catch (eP) { pg = null; }
  if (!pg || !pg.isValid) return res;
  try { res.pageName = String(pg.name); } catch (eN) { res.pageName = "?"; }
  try { res.master = (pg.appliedMaster ? String(pg.appliedMaster.name) : "(none)"); } catch (eM) { res.master = "?"; }

  function cleanOneLine(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    t = t.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    return t;
  }

  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }

  var items = [];
  try { items = pg.allPageItems; } catch (eAll) { items = []; }
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !it.isValid) continue;

    // Graphics
    var hasGraphic = false;
    try { hasGraphic = (it.allGraphics && it.allGraphics.length > 0); } catch (eG) { hasGraphic = false; }
    if (hasGraphic) {
      res.graphicsCount++;
      if (res.graphicLinks.length < 6) {
        var ln = "";
        try {
          var gr = it.allGraphics[0];
          if (gr && gr.isValid && gr.itemLink) ln = String(gr.itemLink.name || "");
        } catch (eL) { ln = ""; }
        if (ln) res.graphicLinks.push(ln);
      }
    }

    // Body-story text frames
    if (bodyStoryOrNull && ctorName(it) === "TextFrame") {
      var tf = it;
      var st = null;
      try { st = tf.parentStory; } catch (eS) { st = null; }
      if (st === bodyStoryOrNull) {
        try { res.bodyWords += tf.words.length; } catch (eW) {}
        if (res.bodyTextSamples.length < 3) {
          var txt = "";
          try { txt = cleanOneLine(tf.contents); } catch (eT) { txt = ""; }
          if (txt && txt.length > 12) res.bodyTextSamples.push(txt.substring(0, 170));
        }
      }
    }
  }

  return res;
}

function ch2ImagePageLeakAudit(doc, startOff, endOff, bodyStoryIndex) {
  // Detect CH1 body-story text on pages that look like Chapter-2 opener/image pages.
  // Heuristic: pages in a lookback window before ^2.1 whose master is CHAPTER_OPENER_MASTER_NAME
  // and which contain any graphics.
  var res = { checked: 0, leaks: 0, samples: [] };
  function addSample(line) {
    if (res.samples.length >= 10) return;
    res.samples.push(line);
  }
  if (!doc) return res;
  if (!(bodyStoryIndex >= 0)) return res;
  var bodyStory = null;
  try { bodyStory = doc.stories[bodyStoryIndex]; } catch (eS) { bodyStory = null; }
  if (!bodyStory) return res;

  // We use CH1 endOff as anchor: endOff = (^2.1 pageOff - 1) in validate-ch1.
  var off2 = endOff + 1;
  if (off2 < 0 || off2 >= doc.pages.length) return res;

  var lb = CH2_LEAK_LOOKBACK_PAGES;
  if (!(lb >= 2)) lb = 2;
  var from = off2 - lb;
  var to = off2 - 1;
  if (from < 0) from = 0;
  if (to < 0) return res;

  for (var po = from; po <= to; po++) {
    var info = inspectPageForGraphicsAndBodyText(doc, bodyStory, po);
    res.checked++;
    // Candidate opener/image page?
    var isOpenerMaster = false;
    try { isOpenerMaster = (String(info.master) === String(CHAPTER_OPENER_MASTER_NAME)); } catch (eM) { isOpenerMaster = false; }
    if (!isOpenerMaster) continue;
    if (!(info.graphicsCount > 0)) continue;
    if (!(info.bodyWords > 0)) continue;

    res.leaks++;
    addSample(
      "pageOff=" + info.pageOff + " page=" + info.pageName +
        " master=" + info.master +
        " bodyWords=" + info.bodyWords +
        " graphics=" + info.graphicsCount +
        (info.graphicLinks.length ? (" links=" + info.graphicLinks.join(",")) : "") +
        (info.bodyTextSamples.length ? (" textSample=\"" + info.bodyTextSamples[0] + "\"") : "")
    );
  }

  return res;
}

function bodyColumnFrameAudit(doc, startOff, endOff, bodyStoryIndex) {
  // Detect missing left/right column frames on normal body pages (BODY_MASTER_NAME).
  // This catches the root cause of “column 2 jumps to another page” issues.
  var res = { pagesChecked: 0, missingPages: 0, samples: [] };
  function addSample(line) { if (res.samples.length < 10) res.samples.push(line); }
  function approxEq(a, b) { return Math.abs(a - b) <= COL_TOL; }
  function localCtorName(o) {
    try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; }
  }
  if (!doc) return res;
  if (!(bodyStoryIndex >= 0)) return res;
  var bodyStory = null;
  try { bodyStory = doc.stories[bodyStoryIndex]; } catch (eS) { bodyStory = null; }
  if (!bodyStory) return res;

  for (var po = startOff; po <= endOff; po++) {
    var pg = doc.pages[po];
    if (!pg || !pg.isValid) continue;
    var m = "";
    try { m = pg.appliedMaster ? String(pg.appliedMaster.name) : ""; } catch (eM) { m = ""; }

    // Collect body-story frames on this page (including master items).
    var frames = [];
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (localCtorName(it) !== "TextFrame") continue;
        var st = null;
        try { st = it.parentStory; } catch (eS2) { st = null; }
        if (st !== bodyStory) continue;
        frames.push(it);
      }
    } catch (eAll) {}

    // Do not rely on page.side: some docs start on LEFT page and some are non-facing.
    // Instead, detect columns purely by their X bounds.
    var hasL1 = false;
    var hasL2 = false;
    var hasR1 = false;
    var hasR2 = false;
    var bSamples = [];
    for (var f = 0; f < frames.length; f++) {
      var tf = frames[f];
      var b = null;
      try { b = tf.geometricBounds; } catch (eB) { b = null; }
      if (b && b.length === 4) {
        if (bSamples.length < 3) bSamples.push("[" + Math.round(b[1]) + "," + Math.round(b[3]) + "]");
        if (approxEq(b[1], L_COL1.x1) && approxEq(b[3], L_COL1.x2)) hasL1 = true;
        if (approxEq(b[1], L_COL2.x1) && approxEq(b[3], L_COL2.x2)) hasL2 = true;
        if (approxEq(b[1], R_COL1.x1) && approxEq(b[3], R_COL1.x2)) hasR1 = true;
        if (approxEq(b[1], R_COL2.x1) && approxEq(b[3], R_COL2.x2)) hasR2 = true;
      }
    }

    // Only audit pages that appear to be using the standard 2-column bounds.
    if (!(hasL1 || hasL2 || hasR1 || hasR2)) continue;
    res.pagesChecked++;

    var missingLeft = ((hasL1 || hasL2) && !(hasL1 && hasL2));
    var missingRight = ((hasR1 || hasR2) && !(hasR1 && hasR2));
    if (missingLeft || missingRight) {
      res.missingPages++;
      var miss = [];
      if (missingLeft) miss.push("LEFT_PAIR");
      if (missingRight) miss.push("RIGHT_PAIR");
      addSample(
        "pageOff=" + po +
          " page=" + String(pg.name) +
          " master=" + m +
          " frames=" + frames.length +
          " missing=" + miss.join(",") +
          " L=" + (hasL1 ? "1" : "0") + "/" + (hasL2 ? "1" : "0") +
          " R=" + (hasR1 ? "1" : "0") + "/" + (hasR2 ? "1" : "0") +
          (bSamples.length ? (" bounds=" + bSamples.join(",")) : "")
      );
    }
  }

  return res;
}

function layerHeadingStructureInBody(doc, startOff, endOff, bodyStoryIndex) {
  // Strictly validates Option A structure in the BODY STORY only (to avoid false positives in captions/callouts).
  //
  // Returns:
  // { labelHits, labelOk, labelBad, nonLabelLineStarts, errors, samples[] }
  var res = { labelHits: 0, labelOk: 0, labelBad: 0, nonLabelLineStarts: 0, errors: 0, samples: [] };

  function addSample(line) {
    if (res.samples.length >= 12) return;
    res.samples.push(line);
  }

  function cleanSnippet(raw) {
    var t = "";
    try { t = String(raw || ""); } catch (e0) { t = ""; }
    try { t = t.replace(/\r/g, "\\r").replace(/\n/g, "\\n"); } catch (e1) {}
    if (t.length > 220) t = t.substring(0, 220) + "…";
    return t;
  }

  function nextNonSpaceIndex(txt, from) {
    var i = from;
    while (i < txt.length) {
      var ch = txt.charAt(i);
      if (ch === " " || ch === "\t" || ch === "\u00A0") { i++; continue; } // include NBSP
      return i;
    }
    return -1;
  }

  function validateLabelAt(para, off, txt, label, idx) {
    res.labelHits++;
    var hadErr = false;

    // 1) Must be preceded by a blank line inside the same paragraph: "\n\n"
    var hasBlankLine = (idx >= 2 && txt.charAt(idx - 1) === "\n" && txt.charAt(idx - 2) === "\n");
    if (!hasBlankLine) {
      res.errors++;
      hadErr = true;
      addSample("pageOff=" + off + " :: " + label + " missing blank line before label (expected \\\\n\\\\n) :: " + cleanSnippet(txt));
    } else {
      // Disallow >2 newlines before the label (extra empty lines).
      if (idx >= 3 && txt.charAt(idx - 3) === "\n") {
        res.errors++;
        hadErr = true;
        addSample("pageOff=" + off + " :: " + label + " has EXTRA blank line(s) before label (expected exactly one blank line) :: " + cleanSnippet(txt));
      }
    }

    // 2) Label must be bold (all characters)
    var labelBoldOk = true;
    try {
      for (var k = 0; k < label.length; k++) {
        var cIdx = idx + k;
        if (cIdx < 0 || cIdx >= para.characters.length) { labelBoldOk = false; break; }
        if (!isBoldChar(para.characters[cIdx])) { labelBoldOk = false; break; }
      }
    } catch (eB) { labelBoldOk = false; }
    if (!labelBoldOk) {
      res.errors++;
      hadErr = true;
      addSample("pageOff=" + off + " :: " + label + " label NOT bold :: " + cleanSnippet(txt));
    }

    // 3) Label must be followed by inline text on the same line, and that text should not be bold
    var afterIdx = idx + label.length;
    // Require at least one whitespace after the label (common style: ":␠text")
    // Accept normal space and NBSP to avoid false positives.
    if (afterIdx >= txt.length) {
      res.errors++;
      hadErr = true;
      addSample("pageOff=" + off + " :: " + label + " missing whitespace after label ':' :: " + cleanSnippet(txt));
    } else {
      var chAfter = txt.charAt(afterIdx);
      var okWs = (chAfter === " " || chAfter === "\t" || chAfter === "\u00A0");
      if (!okWs) {
        res.errors++;
        hadErr = true;
        addSample("pageOff=" + off + " :: " + label + " missing whitespace after label ':' :: " + cleanSnippet(txt));
      }
    }
    var nn = nextNonSpaceIndex(txt, afterIdx);
    if (nn < 0) {
      res.errors++;
      hadErr = true;
      addSample("pageOff=" + off + " :: " + label + " has NO inline text after label :: " + cleanSnippet(txt));
    } else {
      if (txt.charAt(nn) === "\n") {
        res.errors++;
        hadErr = true;
        addSample("pageOff=" + off + " :: " + label + " starts a NEW LINE after label (Option A requires inline text) :: " + cleanSnippet(txt));
      } else {
        // First non-space char after the label should not be bold (only the label is bold)
        var afterBold = false;
        try { afterBold = isBoldChar(para.characters[nn]); } catch (eAB) { afterBold = false; }
        if (afterBold) {
          res.errors++;
          hadErr = true;
          addSample("pageOff=" + off + " :: " + label + " text AFTER label is bold (should only bold the label) :: " + cleanSnippet(txt));
        }
      }
    }

    if (hadErr) res.labelBad++; else res.labelOk++;
  }

  var story = null;
  try { story = doc.stories[bodyStoryIndex]; } catch (eS) { story = null; }
  if (!story) return res;

  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < startOff || off > endOff) continue;

    var txt = "";
    try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
    if (!txt) continue;
    if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);

    // Detect any line-start "In de praktijk" / "Verdieping" token that is NOT the label with ":".
    // This catches baseline patterns like "\nIn de praktijk Bij ..." and Option B standalone lines.
    try {
      function scanLineStartToken(token) {
        var tokenLower = String(token).toLowerCase();
        var lines = String(txt || "").split("\n");
        for (var li0 = 0; li0 < lines.length; li0++) {
          var rawLine = String(lines[li0] || "");
          // Trim start only (keep trailing text for context)
          var line = rawLine.replace(/^[ \t\u00A0]+/, "");
          var low = line.toLowerCase();
          if (low.indexOf(tokenLower) !== 0) continue;
          var chAfter = (line.length > token.length) ? line.charAt(token.length) : "";
          if (chAfter === ":") continue; // ok label
          res.nonLabelLineStarts++;
          res.errors++;
          addSample("pageOff=" + off + " :: Line-start '" + token + "' without ':' (must be '" + token + ":') :: " + cleanSnippet(txt));
          // One sample per paragraph is enough; avoid spamming.
          return;
        }
      }
      scanLineStartToken("In de praktijk");
      scanLineStartToken("Verdieping");
    } catch (eOB) {}

    // Validate each label occurrence within the paragraph
    var labels = ["In de praktijk:", "Verdieping:"];
    for (var li = 0; li < labels.length; li++) {
      var label = labels[li];
      var idx = txt.indexOf(label);
      while (idx !== -1) {
        validateLabelAt(para, off, txt, label, idx);
        idx = txt.indexOf(label, idx + label.length);
      }
    }
  }

  return res;
}

function whitespaceAnomaliesInCh1(doc, startOff, endOff, storyIndexOrNull) {
  var doubleSpaces = 0;
  var missingAfterPunct = 0;
  var spacesBeforePunct = 0;
  var samples = [];

  function addSample(pgName, snippet, kind) {
    if (samples.length >= 12) return;
    samples.push(kind + " page=" + pgName + " :: " + snippet);
  }

  function snippetAround(text, idx) {
    var t = String(text || "");
    var i = (idx && idx >= 0) ? idx : 0;
    var start = i - 40; if (start < 0) start = 0;
    var end = i + 60; if (end > t.length) end = t.length;
    var s = t.substring(start, end);
    // compact whitespace for readability
    try { s = s.replace(/\r/g, "\\r").replace(/\n/g, "\\n"); } catch (e0) {}
    try { s = s.replace(/\s+/g, " "); } catch (e1) {}
    return s;
  }

  function scanStory(story) {
    if (!story) return;
    try { if (story.words.length < 5) return; } catch (eW) {}
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);

      var isCaption = IGNORE_CAPTION_DOUBLE_SPACES && isCaptionLikeParaText(txt);

      // count anomalies
      if (!isCaption && txt.indexOf("  ") !== -1) {
        doubleSpaces++;
        addSample(String(off), txt.substring(0, 120), "double_space");
      }
      if (txt.match(/ ([,.;:!?])/)) {
        spacesBeforePunct++;
        addSample(String(off), txt.substring(0, 120), "space_before_punct");
      }
      var mSent = /([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/.exec(txt);
      if (mSent) {
        missingAfterPunct++;
        addSample(String(off), snippetAround(txt, mSent.index), "missing_space_after_sentence_punct");
      }
      var mSemi = /([A-Za-z\u00C0-\u00FF]);([A-Za-z\u00C0-\u00FF])/.exec(txt);
      if (mSemi) {
        missingAfterPunct++;
        addSample(String(off), snippetAround(txt, mSemi.index), "missing_space_after_semicolon");
      }
      var mComma = /([A-Za-z\u00C0-\u00FF]),([A-Za-z\u00C0-\u00FF])/.exec(txt);
      if (mComma) {
        missingAfterPunct++;
        addSample(String(off), snippetAround(txt, mComma.index), "missing_space_after_comma");
      }
      var mColon = /:([A-Za-z\u00C0-\u00FF])/.exec(txt);
      if (mColon) {
        missingAfterPunct++;
        addSample(String(off), snippetAround(txt, mColon.index), "missing_space_after_colon");
      }
    }
  }

  if (storyIndexOrNull !== null && storyIndexOrNull !== undefined) {
    var st = null;
    try { st = doc.stories[storyIndexOrNull]; } catch (eS) { st = null; }
    scanStory(st);
  } else {
    for (var s = 0; s < doc.stories.length; s++) scanStory(doc.stories[s]);
  }

  return {
    doubleSpaces: doubleSpaces,
    spacesBeforePunct: spacesBeforePunct,
    missingAfterPunct: missingAfterPunct,
    samples: samples
  };
}

function singleWordJustificationAudit(doc, startOff, endOff, bodyStoryIndex) {
  // Ensures short lines (single-word lines) don't get stretched across the full measure.
  // Requirement: singleWordJustification should be LEFT_ALIGN for body story in CH1 range.
  var res = { total: 0, ok: 0, bad: 0, samples: [] };
  function addSample(line) {
    if (res.samples.length >= 12) return;
    res.samples.push(line);
  }
  var story = null;
  try { story = doc.stories[bodyStoryIndex]; } catch (eS) { story = null; }
  if (!story) return res;
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < startOff || off > endOff) continue;
    res.total++;
    var swj = null;
    try { swj = para.singleWordJustification; } catch (eJ) { swj = null; }
    var ok = false;
    try { ok = (swj === Justification.LEFT_ALIGN); } catch (eCmp) { ok = false; }
    if (ok) res.ok++;
    else {
      res.bad++;
      addSample("pageOff=" + off + " swj=" + String(swj));
    }
  }
  return res;
}

function fullyJustifiedAudit(doc, startOff, endOff, bodyStoryIndex) {
  // Hard check: no FULLY_JUSTIFIED paragraphs in body story range (these stretch the last line).
  var res = { total: 0, fully: 0, samples: [] };
  function addSample(line) {
    if (res.samples.length >= 12) return;
    res.samples.push(line);
  }
  var story = null;
  try { story = doc.stories[bodyStoryIndex]; } catch (eS) { story = null; }
  if (!story) return res;
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < startOff || off > endOff) continue;
    res.total++;
    var j = null;
    try { j = para.justification; } catch (eJ) { j = null; }
    var isFull = false;
    try { isFull = (j === Justification.FULLY_JUSTIFIED); } catch (eCmp) { isFull = false; }
    if (isFull) {
      res.fully++;
      addSample("pageOff=" + off + " just=FULLY_JUSTIFIED");
    }
  }
  return res;
}

function layerParasAlignment(doc, startOff, endOff) {
  var total = 0;
  var bad = 0;
  var samples = [];
  for (var s = 0; s < doc.stories.length; s++) {
    var story = doc.stories[s];
    try { if (story.words.length < 5) continue; } catch (eW) {}
    for (var p = 0; p < story.paragraphs.length; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;
      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      if (txt.indexOf("In de praktijk:") === -1 && txt.indexOf("Verdieping:") === -1) continue;
      total++;
      try {
        // For paragraphs containing layer headings, we enforce LEFT_JUSTIFIED to match book layout.
        if (para.justification !== Justification.LEFT_JUSTIFIED) {
          bad++;
          if (samples.length < 10) samples.push("pageOff=" + off + " just=" + (para.justification && para.justification.toString ? para.justification.toString() : String(para.justification)));
        }
      } catch (eJ) {}
    }
  }
  return { total: total, bad: bad, samples: samples };
}

function safeFileName(name) {
  var s = "";
  try { s = String(name || ""); } catch (e0) { s = "doc"; }
  s = s.replace(/\.indd$/i, "");
  s = s.replace(/[^a-z0-9 _-]/gi, "");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^\s+|\s+$/g, "");
  if (!s) s = "doc";
  return s;
}

function isoStamp() {
  var d = new Date();
  function z(n) { return (n < 10 ? "0" : "") + n; }
  var s = d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  return s;
}

function writeTextToDesktop(filename, text) {
  try {
    var f = File(Folder.desktop + "/" + filename);
    f.encoding = "UTF-8";
    f.lineFeed = "Unix";
    if (f.open("w")) {
      f.write(String(text || ""));
      f.close();
    }
  } catch (e) {}
}

var out = [];
var hardFailures = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document open/resolved.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);

  var links = auditLinks(doc);
  out.push("[LINKS] missing=" + links.missing + " outOfDate=" + links.outOfDate);

  var fonts = auditFonts(doc);
  out.push("[FONTS] missing=" + fonts.missing);

  var ov = oversetFramesInRange(doc, range.startOff, range.endOff);
  out.push("[CH1 OVERSET FRAMES] " + ov.count + (ov.samplePages.length ? (" samplePages=" + ov.samplePages.join(",")) : ""));

  var pLab = countBoldLabelsInRange(doc, "In de praktijk:", range.startOff, range.endOff);
  var vLab = countBoldLabelsInRange(doc, "Verdieping:", range.startOff, range.endOff);
  out.push("[CH1 LABELS BOLD] praktijk=" + pLab.boldOk + "/" + pLab.total + " verdieping=" + vLab.boldOk + "/" + vLab.total);

  // Strict Option A structural validation (body story only)
  if (body.index >= 0) {
    var hs = layerHeadingStructureInBody(doc, range.startOff, range.endOff, body.index);
    out.push(
      "[CH1 LAYER HEADING STRUCTURE (STRICT, BODY)] labels_ok=" +
        hs.labelOk + "/" + hs.labelHits +
        " nonLabelLineStarts=" + hs.nonLabelLineStarts +
        " errors=" + hs.errors
    );
    if (hs.samples.length) out.push("  samples=" + hs.samples.join(" | "));
    if (HARD_FAIL_ON_LAYER_HEADING_STRUCTURE && hs.errors > 0) {
      hardFailures.push("Layer heading structure failures: " + hs.errors);
    }
  }

  // CH1 must NOT leak onto Chapter-2 opener/image pages (B-Master + graphics) near the boundary.
  if (body.index >= 0) {
    var leak = ch2ImagePageLeakAudit(doc, range.startOff, range.endOff, body.index);
    out.push("[CH1->CH2 IMAGE PAGE LEAK] checked=" + leak.checked + " leaks=" + leak.leaks);
    if (leak.samples.length) out.push("  samples=" + leak.samples.join(" | "));
    if (HARD_FAIL_ON_CH2_IMAGE_PAGE_LEAK && leak.leaks > 0) {
      hardFailures.push("CH2 image/opener page leak(s): " + leak.leaks);
    }
  }

  // Structural: missing 2nd column frame(s) on normal body pages is a common root cause for text jumping/leaking.
  if (body.index >= 0) {
    var cf = bodyColumnFrameAudit(doc, range.startOff, range.endOff, body.index);
    out.push("[CH1 BODY COLUMN FRAMES] checked=" + cf.pagesChecked + " missingPages=" + cf.missingPages);
    if (cf.samples.length) out.push("  samples=" + cf.samples.join(" | "));
    if (HARD_FAIL_ON_MISSING_BODY_COLUMN_FRAMES && cf.missingPages > 0) {
      hardFailures.push("Missing body column frames on " + cf.missingPages + " page(s)");
    }
  }

  var lp = layerParasAlignment(doc, range.startOff, range.endOff);
  out.push("[CH1 LAYER PARAS LEFT_JUSTIFIED] ok=" + (lp.total - lp.bad) + "/" + lp.total);
  if (lp.samples.length) out.push("  samples=" + lp.samples.join(" | "));

  // Body paragraph justification audit (body story only)
  if (body.index >= 0) {
    var ja = bodyParaJustificationAudit(doc, range.startOff, range.endOff, body.index);
    out.push("[CH1 BODY JUSTIFICATION] total=" + ja.total + " ok_left_justified=" + ja.ok_left_justified + "/" + ja.expected_left_justified + " mismatches=" + ja.mismatches);
    if (ja.samples.length) out.push("  samples=" + ja.samples.join(" | "));
  }

  // Single-word justification + FULLY_JUSTIFIED checks (body story only)
  if (body.index >= 0) {
    var swj = singleWordJustificationAudit(doc, range.startOff, range.endOff, body.index);
    out.push("[CH1 SINGLE-WORD JUSTIFICATION] ok=" + swj.ok + "/" + swj.total + " bad=" + swj.bad);
    if (swj.samples.length) out.push("  samples=" + swj.samples.join(" | "));
    var fj = fullyJustifiedAudit(doc, range.startOff, range.endOff, body.index);
    out.push("[CH1 FULLY_JUSTIFIED] count=" + fj.fully + "/" + fj.total);
    if (fj.samples.length) out.push("  samples=" + fj.samples.join(" | "));
  }

  // Whitespace anomalies are validated on the BODY STORY only to avoid false positives in captions/callouts.
  if (body.index >= 0) {
    var wsBody = whitespaceAnomaliesInCh1(doc, range.startOff, range.endOff, body.index);
    out.push("[CH1 BODY WHITESPACE] doubleSpaces=" + wsBody.doubleSpaces + " spacesBeforePunct=" + wsBody.spacesBeforePunct + " missingSpaceAfterPunct=" + wsBody.missingAfterPunct);
    if (wsBody.samples.length) out.push("  samples=" + wsBody.samples.join(" | "));

    // Optional info: if non-body stories still contain double-spaces, it's usually figure captions (e.g., 'Afbeelding 1.2␠␠...').
    if (INCLUDE_NON_BODY_DOUBLE_SPACE_INFO) {
      var wsAll = whitespaceAnomaliesInCh1(doc, range.startOff, range.endOff, null);
      var nonBodyDouble = Math.max(0, wsAll.doubleSpaces - wsBody.doubleSpaces);
      if (nonBodyDouble > 0) out.push("[CH1 NON-BODY DOUBLE SPACES] " + nonBodyDouble + " (often captions; only fix if desired)");
    }
  } else {
    var ws = whitespaceAnomaliesInCh1(doc, range.startOff, range.endOff, null);
    out.push("[CH1 WHITESPACE] doubleSpaces=" + ws.doubleSpaces + " spacesBeforePunct=" + ws.spacesBeforePunct + " missingSpaceAfterPunct=" + ws.missingAfterPunct);
    if (ws.samples.length) out.push("  samples=" + ws.samples.join(" | "));
  }

  // Chapter boundary pages (CH1-specific)
  if (body.index >= 0) {
    var cb = chapterBoundaryAuditForCh1(doc, body.index);
    out.push("[CH1 CHAPTER BOUNDARY] ok=" + (cb.ok ? "1" : "0") + " failures=" + cb.failures.length);
    if (cb.notes.length) out.push("  notes=" + cb.notes.join(" | "));
    if (cb.failures.length) out.push("  failures=" + cb.failures.join(" | "));
  }
}

function bodyParaJustificationAudit(doc, startOff, endOff, bodyStoryIndex) {
  var res = {
    total: 0,
    expected_left_justified: 0,
    expected_left_align: 0,
    ok_left_justified: 0,
    ok_left_align: 0,
    other: 0,
    mismatches: 0,
    samples: []
  };

  function addSample(off, msg) {
    if (res.samples.length >= 12) return;
    res.samples.push("pageOff=" + off + " :: " + msg);
  }

  var story = null;
  try { story = doc.stories[bodyStoryIndex]; } catch (eS) { story = null; }
  if (!story) return res;

  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < startOff || off > endOff) continue;
    var styleName = "";
    try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
    var txt = "";
    try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
    if (!txt) continue;
    if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);
    txt = String(txt).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!txt || txt.length < 8) continue;
    if (IGNORE_CAPTION_DOUBLE_SPACES && isCaptionLikeParaText(txt)) continue;

    // Skip headings/titles: they are typically LEFT_ALIGN and should not be forced into justification rules.
    var sn = String(styleName || "").toLowerCase();
    var looksNumberedHeading = false;
    try { looksNumberedHeading = /^\d+(?:\.\d+)*\b/.test(txt) && txt.length <= 90; } catch (eNH) { looksNumberedHeading = false; }
    if (sn.indexOf("kop") !== -1 || sn.indexOf("header") !== -1 || sn.indexOf("titel") !== -1 || sn.indexOf("title") !== -1 || looksNumberedHeading) {
      continue;
    }

    var isLayer = (txt.indexOf("In de praktijk:") !== -1) || (txt.indexOf("Verdieping:") !== -1);
    res.total++;
    // New rule: ALL body-story paragraphs (including those containing layer headings) are LEFT_JUSTIFIED.
    res.expected_left_justified++;

    var just = null;
    try { just = para.justification; } catch (eJ) { just = null; }
    var ok = false;
    try { ok = (just === Justification.LEFT_JUSTIFIED); } catch (e1) { ok = false; }
    if (ok) res.ok_left_justified++; else {
      res.mismatches++;
      addSample(off, "Para not LEFT_JUSTIFIED (just=" + String(just) + ") :: " + txt.substring(0, 90));
    }
  }

  return res;
}

function chapterBoundaryAuditForCh1(doc, bodyStoryIndex) {
  // CH1-specific boundary check:
  // - Start image page of chapter 1 (page before chapter-1 start marker) should have 0 BODY-STORY words.
  // - End blank page of chapter 1 (2 pages before chapter-2 start marker) should have 0 BODY-STORY words.
  // - Start image page of chapter 2 (page before chapter-2 start marker) should have 0 BODY-STORY words.
  var res = { ok: true, notes: [], failures: [] };

  function pageOffsetForMatch(re) {
    try {
      app.findGrepPreferences = NothingEnum.nothing;
      app.findGrepPreferences.findWhat = re;
      var found = doc.findGrep();
      if (found && found.length) {
        var pg = pageOfText(found[0]);
        if (pg) return pg.documentOffset;
      }
    } catch (e0) {}
    return -1;
  }

  function bodyWordsOnPage(pageOff) {
    if (pageOff < 0 || pageOff >= doc.pages.length) return 0;
    var pg = doc.pages[pageOff];
    var words = 0;
    try {
      var tfs = pg.textFrames;
      for (var i = 0; i < tfs.length; i++) {
        var tf = tfs[i];
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        try { if (!st || st !== doc.stories[bodyStoryIndex]) continue; } catch (eCmp) { continue; }
        try { words += tf.words.length; } catch (eW) {}
      }
    } catch (e1) {}
    return words;
  }

  var off1 = pageOffsetForMatch("^1\\.1");
  // IMPORTANT: use the first numbered section marker as the chapter-2 anchor.
  // Chapter header styles are not always present (and can be reused elsewhere), which can create false positives.
  var off2 = pageOffsetForMatch("^2\\.1");
  if (off2 < 0) off2 = findChapterHeaderPageOffset(doc, 2, off1); // fallback only
  if (off1 < 0) { res.notes.push("No ^1.1 marker found"); return res; }
  if (off2 < 0) { res.notes.push("No chapter-2 header (or ^2.1) marker found"); return res; }

  function pageHasAnyGraphics(pageOffset) {
    if (pageOffset < 0) return false;
    if (pageOffset >= doc.pages.length) return false;
    var pg = doc.pages[pageOffset];
    if (!pg || !pg.isValid) return false;
    // Use allPageItems to include master items (some chapter images are master-based).
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

  // Detect CH1 start image page by scanning backwards from ^1.1 for a graphic page with 0 body-story words.
  var ch1StartImage = -1;
  for (var o1 = off1 - 1; o1 >= 0 && o1 >= off1 - 12; o1--) {
    if (!pageHasAnyGraphics(o1)) continue;
    if (bodyWordsOnPage(o1) === 0) { ch1StartImage = o1; break; }
  }
  if (ch1StartImage < 0) ch1StartImage = off1 - 1; // fallback

  // CH2 start IMAGE page: usually a graphic page shortly BEFORE ^2.1 (often 1-2 pages back).
  // We detect it by scanning backwards for the nearest page that has any graphics.
  var ch2StartImage = -1;
  for (var o2 = off2 - 1; o2 >= 0 && o2 >= off2 - 12; o2--) {
    if (pageHasAnyGraphics(o2)) { ch2StartImage = o2; break; }
  }
  if (ch2StartImage < 0) ch2StartImage = off2 - 1; // fallback

  // CH1 blank end page: page immediately BEFORE ^2.1 (this is the user-visible "chapter ends with a blank page" rule).
  var ch1BlankEnd = off2 - 1;

  var wCh1Start = bodyWordsOnPage(ch1StartImage);
  var wCh1Blank = bodyWordsOnPage(ch1BlankEnd);
  var wCh2Start = bodyWordsOnPage(ch2StartImage);

  // Baseline comparison (avoid false positives when the template intentionally has text on the CH2 image page).
  var base = null;
  var baseBodyIdx = -1;
  var baseWCh1Start = -1;
  var baseWCh1Blank = -1;
  var baseWCh2Start = -1;
  try {
    base = getBaselineDocOrNull();
    if (base) {
      var rB = getChapterRange(base);
      var detB = detectBodyStoryIndex(base, rB.startOff, rB.endOff);
      baseBodyIdx = detB ? detB.index : -1;
      if (baseBodyIdx >= 0) {
        function baseBodyWordsOnPage(pageOff) {
          if (pageOff < 0 || pageOff >= base.pages.length) return 0;
          var pg = base.pages[pageOff];
          var words = 0;
          try {
            var tfs = pg.textFrames;
            for (var iB = 0; iB < tfs.length; iB++) {
              var tfB = tfs[iB];
              var stB = null;
              try { stB = tfB.parentStory; } catch (eSB) { stB = null; }
              try { if (!stB || stB !== base.stories[baseBodyIdx]) continue; } catch (eCmpB) { continue; }
              try { words += tfB.words.length; } catch (eWB) {}
            }
          } catch (e1B) {}
          return words;
        }
        baseWCh1Start = baseBodyWordsOnPage(ch1StartImage);
        baseWCh1Blank = baseBodyWordsOnPage(ch1BlankEnd);
        baseWCh2Start = baseBodyWordsOnPage(ch2StartImage);
      }
    }
  } catch (eBase) {}

  res.notes.push("CH1 start image pageOff=" + ch1StartImage + " bodyWords=" + wCh1Start);
  res.notes.push("CH1 end blank pageOff=" + ch1BlankEnd + " bodyWords=" + wCh1Blank);
  res.notes.push("CH2 start image pageOff=" + ch2StartImage + " bodyWords=" + wCh2Start);

  // Strict rules for CH1 start image + CH1 blank end: they must be text-free.
  if (ch1StartImage >= 0 && wCh1Start > 0) res.failures.push("CH1 start image page has body-story words (" + wCh1Start + ")");
  if (ch1BlankEnd >= 0 && wCh1Blank > 0) res.failures.push("CH1 end blank page has body-story words (" + wCh1Blank + ")");

  // CH2 start image page: compare to baseline to avoid false positives.
  if (ch2StartImage >= 0) {
    if (baseWCh2Start >= 0) {
      // Fail only if rewritten doc has MORE body words than baseline by a meaningful amount.
      var delta = wCh2Start - baseWCh2Start;
      var tol = 20; // words
      if (delta > tol) res.failures.push("CH2 start image page has MORE body-story words than baseline (delta=" + delta + ", baseline=" + baseWCh2Start + ", now=" + wCh2Start + ")");
      res.notes.push("CH2 start image baselineWords=" + baseWCh2Start + " delta=" + delta);
    } else {
      // If we couldn't load baseline, keep the old strict check (best effort).
      if (wCh2Start > 0) res.failures.push("CH2 start image page has body-story words (" + wCh2Start + ")");
    }
  }

  if (res.failures.length) res.ok = false;
  return res;
}

var report = out.join("\n");
try { $.writeln(report); } catch (eW0) {}
writeTextToDesktop("validate_ch1_report__" + safeFileName(doc ? doc.name : "no_doc") + "__" + isoStamp() + ".txt", report);
if (hardFailures.length) {
  // Throw AFTER writing the report so automated suites can still pick up the details from Desktop.
  throw new Error("validate-ch1.jsx HARD FAIL: " + hardFailures.join(" | "));
}
report;


