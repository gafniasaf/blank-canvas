// debug-swj-ch1.jsx
// Purpose: Find paragraphs in CH1 body story whose singleWordJustification != LEFT_ALIGN,
// attempt to fix them, and report before/after (no other modifications).

(function () {
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
    var outFile = File(Folder.desktop + "/" + filename);
    outFile.encoding = "UTF-8";
    outFile.open("w");
    outFile.write(text);
    outFile.close();
  }

  function cleanOneLine(s) {
    return String(s || "")
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function findGrep(doc, pattern) {
    try {
      app.findGrepPreferences = NothingEnum.nothing;
      app.findGrepPreferences.findWhat = pattern;
      var res = doc.findGrep();
      app.findGrepPreferences = NothingEnum.nothing;
      return res;
    } catch (e) {
      try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
      return [];
    }
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

  function paraStartPageOffset(para) {
    try {
      var ip = para.insertionPoints[0];
      var tf = ip.parentTextFrames[0];
      if (tf && tf.parentPage) return tf.parentPage.documentOffset;
    } catch (e0) {}
    try {
      var tf2 = para.parentTextFrames[0];
      if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset;
    } catch (e1) {}
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
    var best = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
  } else {
    var doc = app.activeDocument;
    out.push("DOC: " + doc.name);
    var range = getChapterRange(doc);
    out.push("CH1 OFFSETS: " + range.startOff + " -> " + range.endOff);
    var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
    out.push("BODY STORY: index=" + body.index + " words=" + body.words);

    if (body.index < 0) {
      out.push("ERROR: could not detect body story");
    } else {
      var story = doc.stories[body.index];
      var bad = 0;
      var fixed = 0;
      var samples = [];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP2) { pc = 0; }

      for (var p2 = 0; p2 < pc; p2++) {
        var para2 = story.paragraphs[p2];
        var off2 = paraStartPageOffset(para2);
        if (off2 < range.startOff || off2 > range.endOff) continue;
        var txt2 = "";
        try { txt2 = String(para2.contents || ""); } catch (eT2) { txt2 = ""; }
        if (!txt2) continue;
        if (txt2.length && txt2.charAt(txt2.length - 1) === "\r") txt2 = txt2.substring(0, txt2.length - 1);

        var swj = null;
        try { swj = para2.singleWordJustification; } catch (eSW) { swj = null; }
        if (!swj) continue;
        if (swj === Justification.LEFT_ALIGN) continue;

        bad++;
        var styleName = "";
        try { styleName = String(para2.appliedParagraphStyle ? para2.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
        var before = "pageOff=" + off2 + " style=" + styleName + " swj=" + String(swj) + " :: " + cleanOneLine(txt2).substring(0, 140);

        var ok = false;
        try { para2.singleWordJustification = Justification.LEFT_ALIGN; ok = true; } catch (eA0) { ok = false; }
        if (!ok) {
          try { para2.properties = { singleWordJustification: Justification.LEFT_ALIGN }; ok = true; } catch (eA1) { ok = false; }
        }
        if (!ok) {
          try {
            var ps = para2.appliedParagraphStyle;
            if (ps && ps.isValid) { ps.singleWordJustification = Justification.LEFT_ALIGN; ok = true; }
          } catch (eA2) { ok = false; }
        }

        var afterSwj = null;
        try { afterSwj = para2.singleWordJustification; } catch (eAfter) { afterSwj = null; }
        var after = " -> after=" + String(afterSwj);

        if (ok && afterSwj === Justification.LEFT_ALIGN) fixed++;
        if (samples.length < 10) samples.push(before + after);
      }

      out.push("[SWJ] non_left_align_before=" + bad + " fixed_now=" + fixed);
      if (samples.length) out.push("samples=" + samples.join(" | "));
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  writeTextToDesktop("debug_swj_ch1__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__" + isoStamp() + ".txt", report);
  report;
})();


































