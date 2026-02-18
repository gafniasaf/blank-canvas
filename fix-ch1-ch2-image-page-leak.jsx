// Fix CH1 body-story text leaking onto the Chapter-2 opener/image page(s).
//
// Background:
// In this template, the page 2 pages before ^2.1 can be a chapter-opener image page (B-Master),
// sometimes containing a threaded body-story text frame. If CH1 text grows, it can flow onto that page.
//
  // Strategy (conservative):
// - Detect CH2 opener/image candidate pages near ^2.1:
//   - appliedMaster.name === "B-Master"
//   - has any graphic placed (via allPageItems)
//   - has BODY-STORY words > 0
// - For each candidate, attempt a non-destructive fix:
  //   - Create a new text frame on the PREVIOUS page (pageOff-1) using the same relative
  //     position/size as the leaking body-story frame (geometricBounds are spread-based).
//   - Insert this new frame into the thread right before the leaking frame.
//   - Recompose and re-check. Often this absorbs the overflow so the image page becomes text-free.
//
// Notes:
// - Does NOT delete the leaking frame; it only adds a new frame to absorb overflow.
// - Does NOT save; a later pipeline step should save.
//
// Output:
// - Writes report to ~/Desktop/fix_ch1_ch2_image_page_leak__<doc>__<timestamp>.txt
//
// Safe-ish: layout changes, but constrained to a narrow boundary area.
#targetengine "session"

