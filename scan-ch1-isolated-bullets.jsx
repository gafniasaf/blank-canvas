// Find isolated bullet/list paragraphs in Chapter 1 body story.
// "Isolated" = bullet/list-like paragraph whose immediate neighbors are NOT bullet/list-like.
// These often look like a single floating bullet item.
//
// Safe: read-only; optionally jumps to first isolated bullet.

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

var out = [];
var __docForFile = null;
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  __docForFile = doc;
  if (!doc) {
    out.push("ERROR: could not resolve a document");
  } else {
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

    var isolated = [];
    for (var i = 0; i < pc2; i++) {
      var para = story.paragraphs[i];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;

      if (!isBulletPara(para)) continue;

      // look at immediate neighbors that are also within CH1 range
      var prevIsBullet = false;
      var nextIsBullet = false;
      if (i > 0) {
        var pPrev = story.paragraphs[i - 1];
        var offPrev = paraStartPageOffset(pPrev);
        if (offPrev >= range.startOff && offPrev <= range.endOff) prevIsBullet = isBulletPara(pPrev);
      }
      if (i + 1 < pc2) {
        var pNext = story.paragraphs[i + 1];
        var offNext = paraStartPageOffset(pNext);
        if (offNext >= range.startOff && offNext <= range.endOff) nextIsBullet = isBulletPara(pNext);
      }

      if (!prevIsBullet && !nextIsBullet) {
        var pg = paraStartPage(para);
        var pgName = pg ? String(pg.name) : "unknown";
        var txt2 = "";
        try { txt2 = String(para.contents || ""); } catch (eT2) { txt2 = ""; }
        var styleName2 = "";
        try { styleName2 = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN2) { styleName2 = ""; }
        isolated.push({
          page: pgName,
          style: styleName2 || "-",
          snippet: cleanOneLine(txt2).substring(0, 160),
          paraRef: para
        });
      }
    }

    out.push("Isolated bullet/list-like paragraphs: " + isolated.length);
    for (var k = 0; k < Math.min(20, isolated.length); k++) {
      out.push(" - page=" + isolated[k].page + " style=" + isolated[k].style + " :: " + isolated[k].snippet);
    }

    if (JUMP_TO_FIRST && isolated.length > 0) {
      try {
        var pg2 = paraStartPage(isolated[0].paraRef);
        if (pg2) app.activeWindow.activePage = pg2;
        app.select(isolated[0].paraRef.insertionPoints[0]);
        app.activeWindow.zoom(ZoomOptions.FIT_PAGE);
        out.push("JUMPED to first isolated bullet on page " + isolated[0].page);
      } catch (eJ) {
        out.push("Could not jump: " + eJ);
      }
    }
  }
  }
}

function safeFileName(name) {
  var s = "";
  try { s = String(name || ""); } catch (e0) { s = "doc"; }
  s = s.replace(/\.indd$/i, "");
  s = s.replace(/[^a-z0-9 _-]/gi, "");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^\s+|\s+$/g, "");
  if (!s) s = "doc";
  return s;
}
function isoStamp() {
  var d = new Date();
  function z(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
}
function writeTextToDesktop(filename, text) {
  try {
    var f = File(Folder.desktop + "/" + filename);
    f.encoding = "UTF-8";
    f.lineFeed = "Unix";
    if (f.open("w")) { f.write(String(text || "")); f.close(); }
  } catch (e) {}
}

var report = out.join("\n");
try { $.writeln(report); } catch (eW0) {}
var __nameForFile = "no_doc";
try {
  if (__docForFile && __docForFile.isValid) __nameForFile = __docForFile.name;
  else if (app.documents.length > 0) __nameForFile = app.documents[0].name;
} catch (eNF0) {}
writeTextToDesktop("scan_ch1_isolated_bullets__" + safeFileName(__nameForFile) + "__" + isoStamp() + ".txt", report);
report;


