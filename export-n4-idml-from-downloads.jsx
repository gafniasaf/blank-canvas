// ============================================================
// EXPORT: Canonical N4 book(s) (Downloads) → IDML snapshot(s)
// ============================================================
// Purpose:
// - Create deterministic, auditable IDML snapshot(s) directly from the ORIGINAL N4 INDD(s)
//   in ~/Downloads, so numbering (chapter/paragraph/subparagraph) can be validated against them.
//
// Default driver:
// - Reads <repo>/books/manifest.json and exports IDML for each entry:
//   - INDD: book.canonical_n4_indd_path
//   - OUT:  book.canonical_n4_idml_path (relative to repo, typically ./_source_exports/<book_id>__FROM_DOWNLOADS.idml)
//
// Optional args (app.scriptArgs):
// - BIC_BOOK_ID: export only this book_id from the manifest
// - BIC_MANIFEST_PATH: override manifest path
//
// Output:
// - Writes each IDML into the repo path specified by the manifest entry
// - Writes a Desktop report: export_n4_idml_from_downloads__<timestamp>.txt
//
// SAFE:
// - Opens INDDs, exports IDML, and closes WITHOUT saving (never modifies Downloads files).
//
// Run:
// - From InDesign: app.doScript(File("<this file>"), ScriptLanguage.JAVASCRIPT)
// ============================================================

#targetengine "session"

