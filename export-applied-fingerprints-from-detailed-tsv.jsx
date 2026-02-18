// ============================================================
// EXPORT: applied fingerprints from replaced_detailed TSV (final)
// ============================================================
// Purpose:
// - The rewrite engine logs replacements to rewrite_v5_safe_replaced_detailed.tsv.
// - In practice, computing after_key/after_snippet inline during replacement can be unreliable.
// - This script re-computes the fingerprint based on the FINAL, SAVED document state.
//
// Inputs (app.scriptArgs):
// - BIC_TSV_IN  (required): path to rewrite_v5_safe_replaced_detailed.tsv (copied into a run folder)
// - BIC_TSV_OUT (required): path to write the final TSV with recomputed after_key/after_snippet
//
// Output:
// - Writes BIC_TSV_OUT
// - Writes a small report to Desktop/export_applied_fingerprints__<timestamp>.txt
//
// Safe: read-only (does not change the document).
// ============================================================

#targetengine "session"

(function () {
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

  function readTextFile(f) {
    if (!f || !f.exists) return "";
    var txt = "";
    // ExtendScript encoding support can vary; try a few common encodings.
    var encs = ["UTF-8", "Macintosh", "ISO-8859-1"];
    for (var ei = 0; ei < encs.length; ei++) {
      try {
        try { f.encoding = encs[ei]; } catch (eEnc) {}
        if (f.open("r")) { txt = String(f.read() || ""); f.close(); }
      } catch (e) { try { f.close(); } catch (e2) {} }
      if (txt && txt.length) return txt;
    }
    // Final fallback: do not force encoding.
    try {
      try { f.encoding = ""; } catch (eEnc2) {}
      if (f.open("r")) { txt = String(f.read() || ""); f.close(); }
    } catch (e3) { try { f.close(); } catch (e4) {} }
    return txt;
  }

  function writeTextFile(f, txt) {
    if (!f) return false;
    try {
      // Write as UTF-8 for stability; Node verifier reads as latin1-safe anyway.
      try { f.encoding = "UTF-8"; } catch (eEnc) {}
      f.lineFeed = "Unix";
      if (f.exists) { try { f.remove(); } catch (e0) {} }
      if (f.open("w")) { f.write(String(txt || "")); f.close(); return true; }
    } catch (e) { try { f.close(); } catch (e2) {} }
    return false;
  }

  // --- fingerprint helpers (must match scripts/rewrite-from-original-safe-v5.jsx + scripts/verify-applied-rewrites.ts) ---
  function cleanText(text) {
    if (!text) return "";
    try { text = text.replace(/<\?ACE\s*\d*\s*\?>/gi, ""); } catch (e0) {}
    try { text = text.replace(/[\u0000-\u001F\u007F]/g, " "); } catch (eCtl) {}
    try { text = text.replace(/\u00AD/g, ""); } catch (eShy) {}
    try { text = text.replace(/<<BOLD_START>>/g, ""); } catch (e1) {}
    try { text = text.replace(/<<BOLD_END>>/g, ""); } catch (e2) {}
    try { text = text.replace(/\uFFFC/g, ""); } catch (e3) {}
    try { text = text.replace(/\s+/g, " "); } catch (e4) {}
    try { text = text.replace(/^\s+|\s+$/g, ""); } catch (e5) {}
    return text;
  }

  function normalizeFull(text) {
    if (!text) return "";
    var s = String(text).toLowerCase();
    try { s = s.replace(/[\r\n\t]/g, " "); } catch (e0) {}
    // IMPORTANT: avoid non-ASCII literals in this file.
    // Some ExtendScript setups interpret script files using a legacy encoding; using \\u escapes is robust.
    try { s = s.replace(/[\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5]/g, "a"); } catch (eD1) {}
    try { s = s.replace(/\u00E6/g, "ae"); } catch (eD2) {}
    try { s = s.replace(/\u00E7/g, "c"); } catch (eD3) {}
    try { s = s.replace(/[\u00E8\u00E9\u00EA\u00EB]/g, "e"); } catch (eD4) {}
    try { s = s.replace(/[\u00EC\u00ED\u00EE\u00EF]/g, "i"); } catch (eD5) {}
    try { s = s.replace(/\u00F1/g, "n"); } catch (eD6) {}
    try { s = s.replace(/[\u00F2\u00F3\u00F4\u00F5\u00F6\u00F8]/g, "o"); } catch (eD7) {}
    try { s = s.replace(/\u0153/g, "oe"); } catch (eD8) {}
    try { s = s.replace(/[\u00F9\u00FA\u00FB\u00FC]/g, "u"); } catch (eD9) {}
    try { s = s.replace(/[\u00FD\u00FF]/g, "y"); } catch (eD10) {}
    try { s = s.replace(/\u00DF/g, "ss"); } catch (eD11) {}
    try { s = s.replace(/[^a-z0-9\s]/g, " "); } catch (e1) {}
    try { s = s.replace(/\s+/g, " "); } catch (e2) {}
    try { s = s.replace(/^\s+|\s+$/g, ""); } catch (e3) {}
    return s;
  }

  function fnv1a32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var hex = (h >>> 0).toString(16);
    return ("00000000" + hex).slice(-8);
  }

  function buildKey(text) {
    var n = normalizeFull(cleanText(text));
    if (!n) return "";
    return String(n.length) + ":" + fnv1a32(n);
  }

  function tsvSafeCell(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    try { t = t.replace(/\t/g, " "); } catch (e1) {}
    try { t = t.replace(/[\r\n]/g, " "); } catch (e2) {}
    try { t = t.replace(/[\u2028\u2029]/g, " "); } catch (e3) {}
    try { t = t.replace(/[\u0000-\u001F\u007F]/g, " "); } catch (e4) {}
    try { t = t.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); } catch (e5) {}
    if (t.length > 160) t = t.substring(0, 160) + "...";
    return t;
  }

  var report = [];
  report.push("=== export-applied-fingerprints-from-detailed-tsv.jsx ===");
  report.push("Started: " + (new Date()).toString());

  if (app.documents.length === 0) {
    report.push("ERROR: no documents open");
    writeTextToDesktop("export_applied_fingerprints__ERROR__" + isoStamp() + ".txt", report.join("\n"));
    throw new Error("No documents open");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    report.push("ERROR: could not resolve active document");
    writeTextToDesktop("export_applied_fingerprints__ERROR__" + isoStamp() + ".txt", report.join("\n"));
    throw new Error("No active document resolved");
  }
  report.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) report.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  report.push("");

  var inPath = "";
  var outPath = "";
  try { inPath = String(app.scriptArgs.getValue("BIC_TSV_IN") || ""); } catch (eA0) { inPath = ""; }
  try { outPath = String(app.scriptArgs.getValue("BIC_TSV_OUT") || ""); } catch (eA1) { outPath = ""; }
  if (!inPath || !outPath) {
    report.push("ERROR: Missing BIC_TSV_IN or BIC_TSV_OUT");
    writeTextToDesktop("export_applied_fingerprints__ERROR__" + isoStamp() + ".txt", report.join("\n"));
    throw new Error("Missing scriptArgs BIC_TSV_IN/BIC_TSV_OUT");
  }

  var inFile = File(inPath);
  var outFile = File(outPath);
  if (!inFile.exists) {
    report.push("ERROR: TSV in not found: " + inFile.fsName);
    writeTextToDesktop("export_applied_fingerprints__ERROR__" + isoStamp() + ".txt", report.join("\n"));
    throw new Error("TSV in not found");
  }

  report.push("TSV_IN:  " + inFile.fsName);
  report.push("TSV_OUT: " + outFile.fsName);
  report.push("");

  var content = readTextFile(inFile);
  var normalized = String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var lines = normalized.split("\n");
  if (!lines || lines.length < 2) {
    report.push("ERROR: TSV has no rows");
    writeTextToDesktop("export_applied_fingerprints__ERROR__" + isoStamp() + ".txt", report.join("\n"));
    throw new Error("TSV empty");
  }

  var header = String(lines[0] || "").split("\t");
  var idxStory = -1, idxPara = -1, idxAfterKey = -1, idxAfterSnippet = -1;
  for (var hi = 0; hi < header.length; hi++) {
    var h = String(header[hi] || "");
    if (h === "storyIndex") idxStory = hi;
    if (h === "paraIndex") idxPara = hi;
    if (h === "after_key") idxAfterKey = hi;
    if (h === "after_snippet") idxAfterSnippet = hi;
  }

  // Ensure after_key/after_snippet columns exist
  var outHeader = header.slice(0);
  if (idxAfterKey < 0) { idxAfterKey = outHeader.length; outHeader.push("after_key"); }
  if (idxAfterSnippet < 0) { idxAfterSnippet = outHeader.length; outHeader.push("after_snippet"); }

  if (idxStory < 0 || idxPara < 0) {
    report.push("ERROR: TSV missing storyIndex/paraIndex columns");
    writeTextToDesktop("export_applied_fingerprints__ERROR__" + isoStamp() + ".txt", report.join("\n"));
    throw new Error("TSV missing storyIndex/paraIndex");
  }

  var okRows = 0;
  var badRows = 0;
  var samples = [];

  var outLines = [];
  outLines.push(outHeader.join("\t"));

  for (var li = 1; li < lines.length; li++) {
    var line = String(lines[li] || "");
    if (!line || !line.replace(/\s+/g, "")) continue;
    var cols = line.split("\t");
    // pad
    while (cols.length < outHeader.length) cols.push("");

    var sIdx = parseInt(String(cols[idxStory] || ""), 10);
    var pIdx = parseInt(String(cols[idxPara] || ""), 10);

    var afterKey = "";
    var afterSnippet = "";
    var ok = false;
    try {
      if (sIdx >= 0 && sIdx < doc.stories.length) {
        var st = doc.stories[sIdx];
        if (st && st.isValid) {
          var pc = 0;
          try { pc = st.paragraphs.length; } catch (ePC) { pc = 0; }
          if (pIdx >= 0 && pIdx < pc) {
            var para = st.paragraphs[pIdx];
            if (para && para.isValid) {
              var txt = "";
              try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
              afterKey = buildKey(txt);
              afterSnippet = tsvSafeCell(cleanText(txt));
              ok = !!afterKey;
            }
          }
        }
      }
    } catch (eRow) { ok = false; }

    if (ok) okRows++;
    else {
      badRows++;
      if (samples.length < 15) samples.push("row=" + li + " storyIndex=" + sIdx + " paraIndex=" + pIdx);
    }

    cols[idxAfterKey] = afterKey;
    cols[idxAfterSnippet] = afterSnippet;
    outLines.push(cols.join("\t"));
  }

  writeTextFile(outFile, outLines.join("\n") + "\n");

  report.push("Rows OK:  " + okRows);
  report.push("Rows BAD: " + badRows);
  if (samples.length) report.push("Bad samples: " + samples.join(" | "));

  writeTextToDesktop("export_applied_fingerprints__" + isoStamp() + ".txt", report.join("\n"));

  report.join("\n");
})();


