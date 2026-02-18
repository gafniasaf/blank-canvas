// ============================================================
// MAKE: CH1-only chapter baseline (no CH2 pages in the file)
// ============================================================
// Goal:
// - Create a CH1-only baseline INDD that cannot spill into CH2 opener pages because they are not present.
// - Fix the common end-of-chapter layout bug where a right-hand page is missing the 2nd body column frame,
//   causing text to jump to the next available frame (often the CH2 opener image page).
// - If the body story is overset after trimming, add extra pages at the end (with correct column frames)
//   so CH1 can grow without affecting the next chapter.
//
// Output:
// - Writes CH1-only baseline to: ~/Desktop/Generated_Books/_chapter_baselines/
// - Writes report to: ~/Desktop/make_ch1_chapter_baseline__<timestamp>.txt
//
// SAFE:
// - Never saves the source baseline; only uses saveACopy + edits the copy.
//
// Run:
// - From InDesign: app.doScript(File("<this file>"), ScriptLanguage.JAVASCRIPT)
// ============================================================

#targetengine "session"

(function () {
  // ----------------------------
  // CONFIG
  // ----------------------------
  var SOURCE_INDD = File("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd");
  var OUT_DIR = new Folder(Folder.desktop + "/Generated_Books/_chapter_baselines");
  var OUT_INDD = File(OUT_DIR.fsName + "/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720__CH1_ONLY_BASELINE.indd");
  var MAX_EXTRA_PAGES = 12;
  var CH_NUM = 1;

  // Template column frame bounds (spread coordinates).
  // LEFT page columns:  [top,left,bottom,right]
  var L_COL1 = [20, 15, 245, 93];
  var L_COL2 = [20, 102, 245, 180];
  // RIGHT page columns:
  var R_COL1 = [20, 210, 245, 288];
  var R_COL2 = [20, 297, 245, 375];

  var CH2_OPENER_MASTER = "B-Master";
  var BODY_MASTER_FALLBACK = "D-Chapter 1";

  // ----------------------------
  // Logging helpers
  // ----------------------------
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
  function safeFsName(f) {
    try { return f && f.exists ? f.fsName : "(missing)"; } catch (e) { return "(err)"; }
  }

  // ----------------------------
  // Find/grep helpers
  // ----------------------------
  function resetFind() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e1) {}
  }
  function findGrep(doc, pat) {
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
  function markerPageOffset(doc, pat) {
    var hits = findGrep(doc, pat);
    if (!hits || hits.length === 0) return -1;
    var pg = pageOfText(hits[0]);
    try { return pg ? pg.documentOffset : -1; } catch (e0) { return -1; }
  }

  // ----------------------------
  // Story detection helpers
  // ----------------------------
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

  function findFirstGrepInStory(story, pat) {
    resetFind();
    app.findGrepPreferences.findWhat = pat;
    var res = [];
    try { res = story.findGrep(); } catch (e) { res = []; }
    resetFind();
    if (!res || res.length === 0) return null;
    var best = res[0];
    var bestIdx = 0;
    try { bestIdx = best.insertionPoints[0].index; } catch (e0) { bestIdx = 0; }
    for (var i = 1; i < res.length; i++) {
      var t = res[i];
      var idx = 0;
      try { idx = t.insertionPoints[0].index; } catch (e1) { idx = 0; }
      if (idx < bestIdx) { bestIdx = idx; best = t; }
    }
    return best;
  }

  function truncateStoryFromText(story, textObj) {
    // Deletes story content from the insertion point at textObj to the end of the story.
    // This removes later-chapter text that would otherwise become overset after trimming pages.
    var res = { ok: false, startIdx: -1, removedApprox: 0, err: "" };
    if (!story || !textObj) return res;
    var startIdx = -1;
    try { startIdx = textObj.insertionPoints[0].index; } catch (e0) { startIdx = -1; }
    if (startIdx < 0) return res;
    res.startIdx = startIdx;
    try {
      var len = 0;
      try { len = story.characters.length; } catch (eL0) { len = 0; }
      if (len > startIdx) res.removedApprox = (len - startIdx);
      // InDesign collections support itemByRange(startIndex, endIndex).
      story.characters.itemByRange(startIdx, len - 1).remove();
      res.ok = true;
      return res;
    } catch (eRem) {
      res.err = String(eRem);
      res.ok = false;
      return res;
    }
  }

  // ----------------------------
  // Layout helpers
  // ----------------------------
  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }
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
  function masterName(pg) {
    try { return pg && pg.isValid && pg.appliedMaster ? String(pg.appliedMaster.name) : ""; } catch (e0) { return ""; }
  }
  function sideIsRight(pg) {
    try { return pg.side === PageSideOptions.RIGHT_HAND; } catch (e0) {}
    return false;
  }
  function approxEq(a, b, tol) { return Math.abs(a - b) <= tol; }

  function spreadStartOffForPage(pg) {
    var sp = null;
    try { sp = pg.parent; } catch (e0) { sp = null; }
    if (!sp || !sp.isValid) return pg.documentOffset;
    var minOff = pg.documentOffset;
    try {
      for (var i = 0; i < sp.pages.length; i++) {
        var p = sp.pages[i];
        if (!p || !p.isValid) continue;
        if (p.documentOffset < minOff) minOff = p.documentOffset;
      }
    } catch (e1) {}
    return minOff;
  }

  function findChapter2OpenerSpreadStartOff(doc) {
    // Use ^2.1 anchor then look back for a B-Master page with graphics.
    var off21 = markerPageOffset(doc, "^2\\.1");
    if (off21 < 0) return -1;
    var bestPage = null;
    var from = off21 - 1;
    var to = Math.max(0, off21 - 12);
    for (var off = from; off >= to; off--) {
      var pg = doc.pages[off];
      if (!pg || !pg.isValid) continue;
      if (masterName(pg) !== CH2_OPENER_MASTER) continue;
      if (!pageHasAnyGraphics(pg)) continue;
      bestPage = pg;
      break;
    }
    if (!bestPage) {
      // Fallback: assume opener is 2 pages before ^2.1 (common in this template)
      var fallbackOff = off21 - 2;
      if (fallbackOff < 0) return -1;
      bestPage = doc.pages[fallbackOff];
      if (!bestPage || !bestPage.isValid) return -1;
    }
    return spreadStartOffForPage(bestPage);
  }

  function removePagesFrom(doc, startOff) {
    var removed = 0;
    if (startOff < 0) return removed;
    // Delete from end backwards to keep offsets stable.
    for (var i = doc.pages.length - 1; i >= startOff; i--) {
      try {
        var pg = doc.pages[i];
        if (pg && pg.isValid) {
          pg.remove();
          removed++;
        }
      } catch (eRm) {}
    }
    return removed;
  }

  function collectBodyFramesOnPage(pg, bodyStory) {
    var frames = [];
    if (!pg || !pg.isValid || !bodyStory) return frames;
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
    } catch (eAll) {}
    return frames;
  }

  function ensureMissingRightColumnOnPage(pg, bodyStory) {
    // If a RIGHT page has only the inner column frame (R_COL1-like), insert the missing outer column frame.
    // Returns {added: 0|1, note: string}
    var res = { added: 0, note: "" };
    if (!pg || !pg.isValid || !bodyStory) return res;
    if (!sideIsRight(pg)) return res;
    if (masterName(pg) !== BODY_MASTER_FALLBACK) return res;

    var frames = collectBodyFramesOnPage(pg, bodyStory);
    if (!frames || frames.length === 0) return res;

    // Identify existing R_COL1-like and R_COL2-like frames by bounds.
    var col1 = null;
    var col2 = null;
    for (var i = 0; i < frames.length; i++) {
      var tf = frames[i];
      var b = null;
      try { b = tf.geometricBounds; } catch (eB) { b = null; }
      if (!b || b.length !== 4) continue;
      // Tolerate small drift (1-2pt) due to different bottom bounds on some pages.
      if (approxEq(b[1], R_COL1[1], 3) && approxEq(b[3], R_COL1[3], 3)) col1 = tf;
      if (approxEq(b[1], R_COL2[1], 3) && approxEq(b[3], R_COL2[3], 3)) col2 = tf;
    }
    if (!col1 || col2) return res;

    // Create missing col2 frame on this page.
    var newTf = null;
    try {
      var b1 = col1.geometricBounds;
      var shiftX = (R_COL2[1] - R_COL1[1]); // 87 in this template
      var nb = [b1[0], b1[1] + shiftX, b1[2], b1[3] + shiftX];
      newTf = pg.textFrames.add();
      newTf.geometricBounds = nb;
      try { newTf.textFramePreferences.textColumnCount = 1; } catch (eC0) {}
    } catch (eAdd) { newTf = null; }
    if (!newTf) return res;

    // Thread it between col1 and its old next frame.
    try {
      var oldNext = null;
      try { oldNext = col1.nextTextFrame; } catch (eN) { oldNext = null; }
      try { col1.nextTextFrame = newTf; } catch (eT0) {}
      try { newTf.previousTextFrame = col1; } catch (eT1) {}
      if (oldNext && oldNext.isValid) {
        try { newTf.nextTextFrame = oldNext; } catch (eT2) {}
        try { oldNext.previousTextFrame = newTf; } catch (eT3) {}
      }
      res.added = 1;
      res.note = "Inserted missing right column frame on page " + String(pg.name);
    } catch (eTh) {
      res.note = "WARN: created missing frame but threading failed on page " + String(pg.name) + " :: " + String(eTh);
    }
    return res;
  }

  function findLastBodyFrame(doc, bodyStory) {
    // Pick body-story frame with highest insertionPoint index.
    var best = null;
    var bestIdx = -1;
    try {
      for (var p = 0; p < doc.pages.length; p++) {
        var pg = doc.pages[p];
        var frames = collectBodyFramesOnPage(pg, bodyStory);
        for (var i = 0; i < frames.length; i++) {
          var tf = frames[i];
          var idx = 0;
          try { idx = tf.insertionPoints[0].index; } catch (eI) { idx = 0; }
          if (idx >= bestIdx) { bestIdx = idx; best = tf; }
        }
      }
    } catch (eAll) {}
    return best;
  }

  function applyMasterIfExists(doc, pg, masterNm) {
    if (!doc || !pg || !pg.isValid) return false;
    try {
      var ms = doc.masterSpreads.itemByName(masterNm);
      if (ms && ms.isValid) {
        pg.appliedMaster = ms;
        return true;
      }
    } catch (e0) {}
    return false;
  }

  function addFramesForNewPage(pg, bodyStory) {
    // Create 2 column frames on the page and thread them into the body story.
    // Returns {col1: TextFrame|null, col2: TextFrame|null}
    var res = { col1: null, col2: null };
    if (!pg || !pg.isValid) return res;

    var isR = sideIsRight(pg);
    var b1 = isR ? R_COL1 : L_COL1;
    var b2 = isR ? R_COL2 : L_COL2;

    try { res.col1 = pg.textFrames.add(); res.col1.geometricBounds = b1; } catch (e1) { res.col1 = null; }
    try { res.col2 = pg.textFrames.add(); res.col2.geometricBounds = b2; } catch (e2) { res.col2 = null; }
    try { if (res.col1) res.col1.textFramePreferences.textColumnCount = 1; } catch (eC0) {}
    try { if (res.col2) res.col2.textFramePreferences.textColumnCount = 1; } catch (eC1) {}

    // Ensure they exist.
    if (!res.col1 || !res.col2) return res;

    // Thread col1 -> col2 (page local ordering).
    try { res.col1.nextTextFrame = res.col2; } catch (eT0) {}
    try { res.col2.previousTextFrame = res.col1; } catch (eT1) {}
    return res;
  }

  function addExtraPagesUntilNoOverflow(doc, bodyStory, masterNm, outLines) {
    var added = 0;
    if (!doc || !bodyStory) return added;

    for (var i = 0; i < MAX_EXTRA_PAGES; i++) {
      var over = false;
      try { over = !!bodyStory.overflows; } catch (eO) { over = false; }
      if (!over) break;

      // Add a new page at end.
      var newPg = null;
      try { newPg = doc.pages.add(LocationOptions.AFTER, doc.pages[doc.pages.length - 1]); } catch (eAdd) { newPg = null; }
      if (!newPg || !newPg.isValid) break;

      // Apply a body master if available (keeps consistent margins/grids), but we always create our own frames.
      var applied = applyMasterIfExists(doc, newPg, masterNm);
      if (!applied) {
        // Try to keep same master as previous page.
        try { newPg.appliedMaster = doc.pages[doc.pages.length - 2].appliedMaster; } catch (eM0) {}
      }

      // Create frames on the new page.
      var created = addFramesForNewPage(newPg, bodyStory);
      if (!created.col1 || !created.col2) {
        try { outLines.push("WARN: could not create 2 column frames on new page " + String(newPg.name)); } catch (eL) {}
        break;
      }

      // Thread last existing body frame -> new page col1.
      var last = findLastBodyFrame(doc, bodyStory);
      if (!last) {
        try { outLines.push("WARN: could not locate last body frame before threading new pages"); } catch (eL2) {}
        break;
      }
      try {
        var oldNext = null;
        try { oldNext = last.nextTextFrame; } catch (eN) { oldNext = null; }
        // If last has a next already (shouldn't after trimming), detach to avoid weird loops.
        if (oldNext && oldNext.isValid) {
          try { last.nextTextFrame = NothingEnum.nothing; } catch (eDet) {}
        }
      } catch (eIgn) {}

      try { last.nextTextFrame = created.col1; } catch (eT0) {}
      try { created.col1.previousTextFrame = last; } catch (eT1) {}

      // Recompose to update overflow status.
      try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eR0) {}
      try { if (doc.recompose) doc.recompose(); } catch (eR1) {}

      added++;
      try { outLines.push("Added page " + String(newPg.name) + " (side=" + (sideIsRight(newPg) ? "R" : "L") + ") for overflow"); } catch (eL3) {}
    }
    return added;
  }

  // ----------------------------
  // MAIN
  // ----------------------------
  var out = [];
  out.push("=== make-ch1-chapter-baseline.jsx ===");
  out.push("Started: " + (new Date()).toString());
  out.push("SOURCE: " + safeFsName(SOURCE_INDD));
  out.push("OUT: " + OUT_INDD.fsName);
  out.push("");

  if (!SOURCE_INDD.exists) {
    out.push("ERROR: Source INDD not found.");
    writeTextToDesktop("make_ch1_chapter_baseline__" + isoStamp() + ".txt", out.join("\n"));
    alert("Source INDD not found:\n" + SOURCE_INDD.fsName);
    return;
  }

  // Ensure output folder exists.
  try { if (!OUT_DIR.exists) OUT_DIR.create(); } catch (eDir) {}
  if (!OUT_DIR.exists) {
    out.push("ERROR: Could not create output folder: " + OUT_DIR.fsName);
    writeTextToDesktop("make_ch1_chapter_baseline__" + isoStamp() + ".txt", out.join("\n"));
    alert("Could not create output folder:\n" + OUT_DIR.fsName);
    return;
  }

  // Backup existing output (optional).
  try {
    if (OUT_INDD.exists) {
      var bak = File(OUT_DIR.fsName + "/" + OUT_INDD.displayName.replace(/\.indd$/i, "") + "__BACKUP__" + isoStamp() + ".indd");
      try { OUT_INDD.copy(bak); out.push("Backed up existing OUT to: " + bak.fsName); } catch (eBk) { out.push("WARN: could not backup existing OUT: " + String(eBk)); }
      try { OUT_INDD.remove(); } catch (eRmOut) {}
    }
  } catch (eBkTop) {}

  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (eUI0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI1) {}

  var srcDoc = null;
  var chDoc = null;
  try {
    // Open source WITH window for stability.
    try { srcDoc = app.open(SOURCE_INDD, true); } catch (eOpen0) { try { srcDoc = app.open(SOURCE_INDD); } catch (eOpen1) { srcDoc = null; } }
    if (!srcDoc) throw new Error("Could not open source INDD");
    try { app.activeDocument = srcDoc; } catch (eAct) {}
    out.push("Opened source: " + srcDoc.name);

    // Save a copy (CH1 chapter baseline) without modifying the source file.
    srcDoc.saveACopy(OUT_INDD);
    out.push("Saved copy to: " + OUT_INDD.fsName);

    // Open the copy for edits.
    try { chDoc = app.open(OUT_INDD, true); } catch (eOpen2) { try { chDoc = app.open(OUT_INDD); } catch (eOpen3) { chDoc = null; } }
    if (!chDoc) throw new Error("Could not open chapter copy");
    try { app.activeDocument = chDoc; } catch (eAct2) {}
    out.push("Opened chapter copy: " + chDoc.name);

    // Determine cut point: start of CH2 opener spread.
    var cutStart = findChapter2OpenerSpreadStartOff(chDoc);
    out.push("Detected CH2 opener spread startOff=" + String(cutStart));
    var pagesBefore = chDoc.pages.length;
    var removed = 0;
    if (cutStart >= 0) {
      removed = removePagesFrom(chDoc, cutStart);
    } else {
      out.push("WARN: could not detect CH2 opener spread; no pages removed.");
    }
    out.push("Pages before=" + pagesBefore + " after=" + chDoc.pages.length + " removed=" + removed);

    // Detect CH1 range in the trimmed doc (end is now EOF).
    var startOff = markerPageOffset(chDoc, "^1\\.1");
    if (startOff < 0) startOff = 0;
    var endOff = chDoc.pages.length - 1;

    var body = detectBodyStoryIndex(chDoc, startOff, endOff);
    out.push("CH1 offsets=" + startOff + ".." + endOff + " bodyStoryIndex=" + body.index + " words=" + body.words);
    if (body.index < 0) throw new Error("Could not detect body story in trimmed doc");
    var bodyStory = chDoc.stories[body.index];

    // IMPORTANT:
    // The source INDD is a full-book document; the body story often contains ALL chapters in one continuous flow.
    // After we delete pages, later-chapter text becomes overset unless we remove it from the story.
    // So: truncate the body story at the first CH2 marker inside the body story (if present).
    var cutHit = findFirstGrepInStory(bodyStory, "^2\\.1");
    // IMPORTANT: avoid false positives on numbered list items like "2 Tijdens ..."
    // Only accept patterns that look like chapter headers: "2.<digit>".
    if (!cutHit) cutHit = findFirstGrepInStory(bodyStory, "^2\\.[0-9]");
    if (cutHit) {
      try {
        var ct = "";
        try { ct = String(cutHit.contents || ""); } catch (eCT0) { ct = ""; }
        ct = ct.replace(/\r/g, " ").replace(/\n/g, " ");
        if (ct.length > 140) ct = ct.substring(0, 140) + "...";
        out.push("Cut marker hit text: " + ct);
      } catch (eCT) {}
      var tr = truncateStoryFromText(bodyStory, cutHit);
      if (tr.ok) out.push("Truncated body story from ^2 marker (startIdx=" + tr.startIdx + " removedApproxChars=" + tr.removedApprox + ")");
      else out.push("WARN: failed to truncate body story at ^2 marker (startIdx=" + tr.startIdx + ") :: " + tr.err);
      try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eTR0) {}
      try { if (chDoc.recompose) chDoc.recompose(); } catch (eTR1) {}
    } else {
      out.push("NOTE: no ^2 marker found inside body story after trimming; did not truncate story text.");
    }

    // Repair missing right-hand column frame(s) (usually the final right page).
    var fixedPages = 0;
    for (var po = startOff; po <= endOff; po++) {
      var pg = chDoc.pages[po];
      if (!pg || !pg.isValid) continue;
      var fx = ensureMissingRightColumnOnPage(pg, bodyStory);
      if (fx.added) { fixedPages++; out.push(fx.note); }
    }
    out.push("Missing-right-column fixes applied: " + fixedPages);

    // Recompose before overflow check.
    try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eR0) {}
    try { if (chDoc.recompose) chDoc.recompose(); } catch (eR1) {}

    // Add pages if overset remains.
    var over0 = false;
    try { over0 = !!bodyStory.overflows; } catch (eO0) { over0 = false; }
    out.push("Body story overflows before addPages=" + (over0 ? "true" : "false"));
    var addedPages = addExtraPagesUntilNoOverflow(chDoc, bodyStory, BODY_MASTER_FALLBACK, out);
    var over1 = false;
    try { over1 = !!bodyStory.overflows; } catch (eO1) { over1 = false; }
    out.push("Extra pages added=" + addedPages + " bodyStory.overflows after=" + (over1 ? "true" : "false"));

    // Save the CH1-only baseline.
    try { chDoc.save(); out.push("Saved CH1-only baseline: ok"); } catch (eSave) { out.push("ERROR: save failed: " + String(eSave)); }

  } catch (eTop) {
    out.push("ERROR: " + String(eTop));
    alert("make-ch1-chapter-baseline.jsx failed:\n" + String(eTop));
  } finally {
    // Close docs without saving source.
    try { if (chDoc && chDoc.isValid) chDoc.close(SaveOptions.NO); } catch (eC1) {}
    try { if (srcDoc && srcDoc.isValid) srcDoc.close(SaveOptions.NO); } catch (eC0) {}
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI2) {}
    out.push("Finished: " + (new Date()).toString());
    writeTextToDesktop("make_ch1_chapter_baseline__" + isoStamp() + ".txt", out.join("\n"));
  }
})();


