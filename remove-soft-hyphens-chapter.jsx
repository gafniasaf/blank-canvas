// ============================================================
// REMOVE: soft hyphens (U+00AD) from chapter output (generic)
// ============================================================
// Motivation:
// - U+00AD is invisible and can cause copy/paste issues and subtle QA problems.
//
// Scope:
// - Intended to run on chapter-only output docs.
// - Uses the largest story as BODY STORY and removes U+00AD from its paragraphs.
//
// Inputs (app.scriptArgs):
// - BIC_CHAPTER_FILTER (optional): for logging only.
//
// Safe:
// - Modifies paragraph contents only; does NOT save.
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

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("remove_soft_hyphens__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("remove_soft_hyphens__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var chapterFilter = "";
  try { chapterFilter = String(app.scriptArgs.getValue("BIC_CHAPTER_FILTER") || ""); } catch (eCF) { chapterFilter = ""; }

  var body = detectBodyStoryIndex(doc);
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("chapter_filter=" + (chapterFilter ? chapterFilter : "(none)"));
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("remove_soft_hyphens__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var story = null;
  try { story = doc.stories[body.index]; } catch (eS) { story = null; }
  if (!story) {
    out.push("ERROR: could not access body story");
    writeTextToDesktop("remove_soft_hyphens__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var count_u00ad = 0;
  var count_removed = 0;
  var samples = [];

  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var txt = "";
    try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
    if (!txt) continue;
    var initialCount = 0;
    try { initialCount = (txt.match(/\u00AD/g) || []).length; } catch (eM) { initialCount = 0; }
    if (initialCount <= 0) continue;

    count_u00ad += initialCount;
    var newTxt = "";
    try { newTxt = txt.replace(/\u00AD/g, ""); } catch (eR) { newTxt = txt; }
    if (newTxt !== txt) {
      try {
        para.contents = newTxt;
        count_removed += initialCount;
        if (samples.length < 12) samples.push("paraIndex=" + p + " removed=" + initialCount);
      } catch (eSet) {
        // ignore
      }
    }
  }

  out.push("U+00AD occurrences found: " + count_u00ad);
  out.push("U+00AD removed:           " + count_removed);
  if (samples.length) out.push("Samples: " + samples.join(" | "));

  var report = out.join("\n");
  writeTextToDesktop("remove_soft_hyphens__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();
































