// ============================================================
// FIX: remove overset text frames on pasteboard / non-page spreads
// ============================================================
// Why:
// - When we isolate a chapter by deleting pages, InDesign can leave behind
//   text frames on spread pasteboards (parent is Spread, parentPage is null).
// - These often contain TOC/Index text from other parts of the book and can be overset.
// - validate-chapter.jsx hard-fails on ANY overset frames, so we must remove these artifacts.
//
// What this does:
// - Finds ALL overset text frames (tf.overflows == true)
// - If the frame is NOT on a page (no parentPage) AND its story is NOT the body story
//   (largest story by words), we remove the frame.
//
// Safe:
// - Operates only on the active document (intended: newest rewritten chapter output).
// - Never touches the baseline source INDD.
// ============================================================

#targetengine "session"

(function () {
  function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }

  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "_");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (!s) s = "doc";
    return s;
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

  function storyIndexOf(doc, st) {
    try { for (var i = 0; i < doc.stories.length; i++) { if (doc.stories[i] === st) return i; } } catch (e) {}
    return -1;
  }

  function detectBodyStoryIndex(doc) {
    var best = -1;
    var bestWords = -1;
    try {
      for (var s = 0; s < doc.stories.length; s++) {
        var wc = 0;
        try { wc = doc.stories[s].words.length; } catch (eW) { wc = 0; }
        if (wc > bestWords) { bestWords = wc; best = s; }
      }
    } catch (e0) {}
    return { index: best, words: bestWords };
  }

  function hasParentPage(tf) {
    try { return !!(tf && tf.parentPage && tf.parentPage.isValid); } catch (e0) { return false; }
  }

  function isPasteboardOrSpreadFrame(tf) {
    // If there's no parentPage, it's not on a page. Often it's on a Spread pasteboard.
    if (hasParentPage(tf)) return false;
    var p = null;
    try { p = tf.parent; } catch (e0) { p = null; }
    var cn = ctorName(p);
    return cn === "Spread" || cn === "MasterSpread" || cn === "SpreadPage" || cn === "Page" || !!p;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("fix_overset_pasteboard__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("fix_overset_pasteboard__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var body = detectBodyStoryIndex(doc);
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  // Force recomposition so tf.overflows is fresh
  try { if (doc.recompose) doc.recompose(); } catch (eR0) {}

  var removed = 0;
  var kept = 0;
  var samples = [];
  var passes = 0;

  // Overset status can "move" to a sibling pasteboard frame after removing another frame in the same story.
  // So we iterate until no more removable overset pasteboard frames remain.
  var maxPasses = 12;
  while (passes < maxPasses) {
    passes++;
    var removedThisPass = 0;

    // Refresh overset flags
    try { if (doc.recompose) doc.recompose(); } catch (eRX) {}

    // Iterate backwards: safer when removing page items.
    for (var i = doc.textFrames.length - 1; i >= 0; i--) {
      var tf = doc.textFrames[i];
      if (!tf || !tf.isValid) continue;

      var ov = false;
      try { ov = !!tf.overflows; } catch (eO) { ov = false; }
      if (!ov) continue;

      var st = null;
      try { st = tf.parentStory; } catch (eS) { st = null; }
      var si = storyIndexOf(doc, st);

      // Only remove overset frames that are NOT on a page and NOT the body story.
      if (si !== body.index && isPasteboardOrSpreadFrame(tf)) {
        var gb = "";
        try { gb = String(tf.geometricBounds); } catch (eB) { gb = ""; }
        if (samples.length < 12) samples.push("removed(pass=" + passes + ") tfIdx=" + i + " storyIndex=" + si + " gb=" + gb);
        try { tf.remove(); removed++; removedThisPass++; } catch (eRm) {}
        continue;
      }

      kept++;
    }

    if (removedThisPass === 0) break;
  }

  try { if (doc.recompose) doc.recompose(); } catch (eR1) {}

  out.push("Removed overset pasteboard/spread frames: " + removed);
  out.push("Kept overset frames (on pages or body story): " + kept);
  out.push("Passes: " + passes);
  if (samples.length) out.push("Samples: " + samples.join(" | "));

  var report = out.join("\n");
  writeTextToDesktop("fix_overset_pasteboard__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();


