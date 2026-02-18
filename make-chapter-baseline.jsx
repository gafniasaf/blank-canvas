// ============================================================
// MAKE: Chapter-only baseline (generic, template-profile driven)
// ============================================================
// Goal:
// - Create a _CH<N>_ONLY_BASELINE.indd that contains ONLY the target chapter pages and body story content.
// - Prevent chapter boundary leaks by physically removing other chapter pages AND truncating body-story content.
// - Repair missing body frames (template-dependent) using a committed template profile.
// - Add extra pages at the end (with correct body frames) until the body story no longer overflows.
//
// Inputs (app.scriptArgs):
// - BIC_BOOK_ID (required unless BIC_SOURCE_INDD + BIC_PROFILE_PATH are provided)
// - BIC_CHAPTER  (required; integer)
// - BIC_SOURCE_INDD (optional; absolute path; defaults to manifest baseline_full_indd_path)
// - BIC_PROFILE_PATH (optional; absolute/relative-to-repo; defaults to manifest template_profile_path)
// - BIC_OUT_INDD (optional; absolute path; defaults to ~/Desktop/Generated_Books/<book_id>/_chapter_baselines/<book_id>__CH<N>_ONLY_BASELINE.indd)
// - BIC_MAX_EXTRA_PAGES (optional; default 12)
//
// Default driver:
// - Reads <repo>/books/manifest.json to resolve book entries and paths.
//
// SAFE:
// - Never saves/modifies the source INDD in place.
// - Uses saveACopy + edits the copy, then saves the copy.
//
// ============================================================

#targetengine "session"

