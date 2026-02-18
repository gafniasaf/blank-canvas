// inspect-threading-pageoff.jsx
// Read-only: Inspect text frame threading on a specific page offset.
// Usage: edit PAGE_OFF constant below before running.

(function () {
  var PAGE_OFF = 52; // <-- change if needed

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
  function cleanOneLine(s) {
    return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
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
    var range = getChapterRange(doc);
    var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
    var bodyStory = null;
    try { if (body.index >= 0) bodyStory = doc.stories[body.index]; } catch (eBS) { bodyStory = null; }

    out.push("DOC: " + doc.name);
    out.push("CH1 offsets: " + range.startOff + " -> " + range.endOff);
    out.push("Body story index=" + body.index + " words=" + body.words);
    out.push("Inspect pageOff=" + PAGE_OFF + " name=" + (PAGE_OFF >= 0 && PAGE_OFF < doc.pages.length ? doc.pages[PAGE_OFF].name : "?"));
    out.push("");

    if (PAGE_OFF < 0 || PAGE_OFF >= doc.pages.length) {
      out.push("ERROR: PAGE_OFF out of range");
    } else {
      var pg = doc.pages[PAGE_OFF];
      out.push("Master=" + (pg.appliedMaster ? pg.appliedMaster.name : "?"));
      out.push("textFrames=" + pg.textFrames.length + " allGraphics=" + (pg.allGraphics ? pg.allGraphics.length : 0));
      out.push("");

      for (var i = 0; i < pg.textFrames.length; i++) {
        var tf = pg.textFrames[i];
        if (!tf || !tf.isValid) continue;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        var isBody = (bodyStory && st === bodyStory);

        var prevPg = "";
        var nextPg = "";
        try { if (tf.previousTextFrame && tf.previousTextFrame.isValid && tf.previousTextFrame.parentPage) prevPg = String(tf.previousTextFrame.parentPage.name); } catch (eP) {}
        try { if (tf.nextTextFrame && tf.nextTextFrame.isValid && tf.nextTextFrame.parentPage) nextPg = String(tf.nextTextFrame.parentPage.name); } catch (eN) {}

        var c = "";
        try { c = cleanOneLine(tf.contents || ""); } catch (eC) { c = ""; }
        if (c.length > 160) c = c.substring(0, 160);

        out.push("TF#" + i + " body=" + (isBody ? "1" : "0") + " prev=" + (prevPg || "-") + " next=" + (nextPg || "-") + " chars=" + c.length);
        if (c) out.push("  \"" + c + "\"");
      }
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  writeTextToDesktop("inspect_threading_pageoff__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__off" + PAGE_OFF + "__" + isoStamp() + ".txt", report);
  report;
})();


