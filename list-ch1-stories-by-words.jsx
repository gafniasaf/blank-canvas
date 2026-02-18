// List stories ranked by word count within Chapter 1 range (page offsets).
// Helps identify the main body story vs small callout/caption stories.

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

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var range = getChapterRange(doc);
  var stats = [];
  for (var s = 0; s < doc.stories.length; s++) {
    var story = doc.stories[s];
    var wc = 0;
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      try { wc += para.words.length; } catch (eW) {}
    }
    if (wc > 0) {
      var name = "";
      try { name = String(story.name || ""); } catch (eN) { name = ""; }
      stats.push({ s: s, words: wc, name: name });
    }
  }
  stats.sort(function (a, b) { return b.words - a.words; });
  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  out.push("Stories in CH1: " + stats.length);
  for (var i = 0; i < Math.min(12, stats.length); i++) {
    out.push((i + 1) + ". storyIndex=" + stats[i].s + " words=" + stats[i].words + (stats[i].name ? (" name=" + stats[i].name) : ""));
  }
}

out.join("\n");


