// Fix Chapter 1 issues:
// 1) Mixed bold within a single word (some letters bold, others not) -> normalize word to one fontStyle (majority).
// 2) Paragraphs that lost justification -> restore LEFT_JUSTIFIED for long body paragraphs and for layer paragraphs.
//
// Scope: Chapter 1 only (based on ^1.1 and ^2.1 markers).
// Safe: does not save.

var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";
var ADOBE_PARAGRAPH_COMPOSER = "$ID/AdobeParagraphComposer";

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

function isListLikeStyleName(styleName) {
  var s = String(styleName || "").toLowerCase();
  return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
}

function isJustified(j) {
  try {
    var js = j && j.toString ? j.toString() : "";
    return js.indexOf("JUST") !== -1;
  } catch (e) { return false; }
}

function isLeftAlign(j) {
  try {
    // Enum compare when possible
    if (j === Justification.LEFT_ALIGN) return true;
  } catch (e0) {}
  try {
    var js = j && j.toString ? j.toString() : "";
    return js.indexOf("LEFT_ALIGN") !== -1;
  } catch (e1) {}
  return false;
}

function hasAnchors(text) {
  try { return String(text || "").indexOf("\uFFFC") !== -1; } catch (e) { return false; }
}

function normalizeMixedBoldInWord(word) {
  // Returns { fixed: boolean, targetStyle: string }
  var chars = null;
  try { chars = word.characters; } catch (e0) { chars = null; }
  if (!chars) return { fixed: false, targetStyle: "" };

  var n = 0;
  try { n = chars.length; } catch (e1) { n = 0; }
  if (n <= 1) return { fixed: false, targetStyle: "" };

  // Count fontStyle occurrences
  var styleCounts = {}; // fontStyle string -> count
  var boldSeen = 0;
  var nonBoldSeen = 0;

  for (var i = 0; i < n; i++) {
    var fs = "";
    try { fs = String(chars[i].fontStyle || ""); } catch (e2) { fs = ""; }
    if (!styleCounts[fs]) styleCounts[fs] = 0;
    styleCounts[fs]++;
    if (fs.toLowerCase().indexOf("bold") !== -1) boldSeen++;
    else nonBoldSeen++;
  }

  if (boldSeen === 0 || nonBoldSeen === 0) return { fixed: false, targetStyle: "" };

  // Pick the most common fontStyle string; tie-breaker: prefer non-bold
  var bestStyle = "";
  var bestCount = -1;
  for (var k in styleCounts) {
    if (styleCounts[k] > bestCount) { bestCount = styleCounts[k]; bestStyle = k; }
    else if (styleCounts[k] === bestCount) {
      // tie-break: prefer non-bold style
      var kb = String(k).toLowerCase().indexOf("bold") !== -1;
      var bb = String(bestStyle).toLowerCase().indexOf("bold") !== -1;
      if (bb && !kb) bestStyle = k;
    }
  }

  // Apply across word
  try {
    word.characters.everyItem().fontStyle = bestStyle;
    return { fixed: true, targetStyle: bestStyle };
  } catch (eSet) {
    return { fixed: false, targetStyle: "" };
  }
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document open/resolved.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

  var wordsFixed = 0;
  var wordsFixedSamples = [];
  var parasReJustified = 0;
  var parasScanned = 0;

  if (body.index < 0) {
    out.push("ERROR: could not detect CH1 body story");
  } else {
    var story = null;
    try { story = doc.stories[body.index]; } catch (eS) { story = null; }
    if (!story) {
      out.push("ERROR: body story not found at index " + body.index);
    } else {
      try { if (story.words.length < 5) { out.push("ERROR: body story appears empty"); } } catch (eW) {}

      for (var p = 0; p < story.paragraphs.length; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      parasScanned++;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;

      // Decide if we should restore justification
      var isLayerPara = (txt.indexOf("In de praktijk:") !== -1) || (txt.indexOf("Verdieping:") !== -1);
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
      var listLike = isListLikeStyleName(styleName);

      var j = null;
      try { j = para.justification; } catch (eJ) { j = null; }

      // Policy:
      // - Layer paragraphs: LEFT_ALIGN (no justification stretching on the line before the heading)
      // - Long body-ish paragraphs that are left aligned: LEFT_JUSTIFIED
      var len = 0;
      try {
        var t2 = String(txt || "").replace(/\uFFFC/g, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        len = t2.length;
      } catch (eLen) { len = 0; }

      if (!hasAnchors(txt) && !listLike) {
        if (isLayerPara) {
          try {
            if (para.justification !== Justification.LEFT_ALIGN) {
              para.justification = Justification.LEFT_ALIGN;
              parasReJustified++;
            }
            // Keep better line-breaking
            try { para.composer = ADOBE_PARAGRAPH_COMPOSER; } catch (eC) {}
            try { para.hyphenation = true; } catch (eH) {}
          } catch (eRJ) {}
        } else if (isLeftAlign(j) && len >= 80) {
          try {
            if (para.justification !== Justification.LEFT_JUSTIFIED) {
              para.justification = Justification.LEFT_JUSTIFIED;
              // Keep better line-breaking
              try { para.composer = ADOBE_PARAGRAPH_COMPOSER; } catch (eC2) {}
              try { para.hyphenation = true; } catch (eH2) {}
              parasReJustified++;
            }
          } catch (eRJ2) {}
        }
      }

      // Fix mixed-bold words
      // Skip anchored paragraphs for safety
      if (hasAnchors(txt)) continue;

      var wCount = 0;
      try { wCount = para.words.length; } catch (eWC) { wCount = 0; }
      for (var wi = 0; wi < wCount; wi++) {
        var w = para.words[wi];
        // Skip the two label headings words by content match (avoid unintended normalization)
        var wtxt = "";
        try { wtxt = String(w.contents || ""); } catch (eWT) { wtxt = ""; }
        if (wtxt === "In" || wtxt === "de" || wtxt.indexOf("praktijk") !== -1 || wtxt.indexOf("Verdieping") !== -1) {
          // still allow fixing mixed styles inside those words (they shouldn't be mixed), but don't force to non-bold via tie-break.
        }

        var res = normalizeMixedBoldInWord(w);
        if (res.fixed) {
          wordsFixed++;
          if (wordsFixedSamples.length < 12) {
            wordsFixedSamples.push("pageOff=" + off + " word=\"" + wtxt + "\" -> \"" + res.targetStyle + "\"");
          }
        }
      }
    }
  }
  }

  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("Paragraphs scanned: " + parasScanned);
  out.push("Paragraphs re-justified: " + parasReJustified);
  out.push("Mixed-bold words fixed: " + wordsFixed);
  if (wordsFixedSamples.length) out.push("Samples: " + wordsFixedSamples.join(" | "));
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


