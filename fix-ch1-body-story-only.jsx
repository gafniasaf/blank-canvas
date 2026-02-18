// Conservative CH1 cleanup applied ONLY to the main body story (largest CH1 word count).
// This avoids touching small callout/label stories.
//
// Fixes (CH1 + storyIndex):
// - spacing: double spaces, missing spaces after punctuation
// - mixed/partial bold inside a word -> normalize word to consistent style (majority)
// - justification: ensure LEFT_JUSTIFIED (last line left) and enable hyphenation + modest spacing controls
//
// Safe: does not save.

var ADOBE_PARAGRAPH_COMPOSER = "$ID/AdobeParagraphComposer";

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
  try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
  try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
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
  s = s.replace(/ {2,}/g, " ");
  s = s.replace(/([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g, "$1$2 $3");
  s = s.replace(/([A-Za-z\u00C0-\u00FF]);([A-Za-z\u00C0-\u00FF])/g, "$1; $2");
  s = s.replace(/([A-Za-z\u00C0-\u00FF]),([A-Za-z\u00C0-\u00FF])/g, "$1, $2");
  s = s.replace(/:([A-Za-z\u00C0-\u00FF])/g, ": $1");
  s = s.replace(/ {2,}/g, " ");
  return s;
}

function normalizeParaText(txt) {
  var parts = String(txt || "").split("\n");
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue;
    parts[i] = normalizeSegment(parts[i]);
  }
  return parts.join("\n");
}

function charBoldness(ch) {
  var fs = "";
  try { fs = String(ch.fontStyle || ""); } catch (e0) { fs = ""; }
  var fb = false;
  try { fb = !!ch.fauxBold; } catch (e1) { fb = false; }
  return (fs.toLowerCase().indexOf("bold") !== -1) || fb;
}

function normalizeMixedBoldInWord(word) {
  var chars = null;
  try { chars = word.characters; } catch (e0) { chars = null; }
  if (!chars) return false;
  var n = 0;
  try { n = chars.length; } catch (e1) { n = 0; }
  if (n <= 1) return false;

  var styles = {};
  var boldT = 0, boldF = 0;
  var fauxT = 0, fauxF = 0;
  for (var i = 0; i < n; i++) {
    var ch = chars[i];
    var fs = "";
    try { fs = String(ch.fontStyle || ""); } catch (e2) { fs = ""; }
    styles[fs] = (styles[fs] || 0) + 1;
    if (charBoldness(ch)) boldT++; else boldF++;
    try { if (ch.fauxBold) fauxT++; else fauxF++; } catch (e3) {}
  }

  var styleKeys = [];
  for (var k in styles) styleKeys.push(k);
  var hasMixedStyle = styleKeys.length > 1;
  var hasMixedBold = (boldT > 0 && boldF > 0);
  var hasMixedFaux = (fauxT > 0 && fauxF > 0);
  if (!hasMixedStyle && !hasMixedBold && !hasMixedFaux) return false;

  // Majority fontStyle, tie-break prefer non-bold
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
  var bestFaux = (fauxT >= fauxF);

  try { word.characters.everyItem().fontStyle = bestStyle; } catch (e4) {}
  try { word.characters.everyItem().fauxBold = bestFaux; } catch (e5) {}
  return true;
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var range = getChapterRange(doc);

  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
  } else {
    var story = null;
    try { story = doc.stories[body.index]; } catch (eS) { story = null; }
    if (!story) {
      out.push("ERROR: body story not found at index " + body.index);
    } else {
      var parasChanged = 0;
      var wordsFixed = 0;
      var parasJustified = 0;

      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
      for (var p = 0; p < pc; p++) {
        var para = story.paragraphs[p];
        var off = paraStartPageOffset(para);
        if (off < range.startOff || off > range.endOff) continue;

        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        var anchored = hasAnchors(txt);

      // Justification policy:
      // - Layer paragraphs containing "In de praktijk:" / "Verdieping:": LEFT_ALIGN (no justification stretching before the heading)
      // - Otherwise: LEFT_JUSTIFIED (justify, last line aligned left)
      var isLayerPara = (txt.indexOf("In de praktijk:") !== -1) || (txt.indexOf("Verdieping:") !== -1);
      try {
        para.justification = isLayerPara ? Justification.LEFT_ALIGN : Justification.LEFT_JUSTIFIED;
        parasJustified++;
      } catch (eJ) {}
        try { para.composer = ADOBE_PARAGRAPH_COMPOSER; } catch (eC) {}
        try { para.hyphenation = true; } catch (eH) {}
        try { para.minimumWordSpacing = 80; } catch (e1) {}
        try { para.desiredWordSpacing = 100; } catch (e2) {}
        try { para.maximumWordSpacing = 120; } catch (e3) {}
        try { para.minimumLetterSpacing = -2; } catch (e4) {}
        try { para.desiredLetterSpacing = 0; } catch (e5) {}
        try { para.maximumLetterSpacing = 2; } catch (e6) {}
        try { para.minimumGlyphScaling = 98; } catch (e7) {}
        try { para.desiredGlyphScaling = 100; } catch (e8) {}
        try { para.maximumGlyphScaling = 102; } catch (e9) {}

        // Normalize spacing in the paragraph text (preserve \n)
        // Skip anchored-object paragraphs for content writes to avoid any risk of breaking anchors.
        if (!anchored) {
          var hasCR = false;
          if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
          var norm = normalizeParaText(txt);
          if (norm !== txt) {
            try { para.contents = norm + (hasCR ? "\r" : ""); parasChanged++; } catch (eSet) {}
          }
        }

        // Fix mixed bold within words in this paragraph
        if (anchored) continue;
        var wc = 0;
        try { wc = para.words.length; } catch (eWC) { wc = 0; }
        for (var wi = 0; wi < wc; wi++) {
          var w = para.words[wi];
          var wtxt = "";
          try { wtxt = String(w.contents || ""); } catch (eWT) { wtxt = ""; }
          if (!wtxt || wtxt.length < 2) continue;
          if (normalizeMixedBoldInWord(w)) wordsFixed++;
        }
      }

      out.push("DOC: " + doc.name);
      out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
      out.push("Body story index: " + body.index + " words=" + body.words);
      out.push("Paragraphs justification applied: " + parasJustified);
      out.push("Paragraphs text spacing changed: " + parasChanged);
      out.push("Mixed-bold words fixed: " + wordsFixed);
      out.push("NOTE: not saved; save manually when happy.");
    }
  }
}

out.join("\n");


