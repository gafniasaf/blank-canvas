// Fix words in Chapter 1 that have mixed character styles (e.g., partially bold).
// We detect per-word mixed "boldness" and/or multiple fontStyle values and normalize to the majority.
//
// Scope: CH1 only (based on ^1.1 and ^2.1 markers).
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

function charBoldness(ch) {
  var fs = "";
  try { fs = String(ch.fontStyle || ""); } catch (e0) { fs = ""; }
  var fb = false;
  try { fb = !!ch.fauxBold; } catch (e1) { fb = false; }
  return (fs.toLowerCase().indexOf("bold") !== -1) || fb;
}

function normalizeWord(word) {
  var chars = null;
  try { chars = word.characters; } catch (e0) { chars = null; }
  if (!chars) return { fixed: false, reason: "" };

  var n = 0;
  try { n = chars.length; } catch (e1) { n = 0; }
  if (n <= 1) return { fixed: false, reason: "" };

  var styles = {};
  var boldTrue = 0, boldFalse = 0;
  var fauxTrue = 0, fauxFalse = 0;

  for (var i = 0; i < n; i++) {
    var ch = chars[i];
    var fs = "";
    try { fs = String(ch.fontStyle || ""); } catch (e2) { fs = ""; }
    styles[fs] = (styles[fs] || 0) + 1;
    var b = charBoldness(ch);
    if (b) boldTrue++; else boldFalse++;
    try { if (ch.fauxBold) fauxTrue++; else fauxFalse++; } catch (e3) {}
  }

  var styleKeys = [];
  for (var k in styles) styleKeys.push(k);
  var hasMixedStyle = styleKeys.length > 1;
  var hasMixedBold = (boldTrue > 0 && boldFalse > 0);
  var hasMixedFaux = (fauxTrue > 0 && fauxFalse > 0);

  if (!hasMixedStyle && !hasMixedBold && !hasMixedFaux) return { fixed: false, reason: "" };

  // Pick most common fontStyle (tie-break: prefer non-bold style)
  var bestStyle = "";
  var bestCount = -1;
  for (var kk in styles) {
    var c = styles[kk];
    if (c > bestCount) { bestCount = c; bestStyle = kk; }
    else if (c === bestCount) {
      var kb = String(kk).toLowerCase().indexOf("bold") !== -1;
      var bb = String(bestStyle).toLowerCase().indexOf("bold") !== -1;
      if (bb && !kb) bestStyle = kk;
    }
  }

  // Majority fauxBold
  var bestFaux = (fauxTrue >= fauxFalse);

  try { word.characters.everyItem().fontStyle = bestStyle; } catch (eSet1) {}
  try { word.characters.everyItem().fauxBold = bestFaux; } catch (eSet2) {}

  return { fixed: true, reason: (hasMixedBold ? "mixedBold" : (hasMixedStyle ? "mixedStyle" : "mixedFaux")) };
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document open/resolved.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

  var fixed = 0;
  var scannedWords = 0;
  var samples = [];

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
      if (hasAnchors(txt)) continue;

      var wc = 0;
      try { wc = para.words.length; } catch (eWC) { wc = 0; }
      for (var i = 0; i < wc; i++) {
        var w = para.words[i];
        scannedWords++;
        var wtxt = "";
        try { wtxt = String(w.contents || ""); } catch (eWT) { wtxt = ""; }
        if (!wtxt || wtxt.length < 2) continue;
        var r = normalizeWord(w);
        if (r.fixed) {
          fixed++;
          if (samples.length < 12) samples.push("pageOff=" + off + " word=\"" + wtxt + "\" (" + r.reason + ")");
        }
      }
    }
  }
  }

  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("Words scanned: " + scannedWords);
  out.push("Words normalized: " + fixed);
  if (samples.length) out.push("Samples: " + samples.join(" | "));
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


