// Print context around isolated bullet paragraphs in CH1 body story.
// Shows prev/current/next paragraph style + snippet to decide how to fix.

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
function isBulletPara(para) {
  var txt = "";
  try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
  var styleName = "";
  try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
  return isListLikeStyleName(styleName) || isBulletLikeText(txt);
}
function paraInfo(para) {
  var pg = paraStartPage(para);
  var pgName = pg ? String(pg.name) : "unknown";
  var styleName = "";
  try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
  var txt = "";
  try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
  return { page: pgName, style: styleName || "-", snippet: cleanOneLine(txt).substring(0, 220) };
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
    var pc2 = 0;
    try { pc2 = story.paragraphs.length; } catch (eP2) { pc2 = 0; }

    var isolatedIdxs = [];
    for (var i = 0; i < pc2; i++) {
      var para = story.paragraphs[i];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      if (!isBulletPara(para)) continue;

      var prevIs = false, nextIs = false;
      if (i > 0) {
        var prev = story.paragraphs[i - 1];
        var offPrev = paraStartPageOffset(prev);
        if (offPrev >= range.startOff && offPrev <= range.endOff) prevIs = isBulletPara(prev);
      }
      if (i + 1 < pc2) {
        var next = story.paragraphs[i + 1];
        var offNext = paraStartPageOffset(next);
        if (offNext >= range.startOff && offNext <= range.endOff) nextIs = isBulletPara(next);
      }
      if (!prevIs && !nextIs) isolatedIdxs.push(i);
    }

    out.push("Isolated bullet paragraphs: " + isolatedIdxs.length);
    for (var k = 0; k < isolatedIdxs.length; k++) {
      var idx = isolatedIdxs[k];
      out.push("");
      out.push("=== ISOLATED #" + (k + 1) + " paragraphIndex=" + idx + " ===");
      if (idx > 0) {
        var a = paraInfo(story.paragraphs[idx - 1]);
        out.push("PREV page=" + a.page + " style=" + a.style + " :: " + a.snippet);
      }
      var b = paraInfo(story.paragraphs[idx]);
      out.push("CURR page=" + b.page + " style=" + b.style + " :: " + b.snippet);
      if (idx + 1 < pc2) {
        var c = paraInfo(story.paragraphs[idx + 1]);
        out.push("NEXT page=" + c.page + " style=" + c.style + " :: " + c.snippet);
      }
    }
  }
}

out.join("\\n");


































