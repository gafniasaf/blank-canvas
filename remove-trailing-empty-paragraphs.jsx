// ============================================================
// FIX: remove trailing empty paragraphs (generic, chapter output)
// ============================================================
// Problem:
// - Some outputs end with one (or more) empty paragraphs (often [Basic Paragraph]).
// - This can cause an overset frame at the end of the body story, which then triggers
//   "add page to fix overset", producing a visually empty trailing page.
//
// Fix:
// - Delete trailing paragraphs at the END of the BODY STORY that are empty after trimming.
// - Stop at the first non-empty paragraph from the end.
//
// Scope:
// - Intended for chapter-only output docs.
// - Uses the largest story as BODY STORY (consistent with other post-passes).
//
// Safe:
// - Modifies content; does NOT save.
// ============================================================

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

  function detectBodyStoryIndex(doc) {
    var best = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = doc.stories[s].words.length; } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }

  function trimParaText(txt) {
    var t = "";
    try { t = String(txt || ""); } catch (e0) { t = ""; }
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/\s+/g, " "); } catch (e1) {}
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e2) {}
    return t;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("remove_trailing_empty_paras__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("remove_trailing_empty_paras__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var body = detectBodyStoryIndex(doc);
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("remove_trailing_empty_paras__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var story = doc.stories[body.index];
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }

  var removed = 0;
  var removedSamples = [];

  // Remove ONLY contiguous empty paragraphs at the very end of the story.
  for (var i = pc - 1; i >= 0; i--) {
    var para = story.paragraphs[i];
    var tt = trimParaText(para.contents);
    if (tt) break; // stop at first non-empty

    var styleName = "";
    try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }

    try {
      para.remove();
      removed++;
      if (removedSamples.length < 20) removedSamples.push("paraIndex=" + i + " style=" + styleName);
    } catch (eRm) {}
  }

  out.push("Removed trailing empty paragraphs: " + removed);
  if (removedSamples.length) out.push("Samples: " + removedSamples.join(" | "));

  var report = out.join("\n");
  writeTextToDesktop("remove_trailing_empty_paras__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();
































