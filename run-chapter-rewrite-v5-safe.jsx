// ============================================================
// RUN: SAFE REWRITE PIPELINE v5 (chapter-by-chapter, generic)
// ============================================================
// Wrapper responsibilities:
// - Resolve book + template info from books/manifest.json
// - Build or reuse a chapter-only baseline via make-chapter-baseline.jsx
// - Run scripts/rewrite-from-original-safe-v5.jsx with chapter scope and configurable JSON/output folder
// - Run post-passes on the newest output:
//   - fix-praktijk-verdieping-headings-chapter.jsx
//   - remove-soft-hyphens-chapter.jsx
// - Copy Desktop-generated logs into a chapter-scoped reports folder (to avoid overwrites)
// - Run scripts/verify-json-coverage.ts on the chapter-scoped coverage TSV
//
// Inputs (app.scriptArgs):
// - BIC_BOOK_ID (optional; defaults to first manifest entry)
// - BIC_CHAPTER (optional; defaults to 1)
// - BIC_REWRITES_JSON_PATH (optional; defaults to ~/Desktop/rewrites_for_indesign.json)
// - BIC_FORCE_REBUILD_BASELINE ("1"/"true" to force baseline rebuild)
//
// Notes:
// - This wrapper sets scriptArgs for child scripts; it does NOT require AppleScript to set them.
// - It hard-gates activeDocument before any destructive operation.
// ============================================================

#targetengine "session"

