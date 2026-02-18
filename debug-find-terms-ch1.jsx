// ============================================================
// DEBUG: Find key terms in CH1 baseline/output (counts + samples)
// ============================================================
// Writes a report to ~/Desktop/debug_find_terms_ch1__<timestamp>.txt
//
// Goal:
// - Determine whether specific JSON-original phrases exist in the baseline/output,
//   and on which pages, to debug matching/coverage issues.
//
// Safe:
// - Opens docs read-only intent; closes without saving.
// ============================================================

#targetengine "session"

(function () {
  var BASELINE = File("/Users/asafgafni/Desktop/Generated_Books/_chapter_baselines/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720__CH1_ONLY_BASELINE.indd");
  var OUTPUT = File("/Users/asafgafni/Desktop/Generated_Books/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720__CH1_ONLY_BASELINE_REWRITTEN_V5_SAFE_V12.indd");

  var TERMS = [
    "Osmose",
    "Diffusie",
    "Actief transport",
    "vitamine B1",
    "Ijzer",
    "koper",
    "Voor de voeding van je cellen"
  ];

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

  function resetFind() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e1) {}
  }

  function pageNameOf(textObj) {
    try { var tf = textObj.parentTextFrames[0]; if (tf && tf.parentPage) return String(tf.parentPage.name); } catch (e0) {}
    return "?";
  }

  function cleanSnippet(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    try { if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1); } catch (e1) {}
    try { t = t.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); } catch (e2) {}
    if (t.length > 220) t = t.substring(0, 220) + "...";
    return t;
  }

  function openDoc(file) {
    if (!file || !file.exists) return null;
    var d = null;
    try { d = app.open(file, true); } catch (e0) { try { d = app.open(file); } catch (e1) { d = null; } }
    return d;
  }

  function runOn(doc, label) {
    var out = [];
    out.push("== " + label + " ==");
    out.push("file: " + (doc && doc.fullName ? doc.fullName.fsName : "(no fullName)"));
    out.push("name: " + (doc ? doc.name : "(null)"));
    out.push("");
    for (var i = 0; i < TERMS.length; i++) {
      var term = TERMS[i];
      resetFind();
      app.findGrepPreferences.findWhat = term;
      var hits = [];
      try { hits = doc.findGrep(); } catch (eF) { hits = []; }
      resetFind();
      out.push("TERM: " + term + "  hits=" + (hits ? hits.length : 0));
      for (var j = 0; j < hits.length && j < 5; j++) {
        var h = hits[j];
        var para = null;
        try { para = (h.paragraphs && h.paragraphs.length) ? h.paragraphs[0] : null; } catch (eP) { para = null; }
        var snippet = "";
        try { snippet = cleanSnippet(para ? para.contents : h.contents); } catch (eT) { snippet = ""; }
        out.push("  - page=" + pageNameOf(h) + " :: " + snippet);
      }
      out.push("");
    }
    return out.join("\n");
  }

  var outAll = [];
  outAll.push("=== debug-find-terms-ch1.jsx ===");
  outAll.push("Started: " + (new Date()).toString());
  outAll.push("");

  var baseDoc = openDoc(BASELINE);
  if (baseDoc) {
    try { app.activeDocument = baseDoc; } catch (eAct0) {}
    outAll.push(runOn(baseDoc, "CH1_ONLY_BASELINE"));
    outAll.push("");
    try { baseDoc.close(SaveOptions.NO); } catch (eC0) {}
  } else {
    outAll.push("ERROR: could not open baseline: " + BASELINE.fsName);
    outAll.push("");
  }

  var outDoc = openDoc(OUTPUT);
  if (outDoc) {
    try { app.activeDocument = outDoc; } catch (eAct1) {}
    outAll.push(runOn(outDoc, "OUTPUT_V12"));
    outAll.push("");
    try { outDoc.close(SaveOptions.NO); } catch (eC1) {}
  } else {
    outAll.push("WARN: could not open output: " + OUTPUT.fsName);
    outAll.push("");
  }

  outAll.push("Finished: " + (new Date()).toString());
  writeTextToDesktop("debug_find_terms_ch1__" + isoStamp() + ".txt", outAll.join("\n"));
})();
































