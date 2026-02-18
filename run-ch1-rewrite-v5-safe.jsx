// ============================================================
// RUN: SAFE REWRITE PIPELINE v5 on CH1 Preview (Automated)
// ============================================================
// This wrapper exists to avoid AppleEvent timeouts and UI prompts by:
// - setting UserInteractionLevels.NEVER_INTERACT
// - opening the baseline INDD inside ExtendScript
// - delegating the heavy work to rewrite-from-original-safe-v5.jsx
//
// Output (from v5 script):
// - ~/Desktop/Generated_Books/<docName>_REWRITTEN_V5_SAFE*.indd
// - ~/Desktop/rewrite_v5_safe_summary.txt
// - ~/Desktop/rewrite_v5_safe_replaced.tsv
// ============================================================

#targetengine "session"

(function () {
  // NEW (chapter-by-chapter workflow):
  // Use a CH1-only baseline so CH1 text can never flow into CH2 opener pages.
  // The baseline is generated/updated by make-ch1-chapter-baseline.jsx (trims CH2 pages,
  // truncates the body story at the first ^2 marker, repairs missing end-column frames, and adds pages if needed).
  var FORCE_REBUILD_CH1_ONLY_BASELINE = false;
  var MAKE_CH1_BASELINE_SCRIPT = File("/Users/asafgafni/Desktop/InDesign/TestRun/make-ch1-chapter-baseline.jsx");
  var CH1_ONLY_BASELINE_INDD = File("/Users/asafgafni/Desktop/Generated_Books/_chapter_baselines/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720__CH1_ONLY_BASELINE.indd");
  var BASELINE_INDD = CH1_ONLY_BASELINE_INDD;
  var SAFE_V5_SCRIPT = File("/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/scripts/rewrite-from-original-safe-v5.jsx");
  // Post-pass: normalize any leftover baseline-style "In de praktijk"/"Verdieping" headings to Option A (blank line + ":" + bold label).
  // This is critical because v5 rewrites may not match/replace every paragraph, leaving original headings untouched.
  var FIX_HEADINGS_SCRIPT = File("/Users/asafgafni/Desktop/InDesign/TestRun/fix-praktijk-verdieping-headings.jsx");
  var SOFT_HYPHEN_CLEAN_SCRIPT = File("/Users/asafgafni/Desktop/InDesign/TestRun/remove-soft-hyphens-ch1.jsx");
  var WRAPPER_LOG = File(Folder.desktop + "/run_ch1_rewrite_v5_safe_wrapper_log.txt");

  // Ensure CH1-only baseline exists (and optionally rebuild it).
  if (FORCE_REBUILD_CH1_ONLY_BASELINE || !BASELINE_INDD.exists) {
    if (!MAKE_CH1_BASELINE_SCRIPT.exists) {
      alert("CH1-only baseline missing AND baseline-maker script not found:\n" + MAKE_CH1_BASELINE_SCRIPT.fsName);
      return;
    }
    try { app.doScript(MAKE_CH1_BASELINE_SCRIPT, ScriptLanguage.JAVASCRIPT); } catch (eMk) {}
  }
  if (!BASELINE_INDD.exists) {
    alert("CH1-only baseline INDD not found:\n" + BASELINE_INDD.fsName);
    return;
  }
  if (!SAFE_V5_SCRIPT.exists) {
    alert("Safe v5 script not found:\n" + SAFE_V5_SCRIPT.fsName);
    return;
  }
  if (!SOFT_HYPHEN_CLEAN_SCRIPT.exists) {
    alert("Soft-hyphen clean script not found:\n" + SOFT_HYPHEN_CLEAN_SCRIPT.fsName);
    return;
  }
  if (!FIX_HEADINGS_SCRIPT.exists) {
    alert("Heading-fix script not found:\n" + FIX_HEADINGS_SCRIPT.fsName);
    return;
  }

  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  function appendLog(line) {
    try {
      WRAPPER_LOG.open("a");
      WRAPPER_LOG.writeln(String(line));
      WRAPPER_LOG.close();
    } catch (eL) {}
  }

  try {
    // Log + hard reset to avoid "active document drift" across multiple open tabs.
    try { if (WRAPPER_LOG.exists) WRAPPER_LOG.remove(); } catch (eRm) {}
    appendLog("=== run-ch1-rewrite-v5-safe.jsx ===");
    // ExtendScript (InDesign) is an older JS engine; avoid toISOString().
    appendLog("Started: " + (new Date()).toString());
    appendLog("Baseline: " + BASELINE_INDD.fsName);
    appendLog("Safe script: " + SAFE_V5_SCRIPT.fsName);
    appendLog("Open docs before close: " + String(app.documents.length));
    for (var i = app.documents.length - 1; i >= 0; i--) {
      try {
        var d0 = app.documents[i];
        appendLog(" - " + d0.name + " :: " + (d0.fullName ? d0.fullName.fsName : "(no fullName)"));
      } catch (eList) {}
    }

    // IMPORTANT: Do NOT force-close ALL docs here.
    // In some environments, closing large docs can hang/timeout AppleEvents.
    //
    // But we DO close previously-generated outputs for this run. Leaving them open can cause
    // activeDocument drift (InDesign sometimes refuses to focus the baseline tab), which would
    // make v5 run on the WRONG document.
    function closeGeneratedOutputs() {
      try {
        for (var ci = app.documents.length - 1; ci >= 0; ci--) {
          var dC = app.documents[ci];
          var pth = "";
          var nm = "";
          try { nm = String(dC.name || ""); } catch (eN) { nm = ""; }
          try { pth = (dC.fullName ? String(dC.fullName.fsName || "") : ""); } catch (eP) { pth = ""; }
          var isGenerated = (pth.indexOf("/Desktop/Generated_Books/") !== -1) || (pth.indexOf("/Generated_Books/") !== -1);
          var looksLikeOutput = (nm.toLowerCase().indexOf("_rewritten_v5_safe") !== -1);
          if (isGenerated && looksLikeOutput) {
            appendLog("Closing generated output doc without saving: " + nm);
            try { dC.close(SaveOptions.NO); } catch (eClose) { appendLog("WARN: close failed for " + nm + " :: " + String(eClose)); }
          }
        }
      } catch (eCloseAll) { appendLog("WARN: closeGeneratedOutputs failed: " + String(eCloseAll)); }
    }
    closeGeneratedOutputs();
    try { appendLog("Docs after closing generated outputs: " + String(app.documents.length)); } catch (eDocs1) {}

    // Explicitly locate or open the baseline doc and set it active.
    var doc = null;
    try {
      for (var j = 0; j < app.documents.length; j++) {
        var dj = app.documents[j];
        try {
          if (dj && dj.fullName && dj.fullName.fsName === BASELINE_INDD.fsName) { doc = dj; break; }
        } catch (eCmp) {}
      }
    } catch (eLoop) {}

    if (!doc) {
      doc = app.open(BASELINE_INDD, true);
      appendLog("Opened baseline doc: " + doc.name);
    } else {
      appendLog("Baseline doc already open: " + doc.name);
    }

    // If the baseline doc was opened earlier without a window (e.g., by validation scripts),
    // InDesign may throw "No documents are open" on app.activeDocument access.
    // Fix: reopen baseline WITH a window.
    try {
      var hasWin = false;
      try { hasWin = (doc.windows && doc.windows.length > 0); } catch (eW0) { hasWin = false; }
      if (!hasWin) {
        appendLog("Baseline doc has no window (likely hidden). Reopening baseline with a window...");
        try { doc.close(SaveOptions.NO); } catch (eCW) {}
        doc = app.open(BASELINE_INDD, true);
        appendLog("Reopened baseline doc: " + doc.name);
      }
    } catch (eWin) { appendLog("WARN: baseline window check failed: " + String(eWin)); }

    try { app.activeDocument = doc; } catch (e2) { appendLog("WARN: setting activeDocument failed: " + String(e2)); }
    try { appendLog("Baseline full path: " + (doc.fullName ? doc.fullName.fsName : "(no fullName)")); } catch (eFN) {}
    try { appendLog("Active doc now: " + app.activeDocument.name); } catch (eAD) { appendLog("WARN: could not read activeDocument.name: " + String(eAD)); }
    // Hard gate: abort if we failed to activate the baseline.
    try {
      var actOk = false;
      // Prefer activeDocument, but in some InDesign contexts it can throw even when docs exist.
      try { actOk = (app.activeDocument && app.activeDocument.fullName && app.activeDocument.fullName.fsName === BASELINE_INDD.fsName); } catch (eCmp2) { actOk = false; }
      // Fallback: if only one doc is open, ensure it's the baseline.
      if (!actOk) {
        try {
          if (app.documents.length === 1) {
            var only = app.documents[0];
            if (only && only.fullName && only.fullName.fsName === BASELINE_INDD.fsName) actOk = true;
          }
        } catch (eCmp3) { actOk = actOk; }
      }
      if (!actOk) {
        appendLog("ERROR: activeDocument is NOT the baseline. Aborting to avoid modifying the wrong doc.");
        alert("run-ch1-rewrite-v5-safe.jsx aborted:\\nCould not activate BASELINE doc.\\n(Prevented running v5 on the wrong file.)");
        return;
      }
    } catch (eGate) {}

    // Delegate to the main safe v5 script (runs on app.activeDocument).
    // IMPORTANT: force CH1 scope via app.scriptArgs so it works across script engines.
    try { app.scriptArgs.setValue("BIC_CHAPTER_FILTER", "1"); } catch (eSA0) {}
    app.doScript(SAFE_V5_SCRIPT, ScriptLanguage.JAVASCRIPT);
    try { app.scriptArgs.setValue("BIC_CHAPTER_FILTER", ""); } catch (eSA1) {}
    appendLog("Safe v5 script completed.");

    // SAFETY: ensure the BASELINE file is not left open (avoid accidental saves).
    // rewrite-from-original-safe-v5.jsx already closes the modified original after saveACopy,
    // but we defensively close any still-open doc that points to BASELINE_INDD.
    try {
      for (var k = app.documents.length - 1; k >= 0; k--) {
        var dk = app.documents[k];
        try {
          if (dk && dk.fullName && dk.fullName.fsName === BASELINE_INDD.fsName) {
            appendLog("Closing baseline doc without saving: " + dk.name);
            dk.close(SaveOptions.NO);
          }
        } catch (eK) {}
      }
    } catch (eCloseAll) {
      appendLog("WARN: Baseline-close sweep failed: " + String(eCloseAll));
    }

    // Ensure the rewritten output doc is ACTIVE for post-passes (fix headings, remove soft hyphens).
    // IMPORTANT: relying on open-document heuristics is brittle (activeDocument drift, hidden windows).
    // Instead, locate the newest matching output file on disk and open it WITH a window.
    try {
      var GENERATED = new Folder(Folder.desktop + "/Generated_Books");
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

      var stem = "";
      try { stem = String(BASELINE_INDD.displayName || ""); } catch (eS0) { stem = ""; }
      try { stem = stem.replace(/\.indd$/i, ""); } catch (eS1) {}
      if (!stem) stem = "MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720";

      var re = null;
      try { re = new RegExp("^" + escapeRe(stem) + ".*_REWRITTEN_V5_SAFE.*\\.indd$", "i"); } catch (eRe) { re = null; }
      if (!re) throw new Error("Could not build output regex");

      var target = newestMatch(GENERATED, re);
      if (!target) {
        appendLog("WARN: could not find newest output file in Generated_Books for stem=" + stem);
      } else {
        appendLog("Post-pass target file: " + target.fsName);

        // If it's already open, reuse it; if it's hidden, close & reopen with a window.
        var outDoc = null;
        try {
          for (var od = 0; od < app.documents.length; od++) {
            var dOut = app.documents[od];
            try { if (dOut && dOut.fullName && dOut.fullName.fsName === target.fsName) { outDoc = dOut; break; } } catch (eCmp) {}
          }
        } catch (eLoop) {}

        try {
          var hasWin = false;
          try { hasWin = (outDoc && outDoc.windows && outDoc.windows.length > 0); } catch (eW0) { hasWin = false; }
          if (outDoc && !hasWin) {
            appendLog("Output doc is open but has no window; reopening with a window to avoid activeDocument drift.");
            try { outDoc.close(SaveOptions.NO); } catch (eCW) {}
            outDoc = null;
          }
        } catch (eW1) {}

        if (!outDoc) {
          try { outDoc = app.open(target, true); } catch (eOpen2) { try { outDoc = app.open(target); } catch (eOpen3) { outDoc = null; } }
        }
        if (outDoc) {
          try { app.activeDocument = outDoc; } catch (eActOut) { appendLog("WARN: could not activate output doc: " + String(eActOut)); }
          try { appendLog("Post-pass target doc: " + app.activeDocument.name); } catch (eAD2) {}
        } else {
          appendLog("WARN: failed to open output doc for post-passes: " + target.fsName);
        }
      }
    } catch (ePick) {
      appendLog("WARN: output-doc selection failed: " + String(ePick));
    }

    // Post-pass: fix baseline-style headings that were not rewritten (Option A + bold label).
    // Run this AFTER the baseline-close sweep so we never risk touching the baseline file.
    try {
      appendLog("Running heading normalization: " + FIX_HEADINGS_SCRIPT.fsName);
      app.doScript(FIX_HEADINGS_SCRIPT, ScriptLanguage.JAVASCRIPT);
      appendLog("Heading normalization completed.");
    } catch (eHF) {
      appendLog("WARN: Heading normalization failed: " + String(eHF));
    }

    // Post-pass: remove invisible soft hyphens (U+00AD) from CH1 body story and save output.
    try {
      appendLog("Running soft-hyphen cleanup: " + SOFT_HYPHEN_CLEAN_SCRIPT.fsName);
      app.doScript(SOFT_HYPHEN_CLEAN_SCRIPT, ScriptLanguage.JAVASCRIPT);
      appendLog("Soft-hyphen cleanup completed.");
    } catch (eSH) {
      appendLog("WARN: Soft-hyphen cleanup failed: " + String(eSH));
    }

    // NEW: Run coverage verification (outside InDesign JS, via shell command if possible, or just log intent).
    // Since we are in ExtendScript, we can't run 'npx' directly easily without a shell helper.
    // However, the user asked to "Update run-ch1-rewrite-v5-safe.jsx to execute the coverage verification".
    // ExtendScript `app.doScript` can run AppleScript to exec shell commands.
    try {
      appendLog("Running coverage verification (verify-json-coverage.ts)...");
      // Coverage verifier lives in this repo (TestRun/scripts), not in the bookautomation repo.
      // Use an absolute path and quote it for shell safety.
      var verifier = File("/Users/asafgafni/Desktop/InDesign/TestRun/scripts/verify-json-coverage.ts");
      var coverage = File(Folder.desktop + "/rewrite_v5_safe_json_coverage.tsv");
      var outLog = File(Folder.desktop + "/coverage_verification.log");
      var cmd = "export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; npx tsx " +
        "'" + verifier.fsName + "'" + " " +
        "'" + coverage.fsName + "'" +
        " > " + "'" + outLog.fsName + "'" + " 2>&1";
      var script = 'do shell script "' + cmd + '"';
      app.doScript(script, ScriptLanguage.APPLESCRIPT_LANGUAGE);
      appendLog("Coverage verification completed. Check Desktop/coverage_verification.log");
      
      // Read the log to check for failure string
      var logF = File(Folder.desktop + "/coverage_verification.log");
      if (logF.exists) {
        logF.open("r");
        var logContent = logF.read();
        logF.close();
        if (logContent.indexOf("VERIFICATION FAILED") !== -1 || logContent.indexOf("CRITICAL FAILURE") !== -1) {
           alert("Coverage Verification FAILED. See Desktop/coverage_verification.log");
           appendLog("ERROR: Coverage Verification FAILED.");
        }
      }
    } catch (eCov) {
      appendLog("WARN: Coverage verification failed to run: " + String(eCov));
    }
  } catch (e) {
    alert("run-ch1-rewrite-v5-safe.jsx failed:\n" + String(e));
    appendLog("ERROR: " + String(e));
  } finally {
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (e3) {}
    appendLog("Finished: " + (new Date()).toString());
  }
})();