(function () {
  var WRAPPER_NAME = "run-chapter-rewrite-v5-safe.jsx";
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

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
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (!s) s = "doc";
    return s;
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

  function appendLog(logFile, line) {
    try {
      logFile.open("a");
      logFile.writeln(String(line));
      logFile.close();
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

  function closeGeneratedOutputsInFolder(outputRoot) {
    try {
      for (var ci = app.documents.length - 1; ci >= 0; ci--) {
        var dC = app.documents[ci];
        var pth = "";
        var nm = "";
        try { nm = String(dC.name || ""); } catch (eN) { nm = ""; }
        try { pth = (dC.fullName ? String(dC.fullName.fsName || "") : ""); } catch (eP) { pth = ""; }
        var isInOut = outputRoot && pth.indexOf(outputRoot.fsName) !== -1;
        var looksLikeOutput = (nm.toLowerCase().indexOf("_rewritten_v5_safe") !== -1);
        if (isInOut && looksLikeOutput) {
          try { dC.close(SaveOptions.NO); } catch (eClose) {}
        }
      }
    } catch (e) {}
  }

  function closeDocIfOpenByPath(fsName, logFile) {
    if (!fsName) return;
    try {
      for (var i = app.documents.length - 1; i >= 0; i--) {
        var d = app.documents[i];
        var pth = "";
        try { pth = (d.fullName ? String(d.fullName.fsName || "") : ""); } catch (eP) { pth = ""; }
        if (pth && pth === fsName) {
          try { appendLog(logFile, "Closing already-open doc (no save): " + String(d.name || "")); } catch (eL) {}
          try { d.close(SaveOptions.NO); } catch (eC) {}
        }
      }
    } catch (e0) {}
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

  function hardGateActiveDocPath(expectedFsName, logFile) {
    var ok = false;
    try {
      try { ok = (app.activeDocument && app.activeDocument.fullName && app.activeDocument.fullName.fsName === expectedFsName); } catch (e0) { ok = false; }
      if (!ok) appendLog(logFile, "ERROR: activeDocument gate failed. expected=" + expectedFsName);
    } catch (e1) {}
    return ok;
  }

  function copyFileIfExists(src, dest) {
    try {
      if (!src || !src.exists) return false;
      if (dest.exists) { try { dest.remove(); } catch (eRm) {} }
      return src.copy(dest);
    } catch (e) {}
    return false;
  }

  // ----------------------------
  // MAIN
  // ----------------------------
  var repoRoot = resolveRepoRoot();
  var out = [];
  var runId = isoStamp();

  try {
    if (!repoRoot || !repoRoot.exists) throw new Error("Could not resolve repo root from $.fileName=" + String($.fileName));

    // Resolve manifest + book entry
    var manifestFile = File(repoRoot.fsName + "/books/manifest.json");
    if (!manifestFile.exists) throw new Error("Manifest not found: " + manifestFile.fsName);
    var manifest = parseJsonLoose(readTextFile(manifestFile));
    if (!manifest || !manifest.books || !(manifest.books instanceof Array) || manifest.books.length === 0) throw new Error("Invalid manifest JSON shape");

    var bookId = "";
    try { bookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eB0) { bookId = ""; }
    var chapterStr = "";
    try { chapterStr = String(app.scriptArgs.getValue("BIC_CHAPTER") || ""); } catch (eC0) { chapterStr = ""; }
    var chapterNum = parseInt(chapterStr, 10);
    if (!(chapterNum > 0)) chapterNum = 1;

    var jsonPath = "";
    try { jsonPath = String(app.scriptArgs.getValue("BIC_REWRITES_JSON_PATH") || ""); } catch (eJ0) { jsonPath = ""; }
    if (!jsonPath) jsonPath = (Folder.desktop.fsName + "/rewrites_for_indesign.json");
    jsonPath = expandTildePath(jsonPath);

    var forceRebuild = false;
    try {
      var fr = String(app.scriptArgs.getValue("BIC_FORCE_REBUILD_BASELINE") || "");
      forceRebuild = (fr.toLowerCase() === "1" || fr.toLowerCase() === "true" || fr.toLowerCase() === "yes");
    } catch (eF0) { forceRebuild = false; }

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
    if (!outputRoot.exists) outputRoot.create();

    var reportsDir = new Folder(outputRoot.fsName + "/reports/ch" + String(chapterNum));
    if (!reportsDir.exists) reportsDir.create();
    var runDir = new Folder(reportsDir.fsName + "/" + runId);
    if (!runDir.exists) runDir.create();

    var logFile = File(runDir.fsName + "/run_chapter_rewrite_v5_safe_wrapper_log.txt");
    writeTextFile(logFile, "=== " + WRAPPER_NAME + " ===\nStarted: " + (new Date()).toString() + "\n");

    appendLog(logFile, "Repo: " + repoRoot.fsName);
    appendLog(logFile, "Manifest: " + manifestFile.fsName);
    appendLog(logFile, "BOOK_ID=" + bookId + " CHAPTER=" + String(chapterNum));
    appendLog(logFile, "JSON(input_path)=" + jsonPath);
    appendLog(logFile, "OutputRoot=" + outputRoot.fsName);
    appendLog(logFile, "RunDir=" + runDir.fsName);

    // Snapshot the exact input JSON into the run folder (single-run reproducibility)
    var jsonFile = File(jsonPath);
    if (!jsonFile.exists) throw new Error("Rewrites JSON not found: " + jsonPath);
    var jsonSnapshot = File(runDir.fsName + "/rewrites_for_indesign.used.json");
    if (!copyFileIfExists(jsonFile, jsonSnapshot)) throw new Error("Failed to snapshot rewrites JSON into run folder: " + jsonSnapshot.fsName);
    var jsonPathForRun = jsonSnapshot.fsName;
    appendLog(logFile, "JSON(used_snapshot)=" + jsonPathForRun);

    // Resolve scripts
    var MAKE_BASELINE_SCRIPT = File(repoRoot.fsName + "/make-chapter-baseline.jsx");
    var SAFE_V5_SCRIPT = File(repoRoot.fsName + "/scripts/rewrite-from-original-safe-v5.jsx");
    var FIX_HEADINGS_SCRIPT = File(repoRoot.fsName + "/fix-praktijk-verdieping-headings-chapter.jsx");
    var SOFT_HYPHEN_CLEAN_SCRIPT = File(repoRoot.fsName + "/remove-soft-hyphens-chapter.jsx");
    var FIX_OVERSET_SCRIPT = File(repoRoot.fsName + "/fix-overset-by-adding-pages.jsx");
    var FIX_EMPTY_BULLETS_SCRIPT = File(repoRoot.fsName + "/fix-empty-bullets.jsx");
    var NORMALIZE_BULLETS_SCRIPT = File(repoRoot.fsName + "/normalize-bullets-chapter.jsx");
    var MICRO_MERGE_BULLETS_SCRIPT = File(repoRoot.fsName + "/micro-merge-bullets-into-prose.jsx");
    var REMOVE_TRAILING_EMPTY_PARAS_SCRIPT = File(repoRoot.fsName + "/remove-trailing-empty-paragraphs.jsx");
    var TRIM_TRAILING_EMPTY_PAGES_SCRIPT = File(repoRoot.fsName + "/trim-trailing-empty-pages.jsx");
    var FIX_OVERSET_PASTEBOARD_SCRIPT = File(repoRoot.fsName + "/fix-overset-pasteboard-frames.jsx");
    var UPDATE_OUT_OF_DATE_LINKS_SCRIPT = File(repoRoot.fsName + "/update-out-of-date-links.jsx");
    var COVERAGE_VERIFIER = File(repoRoot.fsName + "/scripts/verify-json-coverage.ts");
    var APPLIED_VERIFIER = File(repoRoot.fsName + "/scripts/verify-applied-rewrites.ts");

    function ensureExistsOrThrow(f, label) {
      if (!f || !f.exists) throw new Error(label + " not found: " + (f ? f.fsName : "(null)"));
    }
    ensureExistsOrThrow(MAKE_BASELINE_SCRIPT, "make-chapter-baseline.jsx");
    ensureExistsOrThrow(SAFE_V5_SCRIPT, "rewrite-from-original-safe-v5.jsx");
    ensureExistsOrThrow(FIX_HEADINGS_SCRIPT, "fix-praktijk-verdieping-headings-chapter.jsx");
    ensureExistsOrThrow(SOFT_HYPHEN_CLEAN_SCRIPT, "remove-soft-hyphens-chapter.jsx");
    ensureExistsOrThrow(FIX_OVERSET_SCRIPT, "fix-overset-by-adding-pages.jsx");
    ensureExistsOrThrow(FIX_EMPTY_BULLETS_SCRIPT, "fix-empty-bullets.jsx");
    ensureExistsOrThrow(NORMALIZE_BULLETS_SCRIPT, "normalize-bullets-chapter.jsx");
    ensureExistsOrThrow(MICRO_MERGE_BULLETS_SCRIPT, "micro-merge-bullets-into-prose.jsx");
    ensureExistsOrThrow(REMOVE_TRAILING_EMPTY_PARAS_SCRIPT, "remove-trailing-empty-paragraphs.jsx");
    ensureExistsOrThrow(TRIM_TRAILING_EMPTY_PAGES_SCRIPT, "trim-trailing-empty-pages.jsx");
    ensureExistsOrThrow(FIX_OVERSET_PASTEBOARD_SCRIPT, "fix-overset-pasteboard-frames.jsx");
    ensureExistsOrThrow(UPDATE_OUT_OF_DATE_LINKS_SCRIPT, "update-out-of-date-links.jsx");
    ensureExistsOrThrow(COVERAGE_VERIFIER, "scripts/verify-json-coverage.ts");
    ensureExistsOrThrow(APPLIED_VERIFIER, "scripts/verify-applied-rewrites.ts");

    // Baseline output path
    var baselineDir = new Folder(outputRoot.fsName + "/_chapter_baselines");
    if (!baselineDir.exists) baselineDir.create();
    var baselineFile = File(baselineDir.fsName + "/" + bookId + "__CH" + String(chapterNum) + "_ONLY_BASELINE.indd");

    // Build baseline if needed
    if (forceRebuild || !baselineFile.exists) {
      // If the target baseline is already open, InDesign will refuse to overwrite it.
      // Close it proactively (safe: we never save baselines).
      closeDocIfOpenByPath(baselineFile.fsName, logFile);

      appendLog(logFile, "Building chapter baseline: " + baselineFile.fsName);
      try { app.scriptArgs.setValue("BIC_BOOK_ID", bookId); } catch (eSB0) {}
      try { app.scriptArgs.setValue("BIC_CHAPTER", String(chapterNum)); } catch (eSB1) {}
      try { app.scriptArgs.setValue("BIC_OUT_INDD", baselineFile.fsName); } catch (eSB2) {}
      try { app.scriptArgs.setValue("BIC_MAX_EXTRA_PAGES", "12"); } catch (eSB3) {}
      app.doScript(MAKE_BASELINE_SCRIPT, ScriptLanguage.JAVASCRIPT);
      // Clear only the baseline-maker args
      try { app.scriptArgs.setValue("BIC_OUT_INDD", ""); } catch (eClr0) {}
      try { app.scriptArgs.setValue("BIC_MAX_EXTRA_PAGES", ""); } catch (eClr1) {}
    } else {
      appendLog(logFile, "Reusing existing chapter baseline: " + baselineFile.fsName);
    }
    if (!baselineFile.exists) throw new Error("Baseline not found after build: " + baselineFile.fsName);

    // Close any open outputs in this outputRoot to prevent activeDocument drift
    closeGeneratedOutputsInFolder(outputRoot);

    // Open baseline with window and hard-gate activeDocument
    var baseDoc = openDocWithWindow(baselineFile);
    if (!baseDoc) throw new Error("Failed to open baseline: " + baselineFile.fsName);
    try { app.activeDocument = baseDoc; } catch (eActB) {}
    if (!hardGateActiveDocPath(baselineFile.fsName, logFile)) {
      try { baseDoc.close(SaveOptions.NO); } catch (eCB) {}
      throw new Error("Could not activate BASELINE doc. Aborting to avoid modifying the wrong file.");
    }
    appendLog(logFile, "Active baseline doc: " + app.activeDocument.name);

    // Run safe v5 on baseline (safe script closes baseline and opens output)
    try { app.scriptArgs.setValue("BIC_CHAPTER_FILTER", String(chapterNum)); } catch (eSA0) {}
    try { app.scriptArgs.setValue("BIC_REWRITES_JSON_PATH", jsonPathForRun); } catch (eSA1) {}
    try { app.scriptArgs.setValue("BIC_OUTPUT_FOLDER", outputRoot.fsName); } catch (eSA2) {}
    appendLog(logFile, "Running safe v5 rewrite engine...");
    try {
      app.doScript(SAFE_V5_SCRIPT, ScriptLanguage.JAVASCRIPT);
      appendLog(logFile, "Safe v5 script completed.");
    } catch (eV5) {
      appendLog(logFile, "ERROR: Safe v5 script failed: " + String(eV5));
      throw eV5;
    }
    // Clear args that should not leak to other scripts
    try { app.scriptArgs.setValue("BIC_REWRITES_JSON_PATH", ""); } catch (eSA3) {}
    try { app.scriptArgs.setValue("BIC_OUTPUT_FOLDER", ""); } catch (eSA4) {}

    // Defensive baseline-close sweep (baseline should already be closed by v5)
    try {
      for (var k = app.documents.length - 1; k >= 0; k--) {
        var dk = app.documents[k];
        try {
          if (dk && dk.fullName && dk.fullName.fsName === baselineFile.fsName) {
            appendLog(logFile, "Closing baseline doc without saving: " + dk.name);
            dk.close(SaveOptions.NO);
          }
        } catch (eK) {}
      }
    } catch (eCloseAll) {}

    // Identify newest output INDD in outputRoot for this baseline stem.
    var stem = "";
    try { stem = String(baselineFile.displayName || ""); } catch (eSt0) { stem = ""; }
    try { stem = stem.replace(/\.indd$/i, ""); } catch (eSt1) {}
    if (!stem) throw new Error("Could not derive baseline stem");

    function escapeRe(s) {
      try { return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&"); } catch (e0) { return ""; }
    }
    var re = new RegExp("^" + escapeRe(stem) + ".*_REWRITTEN_V5_SAFE.*\\.indd$", "i");
    appendLog(logFile, "Searching newest output in folder: " + outputRoot.fsName);
    var target = newestMatch(outputRoot, re);
    if (!target) throw new Error("Could not find rewritten output in: " + outputRoot.fsName + " for stem=" + stem);
    appendLog(logFile, "Newest output file: " + target.fsName);

    // Open output with window and hard-gate activeDocument
    appendLog(logFile, "Opening output doc for post-passes...");
    var outDoc = openDocWithWindow(target);
    if (!outDoc) throw new Error("Failed to open output doc: " + target.fsName);
    try { app.activeDocument = outDoc; } catch (eActO) {}
    if (!hardGateActiveDocPath(target.fsName, logFile)) {
      try { outDoc.close(SaveOptions.NO); } catch (eCO) {}
      throw new Error("Could not activate OUTPUT doc. Aborting post-passes.");
    }

    // Post-pass: headings normalization
    try { app.scriptArgs.setValue("BIC_CHAPTER_FILTER", String(chapterNum)); } catch (ePF0) {}
    appendLog(logFile, "Running heading normalization...");
    try { app.doScript(FIX_HEADINGS_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eHF) { appendLog(logFile, "WARN: heading normalization failed: " + String(eHF)); }

    // Post-pass: soft-hyphen cleanup
    appendLog(logFile, "Running soft-hyphen cleanup...");
    try { app.doScript(SOFT_HYPHEN_CLEAN_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eSH) { appendLog(logFile, "WARN: soft-hyphen cleanup failed: " + String(eSH)); }

    // Save post-pass changes (pre-fingerprint).
    // IMPORTANT: keep paragraph indices stable for fingerprint export by postponing any paragraph-deleting passes.
    try { app.activeDocument.save(); appendLog(logFile, "Saved output doc after post-passes (pre-fingerprint)."); } catch (eSave) { appendLog(logFile, "WARN: could not save output doc: " + String(eSave)); }

    // Copy Desktop logs into runDir (to avoid overwrites across chapters/books)
    function copyDesktopLog(name, destName) {
      var src = File(Folder.desktop.fsName + "/" + name);
      var dest = File(runDir.fsName + "/" + (destName || name));
      return copyFileIfExists(src, dest);
    }
    appendLog(logFile, "Copying Desktop logs into run folder...");
    copyDesktopLog("rewrite_v5_safe_summary.txt");
    copyDesktopLog("rewrite_v5_safe_replaced.tsv");
    copyDesktopLog("rewrite_v5_safe_replaced_detailed.tsv");
    copyDesktopLog("rewrite_v5_safe_json_coverage.tsv");
    copyDesktopLog("rewrite_v5_safe_progress.log");

    // IMPORTANT: compute applied fingerprints from the saved output doc BEFORE any paragraph-deleting post-passes.
    // Some cosmetic fixes (e.g. deleting empty bullets) can shift paraIndex, which would break the TSV storyIndex/paraIndex mapping.
    var FINGERPRINT_EXPORTER = File(repoRoot.fsName + "/export-applied-fingerprints-from-detailed-tsv.jsx");
    ensureExistsOrThrow(FINGERPRINT_EXPORTER, "export-applied-fingerprints-from-detailed-tsv.jsx");
    var detailedIn = File(runDir.fsName + "/rewrite_v5_safe_replaced_detailed.tsv");
    var detailedOut = File(runDir.fsName + "/rewrite_v5_safe_replaced_detailed_final.tsv");
    if (!detailedIn.exists) {
      appendLog(logFile, "ERROR: missing detailed TSV for fingerprint export: " + detailedIn.fsName);
      throw new Error("Missing rewrite_v5_safe_replaced_detailed.tsv");
    }
    appendLog(logFile, "Exporting final applied fingerprints...");
    try {
      app.scriptArgs.setValue("BIC_TSV_IN", detailedIn.fsName);
      app.scriptArgs.setValue("BIC_TSV_OUT", detailedOut.fsName);
    } catch (eSAF) {}
    try { app.doScript(FINGERPRINT_EXPORTER, ScriptLanguage.JAVASCRIPT); } catch (eFP) {
      appendLog(logFile, "ERROR: fingerprint export failed: " + String(eFP));
      throw new Error("Fingerprint export failed: " + String(eFP));
    }

    // Run coverage verification on the copied TSV (hard gate lives outside InDesign)
    var cov = File(runDir.fsName + "/rewrite_v5_safe_json_coverage.tsv");
    var covLog = File(runDir.fsName + "/coverage_verification.log");
    if (cov.exists) {
      appendLog(logFile, "Running coverage verification...");
      var covRunErr = "";
      try {
        var cmd =
          "export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@20/bin; " +
          "cd " + "'" + repoRoot.fsName + "'" + "; " +
          "npx ts-node " + "'" + COVERAGE_VERIFIER.fsName + "'" + " " +
          "'" + cov.fsName + "'" + " " + "--chapter " + String(chapterNum) +
          " > " + "'" + covLog.fsName + "'" + " 2>&1";
        var script = 'do shell script "' + cmd + '"';
        app.doScript(script, ScriptLanguage.APPLESCRIPT_LANGUAGE);
      } catch (eCov) {
        covRunErr = String(eCov);
        appendLog(logFile, "Coverage verification exited non-zero: " + covRunErr);
      }

      // Hard gate: fail the wrapper if coverage verification indicates failure.
      var covText = "";
      try { covText = readTextFile(covLog); } catch (eRT) { covText = ""; }
      var covFailed =
        (covText.indexOf("VERIFICATION FAILED") !== -1) ||
        (covText.indexOf("CRITICAL FAILURE") !== -1) ||
        (!!covRunErr);
      if (covFailed) {
        appendLog(logFile, "ERROR: Coverage gate FAILED. See: " + covLog.fsName);
        try { alert("Coverage verification FAILED. See:\n" + covLog.fsName); } catch (eAl) {}
        throw new Error("Coverage gate FAILED");
      }
      appendLog(logFile, "Coverage gate OK.");
    } else {
      appendLog(logFile, "ERROR: coverage TSV missing; coverage gate cannot run.");
      throw new Error("Coverage TSV missing; coverage gate cannot run.");
    }

    // Hard gate: verify applied rewrites by fingerprint vs JSON (trust restoration)
    var appliedTsv = File(runDir.fsName + "/rewrite_v5_safe_replaced_detailed_final.tsv");
    var appliedLog = File(runDir.fsName + "/applied_rewrites_verification.log");
    if (!appliedTsv.exists) {
      appendLog(logFile, "ERROR: applied TSV missing: " + appliedTsv.fsName);
      throw new Error("Applied TSV missing; applied-rewrites gate cannot run.");
    }
    appendLog(logFile, "Running applied-rewrites verification...");
    var appliedRunErr = "";
    try {
      var cmd2 =
        "export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@20/bin; " +
        "cd " + "'" + repoRoot.fsName + "'" + "; " +
        "npx ts-node " + "'" + APPLIED_VERIFIER.fsName + "'" + " " +
        "'" + appliedTsv.fsName + "'" + " " + "'" + jsonPathForRun + "'" +
        " > " + "'" + appliedLog.fsName + "'" + " 2>&1";
      var script2 = 'do shell script "' + cmd2 + '"';
      app.doScript(script2, ScriptLanguage.APPLESCRIPT_LANGUAGE);
    } catch (eAp) {
      appliedRunErr = String(eAp);
      appendLog(logFile, "Applied verification exited non-zero: " + appliedRunErr);
    }
    var appliedText = "";
    try { appliedText = readTextFile(appliedLog); } catch (eRT2) { appliedText = ""; }
    var appliedFailed = (appliedText.indexOf("❌ VERIFY FAILED") !== -1) || (!!appliedRunErr);
    if (appliedFailed) {
      appendLog(logFile, "ERROR: Applied-rewrites gate FAILED. See: " + appliedLog.fsName);
      try { alert("Applied rewrites verification FAILED. See:\n" + appliedLog.fsName); } catch (eAl2) {}
      throw new Error("Applied-rewrites gate FAILED");
    }
    appendLog(logFile, "Applied-rewrites gate OK.");

    // Post-pass: normalize bullets for 2-column readability (flatten nested bullets + convert explanatory bullets to body)
    appendLog(logFile, "Running bullet normalization (2-column readability)...");
    try { app.doScript(NORMALIZE_BULLETS_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eNB) { appendLog(logFile, "WARN: bullet normalization failed: " + String(eNB)); }

    // Post-pass: micro-merge short bullet runs into the preceding list-intro paragraph (reduce list stress)
    appendLog(logFile, "Running micro-merge bullets into running text...");
    try { app.doScript(MICRO_MERGE_BULLETS_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eMM) { appendLog(logFile, "WARN: micro-merge bullets failed: " + String(eMM)); }

    // Post-pass: remove empty bullets (cosmetic DTP fix)
    appendLog(logFile, "Running empty-bullets cleanup...");
    try { app.doScript(FIX_EMPTY_BULLETS_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eEB) { appendLog(logFile, "WARN: empty-bullets cleanup failed: " + String(eEB)); }

    // Post-pass: remove trailing empty paragraphs at the END of the body story.
    // This prevents the common “overset resolved by adding an empty trailing page” artifact.
    appendLog(logFile, "Running trailing-empty-paragraphs cleanup...");
    try { app.doScript(REMOVE_TRAILING_EMPTY_PARAS_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eTEP) { appendLog(logFile, "WARN: trailing-empty-paragraphs cleanup failed: " + String(eTEP)); }

    // IMPORTANT: Fix overset at the very end on a saved/settled document state.
    // In practice, `tf.overflows` is most reliable after a save/recompose cycle.
    try { app.activeDocument.save(); appendLog(logFile, "Saved output doc after cosmetic post-passes (pre-overset-fix)."); } catch (eSave0) { appendLog(logFile, "WARN: could not save output doc (pre-overset): " + String(eSave0)); }

    appendLog(logFile, "Running FINAL overset fix (add pages if needed)...");
    try { app.doScript(FIX_OVERSET_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eOF2) { appendLog(logFile, "WARN: final overset fix threw: " + String(eOF2)); }

    // Post-pass: trim trailing empty pages (cosmetic DTP fix)
    // Run AFTER overset-fix so we remove only truly-empty pages.
    appendLog(logFile, "Running trailing-empty-pages trim...");
    try { app.doScript(TRIM_TRAILING_EMPTY_PAGES_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eTP) { appendLog(logFile, "WARN: trailing-empty-pages trim failed: " + String(eTP)); }

    // Post-pass: remove overset frames on pasteboard/non-page spreads (common after page-deletion isolation).
    appendLog(logFile, "Running overset pasteboard cleanup...");
    try { app.doScript(FIX_OVERSET_PASTEBOARD_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eOPB) { appendLog(logFile, "WARN: overset pasteboard cleanup failed: " + String(eOPB)); }

    // Post-pass: update out-of-date links (validation hard-fails on LINK_OUT_OF_DATE).
    appendLog(logFile, "Running update out-of-date links...");
    try { app.doScript(UPDATE_OUT_OF_DATE_LINKS_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eLUP) { appendLog(logFile, "WARN: update links failed: " + String(eLUP)); }

    // Save post-pass changes (final)
    try { app.activeDocument.save(); appendLog(logFile, "Saved output doc after post-passes (final)."); } catch (eSave2) { appendLog(logFile, "WARN: could not save output doc (final): " + String(eSave2)); }

    appendLog(logFile, "DONE ok=1");
  } catch (eTop) {
    try { out.push("ERROR: " + String(eTop)); } catch (e2) {}
    try {
      // Best-effort: append to wrapper log if it exists.
      if (logFile && logFile.exists) appendLog(logFile, "FATAL: " + String(eTop));
    } catch (eLog) {}
    try { alert(WRAPPER_NAME + " failed:\n" + String(eTop)); } catch (eA) {}
    // IMPORTANT: rethrow so AppleScript/osascript callers (e.g. scripts/run-book.ts) receive a non-zero exit.
    throw eTop;
  } finally {
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (e3) {}
  }

  out.join("\n");
})();


