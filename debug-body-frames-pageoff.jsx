// Debug helper: dump BODY story text frames (bounds + columnCount) on a single page offset.
// Edit PAGE_OFF before running.
//
// Output: ~/Desktop/debug_body_frames_pageoff__<doc>__off<OFF>__<timestamp>.txt

#targetengine "session"

(function () {
  var PAGE_OFF = 25; // <-- set the page offset you want to inspect

  function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }
  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "_");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) s = "doc";
    return s;
  }
  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) {
    writeTextToDesktop("debug_body_frames_pageoff__no_doc__" + isoStamp() + ".txt", "ERROR: no active document");
    return;
  }

  function resetFind() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e1) {}
  }
  function findGrep(pat) {
    resetFind();
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
  function detectBodyStoryIndex(startOff, endOff) {
    var best = -1, bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }
  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }
  function fmt(b) {
    if (!b || b.length !== 4) return "null";
    return "[" + Math.round(b[0]) + "," + Math.round(b[1]) + "," + Math.round(b[2]) + "," + Math.round(b[3]) + "]";
  }

  var f1 = findGrep("^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;
  var endOff = doc.pages.length - 1;
  var body = detectBodyStoryIndex(startOff, endOff);

  var out = [];
  out.push("DOC: " + doc.name);
  out.push("bodyStoryIndex=" + body.index + " words=" + body.words + " range=" + startOff + ".." + endOff);
  out.push("Inspect PAGE_OFF=" + PAGE_OFF + " page=" + (PAGE_OFF >= 0 && PAGE_OFF < doc.pages.length ? doc.pages[PAGE_OFF].name : "?"));
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: no body story detected");
    writeTextToDesktop("debug_body_frames_pageoff__" + safeFileName(doc.name) + "__off" + PAGE_OFF + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  if (PAGE_OFF < 0 || PAGE_OFF >= doc.pages.length) {
    out.push("ERROR: PAGE_OFF out of range");
    writeTextToDesktop("debug_body_frames_pageoff__" + safeFileName(doc.name) + "__off" + PAGE_OFF + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  var pg = doc.pages[PAGE_OFF];
  var master = "";
  try { master = (pg.appliedMaster ? String(pg.appliedMaster.name) : ""); } catch (eM) { master = ""; }
  out.push("Master=" + master);

  var bodyStory = null;
  try { bodyStory = doc.stories[body.index]; } catch (eS) { bodyStory = null; }
  if (!bodyStory) {
    out.push("ERROR: body story not found");
    writeTextToDesktop("debug_body_frames_pageoff__" + safeFileName(doc.name) + "__off" + PAGE_OFF + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  var frames = [];
  try {
    var items = pg.allPageItems;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.isValid) continue;
      if (ctorName(it) !== "TextFrame") continue;
      var st = null;
      try { st = it.parentStory; } catch (eS2) { st = null; }
      if (st !== bodyStory) continue;
      frames.push(it);
    }
  } catch (eAll) {}

  out.push("bodyFramesOnPage=" + frames.length);
  for (var j = 0; j < frames.length && j < 12; j++) {
    var tf = frames[j];
    var b = null;
    try { b = tf.geometricBounds; } catch (eB) { b = null; }
    var cols = "?";
    try { cols = String(tf.textFramePreferences.textColumnCount); } catch (eC) { cols = "?"; }
    out.push(" - bounds=" + fmt(b) + " cols=" + cols);
  }

  writeTextToDesktop("debug_body_frames_pageoff__" + safeFileName(doc.name) + "__off" + PAGE_OFF + "__" + isoStamp() + ".txt", out.join("\n"));
})();
