(function () {
  var LOOKBACK = 8;
  var OPENER_MASTER = "B-Master";

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
    var bestIdx = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; bestIdx = s; }
    }
    return { index: bestIdx, words: bestWords };
  }

  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }
  function cleanOneLine(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    t = t.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    return t;
  }

  function pageHasAnyGraphics(pg) {
    if (!pg || !pg.isValid) return false;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        try { if (it.allGraphics && it.allGraphics.length > 0) return true; } catch (eG) {}
      }
    } catch (eAll) {}
    return false;
  }

  function bodyWordsOnPage(pg, bodyStory) {
    var words = 0;
    if (!pg || !pg.isValid || !bodyStory) return 0;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var tf = it;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;
        try { words += tf.words.length; } catch (eW) {}
      }
    } catch (e0) {}
    return words;
  }

  function firstBodyStoryTextFrameOnPage(pg, bodyStory) {
    if (!pg || !pg.isValid || !bodyStory) return null;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var tf = it;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;
        var txt = "";
        try { txt = cleanOneLine(tf.contents); } catch (eT) { txt = ""; }
        if (txt && txt.length >= 10) return tf;
      }
    } catch (e0) {}
    return null;
  }

  function mapFrameBoundsToOtherPage(srcTf, srcPage, dstPage) {
    // geometricBounds are in SPREAD coordinates.
    // Map by preserving the relative offset within the source page bounds.
    var tfb = null;
    var sb = null;
    var db = null;
    try { tfb = srcTf.geometricBounds; } catch (e0) { tfb = null; }
    try { sb = srcPage.bounds; } catch (e1) { sb = null; }
    try { db = dstPage.bounds; } catch (e2) { db = null; }
    if (!tfb || !sb || !db) return null;
    // [top,left,bottom,right]
    var relTop = tfb[0] - sb[0];
    var relLeft = tfb[1] - sb[1];
    var relBottom = tfb[2] - sb[0];
    var relRight = tfb[3] - sb[1];
    return [db[0] + relTop, db[1] + relLeft, db[0] + relBottom, db[1] + relRight];
  }

  function bypassBodyStoryFramesOnPage(pg, bodyStory) {
    // Detach/rethread body-story text frames on this page so the story skips it.
    // Similar to rewrite-from-original-safe-v5.jsx bypassStoryTextFramesOnPage, but self-contained.
    var res = { frames: 0, bypassed: 0, errors: 0 };
    if (!pg || !pg.isValid || !bodyStory) return res;

    function ipIndex(tf) {
      try { return tf.insertionPoints[0].index; } catch (e0) { return 0; }
    }

    var frames = [];
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var st = null;
        try { st = it.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;
        frames.push(it);
      }
    } catch (e0) {}

    res.frames = frames.length;
    if (frames.length === 0) return res;

    // Sort in story order then process in reverse so we rethread from the end backwards.
    try { frames.sort(function (a, b) { return ipIndex(a) - ipIndex(b); }); } catch (eSort) {}

    for (var j = frames.length - 1; j >= 0; j--) {
      var tf = frames[j];
      if (!tf || !tf.isValid) continue;
      try {
        // Best-effort unlock
        try { tf.locked = false; } catch (eL0) {}
        try { if (tf.itemLayer) tf.itemLayer.locked = false; } catch (eL1) {}

        var prev = null;
        var next = null;
        try { prev = tf.previousTextFrame; } catch (eP) { prev = null; }
        try { next = tf.nextTextFrame; } catch (eN) { next = null; }

        if (prev && prev.isValid) {
          try { prev.locked = false; } catch (eL2) {}
          try { if (prev.itemLayer) prev.itemLayer.locked = false; } catch (eL3) {}
          if (next && next.isValid) {
            try { next.locked = false; } catch (eL4) {}
            try { if (next.itemLayer) next.itemLayer.locked = false; } catch (eL5) {}
            prev.nextTextFrame = next;
            try { next.previousTextFrame = prev; } catch (ePrev) {}
          } else {
            try { prev.nextTextFrame = NothingEnum.nothing; } catch (eEnd) {}
          }
        }
        // Detach the skipped frame
        try { tf.previousTextFrame = NothingEnum.nothing; } catch (eD0) {}
        try { tf.nextTextFrame = NothingEnum.nothing; } catch (eD1) {}
        res.bypassed++;
      } catch (e1) {
        res.errors++;
      }
    }

    return res;
  }

  var out = [];
  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { if (app.documents.length > 0) doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: no document open.");
    writeTextToDesktop("fix_ch1_ch2_image_page_leak__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }
  try { app.activeDocument = doc; } catch (eAct) {}

  // CH1 range anchors
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;
  var f2 = findGrep(doc, "^2\\.1");
  var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
  var off2 = p2 ? p2.documentOffset : -1;
  if (off2 < 0) {
    out.push("ERROR: could not find ^2.1 marker");
    writeTextToDesktop("fix_ch1_ch2_image_page_leak__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }
  var endOff = off2 - 1;

  var body = detectBodyStoryIndex(doc, startOff, endOff);
  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("fix_ch1_ch2_image_page_leak__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }
  var bodyStory = doc.stories[body.index];

  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP) {}
  out.push("CH1 offsets: " + startOff + " -> " + endOff + " (^2.1 off=" + off2 + ")");
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  var fixed = 0;
  var stillLeaking = 0;
  var from = off2 - LOOKBACK;
  var to = off2 - 1;
  if (from < 0) from = 0;
  for (var po = from; po <= to; po++) {
    var pg = doc.pages[po];
    if (!pg || !pg.isValid) continue;
    var masterName = "";
    try { masterName = (pg.appliedMaster ? String(pg.appliedMaster.name) : ""); } catch (eM) { masterName = ""; }
    if (masterName !== OPENER_MASTER) continue;
    if (!pageHasAnyGraphics(pg)) continue;

    var beforeWords = bodyWordsOnPage(pg, bodyStory);
    if (!(beforeWords > 0)) continue;

    var badTf = firstBodyStoryTextFrameOnPage(pg, bodyStory);
    if (!badTf) continue;

    // Insert new frame on the previous page (po-1) if possible.
    var prevOff = po - 1;
    if (prevOff < 0) continue;
    var prevPg = doc.pages[prevOff];
    if (!prevPg || !prevPg.isValid) continue;

    // If the leaking frame is ALREADY preceded by a frame on prevPg, we assume it's already fixed.
    try {
      var prevTf0 = badTf.previousTextFrame;
      if (prevTf0 && prevTf0.isValid && prevTf0.parentPage && String(prevTf0.parentPage.name) === String(prevPg.name)) {
        out.push(
          "pageOff=" + po + " page=" + String(pg.name) +
            " :: already has an intermediate frame on prev page " + String(prevPg.name) + " (skip)"
        );
        continue;
      }
    } catch (eSkip0) {}

    var mapped = mapFrameBoundsToOtherPage(badTf, pg, prevPg);
    if (!mapped) continue;

    var newTf = null;
    try {
      newTf = prevPg.textFrames.add();
      newTf.geometricBounds = mapped;
      try { newTf.textFramePreferences.textColumnCount = badTf.textFramePreferences.textColumnCount; } catch (eC0) {}
      try { newTf.textFramePreferences.textColumnGutter = badTf.textFramePreferences.textColumnGutter; } catch (eC1) {}
    } catch (eAdd) { newTf = null; }
    if (!newTf) continue;

    // Thread it in right before the leaking frame.
    try {
      var prevTf = null;
      try { prevTf = badTf.previousTextFrame; } catch (ePrev) { prevTf = null; }
      if (prevTf && prevTf.isValid) {
        try { prevTf.nextTextFrame = newTf; } catch (eT0) {}
        try { newTf.previousTextFrame = prevTf; } catch (eT1) {}
      }
      try { newTf.nextTextFrame = badTf; } catch (eT2) {}
      try { badTf.previousTextFrame = newTf; } catch (eT3) {}
    } catch (eTh) {}

    // Recompose and re-check.
    try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRec0) {}
    try { if (doc && doc.recompose) doc.recompose(); } catch (eRec1) {}

    // Now bypass body-story frames on the opener page so the story skips the image page entirely.
    // This should push any remaining content to the next body page (after the opener spread).
    var bp = bypassBodyStoryFramesOnPage(pg, bodyStory);
    try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRec2) {}
    try { if (doc && doc.recompose) doc.recompose(); } catch (eRec3) {}

    var afterWords = bodyWordsOnPage(pg, bodyStory);
    if (afterWords === 0) fixed++; else stillLeaking++;

    out.push(
      "pageOff=" + po + " page=" + String(pg.name) + " master=" + masterName +
        " :: beforeWords=" + beforeWords + " afterWords=" + afterWords +
        " insertedFrameOnPageOff=" + prevOff +
        " newFrameBounds=" + String(mapped) +
        " bypassedFrames=" + bp.bypassed + "/" + bp.frames + " errors=" + bp.errors
    );
  }

  out.push("");
  out.push("RESULT: fixed_pages=" + fixed + " still_leaking_pages=" + stillLeaking);
  writeTextToDesktop("fix_ch1_ch2_image_page_leak__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
})();


