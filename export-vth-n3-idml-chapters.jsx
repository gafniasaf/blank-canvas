// ============================================================
// EXPORT: VTH N3 chapter INDDs (Downloads) → IDMLs (designs-relinked/)
// ============================================================
// Source folder:
// - /Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 3_9789083412047_03/
// Chapter files:
// - 01-VTH_Niveau-3_03.2024.indd ... 21-VTH_Niveau-3_03.2024.indd
//
// Output folder:
// - <repo>/designs-relinked/_MBO VTH nivo 3_9789083412047_03/
//
// SAFE:
// - Opens INDDs, exports IDML, closes WITHOUT saving.
// ============================================================

#targetengine "session"

(function () {
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
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

  function pad2(n) { var s = String(n); return s.length === 1 ? ("0" + s) : s; }

  var out = [];
  out.push("=== EXPORT VTH N3 CHAPTER IDMLs ===");
  out.push("Started: " + (new Date()).toString());
  out.push("");

  var repoRoot = resolveRepoRoot();
  if (!repoRoot || !repoRoot.exists) {
    out.push("ERROR: Could not resolve repo root from $.fileName=" + String($.fileName));
    writeTextToDesktop("export_vth_n3_idml_chapters__" + isoStamp() + ".txt", out.join("\n"));
    alert("Could not resolve repo root.");
    return;
  }

  var inddDir = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 3_9789083412047_03";
  var outDir = repoRoot.fsName + "/designs-relinked/_MBO VTH nivo 3_9789083412047_03";

  out.push("Repo: " + repoRoot.fsName);
  out.push("INDD dir: " + inddDir);
  out.push("OUT dir:  " + outDir);
  out.push("");

  try { var od = Folder(outDir); if (!od.exists) od.create(); } catch (eDir) {}

  var wrote = 0;
  var failed = 0;

  for (var ch = 1; ch <= 21; ch++) {
    var chStr = pad2(ch);
    var inddPath = inddDir + "/" + chStr + "-VTH_Niveau-3_03.2024.indd";
    var outIdmlPath = outDir + "/" + chStr + "-VTH_Niveau-3_03.2024.idml";

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

    var OUT_IDML = File(outIdmlPath);
    try { if (OUT_IDML.exists) OUT_IDML.remove(); } catch (eRm) {}

    var ok = false;
    try {
      out.push("Exporting IDML...");
      doc.exportFile(ExportFormat.INDESIGN_MARKUP, OUT_IDML);
      ok = !!OUT_IDML.exists;
      out.push(ok ? "Export OK." : "ERROR: Export reported OK but file not found.");
    } catch (eExp) {
      out.push("ERROR: Export failed: " + String(eExp));
      ok = false;
    }

    try { doc.close(SaveOptions.NO); out.push("Closed INDD without saving."); } catch (eClose) { out.push("WARN: Close failed: " + String(eClose)); }
    out.push("OUT exists: " + String(OUT_IDML.exists));
    out.push("");

    if (ok) wrote++; else failed++;
  }

  out.push("RESULT: wrote=" + wrote + " failed=" + failed);
  out.push("Finished: " + (new Date()).toString());
  writeTextToDesktop("export_vth_n3_idml_chapters__" + isoStamp() + ".txt", out.join("\n"));
  try { if (failed === 0) alert("✅ Exported VTH N3 chapter IDMLs."); else alert("❌ Some VTH N3 IDML exports failed. See Desktop report."); } catch (eA) {}
  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI) {}
})();






























