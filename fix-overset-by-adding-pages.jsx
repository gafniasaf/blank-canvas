// ============================================================
// FIX: Overset text by adding pages (profile-driven)
// ============================================================
// Goal:
// - If the main body story is overset, add pages at the end (with correct body frames)
//   until the story no longer overflows.
//
// Inputs (app.scriptArgs):
// - BIC_BOOK_ID (optional): used to locate profile via books/manifest.json
// - BIC_MAX_EXTRA_PAGES (optional): default 60
//
// Safe:
// - Modifies ONLY the active document (intended to be the newest rewritten output INDD).
// ============================================================

#targetengine "session"

(function () {
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
    try { return File($.fileName).parent; } catch (e) { return null; }
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

  function pageSideKey(pg) {
    try { if (pg.side === PageSideOptions.LEFT_HAND) return "left"; } catch (e0) {}
    try { if (pg.side === PageSideOptions.RIGHT_HAND) return "right"; } catch (e1) {}
    return "unknown";
  }

  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? String(o.constructor.name) : ""; } catch (e0) { return ""; } }

  function detectBodyStory(doc) {
    var best = -1;
    var bestWords = -1;
    try {
      for (var s = 0; s < doc.stories.length; s++) {
        var wc = 0;
        try { wc = doc.stories[s].words.length; } catch (eW) { wc = 0; }
        if (wc > bestWords) { bestWords = wc; best = s; }
      }
    } catch (e0) {}
    return { index: best, words: bestWords };
  }

  function bodyStoryFramesOnPage(pg, bodyStory) {
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
    // Sort left-to-right
    frames.sort(function (a, b) {
      try { return a.geometricBounds[1] - b.geometricBounds[1]; } catch (e) { return 0; }
    });
    return frames;
  }

  function findLastBodyFrame(doc, bodyStory) {
    var best = null;
    var bestIdx = -1;
    try {
      for (var p = 0; p < doc.pages.length; p++) {
        var pg = doc.pages[p];
        if (!pg || !pg.isValid) continue;
        var frames = bodyStoryFramesOnPage(pg, bodyStory);
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

  function findOversetFrameForStory(doc, bodyStory) {
    if (!doc || !bodyStory) return null;
    try {
      for (var i = 0; i < doc.textFrames.length; i++) {
        var tf = doc.textFrames[i];
        if (!tf || !tf.isValid) continue;
        var ov = false;
        try { ov = !!tf.overflows; } catch (e0) { ov = false; }
        if (!ov) continue;
        var st = null;
        try { st = tf.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;
        return tf;
      }
    } catch (eAll) {}
    return null;
  }

  function primaryBodyMasterName(profile) {
    try {
      var arr = profile && profile.masters && profile.masters.bodyCandidates ? profile.masters.bodyCandidates : null;
      if (arr && arr instanceof Array && arr.length > 0) {
        var nm = String(arr[0].name || "");
        if (nm) return nm;
      }
    } catch (e0) {}
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

  function bodyFramesPatternForPage(profile, pg) {
    var side = pageSideKey(pg);
    try {
      if (profile && profile.bodyFrames && profile.bodyFrames[side] && profile.bodyFrames[side].frames) {
        return profile.bodyFrames[side];
      }
    } catch (e0) {}
    try {
      if (profile && profile.bodyFrames && profile.bodyFrames.unknown && profile.bodyFrames.unknown.frames) {
        return profile.bodyFrames.unknown;
      }
    } catch (e1) {}
    return { frames: [], masterName: "", signature: "", pagesSeen: 0 };
  }

  function computeRightShift(profile) {
    var shift = 0;
    try {
      var lx = 0;
      var rx = 0;
      if (profile && profile.bodyFrames && profile.bodyFrames.left && profile.bodyFrames.left.frames && profile.bodyFrames.left.frames.length) {
        lx = profile.bodyFrames.left.frames[0].bounds[1];
      }
      if (profile && profile.bodyFrames && profile.bodyFrames.right && profile.bodyFrames.right.frames && profile.bodyFrames.right.frames.length) {
        rx = profile.bodyFrames.right.frames[0].bounds[1];
      }
      shift = Math.round(rx - lx);
    } catch (e0) { shift = 0; }
    return shift;
  }

  function adjustedBoundsForPage(exBounds, pg, assumedPageLeft) {
    // Adjust x bounds by (actualPageLeft - assumedPageLeft). Y bounds unchanged.
    var b = [exBounds[0], exBounds[1], exBounds[2], exBounds[3]];
    var pb = null;
    try { pb = pg.bounds; } catch (eB) { pb = null; }
    var actualLeft = (pb && pb.length === 4) ? pb[1] : 0;
    var dx = actualLeft - (assumedPageLeft || 0);
    b[1] = b[1] + dx;
    b[3] = b[3] + dx;
    return b;
  }

  function applyMasterIfExists(doc, pg, masterNm) {
    if (!doc || !pg || !pg.isValid || !masterNm) return false;
    try {
      var ms = doc.masterSpreads.itemByName(masterNm);
      if (ms && ms.isValid) { pg.appliedMaster = ms; return true; }
    } catch (e0) {}
    return false;
  }

  function addFramesForNewPage(pg, expectedGroup, rightShift) {
    var frames = [];
    if (!pg || !pg.isValid) return frames;
    var expected = expectedGroup && expectedGroup.frames ? expectedGroup.frames : [];
    if (!expected || expected.length === 0) return frames;

    // Sort expected by x1
    expected = expected.slice(0);
    expected.sort(function (a, b) { try { return a.bounds[1] - b.bounds[1]; } catch (e) { return 0; } });

    for (var i = 0; i < expected.length; i++) {
      var ex = expected[i];
      if (!ex || !ex.bounds || ex.bounds.length !== 4) continue;
      var tf = null;
      try {
        tf = pg.textFrames.add();
        // Adjust bounds to this page's coordinate system.
        var assumedLeft = (expectedGroup === null) ? 0 : 0;
        // For right-side frames, profile bounds are typically in spread coords assuming left=rightShift.
        // For left-side frames, assumedLeft=0.
        var side = pageSideKey(pg);
        assumedLeft = (side === "right") ? (rightShift || 0) : 0;
        tf.geometricBounds = adjustedBoundsForPage(ex.bounds, pg, assumedLeft);
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

  var out = [];
  out.push("=== fix-overset-by-adding-pages.jsx ===");
  out.push("Started: " + (new Date()).toString());

  if (app.documents.length === 0) throw new Error("No documents open");
  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) throw new Error("No active document resolved");
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}

  var repoRoot = resolveRepoRoot();
  var manifestFile = repoRoot ? File(repoRoot.fsName + "/books/manifest.json") : null;
  var manifest = (manifestFile && manifestFile.exists) ? parseJsonLoose(readTextFile(manifestFile)) : null;

  var bookId = "";
  try { bookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eB0) { bookId = ""; }

  var maxExtra = 60;
  try {
    var mx = String(app.scriptArgs.getValue("BIC_MAX_EXTRA_PAGES") || "");
    var mi = parseInt(mx, 10);
    if (mi > 0) maxExtra = mi;
  } catch (eMX) {}

  var profile = null;
  if (manifest && manifest.books && manifest.books instanceof Array && bookId) {
    var book = null;
    for (var bi = 0; bi < manifest.books.length; bi++) {
      var b = manifest.books[bi];
      if (!b) continue;
      if (String(b.book_id || "") === bookId) { book = b; break; }
    }
    if (book) {
      var pf = resolveRepoPath(repoRoot, String(book.template_profile_path || ""));
      if (pf && pf.exists) profile = parseJsonLoose(readTextFile(pf));
      out.push("Profile: " + (pf ? pf.fsName : "(null)"));
    }
  }
  if (!profile) {
    out.push("ERROR: missing template profile (needed to add correct frames).");
    writeTextToDesktop("fix_overset__ERROR__" + isoStamp() + ".txt", out.join("\n"));
    throw new Error("Missing template profile");
  }

  var bodyDet = detectBodyStory(doc);
  if (bodyDet.index < 0) throw new Error("Could not detect body story");
  var bodyStory = doc.stories[bodyDet.index];
  out.push("Body story: index=" + bodyDet.index + " words=" + bodyDet.words);

  var rightShift = computeRightShift(profile);
  out.push("rightShift=" + rightShift);

  var masterNm = primaryBodyMasterName(profile);
  out.push("Body master=" + masterNm);

  // Force recomposition so overflows flags are up-to-date before we decide whether to add pages.
  try { if (bodyStory && bodyStory.recompose) bodyStory.recompose(); } catch (eRC0) {}
  try { if (doc && doc.recompose) doc.recompose(); } catch (eRC1) {}

  var added = 0;
  for (var i = 0; i < maxExtra; i++) {
    var oversetFrame = findOversetFrameForStory(doc, bodyStory);
    if (!oversetFrame) {
      out.push("No overset frame found for body story (stop).");
      break;
    }
    try { out.push("Overset frame on page=" + (oversetFrame.parentPage ? oversetFrame.parentPage.name : "?") + " gb=" + String(oversetFrame.geometricBounds)); } catch (eDbg) {}

    var newPg = null;
    try { newPg = doc.pages.add(LocationOptions.AFTER, doc.pages[doc.pages.length - 1]); } catch (eAdd) { newPg = null; }
    if (!newPg || !newPg.isValid) break;

    // Apply master (best-effort)
    var applied = applyMasterIfExists(doc, newPg, masterNm);
    if (!applied) {
      try { newPg.appliedMaster = doc.pages[doc.pages.length - 2].appliedMaster; } catch (eM0) {}
    }

    var expectedGroup = bodyFramesPatternForPage(profile, newPg);
    var newFrames = addFramesForNewPage(newPg, expectedGroup, rightShift);
    if (!newFrames || newFrames.length === 0) break;

    try {
      var nx = null;
      try { nx = oversetFrame.nextTextFrame; } catch (eNX) { nx = null; }
      if (nx && nx.isValid) {
        out.push("WARN: overset frame already has nextTextFrame; refusing to rethread to avoid breaking flow. page=" + (oversetFrame.parentPage ? oversetFrame.parentPage.name : "?"));
        break;
      }
    } catch (eIgn) {}

    try { oversetFrame.nextTextFrame = newFrames[0]; } catch (eT0) {}
    try { newFrames[0].previousTextFrame = oversetFrame; } catch (eT1) {}

    try { if (bodyStory.recompose) bodyStory.recompose(); } catch (eR0) {}
    try { if (doc.recompose) doc.recompose(); } catch (eR1) {}

    added++;
    try { out.push("Added page " + String(newPg.name) + " side=" + pageSideKey(newPg)); } catch (eL0) {}
  }

  var finalOver = !!findOversetFrameForStory(doc, bodyStory);
  out.push("RESULT: added_pages=" + added + " still_overflow=" + (finalOver ? "1" : "0"));
  writeTextToDesktop("fix_overset__" + isoStamp() + ".txt", out.join("\n"));
  out.join("\n");
})();


