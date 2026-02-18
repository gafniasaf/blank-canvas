// inspect-chapter-boundary-pages.jsx
// Read-only diagnostic: inspect page offsets around the ^2.1 marker to see which page is:
// - CH1 end blank page (should be visually blank: no big graphics, no text frames with text)
// - CH2 start image page (should contain a large graphic and no body-story text)
//
// Writes a report to Desktop.

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
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }
  function cleanOneLine(s) {
    return String(s || "")
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

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
  function getMarkerOffset(doc, markerRe) {
    var f = findGrep(doc, markerRe);
    if (f && f.length) {
      var pg = pageOfText(f[0]);
      if (pg) return pg.documentOffset;
    }
    return -1;
  }

  function gb(o) { try { return o.geometricBounds; } catch (e0) { return null; } }
  function w(b) { return b ? Math.abs(b[3] - b[1]) : 0; }
  function h(b) { return b ? Math.abs(b[2] - b[0]) : 0; }
  function area(b) { return b ? Math.abs((b[2] - b[0]) * (b[3] - b[1])) : 0; }
  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }

  function countGraphicsOnPage(pg) {
    var res = { any: 0, large: 0, largestArea: 0, samples: [] };
    if (!pg || !pg.isValid) return res;
    // Use allPageItems so we include master page items as well.
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        var hasGraphic = false;
        try { hasGraphic = (it.allGraphics && it.allGraphics.length > 0); } catch (eG) { hasGraphic = false; }
        if (!hasGraphic) continue;
        res.any++;
        var b = gb(it);
        var a = area(b);
        if (a > res.largestArea) res.largestArea = a;
        if (a >= 200000) res.large++;
        if (res.samples.length < 5) {
          res.samples.push((ctorName(it) || "item") + " area=" + Math.round(a) + " w=" + Math.round(w(b)) + " h=" + Math.round(h(b)));
        }
      }
    } catch (eAll) {}
    return res;
  }

  function countGraphicsOnSpread(sp) {
    var res = { any: 0, large: 0, largestArea: 0, samples: [] };
    if (!sp || !sp.isValid) return res;
    try {
      var items = null;
      try { items = sp.allPageItems; } catch (eA0) { items = null; }
      if (!items) { try { items = sp.pageItems; } catch (eA1) { items = []; } }
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        var hasGraphic = false;
        try { hasGraphic = (it.allGraphics && it.allGraphics.length > 0); } catch (eG) { hasGraphic = false; }
        if (!hasGraphic) continue;
        res.any++;
        var b = gb(it);
        var a = area(b);
        if (a > res.largestArea) res.largestArea = a;
        if (a >= 200000) res.large++;
        if (res.samples.length < 5) {
          res.samples.push((ctorName(it) || "item") + " area=" + Math.round(a));
        }
      }
    } catch (eAll) {}
    return res;
  }

  function textOnPage(pg, bodyStoryOrNull) {
    var res = { framesWithText: 0, totalWordsAll: 0, totalWordsBody: 0, samples: [] };
    if (!pg || !pg.isValid) return res;
    try {
      // Use allPageItems so we include master page text frames as well.
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var tf = it;
        var t = "";
        try { t = String(tf.contents || ""); } catch (eT) { t = ""; }
        var s = cleanOneLine(t);
        if (s.length < 1) continue;
        if (s.length < 6) continue;
        res.framesWithText++;
        try { res.totalWordsAll += tf.words.length; } catch (eW) {}
        if (bodyStoryOrNull) {
          try { if (tf.parentStory === bodyStoryOrNull) res.totalWordsBody += tf.words.length; } catch (eB) {}
        }
        if (res.samples.length < 6) res.samples.push(s.substring(0, 160));
      }
    } catch (e0) {}
    return res;
  }

  function textOnSpread(sp, bodyStoryOrNull) {
    var res = { framesWithText: 0, totalWordsAll: 0, totalWordsBody: 0, samples: [] };
    if (!sp || !sp.isValid) return res;
    try {
      var items = null;
      try { items = sp.allPageItems; } catch (eA0) { items = null; }
      if (!items) { try { items = sp.pageItems; } catch (eA1) { items = []; } }
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var tf = it;
        var t = "";
        try { t = String(tf.contents || ""); } catch (eT) { t = ""; }
        var s = cleanOneLine(t);
        if (s.length < 1) continue;
        if (s.length < 6) continue;
        res.framesWithText++;
        try { res.totalWordsAll += tf.words.length; } catch (eW) {}
        if (bodyStoryOrNull) {
          try { if (tf.parentStory === bodyStoryOrNull) res.totalWordsBody += tf.words.length; } catch (eB) {}
        }
        if (res.samples.length < 6) res.samples.push(s.substring(0, 160));
      }
    } catch (e0) {}
    return res;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
  } else {
    var doc = app.activeDocument;
    out.push("DOC: " + doc.name);
    try { out.push("PATH: " + (doc.saved && doc.fullName ? doc.fullName.fsName : "(unsaved)")); } catch (eP0) {}

    // NOTE: use "^N(?:\\.|\\b)" for boundaries; many books have an unnumbered chapter-intro page before "N.1".
    var off1 = getMarkerOffset(doc, "^1(?:\\.|\\b)");
    var off2 = getMarkerOffset(doc, "^2(?:\\.|\\b)");
    out.push("CH1 start marker (^1(?:\\.|\\b)) pageOff=" + off1);
    out.push("CH2 start marker (^2(?:\\.|\\b)) pageOff=" + off2);

    // detect CH1 body story index quickly (same approach as validate-ch1: max words within CH1 range)
    var ch1Start = off1 >= 0 ? off1 : 0;
    var ch1End = off2 >= 0 ? (off2 - 1) : (doc.pages.length - 1);
    if (ch1End < ch1Start) ch1End = doc.pages.length - 1;

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
    var bodyIdx = -1;
    var bodyWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var st = doc.stories[s];
      var wc = 0;
      try { wc = storyWordCountInRange(st, ch1Start, ch1End); } catch (e0) { wc = 0; }
      if (wc > bodyWords) { bodyWords = wc; bodyIdx = s; }
    }
    out.push("CH1 range for body detection: " + ch1Start + " -> " + ch1End);
    out.push("CH1 body story index=" + bodyIdx + " words=" + bodyWords);
    var bodyStory = null;
    try { if (bodyIdx >= 0) bodyStory = doc.stories[bodyIdx]; } catch (eBS) { bodyStory = null; }

    out.push("");
    out.push("=== PAGE INSPECTION AROUND CH2 START MARKER ===");
    var start = (off2 >= 0 ? off2 - 4 : ch1End - 2);
    var end = (off2 >= 0 ? off2 + 1 : ch1End + 2);
    if (start < 0) start = 0;
    if (end > doc.pages.length - 1) end = doc.pages.length - 1;

    for (var po = start; po <= end; po++) {
      var pg = doc.pages[po];
      out.push("");
      out.push("pageOff=" + po + " name=" + String(pg.name));
      try { out.push("  appliedMaster=" + (pg.appliedMaster ? String(pg.appliedMaster.name) : "(none)")); } catch (eM) {}
      var sp = null;
      try { sp = pg.parent; } catch (eSP) { sp = null; }
      try { out.push("  spread=" + (sp && sp.isValid ? String(sp.name) : "(unknown)")); } catch (eSN) {}

      var g = countGraphicsOnPage(pg);
      out.push("  graphics: any=" + g.any + " large=" + g.large + " largestArea=" + Math.round(g.largestArea) + (g.samples.length ? (" samples=" + g.samples.join(" | ")) : ""));
      var t = textOnPage(pg, bodyStory);
      out.push("  textFramesWithText=" + t.framesWithText + " wordsAll=" + t.totalWordsAll + " wordsBodyStory=" + t.totalWordsBody + (t.samples.length ? (" samples=" + t.samples.join(" | ")) : ""));

      // Spread-level (captures items that may be on pasteboard/spread rather than on the page object)
      var gs = countGraphicsOnSpread(sp);
      out.push("  spreadGraphics: any=" + gs.any + " large=" + gs.large + " largestArea=" + Math.round(gs.largestArea) + (gs.samples.length ? (" samples=" + gs.samples.join(" | ")) : ""));
      var ts = textOnSpread(sp, bodyStory);
      out.push("  spreadTextFramesWithText=" + ts.framesWithText + " wordsAll=" + ts.totalWordsAll + " wordsBodyStory=" + ts.totalWordsBody + (ts.samples.length ? (" samples=" + ts.samples.join(" | ")) : ""));
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  writeTextToDesktop("inspect_chapter_boundary_pages__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__" + isoStamp() + ".txt", report);
  report;
})();


