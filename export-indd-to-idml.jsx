// ============================================================
// EXPORT: One INDD → IDML (scriptArgs-driven)
// ============================================================
// Purpose:
// - Generic safe exporter for a single InDesign document to IDML.
// - Used to create local IDMLs for DB ingestion (Prince-first pipeline).
//
// Args (app.scriptArgs):
// - BIC_INDD_PATH: absolute path to the input .indd
// - BIC_OUT_IDML_PATH: absolute path to write the .idml
//
// SAFE:
// - Opens INDD, exports IDML, closes WITHOUT saving (never modifies the INDD).
//
// Run:
// - AppleScript:
//   tell application "Adobe InDesign 2026"
//     do script "app.scriptArgs.setValue('BIC_INDD_PATH','/...'); app.scriptArgs.setValue('BIC_OUT_IDML_PATH','/...');" language javascript
//     do script (POSIX file "<repo>/export-indd-to-idml.jsx") language javascript
//   end tell
// ============================================================

#targetengine "session"

(function () {
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "_" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.open("w");
      f.write(String(text || ""));
      f.close();
    } catch (e) {}
  }

  function getArg(key) {
    try { return String(app.scriptArgs.getValue(key) || ""); } catch (e) { return ""; }
  }

  function openDocWithWindow(inddFile) {
    var doc = null;
    try { doc = app.open(inddFile, true); } catch (e0) { try { doc = app.open(inddFile); } catch (e1) { doc = null; } }
    try { if (doc) app.activeDocument = doc; } catch (eAct) {}
    // If opened hidden, reopen with a window to avoid activeDocument drift.
    try {
      var hasWin = false;
      try { hasWin = (doc && doc.windows && doc.windows.length > 0); } catch (eW0) { hasWin = false; }
      if (doc && !hasWin) {
        try { doc.close(SaveOptions.NO); } catch (eCW) {}
        try { doc = app.open(inddFile, true); } catch (e2) { try { doc = app.open(inddFile); } catch (e3) { doc = null; } }
        try { if (doc) app.activeDocument = doc; } catch (eAct2) {}
      }
    } catch (eW1) {}
    return doc;
  }

  var out = [];
  out.push("=== EXPORT INDD → IDML ===");
  out.push("Started: " + (new Date()).toString());
  out.push("");

  var inddPath = getArg("BIC_INDD_PATH");
  var outIdmlPath = getArg("BIC_OUT_IDML_PATH");

  out.push("INDD: " + inddPath);
  out.push("OUT:  " + outIdmlPath);
  out.push("");

  if (!inddPath || !outIdmlPath) {
    out.push("ERROR: Missing BIC_INDD_PATH or BIC_OUT_IDML_PATH");
    writeTextToDesktop("export_indd_to_idml__" + isoStamp() + ".txt", out.join("\n"));
    try { alert("Missing scriptArgs. See Desktop report."); } catch (eA0) {}
    return;
  }

  var INDD = File(inddPath);
  var OUT = File(outIdmlPath);

  if (!INDD.exists) {
    out.push("ERROR: INDD not found.");
    writeTextToDesktop("export_indd_to_idml__" + isoStamp() + ".txt", out.join("\n"));
    try { alert("INDD not found. See Desktop report."); } catch (eA1) {}
    return;
  }

  try { if (OUT.parent && !OUT.parent.exists) OUT.parent.create(); } catch (eDir) {}

  var doc = openDocWithWindow(INDD);
  if (!doc) {
    out.push("ERROR: Failed to open INDD.");
    writeTextToDesktop("export_indd_to_idml__" + isoStamp() + ".txt", out.join("\n"));
    try { alert("Failed to open INDD. See Desktop report."); } catch (eA2) {}
    return;
  }

  try { if (OUT.exists) OUT.remove(); } catch (eRm) {}

  var ok = false;
  try {
    out.push("Exporting IDML...");
    doc.exportFile(ExportFormat.INDESIGN_MARKUP, OUT);
    ok = !!OUT.exists;
    out.push(ok ? "Export OK." : "ERROR: Export reported OK but file not found.");
  } catch (eExp) {
    out.push("ERROR: Export failed: " + String(eExp));
    ok = false;
  }

  try {
    doc.close(SaveOptions.NO);
    out.push("Closed INDD without saving.");
  } catch (eClose) {
    out.push("WARN: Close failed: " + String(eClose));
  }

  out.push("OUT exists: " + String(OUT.exists));
  out.push("");
  out.push("RESULT: " + (ok ? "OK" : "FAILED"));
  out.push("Finished: " + (new Date()).toString());

  writeTextToDesktop("export_indd_to_idml__" + isoStamp() + ".txt", out.join("\n"));
  try { alert(ok ? "✅ Exported IDML." : "❌ Export failed. See Desktop report."); } catch (eA3) {}

  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI) {}
})();






























