// ============================================================
// SCAN: trailing empty pages (generic, chapter output)
// ============================================================
// Detects empty pages at the END of the document that are likely artifacts of
// "add pages to fix overset" during baseline making.
//
// A page is considered trailing-empty if:
// - It has 0 body-story words on the page, AND
// - It has no graphics, AND
// - It has no non-body text frames with meaningful text (len >= 6)
//
// Scope:
// - Intended for chapter-only output docs.
// - Uses the largest story as BODY STORY.
//
// Safe: read-only; writes report to Desktop.
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
  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? String(o.constructor.name) : ""; } catch (e0) { return ""; } }
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
  function cleanOneLine(s) {
    return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function pageHasAnyGraphics(pg) {
    if (!pg || !pg.isValid) return false;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        try { if (it.allGraphics && it.allGraphics.length > 0) return true; } catch (eG0) {}
        try { if (it.graphics && it.graphics.length > 0) return true; } catch (eG1) {}
      }
    } catch (eAll) {}
    return false;
  }
  function bodyWordsOnPage(pg, bodyStory) {
    var wc = 0;
    if (!pg || !pg.isValid || !bodyStory) return wc;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var st = null;
        try { st = it.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;
        try { wc += it.words.length; } catch (eW) {}
      }
    } catch (eAll) {}
    return wc;
  }
  function hasMeaningfulNonBodyText(pg, bodyStory) {
    if (!pg || !pg.isValid) return false;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var st = null;
        try { st = it.parentStory; } catch (eS) { st = null; }
        if (st === bodyStory) continue;
        var t = "";
        try { t = String(it.contents || ""); } catch (eT) { t = ""; }
        t = cleanOneLine(t);
        if (t.length >= 6) return true;
      }
    } catch (eAll) {}
    return false;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("scan_trailing_empty_pages__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("scan_trailing_empty_pages__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var body = detectBodyStoryIndex(doc);
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("Pages: " + doc.pages.length);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("scan_trailing_empty_pages__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var bodyStory = doc.stories[body.index];
  var trailing = 0;
  var samples = [];

  for (var po = doc.pages.length - 1; po >= 0; po--) {
    var pg = doc.pages[po];
    if (!pg || !pg.isValid) continue;
    var bw = bodyWordsOnPage(pg, bodyStory);
    var hasG = pageHasAnyGraphics(pg);
    var hasOther = hasMeaningfulNonBodyText(pg, bodyStory);
    if (bw === 0 && !hasG && !hasOther) {
      trailing++;
      if (samples.length < 10) samples.push("pageOff=" + po + " page=" + String(pg.name));
      continue;
    }
    break; // stop at first non-empty from the end
  }

  out.push("Trailing empty pages: " + trailing);
  if (samples.length) out.push("Samples: " + samples.join(" | "));

  var report = out.join("\n");
  writeTextToDesktop("scan_trailing_empty_pages__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  if (trailing > 0) {
    throw new Error("scan-trailing-empty-pages.jsx HARD FAIL: trailing empty pages found=" + String(trailing));
  }
  report;
})();


