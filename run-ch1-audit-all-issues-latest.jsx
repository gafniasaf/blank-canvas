// ============================================================
// RUN: CH1 "ALL ISSUES" audit on latest Generated_Books output
// ============================================================
// Opens the newest *_REWRITTEN_V5_SAFE*.indd in ~/Desktop/Generated_Books
// (matching the CH1 preview base name), then runs:
// - audit-ch1-all-issues.jsx
//
// Output:
// - ~/Desktop/audit_ch1_all_issues__<doc>__<timestamp>.txt
// ============================================================

#targetengine "session"

(function () {
  var GENERATED = new Folder(Folder.desktop + "/Generated_Books");
  var NAME_RE = /MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.*REWRITTEN_V5_SAFE.*\.indd$/i;

  var AUDIT = File("/Users/asafgafni/Desktop/InDesign/TestRun/audit-ch1-all-issues.jsx");

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

  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  try {
    var target = newestMatch(GENERATED, NAME_RE);
    if (!target) {
      alert("No matching rewritten INDD found in:\n" + GENERATED.fsName);
      return;
    }
    if (!AUDIT.exists) {
      alert("Audit script not found:\n" + AUDIT.fsName);
      return;
    }

    var doc = app.open(target, false);
    try { app.activeDocument = doc; } catch (e2) {}
    app.doScript(AUDIT, ScriptLanguage.JAVASCRIPT);
  } catch (e) {
    alert("run-ch1-audit-all-issues-latest.jsx failed:\n" + String(e));
  } finally {
    try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (e3) {}
  }
})();


































