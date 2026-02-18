// Improve visual word spacing for justified text in Chapter 1 (without changing global styles).
//
// Applies to paragraphs in CH1 range that are justified (any JUST*), excluding:
// - paragraphs containing "In de praktijk:" or "Verdieping:" (handled separately; keep as-is)
// - paragraphs containing anchored objects (U+FFFC)
//
// Settings (conservative defaults):
// - justification: LEFT_JUSTIFIED (last line align left)
// - word spacing: 80 / 100 / 120
// - letter spacing: -2 / 0 / 2
// - glyph scaling: 98 / 100 / 102
// - hyphenation: enabled
// - composer: Adobe Paragraph Composer
//
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

function hasAnchors(text) {
  try { return String(text || "").indexOf("\uFFFC") !== -1; } catch (e) { return false; }
}

function isJustified(j) {
  try {
    var js = j && j.toString ? j.toString() : "";
    return js.indexOf("JUST") !== -1;
  } catch (e) { return false; }
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document found/open.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}

  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
  var changed = 0;
  var skippedAnchors = 0;
  var skippedLayerParas = 0;

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

      if (txt.indexOf("In de praktijk:") !== -1 || txt.indexOf("Verdieping:") !== -1) {
        skippedLayerParas++;
        continue;
      }
      if (hasAnchors(txt)) { skippedAnchors++; continue; }

      var j = null;
      try { j = para.justification; } catch (eJ) { j = null; }
      if (!isJustified(j)) continue;

      try { para.justification = Justification.LEFT_JUSTIFIED; } catch (eJJ) {}

      // Spacing controls
      try { para.minimumWordSpacing = 80; } catch (e1) {}
      try { para.desiredWordSpacing = 100; } catch (e2) {}
      try { para.maximumWordSpacing = 120; } catch (e3) {}

      try { para.minimumLetterSpacing = -2; } catch (e4) {}
      try { para.desiredLetterSpacing = 0; } catch (e5) {}
      try { para.maximumLetterSpacing = 2; } catch (e6) {}

      try { para.minimumGlyphScaling = 98; } catch (e7) {}
      try { para.desiredGlyphScaling = 100; } catch (e8) {}
      try { para.maximumGlyphScaling = 102; } catch (e9) {}

      // Better line breaking
      try { para.composer = ADOBE_PARAGRAPH_COMPOSER; } catch (e10) {}
      try { para.hyphenation = true; } catch (e11) {}

      changed++;
    }
  }
  }

  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("Justified paragraphs optimized: " + changed);
  out.push("Skipped (layer paras): " + skippedLayerParas);
  out.push("Skipped (anchored objects): " + skippedAnchors);
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


