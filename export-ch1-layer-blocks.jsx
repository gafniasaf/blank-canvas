// Export Chapter 1 "In de praktijk:" / "Verdieping:" blocks for GPT proofreading.
// Output is a plain text report (easy to paste back).
//
// Scope: CH1 only (based on ^1.1 and ^2.1 markers).
// Safe: read-only.

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

function paraStartPage(para) {
  try {
    var ip = para.insertionPoints[0];
    var tf = ip.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e0) {}
  try {
    var tf2 = para.parentTextFrames[0];
    if (tf2 && tf2.parentPage) return tf2.parentPage;
  } catch (e1) {}
  return null;
}

function paraStartPageOffset(para) {
  var pg = paraStartPage(para);
  if (!pg) return -1;
  try { return pg.documentOffset; } catch (e) { return -1; }
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

function extractBlocks(txt) {
  // txt is paragraph contents (no trailing \r).
  var lines = String(txt || "").split("\n");
  var blocks = { praktijk: "", verdieping: "" };
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || "");
    if (line.indexOf("In de praktijk:") === 0) blocks.praktijk = line;
    if (line.indexOf("Verdieping:") === 0) blocks.verdieping = line;
  }
  return blocks;
}

var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  "ERROR: No document open/resolved.";
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
  var out = [];
  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("");

  var idx = 0;
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
      var pg = paraStartPage(para);
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);
      if (txt.indexOf("In de praktijk:") === -1 && txt.indexOf("Verdieping:") === -1) continue;

      idx++;
      var pageName = pg ? String(pg.name) : "unknown";
      var blocks = extractBlocks(txt);
      out.push("---- BLOCK " + idx + " (page=" + pageName + ") ----");
      if (blocks.praktijk) out.push(blocks.praktijk);
      if (blocks.verdieping) out.push(blocks.verdieping);
      out.push("");
    }
  }
  }

  out.push("TOTAL BLOCKS: " + idx);
  out.join("\n");
}


