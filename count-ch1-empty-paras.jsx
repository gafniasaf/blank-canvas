// count-ch1-empty-paras.jsx
// Read-only: Count empty/near-empty paragraphs in CH1 body story range (useful to detect accidental extra paragraph returns).
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
  function paraStartPageName(para) {
    var pg = paraStartPage(para);
    return pg ? String(pg.name) : "?";
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
    var best = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
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

  function trimParaText(txt) {
    var t = "";
    try { t = String(txt || ""); } catch (e0) { t = ""; }
    // Remove trailing paragraph return
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    // Normalize whitespace but keep \n (forced line breaks) as whitespace for emptiness check
    try { t = t.replace(/\s+/g, " "); } catch (e1) {}
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e2) {}
    return t;
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
      out.push("ERROR: no body story detected");
    } else {
      var story = doc.stories[body.index];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }

      var total = 0;
      var empty = 0;
      var emptySamples = [];
      var shortCount = 0;
      var shortSamples = [];

      for (var p = 0; p < pc; p++) {
        var para = story.paragraphs[p];
        var off = paraStartPageOffset(para);
        if (off < range.startOff || off > range.endOff) continue;
        total++;
        var t = "";
        try { t = para.contents; } catch (eT) { t = ""; }
        var tt = trimParaText(t);
        if (!tt) {
          empty++;
          if (emptySamples.length < 12) {
            var sn = "";
            try { sn = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { sn = ""; }
            emptySamples.push("page=" + paraStartPageName(para) + " style=" + sn);
          }
        } else if (tt.length < 12) {
          shortCount++;
          if (shortSamples.length < 12) {
            var sn2 = "";
            try { sn2 = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN2) { sn2 = ""; }
            shortSamples.push("page=" + paraStartPageName(para) + " style=" + sn2 + " :: \"" + tt + "\"");
          }
        }
      }

      out.push("Total paragraphs in CH1 body story range: " + total);
      out.push("Empty paragraphs (no text): " + empty);
      if (emptySamples.length) out.push("  samples=" + emptySamples.join(" | "));
      out.push("Short paragraphs (<12 chars): " + shortCount);
      if (shortSamples.length) out.push("  samples=" + shortSamples.join(" | "));
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  writeTextToDesktop("count_ch1_empty_paras__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__" + isoStamp() + ".txt", report);
  report;
})();


