// ============================================================
// EXPORT: VTH N4 chapter INDDs (Downloads) → IDMLs (designs-relinked/)
// ============================================================
// Purpose:
// - VTH N4 is delivered as per-chapter .indd files.
// - Export each chapter document to IDML for DB ingest / canonical export.
//
// Output:
// - Writes IDMLs to:
//   <repo>/designs-relinked/MBO VTH nivo 4_9789083412054_03/<same>.idml
// - Writes a Desktop report: export_vth_n4_idml_chapters__<timestamp>.txt
//
// SAFE:
// - Opens INDDs, saves a COPY, exports from the COPY, closes WITHOUT saving.
// - Never modifies Downloads files.
//
// Run:
// - From AppleScript:
//   tell application "Adobe InDesign 2026" to do script (POSIX file "<repo>/export-vth-n4-idml-chapters.jsx") language javascript
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

  function resolveRepoRoot() {
    try {
      var me = File($.fileName);
      if (!me || !me.exists) return null;
      return me.parent; // repo root
    } catch (e) { return null; }
  }

  function openDocWithWindow(inddFile) {
    var doc = null;
    try { doc = app.open(inddFile, true); } catch (e0) { try { doc = app.open(inddFile); } catch (e1) { doc = null; } }
    try { if (doc) app.activeDocument = doc; } catch (eAct) {}
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

  function ensureActiveDoc(doc, expectedPath, out) {
    try { if (doc) app.activeDocument = doc; } catch (eAct) {}
    try {
      var actual = "";
      try { actual = (doc && doc.fullName) ? doc.fullName.fsName : ""; } catch (eF) { actual = ""; }
      if (expectedPath && actual && (actual !== expectedPath)) {
        out.push("ERROR: activeDocument mismatch.");
        out.push("  expected: " + expectedPath);
        out.push("  actual:   " + actual);
        return false;
      }
    } catch (eCheck) {}
    return true;
  }

  function pad2(n) {
    var s = String(n);
    return s.length === 1 ? ("0" + s) : s;
  }

  var out = [];
  out.push("=== EXPORT VTH N4 CHAPTER IDMLs ===");
  out.push("Started: " + (new Date()).toString());
  out.push("");

  var repoRoot = resolveRepoRoot();
  if (!repoRoot || !repoRoot.exists) {
    out.push("ERROR: Could not resolve repo root from $.fileName=" + String($.fileName));
    writeTextToDesktop("export_vth_n4_idml_chapters__" + isoStamp() + ".txt", out.join("\n"));
    alert("Could not resolve repo root.");
    return;
  }
  out.push("Repo: " + repoRoot.fsName);

  var inddDir = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03";
  var outDir = repoRoot.fsName + "/designs-relinked/MBO VTH nivo 4_9789083412054_03";
  var copyDir = repoRoot.fsName + "/designs-relinked/_tmp_copies/MBO VTH nivo 4_9789083412054_03";

  out.push("INDD dir: " + inddDir);
  out.push("OUT dir:  " + outDir);
  out.push("COPY dir: " + copyDir);
  out.push("");

  try {
    var od = Folder(outDir);
    if (!od.exists) od.create();
  } catch (eDir) {}
  try {
    var cd = Folder(copyDir);
    if (!cd.exists) cd.create();
  } catch (eCopyDir) {}

  var wrote = 0;
  var failed = 0;

  for (var ch = 1; ch <= 30; ch++) {
    var chStr = pad2(ch);
    var inddPath = inddDir + "/" + chStr + "-VTH_Combined_03.2024.indd";
    var outIdmlPath = outDir + "/" + chStr + "-VTH_Combined_03.2024.idml";
    var copyInddPath = copyDir + "/" + chStr + "-VTH_Combined_03.2024__COPY.indd";

    out.push("--- CH" + chStr + " ---");
    out.push("INDD: " + inddPath);
    out.push("OUT:  " + outIdmlPath);

    var INDD = File(inddPath);
    if (!INDD.exists) {
      failed++;
      out.push("ERROR: INDD not found.");
      out.push("");
      continue;
    }

    var doc = openDocWithWindow(INDD);
    if (!doc) {
      failed++;
      out.push("ERROR: Failed to open INDD.");
      out.push("");
      continue;
    }

    if (!ensureActiveDoc(doc, INDD.fsName, out)) {
      try { doc.close(SaveOptions.NO); } catch (eClose0) {}
      failed++;
      out.push("ERROR: Active document mismatch; skipped.");
      out.push("");
      continue;
    }

    var copyFile = File(copyInddPath);
    try { if (copyFile.exists) copyFile.remove(); } catch (eCopyRm) {}

    var copyOk = false;
    try {
      out.push("Saving copy...");
      doc.saveACopy(copyFile);
      copyOk = !!copyFile.exists;
      out.push(copyOk ? "Copy OK." : "ERROR: Copy not found after saveACopy.");
    } catch (eCopy) {
      out.push("ERROR: saveACopy failed: " + String(eCopy));
      copyOk = false;
    }

    var OUT_IDML = File(outIdmlPath);
    try { if (OUT_IDML.exists) OUT_IDML.remove(); } catch (eRm) {}

    var ok = false;
    try {
      if (!copyOk) throw "Copy missing; skipping export.";
      try { doc.close(SaveOptions.NO); } catch (eClose1) {}

      var copyDoc = openDocWithWindow(copyFile);
      if (!copyDoc) throw "Failed to open copy INDD.";
      if (!ensureActiveDoc(copyDoc, copyFile.fsName, out)) {
        try { copyDoc.close(SaveOptions.NO); } catch (eClose2) {}
        throw "Active document mismatch on copy.";
      }

      out.push("Exporting IDML from copy...");
      copyDoc.exportFile(ExportFormat.INDESIGN_MARKUP, OUT_IDML);
      ok = !!OUT_IDML.exists;
      out.push(ok ? "Export OK." : "ERROR: Export reported OK but file not found.");
      try { copyDoc.close(SaveOptions.NO); } catch (eClose3) {}
    } catch (eExp) {
      out.push("ERROR: Export failed: " + String(eExp));
      ok = false;
    }

    try {
      if (doc && doc.isValid) doc.close(SaveOptions.NO);
      out.push("Closed INDD without saving.");
    } catch (eClose) {
      out.push("WARN: Close failed: " + String(eClose));
    }

    if (ok) {
      try { if (copyFile.exists) copyFile.remove(); } catch (eCopyRm2) {}
    }

    out.push("OUT exists: " + String(OUT_IDML.exists));
    out.push("");

    if (ok) wrote++; else failed++;
  }

  out.push("RESULT: wrote=" + wrote + " failed=" + failed);
  out.push("Finished: " + (new Date()).toString());
  writeTextToDesktop("export_vth_n4_idml_chapters__" + isoStamp() + ".txt", out.join("\n"));

  try {
    if (failed === 0) alert("✅ Exported VTH N4 chapter IDMLs. See Desktop report for details.");
    else alert("❌ Some IDML exports failed. See Desktop report for details.");
  } catch (eA) {}

  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI) {}
})();





