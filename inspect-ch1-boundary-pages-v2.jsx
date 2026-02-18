// inspect-ch1-boundary-pages-v2.jsx
// Read-only diagnostic: locate CH1 start marker (^1.1), CH2 chapter header (style-aware),
// and inspect pages around the boundary to identify:
// - CH1 start image page (image-only, no body-story words)
// - CH1 end blank page (blank, no graphics, no body-story words)
// - CH2 start image page (image-only, no body-story words)
//
// Writes report to Desktop.

(function () {
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
        var t = trimParaText(para.contents);
        if (!t) continue;
        if (!re.test(t)) continue;
        if (best < 0 || off < best) best = off;
      }
    }
    return best;
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
    var best = -1, bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }

  function wordsBodyStoryOnPage(doc, bodyStory, pageOffset) {
    if (!bodyStory) return 0;
    if (pageOffset < 0 || pageOffset >= doc.pages.length) return 0;
    var pg = doc.pages[pageOffset];
    if (!pg || !pg.isValid) return 0;
    var words = 0;
    try {
      var tfs = pg.textFrames;
      for (var i = 0; i < tfs.length; i++) {
        var tf = tfs[i];
        if (!tf || !tf.isValid) continue;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (!st || st !== bodyStory) continue;
        try { words += tf.words.length; } catch (eW) {}
      }
    } catch (e0) {}
    return words;
  }

  function pageGraphicsCount(pg) {
    if (!pg || !pg.isValid) return 0;
    try { return pg.allGraphics ? pg.allGraphics.length : 0; } catch (e) { return 0; }
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

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
  } else {
    var doc = app.activeDocument;
    out.push("DOC: " + doc.name);
    try { out.push("PATH: " + (doc.saved && doc.fullName ? doc.fullName.fsName : "(unsaved)")); } catch (eP0) {}

    var off1_1 = -1;
    var f1 = findGrep(doc, "^1\\.1");
    var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
    if (p1) off1_1 = p1.documentOffset;
    var off2_1 = -1;
    var f2 = findGrep(doc, "^2\\.1");
    var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
    if (p2) off2_1 = p2.documentOffset;

    var ch2HeaderOff = findChapterHeaderPageOffset(doc, 2, off1_1);

    out.push("^1.1 pageOff=" + off1_1);
    out.push("^2.1 pageOff=" + off2_1);
    out.push("CH2 chapter header pageOff=" + ch2HeaderOff);

    var ch1Start = off1_1 >= 0 ? off1_1 : 0;
    var ch1End = (ch2HeaderOff >= 0 ? (ch2HeaderOff - 1) : (off2_1 >= 0 ? (off2_1 - 1) : (doc.pages.length - 1)));
    if (ch1End < ch1Start) ch1End = doc.pages.length - 1;

    var body = detectBodyStoryIndex(doc, ch1Start, ch1End);
    out.push("CH1 range for body detection: " + ch1Start + " -> " + ch1End);
    out.push("CH1 body story index=" + body.index + " words=" + body.words);
    var bodyStory = null;
    try { if (body.index >= 0) bodyStory = doc.stories[body.index]; } catch (eBS) { bodyStory = null; }

    out.push("");
    out.push("=== PAGE INSPECTION AROUND CH1 START (^1.1) ===");
    var sStart = (off1_1 >= 0 ? Math.max(0, off1_1 - 6) : Math.max(0, ch1Start - 2));
    var sEnd = (off1_1 >= 0 ? Math.min(doc.pages.length - 1, off1_1 + 2) : Math.min(doc.pages.length - 1, ch1Start + 2));
    for (var po = sStart; po <= sEnd; po++) {
      var pg = doc.pages[po];
      out.push("");
      out.push("pageOff=" + po + " name=" + pg.name + " master=" + (pg.appliedMaster ? pg.appliedMaster.name : "?"));
      out.push("  graphics=" + pageGraphicsCount(pg) + " bodyWords=" + wordsBodyStoryOnPage(doc, bodyStory, po));
    }

    out.push("");
    out.push("=== PAGE INSPECTION AROUND CH2 HEADER ===");
    var bStart = (ch2HeaderOff >= 0 ? Math.max(0, ch2HeaderOff - 6) : Math.max(0, ch1End - 2));
    var bEnd = (ch2HeaderOff >= 0 ? Math.min(doc.pages.length - 1, ch2HeaderOff + 2) : Math.min(doc.pages.length - 1, ch1End + 2));
    for (var po2 = bStart; po2 <= bEnd; po2++) {
      var pg2 = doc.pages[po2];
      out.push("");
      out.push("pageOff=" + po2 + " name=" + pg2.name + " master=" + (pg2.appliedMaster ? pg2.appliedMaster.name : "?"));
      out.push("  graphics=" + pageGraphicsCount(pg2) + " bodyWords=" + wordsBodyStoryOnPage(doc, bodyStory, po2));
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  writeTextToDesktop("inspect_ch1_boundary_pages_v2__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__" + isoStamp() + ".txt", report);
  report;
})();


