(function () {
  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e0) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e1) {}

  function shouldAlert() {
    // Default: silent (non-blocking). Enable alerts only when explicitly requested.
    var v = "";
    try { v = String(app.scriptArgs.getValue("BIC_SHOW_ALERTS") || ""); } catch (e0) { v = ""; }
    v = String(v || "").toLowerCase();
    return (v === "1" || v === "true" || v === "yes");
  }

  var SHOW_ALERTS = false;
  try { SHOW_ALERTS = shouldAlert(); } catch (eSA) { SHOW_ALERTS = false; }

  function maybeAlert(msg) {
    if (!SHOW_ALERTS) return;
    try { alert(String(msg || "")); } catch (e) {}
  }

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
      try { f.encoding = "UTF-8"; } catch (eEnc) {}
      try { f.lineFeed = "Unix"; } catch (eLF) {}
      try { if (f.exists) f.remove(); } catch (eRm) {}
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
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

  function parseJsonLoose(txt) {
    // NOTE: manifest is trusted (repo file). Use eval as JSON.parse may not exist in ExtendScript.
    var t = String(txt || "");
    if (!t) return null;
    try { return eval("(" + t + ")"); } catch (e) { return null; }
  }

  function resolveRepoRoot() {
    try {
      var me = File($.fileName);
      if (!me || !me.exists) return null;
      // .../TestRun/export-n4-idml-from-downloads.jsx → repo root is parent of this file
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

  function exportOne(inddPath, outIdmlPath, out) {
    var INDD = File(inddPath);
    var OUT_IDML = File(outIdmlPath);
    out.push("INDD: " + INDD.fsName);
    out.push("OUT:  " + OUT_IDML.fsName);

    if (!INDD.exists) {
      out.push("ERROR: INDD not found.");
      out.push("");
      return false;
    }

    try { if (OUT_IDML.parent && !OUT_IDML.parent.exists) OUT_IDML.parent.create(); } catch (eDir) {}
    if (!OUT_IDML.parent || !OUT_IDML.parent.exists) {
      out.push("ERROR: Could not create output dir: " + (OUT_IDML.parent ? OUT_IDML.parent.fsName : "(null)"));
      out.push("");
      return false;
    }

    var doc = openDocWithWindow(INDD);
    if (!doc) {
      out.push("ERROR: Failed to open INDD.");
      out.push("");
      return false;
    }

    try {
      if (OUT_IDML.exists) {
        try { OUT_IDML.remove(); } catch (eRm) {}
      }
    } catch (eExist) {}

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

    try {
      doc.close(SaveOptions.NO);
      out.push("Closed INDD without saving.");
    } catch (eClose) {
      out.push("WARN: Close failed: " + String(eClose));
    }

    out.push("OUT exists: " + String(OUT_IDML.exists));
    out.push("");
    return ok;
  }

  var out = [];
  out.push("=== EXPORT N4 IDML FROM DOWNLOADS (manifest-driven) ===");
  out.push("Started: " + (new Date()).toString());
  out.push("");

  var repoRoot = resolveRepoRoot();
  if (!repoRoot || !repoRoot.exists) {
    out.push("ERROR: Could not resolve repo root from $.fileName=" + String($.fileName));
    writeTextToDesktop("export_n4_idml_from_downloads__" + isoStamp() + ".txt", out.join("\n"));
    maybeAlert("Could not resolve repo root.");
    return;
  }
  out.push("Repo: " + repoRoot.fsName);

  var manifestPath = "";
  try { manifestPath = String(app.scriptArgs.getValue("BIC_MANIFEST_PATH") || ""); } catch (eMP) { manifestPath = ""; }
  var manifestFile = manifestPath ? File(manifestPath) : File(repoRoot.fsName + "/books/manifest.json");
  if (!manifestFile.exists) {
    out.push("ERROR: manifest not found: " + manifestFile.fsName);
    writeTextToDesktop("export_n4_idml_from_downloads__" + isoStamp() + ".txt", out.join("\n"));
    maybeAlert("Manifest not found:\n" + manifestFile.fsName);
    return;
  }
  out.push("Manifest: " + manifestFile.fsName);

  var onlyBookId = "";
  try { onlyBookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eBID) { onlyBookId = ""; }
  if (onlyBookId) out.push("Filter book_id=" + onlyBookId);
  out.push("");

  var manifest = parseJsonLoose(readTextFile(manifestFile));
  if (!manifest || !manifest.books || !(manifest.books instanceof Array)) {
    out.push("ERROR: invalid manifest JSON shape: expected { books: [...] }");
    writeTextToDesktop("export_n4_idml_from_downloads__" + isoStamp() + ".txt", out.join("\n"));
    maybeAlert("Invalid manifest JSON shape.");
    return;
  }

  var wrote = 0;
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < manifest.books.length; i++) {
    var book = manifest.books[i];
    if (!book) continue;
    var bid = String(book.book_id || "");
    if (onlyBookId && bid !== onlyBookId) { skipped++; continue; }

    var inddPath = String(book.canonical_n4_indd_path || "");
    var outRel = String(book.canonical_n4_idml_path || "");
    if (!bid || !inddPath || !outRel) {
      failed++;
      out.push("---");
      out.push("BOOK: " + bid);
      out.push("ERROR: missing canonical_n4_indd_path or canonical_n4_idml_path");
      out.push("");
      continue;
    }

    var outFile = resolveRepoPath(repoRoot, outRel);
    if (!outFile) {
      failed++;
      out.push("---");
      out.push("BOOK: " + bid);
      out.push("ERROR: could not resolve canonical_n4_idml_path: " + outRel);
      out.push("");
      continue;
    }

    out.push("---");
    out.push("BOOK: " + bid);
    var ok = exportOne(inddPath, outFile.fsName, out);
    if (ok) wrote++; else failed++;
  }

  out.push("RESULT: wrote=" + wrote + " skipped=" + skipped + " failed=" + failed);

  out.push("Finished: " + (new Date()).toString());
  writeTextToDesktop("export_n4_idml_from_downloads__" + isoStamp() + ".txt", out.join("\n"));
  if (SHOW_ALERTS) {
    try {
      if (failed === 0) alert("✅ Exported IDML snapshot(s). See Desktop report for details.");
      else alert("❌ Some IDML exports failed. See Desktop report for details.");
    } catch (eA) {}
  }
  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI) {}
})();


