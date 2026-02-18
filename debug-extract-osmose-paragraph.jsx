// ============================================================
// DEBUG: Extract the full Osmose body paragraph from CH1 baseline
// ============================================================
// Writes to ~/Desktop/debug_osmose_paragraph__<timestamp>.txt
// ============================================================

#targetengine "session"

(function () {
  var BASELINE = File("/Users/asafgafni/Desktop/Generated_Books/_chapter_baselines/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720__CH1_ONLY_BASELINE.indd");

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

  var out = [];
  out.push("=== debug-extract-osmose-paragraph.jsx ===");
  out.push("Started: " + (new Date()).toString());
  out.push("Baseline: " + BASELINE.fsName);
  out.push("");

  if (!BASELINE.exists) {
    out.push("ERROR: baseline not found.");
    writeTextToDesktop("debug_osmose_paragraph__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  var doc = null;
  try { doc = app.open(BASELINE, true); } catch (e0) { try { doc = app.open(BASELINE); } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: failed to open baseline.");
    writeTextToDesktop("debug_osmose_paragraph__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }
  try { app.activeDocument = doc; } catch (eAct) {}

  resetFind();
  app.findGrepPreferences.findWhat = "^Osmose\\s+is";
  var hits = [];
  try { hits = doc.findGrep(); } catch (eF) { hits = []; }
  resetFind();

  out.push("hits=" + (hits ? hits.length : 0));
  if (hits && hits.length) {
    var h = hits[0];
    var para = null;
    try { para = (h.paragraphs && h.paragraphs.length) ? h.paragraphs[0] : null; } catch (eP) { para = null; }
    var txt = "";
    try { txt = String(para ? para.contents : h.contents); } catch (eT) { txt = ""; }
    try { if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1); } catch (eCR) {}
    out.push("page=" + pageNameOf(h));
    out.push("len=" + String(txt.length));
    out.push("");
    out.push(txt);
  }

  try { doc.close(SaveOptions.NO); } catch (eC) {}
  out.push("");
  out.push("Finished: " + (new Date()).toString());

  writeTextToDesktop("debug_osmose_paragraph__" + isoStamp() + ".txt", out.join("\n"));
})();
































