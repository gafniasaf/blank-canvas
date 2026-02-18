// Remove soft hyphen characters (U+00AD) from the CH1 body story only.
// Motivation: U+00AD is invisible and can cause copy/paste issues and odd hyphenation artifacts.
//
// Safe:
// - Only removes the character itself (does not rewrite full paragraph contents).
// - Scopes to Chapter 1 range via ^1.1 .. ^2.1 markers.
// - Scopes to the body story (largest wordcount in range).
//
// Output:
// - Writes report to ~/Desktop/remove_soft_hyphens__<doc>__<timestamp>.txt
//
// Run:
// - Usually invoked by run-ch1-rewrite-v5-safe.jsx after applying rewrites.

#targetengine "session"

(function () {
  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) s = "doc";
    return s;
  }
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
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
  }
  function setCaseInsensitive() {
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e) {}
    try { app.findChangeTextOptions.caseSensitive = false; } catch (e2) {}
  }
  function findGrep(doc, pat) {
    resetFind();
    setCaseInsensitive();
    app.findGrepPreferences.findWhat = pat;
    var res = [];
    try { res = doc.findGrep(); } catch (e) { res = []; }
    resetFind();
    return res;
  }
  function pageOfText(textObj) {
    try { var tf = textObj.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e) {}
    return null;
  }

  function paraStartPage(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage; } catch (e1) {}
    return null;
  }
  function paraStartPageOffset(para) {
    var pg = paraStartPage(para);
    if (!pg) return -1;
    try { return pg.documentOffset; } catch (e) { return -1; }
  }

  function getChapterRange(doc) {
    // CH1 scope:
    // - Start: ^1.1 (stable and avoids matching numbered lists)
    // - End: ^2.1 (fallback)
    var f1 = findGrep(doc, "^1\\.1");
    var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
    var startOff = p1 ? p1.documentOffset : 0;

    var f2 = findGrep(doc, "^2\\.1");
    var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
    var endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
    if (endOff < startOff) endOff = doc.pages.length - 1;
    return { startOff: startOff, endOff: endOff };
  }

  function storyWordCountInRange(story, startOff, endOff) {
    var wc = 0;
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;
      try { wc += para.words.length; } catch (eW) {}
    }
    return wc;
  }

  function detectBodyStoryIndex(doc, startOff, endOff) {
    var bestIdx = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = storyWordCountInRange(doc.stories[s], startOff, endOff);
      if (wc > bestWords) { bestWords = wc; bestIdx = s; }
    }
    return { index: bestIdx, words: bestWords };
  }

  function paraHasAnchors(para) {
    try { return String(para.contents || "").indexOf("\uFFFC") !== -1; } catch (e) { return false; }
  }

  function resetChangePrefs() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e1) {}
  }
  // NOTE: InDesign GREP does NOT reliably support a \\u00AD escape token.
  // Matching/removing works by using the literal U+00AD character in findWhat.
  function configureSoftHyphenChangeGrep() {
    resetChangePrefs();
    setCaseInsensitive();
    app.findGrepPreferences.findWhat = "\u00AD";
    app.changeGrepPreferences.changeTo = "";
  }

  var out = [];
  var doc = null;
  try { doc = app.activeDocument; } catch (eA) { doc = null; }
  if (!doc) { try { if (app.documents.length > 0) doc = app.documents[0]; } catch (eB) { doc = null; } }

  if (!doc) {
    out.push("ERROR: No document open/resolved.");
    writeTextToDesktop("remove_soft_hyphens__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  try { app.activeDocument = doc; } catch (eAct) {}

  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP) {}
  out.push("CH1 offsets: " + range.startOff + " -> " + range.endOff);
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: Could not resolve body story.");
    writeTextToDesktop("remove_soft_hyphens__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  var story = doc.stories[body.index];
  var pc2 = 0;
  try { pc2 = story.paragraphs.length; } catch (ePC) { pc2 = 0; }

  var totalRemoved = 0;
  var sampleRefs = [];

  // Configure GREP once; we’ll apply it per paragraph (scoped).
  try { configureSoftHyphenChangeGrep(); } catch (eCfg) {}

  for (var p2 = 0; p2 < pc2; p2++) {
    var para2 = story.paragraphs[p2];
    var off2 = paraStartPageOffset(para2);
    if (off2 < range.startOff || off2 > range.endOff) continue;
    if (paraHasAnchors(para2)) continue; // conservative

    // Fast pre-check (string-based) before running GREP change
    var txt = "";
    try { txt = String(para2.contents || ""); } catch (eT) { txt = ""; }
    if (txt.indexOf("\u00AD") === -1) continue;

    var removedHere = 0;
    try {
      var res = para2.changeGrep();
      if (res && res.length) removedHere = res.length;
    } catch (eChg) { removedHere = 0; }
    if (removedHere > 0) {
      totalRemoved += removedHere;
      if (sampleRefs.length < 10) {
        var pg = paraStartPage(para2);
        var pgName = pg ? String(pg.name) : "?";
        sampleRefs.push("page=" + pgName + " off=" + off2 + " removed=" + removedHere);
      }
    }
  }

  out.push("Removed soft hyphens (U+00AD): " + totalRemoved);
  if (sampleRefs.length) {
    out.push("Samples:");
    for (var s0 = 0; s0 < sampleRefs.length; s0++) out.push(" - " + sampleRefs[s0]);
  }

  // Save changes to the already-generated rewritten output.
  try {
    if (doc.saved) doc.save();
    out.push("Saved: ok");
  } catch (eSave) {
    out.push("Saved: FAILED :: " + String(eSave));
  }

  // Clean up GREP prefs so we don't affect later scripts.
  try { resetChangePrefs(); } catch (eResetEnd) {}

  writeTextToDesktop("remove_soft_hyphens__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
})();


