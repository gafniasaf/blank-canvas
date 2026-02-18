// ============================================================
// EXPORT TEMPLATE PROFILE (per book/template) — InDesign/TestRun
// ============================================================
//
// Goal:
// - Extract a deterministic "template profile" from a baseline INDD:
//   - candidate chapter header paragraph styles
//   - body story identification (largest story)
//   - representative body text-frame geometry (left/right pages)
//   - master-page candidates (body vs opener)
//   - list/bullet style-name candidates
//
// Output:
// - Writes JSON profiles to: <repo>/books/template_profiles/<book_id>.json
// - Default driver: reads <repo>/books/manifest.json and generates profiles for all entries.
//
// Safety:
// - Never saves changes to any source INDD. Opens, analyzes, closes WITHOUT saving.
// - Runs with UserInteractionLevels.NEVER_INTERACT.
//
// Optional args (app.scriptArgs):
// - BIC_BOOK_ID: run for a single book_id from the manifest
// - BIC_MANIFEST_PATH: override manifest path
//
// Run (manual):
// - InDesign: File > Scripts > run this file
//
// Run (osascript):
//   tell application "Adobe InDesign 2026"
//     do script (POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/books/export-template-profile.jsx") language javascript
//   end tell
//
// ============================================================

#targetengine "session"

