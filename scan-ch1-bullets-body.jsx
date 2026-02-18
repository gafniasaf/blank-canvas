// Scan the main body story in Chapter 1 for bullet/list anomalies.
// - Detects list-like paragraph styles and bullet-like text markers (• or "- ").
// - Jumps to first hit for quick review.
//
// Safe: read-only.

var JUMP_TO_FIRST = true;

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
function paraStartPage(para) {
  try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e0) {}
  try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage; } catch (e1) {}
  return null;
}
function paraStartPageOffset(para) {
  var pg = paraStartPage(para);
  if (!pg) return -1;
  try { return pg.documentOffset; } catch (e) { return -1; }
}
function isListLikeStyleName(styleName) {
  var s = String(styleName || "").toLowerCase();
  return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
}
function cleanOneLine(s) {
  return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}
function isBulletLikeText(t) {
  var s = cleanOneLine(t);
  if (!s) return false;
  if (s.indexOf("\u2022") === 0) return true;
  if (s.indexOf("- ") === 0) return true;
  if (s.indexOf("\u2022") >= 0 && s.indexOf("\u2022") <= 5) return true;
  return false;
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

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var range = getChapterRange(doc);

  // auto-detect body story
  var bodyIdx = -1;
  var bodyWords = -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var wc = storyWordCountInRange(doc.stories[s], range.startOff, range.endOff);
    if (wc > bodyWords) { bodyWords = wc; bodyIdx = s; }
  }
  out.push("DOC: " + doc.name);
  out.push("CH1 offsets: " + range.startOff + " -> " + range.endOff);
  out.push("Body story index=" + bodyIdx + " words=" + bodyWords);

  if (bodyIdx < 0) {
    out.push("ERROR: could not find body story");
  } else {
    var story = doc.stories[bodyIdx];
    var hits = [];
    var pc2 = 0;
    try { pc2 = story.paragraphs.length; } catch (eP2) { pc2 = 0; }
    for (var i = 0; i < pc2; i++) {
      var para = story.paragraphs[i];
      var off2 = paraStartPageOffset(para);
      if (off2 < range.startOff || off2 > range.endOff) continue;
      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
      if (isListLikeStyleName(styleName) || isBulletLikeText(txt)) {
        var pg = paraStartPage(para);
        hits.push({
          page: pg ? String(pg.name) : "unknown",
          style: styleName || "-",
          snippet: cleanOneLine(txt).substring(0, 140),
          paraRef: para
        });
      }
    }
    out.push("Body bullet/list-like paragraphs in CH1: " + hits.length);
    for (var h = 0; h < Math.min(15, hits.length); h++) {
      out.push(" - page=" + hits[h].page + " style=" + hits[h].style + " :: " + hits[h].snippet);
    }
    if (JUMP_TO_FIRST && hits.length > 0) {
      try {
        var pg2 = paraStartPage(hits[0].paraRef);
        if (pg2) app.activeWindow.activePage = pg2;
        app.select(hits[0].paraRef.insertionPoints[0]);
        app.activeWindow.zoom(ZoomOptions.FIT_PAGE);
        out.push("JUMPED to first body bullet anomaly on page " + hits[0].page);
      } catch (eJ) {
        out.push("Could not jump: " + eJ);
      }
    }
  }
}

out.join("\\n");


