(function () {
  // ----------------------------
  // Low-level helpers
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

  function readTextFile(f) {
    if (!f || !f.exists) return "";
    var txt = "";
    try {
      f.encoding = "UTF-8";
      if (f.open("r")) { txt = String(f.read() || ""); f.close(); }
    } catch (e) { try { f.close(); } catch (e2) {} }
    return txt;
  }

  function parseJsonLoose(txt) {
    var t = String(txt || "");
    if (!t) return null;
    try { return eval("(" + t + ")"); } catch (e) { return null; }
  }

  function resolveRepoRoot() {
    try {
      var me = File($.fileName);
      if (!me || !me.exists) return null;
      return me.parent;
    } catch (e) { return null; }
  }

  function resolveRepoPath(repoRoot, pth) {
    var p = "";
    try { p = String(pth || ""); } catch (e0) { p = ""; }
    if (!p) return null;
    if (p.indexOf("/") === 0) return File(p);
    if (p.indexOf("./") === 0) p = p.substring(2);
    if (!repoRoot) return File(p);
    return File(repoRoot.fsName + "/" + p);
  }

  function expandTildePath(pth) {
    var p = "";
    try { p = String(pth || ""); } catch (e0) { p = ""; }
    if (!p) return "";
    if (p.indexOf("~/") === 0) {
      try { return Folder.home.fsName + "/" + p.substring(2); } catch (e1) {}
    }
    return p;
  }

  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? String(o.constructor.name) : ""; } catch (e0) { return ""; } }

  function resetFind() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e1) {}
  }

  function findGrep(docOrStory, pat) {
    resetFind();
    app.findGrepPreferences.findWhat = pat;
    var res = [];
    try { res = docOrStory.findGrep(); } catch (e) { res = []; }
    resetFind();
    return res;
  }

  function trimParaText(txt) {
    var t = "";
    try { t = String(txt || ""); } catch (e0) { t = ""; }
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return t;
  }

  function paraStartPageOffset(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
    return -1;
  }

  function paraStartPage(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage; } catch (e1) {}
    return null;
  }

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

  function pageHasAnyGraphics(pg) {
    if (!pg || !pg.isValid) return false;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        try {
          if (it.allGraphics && it.allGraphics.length > 0) return true;
        } catch (eG0) {}
        try {
          if (it.graphics && it.graphics.length > 0) return true;
        } catch (eG1) {}
      }
    } catch (eAll) {}
    return false;
  }

  function masterName(pg) {
    try { return pg && pg.isValid && pg.appliedMaster ? String(pg.appliedMaster.name) : ""; } catch (e0) { return ""; }
  }

  function pageSideKey(pg) {
    try { if (pg.side === PageSideOptions.LEFT_HAND) return "left"; } catch (e0) {}
    try { if (pg.side === PageSideOptions.RIGHT_HAND) return "right"; } catch (e1) {}
    return "unknown";
  }

  function approxEq(a, b, tol) { return Math.abs(a - b) <= tol; }

  // ----------------------------
  // Profile-derived helpers
  // ----------------------------
  function buildStyleSet(arr) {
    var set = {};
    if (!arr || !(arr instanceof Array)) return set;
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it) continue;
      var nm = "";
      try { nm = String(it.name || ""); } catch (e0) { nm = ""; }
      if (nm) set[nm] = 1;
    }
    return set;
  }

  function isHeadingStyleName(styleName, profile) {
    var s = String(styleName || "");
    if (!s) return false;
    // keyword fallback
    var sl = s.toLowerCase();
    if (sl.indexOf("chapter header") !== -1 || sl.indexOf("hoofdstuk") !== -1 || sl.indexOf("chapter") !== -1) return true;
    if (sl.indexOf("kop") !== -1 || sl.indexOf("header") !== -1 || sl.indexOf("titel") !== -1 || sl.indexOf("title") !== -1) return true;

    try {
      var chSet = profile && profile._chapterHeaderStyleSet ? profile._chapterHeaderStyleSet : null;
      var numSet = profile && profile._numberedHeadingStyleSet ? profile._numberedHeadingStyleSet : null;
      if (chSet && chSet.hasOwnProperty(s)) return true;
      if (numSet && numSet.hasOwnProperty(s)) return true;
    } catch (e1) {}
    return false;
  }

  function buildBodyMasterSet(profile, maxN) {
    var set = {};
    var n = maxN || 5;
    try {
      var arr = profile && profile.masters && profile.masters.bodyCandidates ? profile.masters.bodyCandidates : [];
      if (arr && arr instanceof Array) {
        for (var i = 0; i < Math.min(n, arr.length); i++) {
          var nm = String(arr[i].name || "");
          if (nm) set[nm] = 1;
        }
      }
    } catch (e0) {}
    return set;
  }

  function bodyFramesPatternForPage(profile, pg) {
    var side = pageSideKey(pg);
    try {
      if (profile && profile.bodyFrames && profile.bodyFrames[side] && profile.bodyFrames[side].frames) {
        return profile.bodyFrames[side];
      }
    } catch (e0) {}
    // Fallback: use unknown side if present
    try {
      if (profile && profile.bodyFrames && profile.bodyFrames.unknown && profile.bodyFrames.unknown.frames) {
        return profile.bodyFrames.unknown;
      }
    } catch (e1) {}
    return { frames: [], masterName: "", signature: "", pagesSeen: 0 };
  }

  function primaryBodyMasterName(profile) {
    // Prefer the most common body master candidate.
    try {
      var arr = profile && profile.masters && profile.masters.bodyCandidates ? profile.masters.bodyCandidates : null;
      if (arr && arr instanceof Array && arr.length > 0) {
        var nm = String(arr[0].name || "");
        if (nm) return nm;
      }
    } catch (e0) {}
    // Else fallback to a side's representative masterName
    try {
      var nmL = profile && profile.bodyFrames && profile.bodyFrames.left ? String(profile.bodyFrames.left.masterName || "") : "";
      if (nmL) return nmL;
    } catch (e1) {}
    try {
      var nmR = profile && profile.bodyFrames && profile.bodyFrames.right ? String(profile.bodyFrames.right.masterName || "") : "";
      if (nmR) return nmR;
    } catch (e2) {}
    return "";
  }

  // ----------------------------
  // Chapter boundary detection
  // ----------------------------
  function findFirstHeadingPageOffset(doc, chapterNum, profile, minOff) {
    var best = -1;
    var re = null;
    try { re = new RegExp("^" + String(chapterNum) + "\\.1\\b"); } catch (eR0) { re = null; }
    if (!re) return -1;
    var min = (minOff === 0 || (minOff && minOff > 0)) ? minOff : -1;

    for (var s = 0; s < doc.stories.length; s++) {
      var story = doc.stories[s];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
      for (var p = 0; p < pc; p++) {
        var para = story.paragraphs[p];
        var off = paraStartPageOffset(para);
        if (off < 0) continue;
        if (min >= 0 && off < min) continue;

        var styleName = "";
        try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS0) { styleName = ""; }
        if (!isHeadingStyleName(styleName, profile)) continue;

        var t = "";
        try { t = trimParaText(para.contents); } catch (eT0) { t = ""; }
        if (!t) continue;
        if (!re.test(t)) continue;

        if (best < 0 || off < best) best = off;
      }
    }

    // Fallback: grep without style checks (may false-positive, but better than failing hard).
    if (best < 0) {
      var hits = findGrep(doc, "^" + String(chapterNum) + "\\.1\\b");
      if (hits && hits.length > 0) {
        try {
          var pg = hits[0].parentTextFrames[0].parentPage;
          if (pg) best = pg.documentOffset;
        } catch (eF) {}
      }
    }

    return best;
  }

  function findOpenerSpreadStartOff(doc, chapterNum, profile) {
    // Look back from the first "<N>.1" page for a graphics-heavy page that has no body text frames.
    // This is template-dependent and only a heuristic; profiles provide opener master candidates, but we still require graphics.
    var off = findFirstHeadingPageOffset(doc, chapterNum, profile, -1);
    if (off < 0) return -1;

    var LOOKBACK = 12;
    var bestPage = null;
    for (var po = off - 1; po >= 0 && po >= (off - LOOKBACK); po--) {
      var pg = doc.pages[po];
      if (!pg || !pg.isValid) continue;
      if (!pageHasAnyGraphics(pg)) continue;
      bestPage = pg;
      break;
    }
    if (!bestPage) {
      // Fallback: 2 pages before first heading (common)
      var fb = off - 2;
      if (fb >= 0 && fb < doc.pages.length) bestPage = doc.pages[fb];
    }
    if (!bestPage || !bestPage.isValid) return -1;
    return spreadStartOffForPage(bestPage);
  }

  function removePagesFromEnd(doc, startOff) {
    // Delete pages from end backwards.
    var removed = 0;
    if (startOff < 0) return removed;
    for (var i = doc.pages.length - 1; i >= startOff; i--) {
      try {
        var pg = doc.pages[i];
        if (pg && pg.isValid) { pg.remove(); removed++; }
      } catch (eRm) {}
    }
    return removed;
  }

  function removePagesBefore(doc, endExclusiveOff) {
    // Delete pages [0..endExclusiveOff-1] from start forwards is tricky; do it backwards.
    var removed = 0;
    var last = endExclusiveOff - 1;
    if (last < 0) return removed;
    for (var i = last; i >= 0; i--) {
      try {
        var pg = doc.pages[i];
        if (pg && pg.isValid) { pg.remove(); removed++; }
      } catch (eRm) {}
    }
    return removed;
  }

  // ----------------------------
  // Story truncation
  // ----------------------------
  function findFirstGrepInStory(story, pat) {
    if (!story) return null;
    var res = findGrep(story, pat);
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
      story.characters.itemByRange(startIdx, len - 1).remove();
      res.ok = true;
      return res;
    } catch (eRem) {
      res.err = String(eRem);
      res.ok = false;
      return res;
    }
  }

  function truncateStoryBeforeText(story, textObj) {
    // Deletes story content from story start to insertion point at textObj (exclusive).
    var res = { ok: false, endIdx: -1, removedApprox: 0, err: "" };
    if (!story || !textObj) return res;
    var endIdx = -1;
    try { endIdx = textObj.insertionPoints[0].index; } catch (e0) { endIdx = -1; }
    if (endIdx <= 0) return res;
    res.endIdx = endIdx;
    try {
      res.removedApprox = endIdx;
      story.characters.itemByRange(0, endIdx - 1).remove();
      res.ok = true;
      return res;
    } catch (eRem) {
      res.err = String(eRem);
      res.ok = false;
      return res;
    }
  }

  function hitLooksLikeHeading(hit, profile) {
    try {
      if (!hit || !hit.paragraphs || hit.paragraphs.length === 0) return false;
      var para = hit.paragraphs[0];
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
      return isHeadingStyleName(styleName, profile);
    } catch (e0) {}
    return false;
  }

  // ----------------------------
  // Body frame repair + page extension
  // ----------------------------
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

  function matchFrameByBounds(frames, targetBounds, tol) {
    // Compare x1/x2 primarily; y can drift slightly due to varying bottom bounds.
    for (var i = 0; i < frames.length; i++) {
      var tf = frames[i];
      var b = null;
      try { b = tf.geometricBounds; } catch (eB) { b = null; }
      if (!b || b.length !== 4) continue;
      if (approxEq(b[1], targetBounds[1], tol) && approxEq(b[3], targetBounds[3], tol)) return tf;
    }
    return null;
  }

  function addMissingFrameAfter(prevTf, pg, expectedFrame) {
    if (!prevTf || !prevTf.isValid || !pg || !pg.isValid || !expectedFrame) return null;
    var newTf = null;
    try {
      newTf = pg.textFrames.add();
      newTf.geometricBounds = expectedFrame.bounds;
      try { newTf.textFramePreferences.textColumnCount = expectedFrame.textColumnCount || 1; } catch (eC0) {}
      try {
        if (expectedFrame.textColumnGutter !== null && expectedFrame.textColumnGutter !== undefined) {
          newTf.textFramePreferences.textColumnGutter = expectedFrame.textColumnGutter;
        }
      } catch (eG0) {}
    } catch (eAdd) { newTf = null; }
    if (!newTf) return null;

    // Insert into thread: prev -> new -> oldNext
    try {
      var oldNext = null;
      try { oldNext = prevTf.nextTextFrame; } catch (eN) { oldNext = null; }
      try { prevTf.nextTextFrame = newTf; } catch (eT0) {}
      try { newTf.previousTextFrame = prevTf; } catch (eT1) {}
      if (oldNext && oldNext.isValid) {
        try { newTf.nextTextFrame = oldNext; } catch (eT2) {}
        try { oldNext.previousTextFrame = newTf; } catch (eT3) {}
      }
    } catch (eTh) {}

    return newTf;
  }

  function ensureExpectedFramesOnPage(pg, bodyStory, profile, bodyMasterSet, outLines) {
    // Generic: if a page already has body frames and appears to be a body page, ensure expected frames exist.
    var res = { added: 0 };
    if (!pg || !pg.isValid || !bodyStory || !profile) return res;

    var m = masterName(pg);
    if (bodyMasterSet && !bodyMasterSet.hasOwnProperty(m)) return res;

    var expectedGroup = bodyFramesPatternForPage(profile, pg);
    var expected = expectedGroup && expectedGroup.frames ? expectedGroup.frames : [];
    if (!expected || expected.length === 0) return res;

    var frames = collectBodyFramesOnPage(pg, bodyStory);
    if (!frames || frames.length === 0) return res; // only repair if page already participates

    // Sort expected by x1
    expected = expected.slice(0);
    expected.sort(function (a, b) { try { return a.bounds[1] - b.bounds[1]; } catch (e) { return 0; } });

    // Match existing
    var tol = 3;
    var have = [];
    for (var i = 0; i < expected.length; i++) {
      var ex = expected[i];
      var tf = matchFrameByBounds(frames, ex.bounds, tol);
      have.push(tf);
    }

    // Helper: derive a y1/y2 height from an existing frame on this page (so we don't create
    // a full-height frame on a page that intentionally has shorter columns).
    function yBoundsFromAnyFrame(frames) {
      for (var i = 0; i < frames.length; i++) {
        var tf = frames[i];
        var b = null;
        try { b = tf.geometricBounds; } catch (eB) { b = null; }
        if (b && b.length === 4) return [b[0], b[2]];
      }
      return null;
    }

    var yb = yBoundsFromAnyFrame(frames);

    // Only handle common case: missing one or more non-first frames; insert after the closest previous existing.
    for (var j = 0; j < expected.length; j++) {
      if (have[j]) continue;
      if (j === 0) {
        // Too risky to re-root the story thread; report only.
        try { outLines.push("WARN: page " + String(pg.name) + " missing FIRST body frame for side=" + pageSideKey(pg) + " master=" + m); } catch (eW0) {}
        continue;
      }

      // Find previous existing frame in expected order.
      var prev = null;
      for (var k = j - 1; k >= 0; k--) { if (have[k]) { prev = have[k]; break; } }
      if (!prev) continue;

      // Adjust bounds to match this page's existing column height (y1/y2), keeping x1/x2 from profile.
      var exj = expected[j];
      if (yb && exj && exj.bounds && exj.bounds.length === 4) {
        try {
          exj = {
            bounds: [yb[0], exj.bounds[1], yb[1], exj.bounds[3]],
            textColumnCount: exj.textColumnCount,
            textColumnGutter: exj.textColumnGutter
          };
        } catch (eAdj) {}
      }

      var addedTf = addMissingFrameAfter(prev, pg, exj);
      if (addedTf) {
        have[j] = addedTf;
        res.added++;
        try { outLines.push("Inserted missing body frame on page " + String(pg.name) + " side=" + pageSideKey(pg) + " master=" + m); } catch (eL0) {}
      }
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
    if (!doc || !pg || !pg.isValid || !masterNm) return false;
    try {
      var ms = doc.masterSpreads.itemByName(masterNm);
      if (ms && ms.isValid) { pg.appliedMaster = ms; return true; }
    } catch (e0) {}
    return false;
  }

  function addFramesForNewPage(pg, expectedGroup) {
    // Create expected frames (one or more) and thread them in left-to-right order.
    var frames = [];
    if (!pg || !pg.isValid) return frames;
    var expected = expectedGroup && expectedGroup.frames ? expectedGroup.frames : [];
    if (!expected || expected.length === 0) return frames;

    // Sort expected by x1
    expected = expected.slice(0);
    expected.sort(function (a, b) { try { return a.bounds[1] - b.bounds[1]; } catch (e) { return 0; } });

    for (var i = 0; i < expected.length; i++) {
      var ex = expected[i];
      var tf = null;
      try {
        tf = pg.textFrames.add();
        tf.geometricBounds = ex.bounds;
        try { tf.textFramePreferences.textColumnCount = ex.textColumnCount || 1; } catch (eC0) {}
        try {
          if (ex.textColumnGutter !== null && ex.textColumnGutter !== undefined) {
            tf.textFramePreferences.textColumnGutter = ex.textColumnGutter;
          }
        } catch (eG0) {}
      } catch (eAdd) { tf = null; }
      if (tf) frames.push(tf);
    }

    for (var j = 0; j < frames.length - 1; j++) {
      try { frames[j].nextTextFrame = frames[j + 1]; } catch (eT0) {}
      try { frames[j + 1].previousTextFrame = frames[j]; } catch (eT1) {}
    }

    return frames;
  }

  function addExtraPagesUntilNoOverflow(doc, bodyStory, profile, outLines, maxExtraPages) {
    var added = 0;
    if (!doc || !bodyStory || !profile) return added;
    var masterNm = primaryBodyMasterName(profile);

    for (var i = 0; i < maxExtraPages; i++) {
      var over = false;
      try { over = !!bodyStory.overflows; } catch (eO) { over = false; }
      if (!over) break;

      var newPg = null;
      try { newPg = doc.pages.add(LocationOptions.AFTER, doc.pages[doc.pages.length - 1]); } catch (eAdd) { newPg = null; }
      if (!newPg || !newPg.isValid) break;

      // Apply master (best-effort)
      var applied = applyMasterIfExists(doc, newPg, masterNm);
      if (!applied) {
        try { newPg.appliedMaster = doc.pages[doc.pages.length - 2].appliedMaster; } catch (eM0) {}
      }

      // Create frames based on profile pattern for this side.
      var expectedGroup = bodyFramesPatternForPage(profile, newPg);
      var newFrames = addFramesForNewPage(newPg, expectedGroup);
      if (!newFrames || newFrames.length === 0) {
        try { outLines.push("WARN: could not create body frames on new page " + String(newPg.name)); } catch (eL0) {}
        break;
      }

      // Thread last body frame -> new page's first frame
      var last = findLastBodyFrame(doc, bodyStory);
      if (!last) {
        try { outLines.push("WARN: could not locate last body frame before threading new pages"); } catch (eL2) {}
        break;
      }

      try {
        var oldNext = null;
        try { oldNext = last.nextTextFrame; } catch (eN) { oldNext = null; }
        if (oldNext && oldNext.isValid) {
          try { last.nextTextFrame = NothingEnum.nothing; } catch (eDet) {}
        }
      } catch (eIgn) {}

      try { last.nextTextFrame = newFrames[0]; } catch (eT0) {}
      try { newFrames[0].previousTextFrame = last; } catch (eT1) {}

      try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eR0) {}
      try { if (doc.recompose) doc.recompose(); } catch (eR1) {}

      added++;
      try { outLines.push("Added page " + String(newPg.name) + " (side=" + pageSideKey(newPg) + ") for overflow"); } catch (eL3) {}
    }

    return added;
  }

  // ----------------------------
  // MAIN
  // ----------------------------
  var out = [];
  out.push("=== make-chapter-baseline.jsx ===");
  out.push("Started: " + (new Date()).toString());

  var repoRoot = resolveRepoRoot();
  out.push("Repo: " + (repoRoot ? repoRoot.fsName : "(null)"));

  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (eUI0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI1) {}

  var srcDoc = null;
  var chDoc = null;

  try {
    if (!repoRoot || !repoRoot.exists) throw new Error("Could not resolve repo root from $.fileName=" + String($.fileName));

    // Inputs
    var bookId = "";
    try { bookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eB0) { bookId = ""; }
    var chapterStr = "";
    try { chapterStr = String(app.scriptArgs.getValue("BIC_CHAPTER") || ""); } catch (eC0) { chapterStr = ""; }
    var chapterNum = parseInt(chapterStr, 10);
    if (!(chapterNum > 0)) throw new Error("Missing/invalid BIC_CHAPTER (expected integer > 0)");

    var manifestFile = File(repoRoot.fsName + "/books/manifest.json");
    if (!manifestFile.exists) throw new Error("Manifest not found: " + manifestFile.fsName);
    var manifest = parseJsonLoose(readTextFile(manifestFile));
    if (!manifest || !manifest.books || !(manifest.books instanceof Array)) throw new Error("Invalid manifest JSON shape");

    var book = null;
    for (var bi = 0; bi < manifest.books.length; bi++) {
      var b = manifest.books[bi];
      if (!b) continue;
      if (bookId && String(b.book_id || "") === bookId) { book = b; break; }
    }
    if (!book) {
      if (!bookId) throw new Error("Missing BIC_BOOK_ID and could not select a default from manifest");
      throw new Error("Book not found in manifest: book_id=" + bookId);
    }
    bookId = String(book.book_id || bookId || "");

    // Resolve source INDD and profile paths (scriptArgs can override).
    var sourceInddPath = "";
    try { sourceInddPath = String(app.scriptArgs.getValue("BIC_SOURCE_INDD") || ""); } catch (eSI0) { sourceInddPath = ""; }
    if (!sourceInddPath) sourceInddPath = String(book.baseline_full_indd_path || "");
    sourceInddPath = expandTildePath(sourceInddPath);
    if (!sourceInddPath) throw new Error("Could not resolve source INDD path for book_id=" + bookId);

    var profilePathArg = "";
    try { profilePathArg = String(app.scriptArgs.getValue("BIC_PROFILE_PATH") || ""); } catch (ePP0) { profilePathArg = ""; }
    var profileFile = profilePathArg ? resolveRepoPath(repoRoot, profilePathArg) : resolveRepoPath(repoRoot, String(book.template_profile_path || ""));
    if (!profileFile || !profileFile.exists) throw new Error("Template profile not found: " + (profileFile ? profileFile.fsName : "(null)"));
    var profile = parseJsonLoose(readTextFile(profileFile));
    if (!profile) throw new Error("Failed to parse template profile JSON: " + profileFile.fsName);
    // Precompute style sets for heading checks.
    try { profile._chapterHeaderStyleSet = buildStyleSet(profile.paragraphStyleCandidates && profile.paragraphStyleCandidates.chapterHeader ? profile.paragraphStyleCandidates.chapterHeader : []); } catch (eS1) {}
    try { profile._numberedHeadingStyleSet = buildStyleSet(profile.paragraphStyleCandidates && profile.paragraphStyleCandidates.numberedHeadings ? profile.paragraphStyleCandidates.numberedHeadings : []); } catch (eS2) {}
    var bodyMasterSet = buildBodyMasterSet(profile, 6);

    var outInddPath = "";
    try { outInddPath = String(app.scriptArgs.getValue("BIC_OUT_INDD") || ""); } catch (eOI0) { outInddPath = ""; }
    outInddPath = expandTildePath(outInddPath);
    if (!outInddPath) {
      var baseOutRoot = expandTildePath(String(book.output_root || ""));
      if (!baseOutRoot) baseOutRoot = (Folder.desktop.fsName + "/Generated_Books/" + bookId);
      outInddPath = baseOutRoot + "/_chapter_baselines/" + bookId + "__CH" + String(chapterNum) + "_ONLY_BASELINE.indd";
    }
    var OUT_INDD = File(outInddPath);
    var OUT_DIR = OUT_INDD.parent;

    var maxExtraPages = 12;
    try {
      var m = String(app.scriptArgs.getValue("BIC_MAX_EXTRA_PAGES") || "");
      var mv = parseInt(m, 10);
      if (mv > 0) maxExtraPages = mv;
    } catch (eMX) {}

    out.push("BOOK_ID: " + bookId);
    out.push("CHAPTER: " + String(chapterNum));
    out.push("SOURCE:  " + sourceInddPath);
    out.push("PROFILE: " + profileFile.fsName);
    out.push("OUT:     " + OUT_INDD.fsName);
    out.push("MAX_EXTRA_PAGES: " + String(maxExtraPages));
    out.push("");

    // Ensure output folder exists.
    try { if (OUT_DIR && !OUT_DIR.exists) OUT_DIR.create(); } catch (eDir) {}
    if (!OUT_DIR || !OUT_DIR.exists) throw new Error("Could not create output folder: " + (OUT_DIR ? OUT_DIR.fsName : "(null)"));

    // Backup existing output.
    try {
      if (OUT_INDD.exists) {
        var bak = File(OUT_DIR.fsName + "/" + OUT_INDD.displayName.replace(/\\.indd$/i, "") + "__BACKUP__" + isoStamp() + ".indd");
        try { OUT_INDD.copy(bak); out.push("Backed up existing OUT to: " + bak.fsName); } catch (eBk) { out.push("WARN: could not backup existing OUT: " + String(eBk)); }
        try { OUT_INDD.remove(); } catch (eRmOut) {}
      }
    } catch (eBkTop) {}

    // Open source and save a copy
    var SOURCE_INDD = File(sourceInddPath);
    if (!SOURCE_INDD.exists) throw new Error("Source INDD not found: " + SOURCE_INDD.fsName);

    try { srcDoc = app.open(SOURCE_INDD, true); } catch (eOpen0) { try { srcDoc = app.open(SOURCE_INDD); } catch (eOpen1) { srcDoc = null; } }
    if (!srcDoc) throw new Error("Could not open source INDD");
    try { app.activeDocument = srcDoc; } catch (eAct0) {}

    srcDoc.saveACopy(OUT_INDD);
    out.push("Saved copy: " + OUT_INDD.fsName);

    try { chDoc = app.open(OUT_INDD, true); } catch (eOpen2) { try { chDoc = app.open(OUT_INDD); } catch (eOpen3) { chDoc = null; } }
    if (!chDoc) throw new Error("Could not open chapter copy");
    try { app.activeDocument = chDoc; } catch (eAct1) {}

    // Determine cut range in the copied doc.
    var startCut = findOpenerSpreadStartOff(chDoc, chapterNum, profile);
    if (startCut < 0) {
      // Fallback: cut at first heading page
      startCut = findFirstHeadingPageOffset(chDoc, chapterNum, profile, -1);
    }
    var nextCut = findOpenerSpreadStartOff(chDoc, chapterNum + 1, profile);
    if (nextCut < 0) {
      nextCut = findFirstHeadingPageOffset(chDoc, chapterNum + 1, profile, (startCut >= 0 ? startCut : -1));
    }
    out.push("Detected startCut=" + String(startCut) + " nextCut=" + String(nextCut));

    // Remove pages after nextCut (trim future chapters).
    var pagesBefore = chDoc.pages.length;
    var removedAfter = 0;
    if (nextCut >= 0) removedAfter = removePagesFromEnd(chDoc, nextCut);
    out.push("Removed pages from nextCut..end: removed=" + removedAfter + " pagesBefore=" + pagesBefore + " pagesNow=" + chDoc.pages.length);

    // Remove pages before startCut (trim earlier chapters).
    var removedBefore = 0;
    if (startCut > 0) removedBefore = removePagesBefore(chDoc, startCut);
    out.push("Removed pages before startCut: removed=" + removedBefore + " pagesNow=" + chDoc.pages.length);

    // After trimming, define chapter range as entire doc.
    var startOff = 0;
    var endOff = chDoc.pages.length - 1;

    // Detect body story in trimmed doc by wordcount in range.
    var bestIdx = -1;
    var bestWords = -1;
    for (var s2 = 0; s2 < chDoc.stories.length; s2++) {
      var wc2 = 0;
      try { wc2 = chDoc.stories[s2].words.length; } catch (eW2) { wc2 = 0; }
      // Prefer stories that actually appear in this range: count by scanning paragraphs quickly.
      // (Keep it lightweight: if wc is already tiny, skip.)
      if (wc2 > bestWords) { bestWords = wc2; bestIdx = s2; }
    }
    if (bestIdx < 0) throw new Error("Could not detect body story");
    var bodyStory = chDoc.stories[bestIdx];
    out.push("Body story: index=" + String(bestIdx) + " words=" + String(bestWords));

    // Truncate story BEFORE current chapter start marker (remove earlier chapters' content).
    var startHit = findFirstGrepInStory(bodyStory, "^" + String(chapterNum) + "\\.1\\b");
    if (!startHit) startHit = findFirstGrepInStory(bodyStory, "^" + String(chapterNum) + "\\.[0-9]");
    if (startHit && hitLooksLikeHeading(startHit, profile)) {
      var trB = truncateStoryBeforeText(bodyStory, startHit);
      if (trB.ok) out.push("Truncated body story BEFORE ^" + String(chapterNum) + ".1 (removedApproxChars=" + trB.removedApprox + ")");
      else out.push("WARN: failed to truncate body story BEFORE marker: " + trB.err);
    } else {
      out.push("WARN: could not find/validate chapter start marker in body story; did not truncate BEFORE.");
    }

    // Truncate story FROM next chapter marker (remove later chapters' content).
    var nextHit = findFirstGrepInStory(bodyStory, "^" + String(chapterNum + 1) + "\\.1\\b");
    if (!nextHit) nextHit = findFirstGrepInStory(bodyStory, "^" + String(chapterNum + 1) + "\\.[0-9]");
    if (nextHit && hitLooksLikeHeading(nextHit, profile)) {
      var trA = truncateStoryFromText(bodyStory, nextHit);
      if (trA.ok) out.push("Truncated body story FROM ^" + String(chapterNum + 1) + ".1 (removedApproxChars=" + trA.removedApprox + ")");
      else out.push("WARN: failed to truncate body story FROM marker: " + trA.err);
    } else {
      out.push("NOTE: no next-chapter marker found/validated in body story; did not truncate AFTER.");
    }

    try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eR0) {}
    try { if (chDoc.recompose) chDoc.recompose(); } catch (eR1) {}

    // Repair missing body frames on pages that already participate in body story and appear to be body pages.
    var fixed = 0;
    for (var po = startOff; po <= endOff; po++) {
      var pg = chDoc.pages[po];
      if (!pg || !pg.isValid) continue;
      var fx = ensureExpectedFramesOnPage(pg, bodyStory, profile, bodyMasterSet, out);
      if (fx.added) fixed += fx.added;
    }
    out.push("Body-frame repairs addedFrames=" + fixed);

    try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eR2) {}
    try { if (chDoc.recompose) chDoc.recompose(); } catch (eR3) {}

    // Add pages to absorb overflow.
    var over0 = false;
    try { over0 = !!bodyStory.overflows; } catch (eO0) { over0 = false; }
    out.push("Body story overflows before addPages=" + (over0 ? "true" : "false"));
    var addedPages = addExtraPagesUntilNoOverflow(chDoc, bodyStory, profile, out, maxExtraPages);
    var over1 = false;
    try { over1 = !!bodyStory.overflows; } catch (eO1) { over1 = false; }
    out.push("Extra pages added=" + addedPages + " bodyStory.overflows after=" + (over1 ? "true" : "false"));

    // Save chapter baseline.
    try { chDoc.save(); out.push("Saved chapter baseline: ok"); } catch (eSave) { out.push("ERROR: save failed: " + String(eSave)); }
  } catch (eTop) {
    out.push("ERROR: " + String(eTop));
    try { alert("make-chapter-baseline.jsx failed:\n" + String(eTop)); } catch (eA) {}
  } finally {
    try { if (chDoc && chDoc.isValid) chDoc.close(SaveOptions.NO); } catch (eC1) {}
    try { if (srcDoc && srcDoc.isValid) srcDoc.close(SaveOptions.NO); } catch (eC0) {}
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI2) {}
    out.push("Finished: " + (new Date()).toString());
    writeTextToDesktop("make_chapter_baseline__" + isoStamp() + ".txt", out.join("\n"));
  }

  out.join("\n");
})();