(function () {
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  function ctorName(o) {
    if (!o) return "";
    try { return o.constructor && o.constructor.name ? String(o.constructor.name) : ""; } catch (e) { return ""; }
  }

  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "_");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (!s) s = "doc";
    return s;
  }

  function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }

  function readTextFile(f) {
    if (!f || !f.exists) return "";
    var txt = "";
    try {
      f.encoding = "UTF-8";
      if (f.open("r")) {
        txt = String(f.read() || "");
        f.close();
      }
    } catch (e) { try { f.close(); } catch (e2) {} }
    return txt;
  }

  function writeTextFile(f, txt) {
    try {
      if (!f) return false;
      var parent = f.parent;
      if (parent && !parent.exists) parent.create();
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(txt || "")); f.close(); return true; }
    } catch (e) { try { f.close(); } catch (e2) {} }
    return false;
  }

  // ExtendScript JSON support is inconsistent; use a deterministic serializer.
  function jsonEscape(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    t = t.replace(/\\/g, "\\\\");
    t = t.replace(/"/g, "\\\"");
    t = t.replace(/\r/g, "\\r");
    t = t.replace(/\n/g, "\\n");
    t = t.replace(/\t/g, "\\t");
    return t;
  }
  function jsonStringify(v, indent, depth) {
    var sp = indent || "  ";
    var d = depth || 0;
    var pad = "";
    for (var i = 0; i < d; i++) pad += sp;
    var padIn = pad + sp;

    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "string") return "\"" + jsonEscape(v) + "\"";
    if (t === "number") {
      if (isFinite(v)) return String(v);
      return "null";
    }
    if (t === "boolean") return v ? "true" : "false";
    if (v instanceof Array) {
      if (v.length === 0) return "[]";
      var parts = [];
      for (var a = 0; a < v.length; a++) parts.push(padIn + jsonStringify(v[a], sp, d + 1));
      return "[\n" + parts.join(",\n") + "\n" + pad + "]";
    }
    // Object
    var keys = [];
    for (var k in v) { if (v.hasOwnProperty(k)) keys.push(k); }
    keys.sort();
    if (keys.length === 0) return "{}";
    var partsO = [];
    for (var j = 0; j < keys.length; j++) {
      var kk = keys[j];
      partsO.push(padIn + "\"" + jsonEscape(kk) + "\": " + jsonStringify(v[kk], sp, d + 1));
    }
    return "{\n" + partsO.join(",\n") + "\n" + pad + "}";
  }

  function parseJsonLoose(txt) {
    // NOTE: manifest is trusted (repo file). Use eval as JSON.parse may not exist.
    var t = String(txt || "");
    if (!t) return null;
    try { return eval("(" + t + ")"); } catch (e) { return null; }
  }

  function resolveRepoRoot() {
    try {
      var me = File($.fileName);
      if (!me || !me.exists) return null;
      // .../TestRun/books/export-template-profile.jsx → repo root is parent of "books"
      return me.parent ? me.parent.parent : null;
    } catch (e) { return null; }
  }

  function resolveRepoPath(repoRoot, pth) {
    var p = "";
    try { p = String(pth || ""); } catch (e0) { p = ""; }
    if (!p) return null;
    // absolute
    if (p.indexOf("/") === 0) return File(p);
    // normalize leading "./"
    if (p.indexOf("./") === 0) p = p.substring(2);
    if (!repoRoot) return File(p);
    return File(repoRoot.fsName + "/" + p);
  }

  function pageSideKey(pg) {
    try { if (pg.side === PageSideOptions.LEFT_HAND) return "left"; } catch (e0) {}
    try { if (pg.side === PageSideOptions.RIGHT_HAND) return "right"; } catch (e1) {}
    return "unknown";
  }

  function roundBounds(b) {
    // Keep integer precision for stable signatures (docs often use mm integer bounds).
    if (!b || b.length !== 4) return [0, 0, 0, 0];
    return [
      Math.round(b[0]),
      Math.round(b[1]),
      Math.round(b[2]),
      Math.round(b[3]),
    ];
  }

  function boundsSignature(frames) {
    // frames: [{bounds:[...], ...}]
    var parts = [];
    for (var i = 0; i < frames.length; i++) {
      var rb = roundBounds(frames[i].bounds);
      parts.push(rb.join(","));
    }
    return parts.join("|");
  }

  function pageHasAnyGraphics(pg) {
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        // Most placed images appear as Rectangle/Polygon/Oval with a Graphics array.
        try {
          if (it.graphics && it.graphics.length && it.graphics.length > 0) return true;
        } catch (e0) {}
      }
    } catch (e) {}
    return false;
  }

  function collectMasters(doc) {
    var names = [];
    try {
      for (var i = 0; i < doc.masterSpreads.length; i++) {
        try { names.push(String(doc.masterSpreads[i].name || "")); } catch (e0) {}
      }
    } catch (e) {}
    names.sort();
    return names;
  }

  function detectBodyStory(doc) {
    var best = -1;
    var bestWords = -1;
    try {
      for (var s = 0; s < doc.stories.length; s++) {
        var wc = 0;
        try { wc = doc.stories[s].words.length; } catch (eW) { wc = 0; }
        if (wc > bestWords) { bestWords = wc; best = s; }
      }
    } catch (e) {}
    return { index: best, words: bestWords };
  }

  function bodyStoryFramesOnPage(pg, bodyStory) {
    var frames = [];
    if (!pg || !bodyStory) return frames;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var st = null;
        try { st = it.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;

        var gb = null;
        try { gb = it.geometricBounds; } catch (eB) { gb = null; }
        if (!gb || gb.length !== 4) continue;

        var colCount = 1;
        var gutter = null;
        try { colCount = it.textFramePreferences.textColumnCount; } catch (eC) { colCount = 1; }
        try { gutter = it.textFramePreferences.textColumnGutter; } catch (eG) { gutter = null; }

        frames.push({
          bounds: [gb[0], gb[1], gb[2], gb[3]],
          textColumnCount: colCount,
          textColumnGutter: gutter
        });
      }
    } catch (eAll) {}

    // Sort left-to-right for stable signatures
    frames.sort(function (a, b) {
      try { return a.bounds[1] - b.bounds[1]; } catch (e) { return 0; }
    });
    return frames;
  }

  function mostCommonFramesBySide(doc, bodyStory) {
    var bySide = {
      left: { sigToCount: {}, sigToSample: {}, sigToMaster: {} },
      right: { sigToCount: {}, sigToSample: {}, sigToMaster: {} },
      unknown: { sigToCount: {}, sigToSample: {}, sigToMaster: {} }
    };

    var masterCountsBody = {};
    var masterCountsOpener = {};

    function inc(map, key) { map[key] = (map.hasOwnProperty(key) ? map[key] : 0) + 1; }

    for (var po = 0; po < doc.pages.length; po++) {
      var pg = doc.pages[po];
      if (!pg || !pg.isValid) continue;

      var side = pageSideKey(pg);
      var m = "";
      try { m = (pg.appliedMaster ? String(pg.appliedMaster.name || "") : ""); } catch (eM) { m = ""; }

      var frames = bodyStoryFramesOnPage(pg, bodyStory);
      if (frames.length > 0) {
        inc(masterCountsBody, m || "(none)");
        var sig = boundsSignature(frames);
        if (!sig) continue;
        inc(bySide[side].sigToCount, sig);
        if (!bySide[side].sigToSample.hasOwnProperty(sig)) bySide[side].sigToSample[sig] = frames;
        if (!bySide[side].sigToMaster.hasOwnProperty(sig)) bySide[side].sigToMaster[sig] = m || "";
      } else {
        // Candidate opener pages: graphics present but no body frames.
        if (pageHasAnyGraphics(pg)) {
          inc(masterCountsOpener, m || "(none)");
        }
      }
    }

    function pickBest(sideObj) {
      var bestSig = "";
      var bestCount = -1;
      for (var sig in sideObj.sigToCount) {
        if (!sideObj.sigToCount.hasOwnProperty(sig)) continue;
        var c = sideObj.sigToCount[sig];
        if (c > bestCount) { bestCount = c; bestSig = sig; }
      }
      return {
        signature: bestSig,
        pagesSeen: bestCount < 0 ? 0 : bestCount,
        masterName: bestSig ? (sideObj.sigToMaster[bestSig] || "") : "",
        frames: bestSig ? (sideObj.sigToSample[bestSig] || []) : []
      };
    }

    function sortCounts(map) {
      var arr = [];
      for (var k in map) { if (map.hasOwnProperty(k)) arr.push({ name: k, count: map[k] }); }
      arr.sort(function (a, b) { return b.count - a.count; });
      return arr;
    }

    return {
      bySide: {
        left: pickBest(bySide.left),
        right: pickBest(bySide.right),
        unknown: pickBest(bySide.unknown)
      },
      masterCandidates: {
        body: sortCounts(masterCountsBody),
        opener: sortCounts(masterCountsOpener)
      }
    };
  }

  function cleanOneLine(s) {
    return String(s || "")
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function isListLikeStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
  }

  function detectHeadingStylesFromStory(story) {
    var counts = {};
    var listStyleCounts = {};
    var chapterHeaderStyleCounts = {};

    function inc(map, key) { map[key] = (map.hasOwnProperty(key) ? map[key] : 0) + 1; }

    if (!story) return { numbered: [], chapter: [], listLike: [] };
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var i = 0; i < pc; i++) {
      var para = story.paragraphs[i];
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
      if (!styleName) styleName = "(none)";

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (txt && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);
      var one = cleanOneLine(txt);
      if (!one) continue;

      // Numbered headings like 1.4 or 1.4.6
      var isNumbered = false;
      try { isNumbered = /^\d+\.(\d+)(?:\.\d+)?\b/.test(one) && one.length <= 160; } catch (eN) { isNumbered = false; }
      if (isNumbered) inc(counts, styleName);

      // Chapter headers like "1 ..." / "2 ..." often use special styles.
      var isChapterHeader = false;
      var sn = String(styleName || "").toLowerCase();
      if (sn.indexOf("chapter header") !== -1 || sn.indexOf("hoofdstuk") !== -1 || sn.indexOf("chapter") !== -1) {
        isChapterHeader = true;
      } else {
        try { isChapterHeader = /^\d+\b/.test(one) && one.length <= 80; } catch (eCH) { isChapterHeader = false; }
      }
      if (isChapterHeader) inc(chapterHeaderStyleCounts, styleName);

      // List/bullets styles
      if (isListLikeStyleName(styleName)) inc(listStyleCounts, styleName);
    }

    function topN(map, n) {
      var arr = [];
      for (var k in map) { if (map.hasOwnProperty(k)) arr.push({ name: k, count: map[k] }); }
      arr.sort(function (a, b) { return b.count - a.count; });
      var out = [];
      for (var i = 0; i < Math.min(n, arr.length); i++) out.push(arr[i]);
      return out;
    }

    return {
      numbered: topN(counts, 25),
      chapter: topN(chapterHeaderStyleCounts, 25),
      listLike: topN(listStyleCounts, 50)
    };
  }

  function buildProfile(book, doc) {
    var body = detectBodyStory(doc);
    var bodyStory = null;
    try { if (body.index >= 0) bodyStory = doc.stories[body.index]; } catch (eS) { bodyStory = null; }

    var framesInfo = mostCommonFramesBySide(doc, bodyStory);
    var headingInfo = detectHeadingStylesFromStory(bodyStory);

    var unit = "";
    try { unit = String(doc.viewPreferences.horizontalMeasurementUnits || ""); } catch (eU0) { unit = ""; }

    return {
      book_id: String(book.book_id || ""),
      generated_at: isoStamp(),
      source: {
        canonical_n4_indd_path: String(book.canonical_n4_indd_path || ""),
        canonical_n4_idml_path: String(book.canonical_n4_idml_path || ""),
        baseline_full_indd_path: String(book.baseline_full_indd_path || "")
      },
      document: {
        name: String(doc.name || ""),
        pages: (function () { try { return doc.pages.length; } catch (e) { return 0; } })(),
        facingPages: (function () { try { return !!doc.documentPreferences.facingPages; } catch (e) { return null; } })(),
        horizontalMeasurementUnits: unit
      },
      masters: {
        all: collectMasters(doc),
        bodyCandidates: framesInfo.masterCandidates.body,
        openerCandidates: framesInfo.masterCandidates.opener
      },
      bodyStory: {
        index: body.index,
        words: body.words
      },
      bodyFrames: {
        left: framesInfo.bySide.left,
        right: framesInfo.bySide.right,
        unknown: framesInfo.bySide.unknown
      },
      paragraphStyleCandidates: {
        chapterHeader: headingInfo.chapter,
        numberedHeadings: headingInfo.numbered,
        listLike: headingInfo.listLike
      }
    };
  }

  function openDocForReadOnly(inddPath) {
    var f = File(inddPath);
    if (!f.exists) return null;
    var doc = null;
    try { doc = app.open(f, true); } catch (e0) { try { doc = app.open(f); } catch (e1) { doc = null; } }
    // Ensure visible window to avoid activeDocument weirdness.
    try {
      var hasWin = false;
      try { hasWin = (doc && doc.windows && doc.windows.length > 0); } catch (eW0) { hasWin = false; }
      if (doc && !hasWin) {
        try { doc.close(SaveOptions.NO); } catch (eCW) {}
        try { doc = app.open(f, true); } catch (e2) { try { doc = app.open(f); } catch (e3) { doc = null; } }
      }
    } catch (eW1) {}
    return doc;
  }

  function closeDocNoSave(doc) {
    try { if (doc && doc.isValid) doc.close(SaveOptions.NO); } catch (e) {}
  }

  var outLines = [];
  try {
    var repoRoot = resolveRepoRoot();
    if (!repoRoot || !repoRoot.exists) throw new Error("Could not resolve repo root from $.fileName=" + String($.fileName));

    var manifestPath = "";
    try { manifestPath = String(app.scriptArgs.getValue("BIC_MANIFEST_PATH") || ""); } catch (eMP) { manifestPath = ""; }
    var manifestFile = manifestPath ? File(manifestPath) : File(repoRoot.fsName + "/books/manifest.json");
    if (!manifestFile.exists) throw new Error("Manifest not found: " + manifestFile.fsName);

    var onlyBookId = "";
    try { onlyBookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eBID) { onlyBookId = ""; }

    var manifest = parseJsonLoose(readTextFile(manifestFile));
    if (!manifest || !manifest.books || !(manifest.books instanceof Array)) {
      throw new Error("Invalid manifest JSON shape: expected { books: [...] }");
    }

    outLines.push("=== EXPORT TEMPLATE PROFILES ===");
    outLines.push("Repo: " + repoRoot.fsName);
    outLines.push("Manifest: " + manifestFile.fsName);
    if (onlyBookId) outLines.push("Filter book_id=" + onlyBookId);
    outLines.push("Started: " + (new Date()).toString());
    outLines.push("");

    var wrote = 0;
    var skipped = 0;
    var failed = 0;

    for (var i = 0; i < manifest.books.length; i++) {
      var book = manifest.books[i];
      if (!book) continue;
      var bid = String(book.book_id || "");
      if (onlyBookId && bid !== onlyBookId) { skipped++; continue; }

      var baselinePath = String(book.baseline_full_indd_path || "");
      var outP = String(book.template_profile_path || "");
      if (!bid || !baselinePath || !outP) {
        failed++;
        outLines.push("ERROR: missing fields for entry i=" + i + " book_id=" + bid);
        continue;
      }

      var outFile = resolveRepoPath(repoRoot, outP);
      if (!outFile) {
        failed++;
        outLines.push("ERROR: could not resolve template_profile_path for " + bid + ": " + outP);
        continue;
      }

      outLines.push("---");
      outLines.push("BOOK: " + bid);
      outLines.push("BASELINE: " + baselinePath);
      outLines.push("OUT: " + outFile.fsName);

      var doc = openDocForReadOnly(baselinePath);
      if (!doc) {
        failed++;
        outLines.push("ERROR: could not open baseline: " + baselinePath);
        continue;
      }
      try { app.activeDocument = doc; } catch (eAct) {}

      var profile = null;
      try { profile = buildProfile(book, doc); } catch (eProf) { profile = null; }
      closeDocNoSave(doc);

      if (!profile) {
        failed++;
        outLines.push("ERROR: failed to build profile for " + bid);
        continue;
      }

      var json = jsonStringify(profile, "  ", 0) + "\n";
      var ok = writeTextFile(outFile, json);
      if (ok) {
        wrote++;
        outLines.push("OK: wrote profile");
      } else {
        failed++;
        outLines.push("ERROR: failed to write profile");
      }
    }

    outLines.push("");
    outLines.push("RESULT: wrote=" + wrote + " skipped=" + skipped + " failed=" + failed);

    // Write a run log for debugging.
    var logFile = File(Folder.desktop + "/export_template_profiles__" + isoStamp() + ".txt");
    writeTextFile(logFile, outLines.join("\n") + "\n");
  } catch (eTop) {
    try { outLines.push("FATAL: " + String(eTop)); } catch (e2) {}
    try { alert("export-template-profile.jsx failed:\n" + String(eTop)); } catch (e3) {}
    try {
      var logFile2 = File(Folder.desktop + "/export_template_profiles__FAILED__" + isoStamp() + ".txt");
      writeTextFile(logFile2, outLines.join("\n") + "\n");
    } catch (e4) {}
  } finally {
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eF) {}
  }

  outLines.join("\n");
})();
































