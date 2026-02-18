// ============================================================
// SCAN: nested bullets (fail if found)
// ============================================================
// Hard gate for 2-column N3 readability:
// - No nested bullet styles ("lvl"/"level") in the main body story.
//
// Scope:
// - Intended to run on chapter-only output docs.
// - Uses the largest story as BODY STORY and scans across it.
//
// Safe: read-only.
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
  function cleanOneLine(s) {
    return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function trimParaText(txt) {
    var t = "";
    try { t = String(txt || ""); } catch (e0) { t = ""; }
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return t;
  }
  function isNestedBulletStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return (s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1) && (s.indexOf("lvl") !== -1 || s.indexOf("level") !== -1);
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("scan_nested_bullets__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    throw new Error("scan-nested-bullets.jsx: no documents open");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) throw new Error("scan-nested-bullets.jsx: could not resolve a document");

  var chapterFilter = "";
  try { chapterFilter = String(app.scriptArgs.getValue("BIC_CHAPTER_FILTER") || ""); } catch (eCF) { chapterFilter = ""; }

  var body = detectBodyStoryIndex(doc);
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("chapter_filter=" + (chapterFilter ? chapterFilter : "(none)"));
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) throw new Error("scan-nested-bullets.jsx: could not detect body story");

  var story = null;
  try { story = doc.stories[body.index]; } catch (eS) { story = null; }
  if (!story) throw new Error("scan-nested-bullets.jsx: could not access body story");

  var hits = [];
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var i = 0; i < pc; i++) {
    var para = story.paragraphs[i];
    var styleName = "";
    try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
    if (!styleName) continue;
    if (!isNestedBulletStyleName(styleName)) continue;
    var txt = "";
    try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
    txt = trimParaText(txt);
    hits.push({ idx: i, style: styleName, snippet: cleanOneLine(txt).substring(0, 120) });
  }

  out.push("Nested bullet paragraphs found: " + hits.length);
  for (var j = 0; j < Math.min(20, hits.length); j++) {
    out.push(" - idx=" + hits[j].idx + " style=" + hits[j].style + " :: " + hits[j].snippet);
  }

  var report = out.join("\n");
  writeTextToDesktop("scan_nested_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);

  if (hits.length > 0) throw new Error("Nested bullet styles found in body story (" + hits.length + ").");
  report;
})();
































