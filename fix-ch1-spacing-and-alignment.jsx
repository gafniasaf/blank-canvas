// Fix Chapter 1 text quality in the CH1 preview doc:
// - Normalize spacing (double spaces, missing spaces after punctuation, spaces before punctuation)
// - For paragraphs that contain layer headings ("In de praktijk:" / "Verdieping:"), enforce LEFT_ALIGN
//   (ragged right; prevents justification stretching on the line before the heading).
//
// Scope: Chapter 1 only (based on first ^1.1 and first ^2.1 markers).
// Safe: does not save.

var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

function getDocByPathOrActive(path) {
  var doc = null;
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) { doc = d; break; } } catch (e) {}
  }
  if (!doc) { try { doc = app.activeDocument; } catch (e2) { doc = null; } }
  return doc;
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

function pageOfText(textObj) {
  try {
    var tf = textObj.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e) {}
  return null;
}

function getChapterRange(doc) {
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var f2 = findGrep(doc, "^2\\.1");
  var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
  var endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
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

function hasAnchors(text) {
  try { return String(text || "").indexOf("\uFFFC") !== -1; } catch (e) { return false; }
}

function normalizeSegment(seg) {
  var s = String(seg || "");
  // Keep it conservative; only touch regular spaces.
  s = s.replace(/ {2,}/g, " ");
  // Remove spaces before punctuation
  s = s.replace(/ ([,.;:!?])/g, "$1");
  // Missing spaces after sentence punctuation (lowercase -> Uppercase)
  s = s.replace(/([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g, "$1$2 $3");
  // Missing spaces after ; , : when followed by a letter
  s = s.replace(/([A-Za-z\u00C0-\u00FF]);([A-Za-z\u00C0-\u00FF])/g, "$1; $2");
  s = s.replace(/([A-Za-z\u00C0-\u00FF]),([A-Za-z\u00C0-\u00FF])/g, "$1, $2");
  s = s.replace(/:([A-Za-z\u00C0-\u00FF])/g, ": $1");
  // Parentheses spacing
  s = s.replace(/([A-Za-z\u00C0-\u00FF])\(/g, "$1 (");
  s = s.replace(/\(\s+/g, "(");
  s = s.replace(/\s+\)/g, ")");
  // Collapse again after edits
  s = s.replace(/ {2,}/g, " ");
  return s;
}

function normalizeParaText(txt) {
  // Operate per forced-line-break segment so we don't accidentally remove \n structure.
  var parts = String(txt || "").split("\n");
  for (var i = 0; i < parts.length; i++) {
    // Keep intentionally empty lines
    if (parts[i] === "") continue;
    parts[i] = normalizeSegment(parts[i]);
  }
  return parts.join("\n");
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document found/open.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}

  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
  var changedParas = 0;
  var skippedAnchors = 0;
  var layerParasAlignedLeft = 0;

  if (body.index < 0) {
    out.push("ERROR: could not detect CH1 body story");
  } else {
    var story = null;
    try { story = doc.stories[body.index]; } catch (eS) { story = null; }
    if (!story) {
      out.push("ERROR: body story not found at index " + body.index);
    } else {
      for (var p = 0; p < story.paragraphs.length; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;

      // Skip anchored object paragraphs to avoid any risk of breaking anchors
      if (hasAnchors(txt)) { skippedAnchors++; continue; }

      var isLayerPara = (txt.indexOf("In de praktijk:") !== -1) || (txt.indexOf("Verdieping:") !== -1);
      if (isLayerPara) {
        try {
          if (para.justification !== Justification.LEFT_ALIGN) {
            para.justification = Justification.LEFT_ALIGN;
            layerParasAlignedLeft++;
          }
        } catch (eJ) {}
      }

      // Remove trailing paragraph return if present in contents string
      var hasCR = false;
      if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }

      var normalized = normalizeParaText(txt);
      if (normalized !== txt) {
        try {
          para.contents = normalized + (hasCR ? "\r" : "");
          changedParas++;
        } catch (eSet) {}
      }
    }
  }
  }

  out.push("DOC: " + doc.name);
  out.push("CH1 range (page offsets): " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("Paragraphs changed (spacing): " + changedParas);
  out.push("Layer paragraphs LEFT_ALIGN: " + layerParasAlignedLeft);
  out.push("Paragraphs skipped (anchored objects): " + skippedAnchors);
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


