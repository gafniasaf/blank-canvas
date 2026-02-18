// Scan CH1 body story for widows/orphans (page/column break quality).
//
// Definitions (pragmatic):
// - Orphan: paragraph that spans multiple pages where ONLY 1 line of that paragraph appears on the FIRST page.
// - Widow:  paragraph that spans multiple pages where ONLY 1 line of that paragraph appears on the LAST page.
//
// Scope:
// - CH1 range: ^1.1 .. ^2.1 (page offsets)
// - Body story only: story with max wordcount in CH1 range
//
// Output:
// - Writes report to ~/Desktop/scan_ch1_widows_orphans__<doc>__<timestamp>.txt
//
// Safe: read-only (does not modify or save).
#targetengine "session"

(function () {
  var MAX_SAMPLES = 30;

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

    return {
      startOff: startOff,
      endOff: endOff,
      startPage: p1 ? String(p1.name) : "?",
      endPage: (endOff >= 0 && endOff < doc.pages.length) ? String(doc.pages[endOff].name) : "?"
    };
  }
  function paraStartPageOffset(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
    return -1;
  }
  function storyWordCountInRange(story, range) {
    var wc = 0;
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      try { wc += para.words.length; } catch (eW) {}
    }
    return wc;
  }
  function detectBodyStoryIndex(doc, range) {
    var bestIdx = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], range); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; bestIdx = s; }
    }
    return { index: bestIdx, words: bestWords };
  }

  function cleanSnippet(txt) {
    var t = "";
    try { t = String(txt || ""); } catch (e0) { t = ""; }
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    t = t.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (t.length > 170) t = t.substring(0, 170) + "…";
    return t;
  }

  function linePageOffset(lineObj) {
    try {
      var ip = lineObj.insertionPoints[0];
      var tf = ip.parentTextFrames[0];
      if (tf && tf.parentPage) return tf.parentPage.documentOffset;
    } catch (e0) {}
    // Fallback: parentTextFrames
    try {
      var tf2 = lineObj.parentTextFrames[0];
      if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset;
    } catch (e1) {}
    return -1;
  }

  var out = [];
  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { if (app.documents.length > 0) doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: no document open.");
    writeTextToDesktop("scan_ch1_widows_orphans__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range);

  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP) {}
  out.push("CH1 range: page " + range.startPage + " -> " + range.endPage + " (offsets " + range.startOff + " -> " + range.endOff + ")");
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story.");
    writeTextToDesktop("scan_ch1_widows_orphans__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  var story = doc.stories[body.index];
  var stats = {
    paras_checked: 0,
    paras_spanning_pages: 0,
    orphans: 0,
    widows: 0,
    samples: []
  };
  function addSample(kind, msg) {
    if (stats.samples.length >= MAX_SAMPLES) return;
    stats.samples.push(kind + " :: " + msg);
  }

  var pc2 = 0;
  try { pc2 = story.paragraphs.length; } catch (ePC) { pc2 = 0; }
  for (var p2 = 0; p2 < pc2; p2++) {
    var para2 = story.paragraphs[p2];
    var off2 = paraStartPageOffset(para2);
    if (off2 < range.startOff || off2 > range.endOff) continue;

    var txt = "";
    try { txt = String(para2.contents || ""); } catch (eT) { txt = ""; }
    if (!txt) continue;
    if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);
    if (!txt || txt.replace(/\s+/g, "").length < 10) continue;

    stats.paras_checked++;

    // Collect page offsets for each line in the paragraph.
    var lineOffsets = [];
    try {
      var lc = para2.lines.length;
      for (var li = 0; li < lc; li++) {
        var ln = para2.lines[li];
        var lo = linePageOffset(ln);
        if (lo < 0) continue;
        // Only consider lines that land inside CH1 page range
        if (lo < range.startOff || lo > range.endOff) continue;
        lineOffsets.push(lo);
      }
    } catch (eL) { lineOffsets = []; }

    if (lineOffsets.length < 2) continue;

    // Count lines per pageOff for this paragraph
    var counts = {};
    var unique = [];
    for (var ii = 0; ii < lineOffsets.length; ii++) {
      var lo2 = lineOffsets[ii];
      if (!counts.hasOwnProperty(lo2)) { counts[lo2] = 0; unique.push(lo2); }
      counts[lo2] += 1;
    }
    if (unique.length < 2) continue;
    unique.sort(function (a, b) { return a - b; });
    stats.paras_spanning_pages++;

    var firstOff = unique[0];
    var lastOff = unique[unique.length - 1];
    var firstCnt = counts[firstOff] || 0;
    var lastCnt = counts[lastOff] || 0;

    if (firstCnt === 1) {
      stats.orphans++;
      addSample("ORPHAN", "firstPageOff=" + firstOff + " lastPageOff=" + lastOff + " :: " + cleanSnippet(txt));
    }
    if (lastCnt === 1) {
      stats.widows++;
      addSample("WIDOW", "firstPageOff=" + firstOff + " lastPageOff=" + lastOff + " :: " + cleanSnippet(txt));
    }
  }

  out.push("SUMMARY:");
  out.push(" - paragraphs checked: " + stats.paras_checked);
  out.push(" - paragraphs spanning pages: " + stats.paras_spanning_pages);
  out.push(" - orphans: " + stats.orphans);
  out.push(" - widows: " + stats.widows);
  out.push("");
  if (stats.samples.length) {
    out.push("SAMPLES (review candidates):");
    for (var s0 = 0; s0 < stats.samples.length; s0++) out.push(" - " + stats.samples[s0]);
  } else {
    out.push("SAMPLES: none");
  }

  writeTextToDesktop("scan_ch1_widows_orphans__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
})();


