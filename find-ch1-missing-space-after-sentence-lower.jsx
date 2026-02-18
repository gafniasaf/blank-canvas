// Find suspicious missing spaces after sentence-ending punctuation where next char is lowercase:
// e.g., "woord.zin" or "woord!zin" or "woord?zin"
//
// Scope: CH1 body story only, within CH1 range (^1.1..^2.1)
// Excludes: anchored-object paragraphs + caption-like paragraphs.
//
// Run:
// osascript -e 'with timeout of 900 seconds' -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/find-ch1-missing-space-after-sentence-lower.jsx" language javascript' -e 'end timeout'

var MAX_MATCHES = 20;

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
function hasAnchors(txt) {
  try { return String(txt || "").indexOf("\uFFFC") !== -1; } catch (e) { return false; }
}
function isCaptionLikeParaText(txt) {
  var t = "";
  try { t = String(txt || ""); } catch (e0) { t = ""; }
  if (!t) return false;
  if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
  t = t.replace(/^\s+/, "");
  try { return !!t.match(/^Afbeelding\s+\d+(?:\.\d+)?\s{2,}/); } catch (e1) { return false; }
}
function cleanOneLine(s) {
  return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
  out.push("DOC: " + doc.name);
  out.push("CH1 offsets: " + range.startOff + " -> " + range.endOff);
  out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
  } else {
    var story = doc.stories[body.index];
    var matches = 0;

    // Greedy scan in paragraph strings (faster than per-character story scan)
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (ePC) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      if (hasAnchors(txt)) continue;
      if (isCaptionLikeParaText(txt)) continue;

      // Remove trailing paragraph return for string regex
      if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);

      var re = /([A-Za-z\u00C0-\u00FF0-9])([.!?])([a-z\u00E0-\u00FF])/g;
      var m;
      while ((m = re.exec(txt)) !== null) {
        var idx = m.index;
        var start = Math.max(0, idx - 40);
        var end = Math.min(txt.length, idx + 60);
        var ctx = txt.substring(start, end);
        var pg = paraStartPage(para);
        var pageName = pg ? String(pg.name) : "?";
        out.push("page=" + pageName + " off=" + off + " :: " + cleanOneLine(ctx));
        matches++;
        if (matches >= MAX_MATCHES) break;
      }
      if (matches >= MAX_MATCHES) break;
    }

    if (matches === 0) out.push("No matches found.");
  }
}

out.join("\n");


































