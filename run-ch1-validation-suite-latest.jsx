// ============================================================
// RUN: CH1 validation suite on latest Generated_Books output
// ============================================================
// Opens the newest *_REWRITTEN_V5_SAFE*.indd in ~/Desktop/Generated_Books
// (matching the CH1 preview base name), then runs:
// - check-links.jsx
// - validate-ch1.jsx
// - scan-ch1-anomalies.jsx
// - scan-ch1-isolated-bullets.jsx
//
// Each script writes its own report to ~/Desktop/*.txt
// ============================================================

#targetengine "session"

(function () {
  var GENERATED = new Folder(Folder.desktop + "/Generated_Books");
  var NAME_RE = /MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.*_REWRITTEN_V5_SAFE.*\.indd$/i;
  var WRAPPER_LOG = File(Folder.desktop + "/run_ch1_validation_suite_wrapper_log.txt");

  var SCRIPTS = {
    checkLinks: File("/Users/asafgafni/Desktop/InDesign/TestRun/check-links.jsx"),
    validateCh1: File("/Users/asafgafni/Desktop/InDesign/TestRun/validate-ch1.jsx"),
    scanAnoms: File("/Users/asafgafni/Desktop/InDesign/TestRun/scan-ch1-anomalies.jsx"),
    scanIsolatedBullets: File("/Users/asafgafni/Desktop/InDesign/TestRun/scan-ch1-isolated-bullets.jsx"),
    auditBodyQuality: File("/Users/asafgafni/Desktop/InDesign/TestRun/audit-ch1-body-quality.jsx"),
    scanWidowsOrphans: File("/Users/asafgafni/Desktop/InDesign/TestRun/scan-ch1-widows-orphans.jsx")
  };

  function newestMatch(folder, re) {
    if (!folder.exists) return null;
    var files = folder.getFiles(function (f) {
      try { return (f instanceof File) && re.test(f.name); } catch (e) { return false; }
    });
    if (!files || files.length === 0) return null;
    files.sort(function (a, b) {
      try { return b.modified.getTime() - a.modified.getTime(); } catch (e) { return 0; }
    });
    return files[0];
  }

  function ensureExistsOrThrow(f, label) {
    if (!f || !f.exists) throw new Error(label + " not found: " + (f ? f.fsName : "(null)"));
  }

  function appendLog(line) {
    try {
      WRAPPER_LOG.open("a");
      WRAPPER_LOG.writeln(String(line));
      WRAPPER_LOG.close();
    } catch (eL) {}
  }

  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  try {
    try { if (WRAPPER_LOG.exists) WRAPPER_LOG.remove(); } catch (eRm) {}
    appendLog("=== run-ch1-validation-suite-latest.jsx ===");
    appendLog("Started: " + (new Date()).toString());
    appendLog("Generated folder: " + GENERATED.fsName);
    appendLog("Regex: " + String(NAME_RE));
    try { appendLog("Open docs at start: " + String(app.documents.length)); } catch (eDocs0) {}

    var target = newestMatch(GENERATED, NAME_RE);
    if (!target) {
      alert("No matching rewritten INDD found in:\n" + GENERATED.fsName);
      appendLog("ERROR: No matching rewritten INDD found.");
      return;
    }
    appendLog("Target INDD: " + target.fsName);

    ensureExistsOrThrow(SCRIPTS.checkLinks, "check-links.jsx");
    ensureExistsOrThrow(SCRIPTS.validateCh1, "validate-ch1.jsx");
    ensureExistsOrThrow(SCRIPTS.scanAnoms, "scan-ch1-anomalies.jsx");
    ensureExistsOrThrow(SCRIPTS.scanIsolatedBullets, "scan-ch1-isolated-bullets.jsx");
    ensureExistsOrThrow(SCRIPTS.auditBodyQuality, "audit-ch1-body-quality.jsx");
    ensureExistsOrThrow(SCRIPTS.scanWidowsOrphans, "scan-ch1-widows-orphans.jsx");

    // Open WITH a window; opening without a window can cause activeDocument drift (scripts then validate the wrong tab).
    var doc = null;
    try { doc = app.open(target, true); } catch (eOpen0) {
      try { doc = app.open(target); } catch (eOpen1) { doc = null; }
    }
    try { if (doc) app.activeDocument = doc; } catch (e2) {}
    // If the document was opened hidden by the engine, force a reopen with a window.
    try {
      var hasWin = false;
      try { hasWin = (doc && doc.windows && doc.windows.length > 0); } catch (eW0) { hasWin = false; }
      if (doc && !hasWin) {
        appendLog("Target doc has no window; reopening with a window to avoid activeDocument drift.");
        try { doc.close(SaveOptions.NO); } catch (eCW) {}
        try { doc = app.open(target, true); } catch (eOpen2) { try { doc = app.open(target); } catch (eOpen3) { doc = null; } }
        try { if (doc) app.activeDocument = doc; } catch (eAct2) {}
      }
    } catch (eWin) {}
    // Hard gate: ensure activeDocument is the target doc before running any scripts.
    try {
      var actOk = false;
      try { actOk = (app.activeDocument && app.activeDocument.fullName && app.activeDocument.fullName.fsName === target.fsName); } catch (eCmp) { actOk = false; }
      if (!actOk) {
        appendLog("ERROR: activeDocument is NOT the target doc. Aborting suite to avoid validating the wrong file.");
        alert("Validation suite aborted:\\nCould not activate target doc.\\n(Prevented validating the wrong file.)");
        return;
      }
    } catch (eGate) {}
    try { appendLog("Opened doc: " + (doc ? doc.name : "(null)")); } catch (eOD) {}
    try { appendLog("Active doc: " + (app.activeDocument ? app.activeDocument.name : "(none)")); } catch (eAD) {}
    try { appendLog("Docs now: " + String(app.documents.length)); } catch (eDC0) {}

    var hadErrors = false;

    // Run suite (each script writes to ~/Desktop/*.txt)
    appendLog("Running: check-links.jsx");
    try {
      app.doScript(SCRIPTS.checkLinks, ScriptLanguage.JAVASCRIPT);
      appendLog("OK: check-links.jsx");
    } catch (eCL) {
      hadErrors = true;
      appendLog("ERROR running check-links.jsx: " + String(eCL));
    }
    try {
      var n1 = [];
      for (var a1 = 0; a1 < app.documents.length; a1++) n1.push(app.documents[a1].name);
      appendLog("After check-links: docs=" + String(app.documents.length) + " names=" + n1.join(" | "));
    } catch (eDC1) {}

    appendLog("Running: validate-ch1.jsx");
    try {
      app.doScript(SCRIPTS.validateCh1, ScriptLanguage.JAVASCRIPT);
      appendLog("OK: validate-ch1.jsx");
    } catch (eV) {
      hadErrors = true;
      appendLog("ERROR running validate-ch1.jsx: " + String(eV));
    }
    try {
      var n2 = [];
      for (var a2 = 0; a2 < app.documents.length; a2++) n2.push(app.documents[a2].name);
      appendLog("After validate-ch1: docs=" + String(app.documents.length) + " names=" + n2.join(" | "));
    } catch (eDC2) {}

    appendLog("Running: scan-ch1-anomalies.jsx");
    try {
      app.doScript(SCRIPTS.scanAnoms, ScriptLanguage.JAVASCRIPT);
      appendLog("OK: scan-ch1-anomalies.jsx");
    } catch (eSA) {
      hadErrors = true;
      appendLog("ERROR running scan-ch1-anomalies.jsx: " + String(eSA));
    }

    appendLog("Running: scan-ch1-isolated-bullets.jsx");
    try {
      app.doScript(SCRIPTS.scanIsolatedBullets, ScriptLanguage.JAVASCRIPT);
      appendLog("OK: scan-ch1-isolated-bullets.jsx");
    } catch (eSB) {
      hadErrors = true;
      appendLog("ERROR running scan-ch1-isolated-bullets.jsx: " + String(eSB));
    }

    appendLog("Running: audit-ch1-body-quality.jsx");
    try {
      app.doScript(SCRIPTS.auditBodyQuality, ScriptLanguage.JAVASCRIPT);
      appendLog("OK: audit-ch1-body-quality.jsx");
    } catch (eAQ) {
      hadErrors = true;
      appendLog("ERROR running audit-ch1-body-quality.jsx: " + String(eAQ));
    }

    appendLog("Running: scan-ch1-widows-orphans.jsx");
    try {
      app.doScript(SCRIPTS.scanWidowsOrphans, ScriptLanguage.JAVASCRIPT);
      appendLog("OK: scan-ch1-widows-orphans.jsx");
    } catch (eWO) {
      hadErrors = true;
      appendLog("ERROR running scan-ch1-widows-orphans.jsx: " + String(eWO));
    }

    appendLog("Finished: " + (new Date()).toString() + " ok=" + (hadErrors ? "0" : "1"));
  } catch (e) {
    alert("run-ch1-validation-suite-latest.jsx failed:\n" + String(e));
    appendLog("ERROR: " + String(e));
  } finally {
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (e3) {}
  }
})();



