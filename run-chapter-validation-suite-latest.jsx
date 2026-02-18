// ============================================================
// RUN: chapter validation suite on latest rewritten output (generic)
// ============================================================
// Finds the newest output INDD for a given (book_id, chapter) under output_root
// and runs a deterministic validation suite with hard-fails.
//
// Inputs (app.scriptArgs):
// - BIC_BOOK_ID (optional; defaults to first manifest entry)
// - BIC_CHAPTER_FILTER (optional; defaults to 1)
//
// Suite (hard-fail):
// - validate-chapter.jsx
// - scan-empty-bullets.jsx
// - scan-trailing-empty-pages.jsx
// - validate-chapter-headers.jsx
//
// Also runs (report-only):
// - check-links.jsx
// ============================================================

#targetengine "session"

(function () {
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

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

  function expandTildePath(pth) {
    var p = "";
    try { p = String(pth || ""); } catch (e0) { p = ""; }
    if (!p) return "";
    if (p.indexOf("~/") === 0) {
      try { return Folder.home.fsName + "/" + p.substring(2); } catch (e1) {}
    }
    return p;
  }

  function escapeRe(s) {
    try { return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); } catch (e0) { return ""; }
  }

  function newestMatch(folder, re) {
    if (!folder || !folder.exists) return null;
    var files = folder.getFiles(function (f) {
      try { return (f instanceof File) && re.test(f.name); } catch (e) { return false; }
    });
    if (!files || files.length === 0) return null;
    files.sort(function (a, b) {
      try { return b.modified.getTime() - a.modified.getTime(); } catch (e) { return 0; }
    });
    return files[0];
  }

  function openDocWithWindow(f) {
    var doc = null;
    try { doc = app.open(f, true); } catch (e0) { try { doc = app.open(f); } catch (e1) { doc = null; } }
    try { if (doc) app.activeDocument = doc; } catch (eAct) {}
    try {
      var hasWin = false;
      try { hasWin = (doc && doc.windows && doc.windows.length > 0); } catch (eW0) { hasWin = false; }
      if (doc && !hasWin) {
        try { doc.close(SaveOptions.NO); } catch (eCW) {}
        try { doc = app.open(f, true); } catch (e2) { try { doc = app.open(f); } catch (e3) { doc = null; } }
        try { if (doc) app.activeDocument = doc; } catch (eAct2) {}
      }
    } catch (eW1) {}
    return doc;
  }

  function hardGateActiveDocPath(expectedFsName) {
    try {
      return (app.activeDocument && app.activeDocument.fullName && app.activeDocument.fullName.fsName === expectedFsName);
    } catch (e0) {}
    return false;
  }

  var log = [];
  try {
    var repoRoot = resolveRepoRoot();
    if (!repoRoot || !repoRoot.exists) throw new Error("Could not resolve repo root from $.fileName=" + String($.fileName));

    var manifestFile = File(repoRoot.fsName + "/books/manifest.json");
    if (!manifestFile.exists) throw new Error("Manifest not found: " + manifestFile.fsName);
    var manifest = parseJsonLoose(readTextFile(manifestFile));
    if (!manifest || !manifest.books || !(manifest.books instanceof Array) || manifest.books.length === 0) throw new Error("Invalid manifest JSON shape");

    var bookId = "";
    try { bookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eB0) { bookId = ""; }
    var chapterStr = "";
    try { chapterStr = String(app.scriptArgs.getValue("BIC_CHAPTER_FILTER") || ""); } catch (eC0) { chapterStr = ""; }
    var chapterNum = parseInt(chapterStr, 10);
    if (!(chapterNum > 0)) chapterNum = 1;

    var book = null;
    if (!bookId) book = manifest.books[0];
    else {
      for (var i = 0; i < manifest.books.length; i++) {
        var b = manifest.books[i];
        if (!b) continue;
        if (String(b.book_id || "") === bookId) { book = b; break; }
      }
    }
    if (!book) throw new Error("Book not found in manifest: book_id=" + bookId);
    bookId = String(book.book_id || bookId || "");

    var outputRootPath = expandTildePath(String(book.output_root || ""));
    if (!outputRootPath) outputRootPath = Folder.desktop.fsName + "/Generated_Books/" + bookId;
    var outputRoot = new Folder(outputRootPath);
    if (!outputRoot.exists) throw new Error("Output root not found: " + outputRoot.fsName);

    log.push("=== run-chapter-validation-suite-latest.jsx ===");
    log.push("Started: " + (new Date()).toString());
    log.push("Repo: " + repoRoot.fsName);
    log.push("Manifest: " + manifestFile.fsName);
    log.push("BOOK_ID=" + bookId + " CHAPTER=" + String(chapterNum));
    log.push("OutputRoot: " + outputRoot.fsName);
    log.push("");

    var baseStem = bookId + "__CH" + String(chapterNum) + "_ONLY_BASELINE";
    var re = new RegExp("^" + escapeRe(baseStem) + ".*_REWRITTEN_V5_SAFE.*\\.indd$", "i");
    var target = newestMatch(outputRoot, re);
    if (!target) throw new Error("No rewritten output found in " + outputRoot.fsName + " for stem=" + baseStem);
    log.push("Target: " + target.fsName);

    // Resolve suite scripts
    var SCRIPTS = {
      checkLinks: File(repoRoot.fsName + "/check-links.jsx"),
      validateChapter: File(repoRoot.fsName + "/validate-chapter.jsx"),
      scanEmptyBullets: File(repoRoot.fsName + "/scan-empty-bullets.jsx"),
      scanNestedBullets: File(repoRoot.fsName + "/scan-nested-bullets.jsx"),
      scanTrailingEmptyPages: File(repoRoot.fsName + "/scan-trailing-empty-pages.jsx"),
      validateChapterHeaders: File(repoRoot.fsName + "/validate-chapter-headers.jsx")
    };
    function ensureExistsOrThrow(f, label) {
      if (!f || !f.exists) throw new Error(label + " not found: " + (f ? f.fsName : "(null)"));
    }
    ensureExistsOrThrow(SCRIPTS.checkLinks, "check-links.jsx");
    ensureExistsOrThrow(SCRIPTS.validateChapter, "validate-chapter.jsx");
    ensureExistsOrThrow(SCRIPTS.scanEmptyBullets, "scan-empty-bullets.jsx");
    ensureExistsOrThrow(SCRIPTS.scanNestedBullets, "scan-nested-bullets.jsx");
    ensureExistsOrThrow(SCRIPTS.scanTrailingEmptyPages, "scan-trailing-empty-pages.jsx");
    ensureExistsOrThrow(SCRIPTS.validateChapterHeaders, "validate-chapter-headers.jsx");

    // Open target with window and hard-gate
    var doc = openDocWithWindow(target);
    if (!doc) throw new Error("Failed to open target doc");
    try { app.activeDocument = doc; } catch (eAct) {}
    if (!hardGateActiveDocPath(target.fsName)) throw new Error("Could not activate target doc (activeDocument gate failed)");

    // Provide context to scripts (profile resolution, chapter info)
    try { app.scriptArgs.setValue("BIC_BOOK_ID", bookId); } catch (eSA0) {}
    try { app.scriptArgs.setValue("BIC_CHAPTER_FILTER", String(chapterNum)); } catch (eSA1) {}

    var hadErrors = false;

    // Report-only link check
    try {
      log.push("Running: check-links.jsx");
      app.doScript(SCRIPTS.checkLinks, ScriptLanguage.JAVASCRIPT);
      log.push("OK: check-links.jsx");
    } catch (eCL) {
      hadErrors = true;
      log.push("ERROR: check-links.jsx threw: " + String(eCL));
    }

    // Hard-gate scripts
    function runHard(label, f) {
      log.push("Running: " + label);
      app.doScript(f, ScriptLanguage.JAVASCRIPT);
      log.push("OK: " + label);
    }

    try { runHard("validate-chapter.jsx", SCRIPTS.validateChapter); } catch (eV) { hadErrors = true; log.push("ERROR: validate-chapter.jsx threw: " + String(eV)); }
    try { runHard("scan-empty-bullets.jsx", SCRIPTS.scanEmptyBullets); } catch (eEB) { hadErrors = true; log.push("ERROR: scan-empty-bullets.jsx threw: " + String(eEB)); }
    try { runHard("scan-nested-bullets.jsx", SCRIPTS.scanNestedBullets); } catch (eNB) { hadErrors = true; log.push("ERROR: scan-nested-bullets.jsx threw: " + String(eNB)); }
    try { runHard("scan-trailing-empty-pages.jsx", SCRIPTS.scanTrailingEmptyPages); } catch (eTEP) { hadErrors = true; log.push("ERROR: scan-trailing-empty-pages.jsx threw: " + String(eTEP)); }
    try { runHard("validate-chapter-headers.jsx", SCRIPTS.validateChapterHeaders); } catch (eCH) { hadErrors = true; log.push("ERROR: validate-chapter-headers.jsx threw: " + String(eCH)); }

    log.push("");
    log.push("Finished: " + (new Date()).toString() + " ok=" + (hadErrors ? "0" : "1"));
    writeTextToDesktop("run_chapter_validation_suite__" + isoStamp() + ".txt", log.join("\n"));

    if (hadErrors) {
      alert("Chapter validation suite FAILED. See Desktop run_chapter_validation_suite__*.txt and per-script reports.");
      throw new Error("run-chapter-validation-suite-latest.jsx HARD FAIL");
    }
  } catch (eTop) {
    log.push("FATAL: " + String(eTop));
    writeTextToDesktop("run_chapter_validation_suite__FAILED__" + isoStamp() + ".txt", log.join("\n"));
    try { alert("run-chapter-validation-suite-latest.jsx failed:\n" + String(eTop)); } catch (eA) {}
    // IMPORTANT: rethrow so AppleScript/osascript callers (e.g. scripts/run-book.ts) receive a non-zero exit.
    throw eTop;
  } finally {
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (e3) {}
  }
})();


