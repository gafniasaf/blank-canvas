// Fix isolated bullet paragraphs in CH1 body story.
// These are bullet/list-style paragraphs whose neighbors are not bullet/list-like,
// which often look like a single floating bullet item.
//
// Strategy (conservative):
// - Detect isolated bullet paragraphs in CH1 body story (same logic as scan-ch1-isolated-bullets.jsx).
// - Apply the paragraph style of the previous paragraph (usually body, e.g. "•Basis").
// - Rewrite the fragment into a proper standalone sentence (small, targeted rules).
//
// Safe: modifies text+style in a few paragraphs only; does not save.

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
  // CH1 scope:
  // - Start marker: "^1.1" (stable and avoids matching numbered lists like "1 ...", "2 ...")
  // - End marker: chapter-2 CHAPTER HEADER (style-aware) if present; fallback "^2.1"
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var endOff = -1;
  var ch2HeaderOff = findChapterHeaderPageOffset(doc, 2, startOff);
  if (ch2HeaderOff >= 0) {
    endOff = ch2HeaderOff - 1;
  } else {
    var f2 = findGrep(doc, "^2\\.1");
    var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
    endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
  }
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

function isChapterHeaderStyleName(styleName) {
  var s = String(styleName || "").toLowerCase();
  return s.indexOf("chapter header") !== -1 || s.indexOf("hoofdstuk") !== -1;
}

function trimParaText(txt) {
  var t = "";
  try { t = String(txt || ""); } catch (e0) { t = ""; }
  if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
  try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
  return t;
}

function findChapterHeaderPageOffset(doc, chapterNum, minOffOrNull) {
  var best = -1;
  var re = null;
  try { re = new RegExp("^" + String(chapterNum) + "(?:\\\\.|\\\\b)"); } catch (eR) { re = null; }
  if (!re) return -1;
  var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var story = doc.stories[s];
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
      if (!isChapterHeaderStyleName(styleName)) continue;
      var off = paraStartPageOffset(para);
      if (off < 0) continue;
      if (minOff >= 0 && off < minOff) continue;
      var t = "";
      try { t = trimParaText(para.contents); } catch (eT) { t = ""; }
      if (!t) continue;
      if (!re.test(t)) continue;
      if (best < 0 || off < best) best = off;
    }
  }
  return best;
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

function fixFragment(text) {
  var t = cleanOneLine(text);
  // targeted rewrites for the three known fragments
  if (t.toLowerCase().indexOf("zakjes.") === 0 && t.toLowerCase().indexOf("cisternae") !== -1) {
    return "Er zijn ook zakjes. Die heten ook wel cisternae.";
  }
  if (t.toLowerCase().indexOf("eiwit.") === 0 && t.indexOf("40%") !== -1) {
    return "Eiwit vormt 40% van de ribosomen.";
  }
  if (t.toLowerCase().indexOf("translatiefase.") === 0) {
    // Keep the rest but fix the start
    var rest = t.substring("translatiefase.".length);
    rest = rest.replace(/^\s+/, "");
    // Prefer one clean opening sentence
    if (rest.toLowerCase().indexOf("dit is de fase waarin") === 0) {
      rest = rest.substring("Dit is de fase waarin".length);
      rest = rest.replace(/^\s+/, "");
      return "De translatiefase is de fase waarin " + rest;
    }
    return "De translatiefase. " + rest;
  }
  // generic: capitalize first letter if it starts lowercase
  if (t.length > 1 && t.charAt(0) >= "a" && t.charAt(0) <= "z") {
    t = t.charAt(0).toUpperCase() + t.substring(1);
  }
  return t;
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

    var fixed = 0;
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

      if (prevIs || nextIs) continue; // not isolated

      // Apply previous paragraph style when possible
      if (i > 0) {
        try {
          var ps = story.paragraphs[i - 1].appliedParagraphStyle;
          if (ps) para.appliedParagraphStyle = ps;
        } catch (eS) {}
      }

      // Rewrite fragment to standalone sentence
      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      var hasCR = false;
      if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
      var fixedTxt = fixFragment(txt);
      try { para.contents = fixedTxt + (hasCR ? "\r" : ""); } catch (eSet) {}

      fixed++;
    }

    out.push("Isolated bullet paragraphs fixed: " + fixed);
    out.push("NOTE: not saved; save manually when happy.");
  }
}

out.join("\n");


