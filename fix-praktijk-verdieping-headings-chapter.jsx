// ============================================================
// FIX: "In de praktijk" / "Verdieping" headings (generic, chapter-scoped)
// ============================================================
// Enforces Option A heading shape inside the BODY STORY:
// - Ensures ":" after the label when it is used as a heading
// - Ensures a single blank line before the label inside the same paragraph (\\n\\n)
// - Bolds the label text (label only)
//
// Scope:
// - Intended to run on chapter-only output docs.
// - Uses the largest story as BODY STORY and operates across it.
//
// Inputs (app.scriptArgs):
// - BIC_CHAPTER_FILTER (optional): used only for logging; chapter-only docs usually don’t need page-range scoping.
//
// Safe:
// - Modifies text formatting and punctuation only; does NOT save.
// ============================================================

#targetengine "session"

(function () {
  function resetFind() {
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
    try { app.changeTextPreferences = NothingEnum.nothing; } catch (e2) {}
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e3) {}
    try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e4) {}
  }

  function setCaseInsensitive() {
    // We keep label matching case-sensitive for bolding (capitalized headings),
    // but GREP normalization can be case-insensitive to catch variants.
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e) {}
  }

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

  function applyBoldLabel(textObj, label) {
    var changed = 0;
    try {
      resetFind();
      // Case-sensitive on purpose: capitalized headings only.
      try { app.findChangeTextOptions.caseSensitive = true; } catch (eCS) {}
      app.findTextPreferences.findWhat = label;
      app.changeTextPreferences.changeTo = label;
      app.changeTextPreferences.fontStyle = "Bold";
      var found = textObj.changeText();
      changed += (found ? found.length : 0);
    } catch (e0) {}
    resetFind();
    return changed;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("fix_praktijk_verdieping_headings__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("fix_praktijk_verdieping_headings__no_doc__" + isoStamp() + ".txt", out.join("\n"));
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
    writeTextToDesktop("fix_praktijk_verdieping_headings__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var story = null;
  try { story = doc.stories[body.index]; } catch (eS) { story = null; }
  if (!story) {
    out.push("ERROR: could not access body story");
    writeTextToDesktop("fix_praktijk_verdieping_headings__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var colonsChanged = 0;
  var boldChanged = 0;

  // Pass 1: ensure Option A + ":" for label uses where ":" is missing.
  // We run 3 patterns in order to avoid creating extra blank lines when a label is already preceded by \\n\\n.
  try {
    resetFind();
    setCaseInsensitive();

    // a) Already preceded by \\n\\n (possibly with whitespace) but missing ":".
    app.findGrepPreferences.findWhat = "\\n\\n\\s*(In de praktijk|Verdieping)(?:\\s*\\n|\\s)";
    app.changeGrepPreferences.changeTo = "\\n\\n$1: ";
    var a = story.changeGrep();
    colonsChanged += (a ? a.length : 0);
    resetFind();

    // b) Preceded by a single newline; normalize to \\n\\n + ":".
    setCaseInsensitive();
    app.findGrepPreferences.findWhat = "\\n\\s*(In de praktijk|Verdieping)(?:\\s*\\n|\\s)";
    app.changeGrepPreferences.changeTo = "\\n\\n$1: ";
    var b = story.changeGrep();
    colonsChanged += (b ? b.length : 0);
    resetFind();

    // c) Start-of-paragraph headings (Option B-ish); normalize to \\n\\n + ":".
    setCaseInsensitive();
    app.findGrepPreferences.findWhat = "^\\s*(In de praktijk|Verdieping)(?:\\s*\\n|\\s)";
    app.changeGrepPreferences.changeTo = "\\n\\n$1: ";
    var c = story.changeGrep();
    colonsChanged += (c ? c.length : 0);
    resetFind();
  } catch (eG) {
    resetFind();
    out.push("WARN: GREP normalization failed: " + String(eG));
  }

  // Pass 2: bold labels (case-sensitive)
  boldChanged += applyBoldLabel(story, "In de praktijk:");
  boldChanged += applyBoldLabel(story, "Verdieping:");

  out.push("Colon/blankline normalizations: " + colonsChanged);
  out.push("Bold label applications: " + boldChanged);

  var report = out.join("\n");
  writeTextToDesktop("fix_praktijk_verdieping_headings__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();
































