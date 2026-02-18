// ============================================================
// VALIDATE: chapter header layout/style (generic, profile-driven)
// ============================================================
// Checks that the chapter title paragraph(s) use an expected paragraph style from the template profile.
// This catches “chapter names sometimes with wrong layout”.
//
// Inputs (app.scriptArgs):
// - BIC_BOOK_ID (optional): used to locate profile via books/manifest.json
// - BIC_CHAPTER_FILTER (optional): expected chapter number; default attempts to infer from doc name
//
// Output:
// - Writes report to Desktop/validate_chapter_headers__<doc>__<timestamp>.txt
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
  function readTextFile(f) {
    if (!f || !f.exists) return "";
    var txt = "";
    try {
      f.encoding = "UTF-8";
      if (f.open("r")) { txt = String(f.read() || ""); f.close(); }
    } catch (e) { try { f.close(); } catch (e2) {} }
    return txt;
  }
  function parseJsonLoose(txt) {
    var t = String(txt || "");
    if (!t) return null;
    try { return eval("(" + t + ")"); } catch (e) { return null; }
  }
  function resolveRepoRoot() {
    try { return File($.fileName).parent; } catch (e) { return null; }
  }
  function resolveRepoPath(repoRoot, pth) {
    var p = "";
    try { p = String(pth || ""); } catch (e0) { p = ""; }
    if (!p) return null;
    if (p.indexOf("/") === 0) return File(p);
    if (p.indexOf("./") === 0) p = p.substring(2);
    if (!repoRoot) return File(p);
    return File(repoRoot.fsName + "/" + p);
  }
  function cleanOneLine(s) {
    return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function paraStartPageName(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return String(tf.parentPage.name); } catch (e0) {}
    return "?";
  }
  function paraStartMasterName(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage && tf.parentPage.appliedMaster) return String(tf.parentPage.appliedMaster.name); } catch (e0) {}
    return "";
  }
  function isChapterHeaderStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("chapter header") !== -1 || s.indexOf("hoofdstuk") !== -1 || s.indexOf("chapter") !== -1;
  }

  function isLikelyChapterOpenerStyleName(styleName) {
    // We only want to validate the OPENER header styles (chapter number/title),
    // not section headings or numbered lists in the body.
    var s = String(styleName || "").toLowerCase();
    if (!s) return false;
    if (s.indexOf("hoofdstuk") !== -1) return true;
    if (s.indexOf("chapter") !== -1) return true;
    if (s.indexOf("chapter header") !== -1) return true;
    return false;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("validate_chapter_headers__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("validate_chapter_headers__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var repoRoot = resolveRepoRoot();
  var manifestFile = repoRoot ? File(repoRoot.fsName + "/books/manifest.json") : null;
  var manifest = (manifestFile && manifestFile.exists) ? parseJsonLoose(readTextFile(manifestFile)) : null;

  var bookId = "";
  try { bookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eB0) { bookId = ""; }

  var chStr = "";
  try { chStr = String(app.scriptArgs.getValue("BIC_CHAPTER_FILTER") || ""); } catch (eC0) { chStr = ""; }
  var chapterNum = parseInt(chStr, 10);
  if (!(chapterNum > 0)) {
    // Attempt inference from doc name: "__CH<N>_"
    var m = null;
    try { m = String(doc.name || "").match(/__CH(\d+)_/i); } catch (eM) { m = null; }
    if (m && m.length >= 2) chapterNum = parseInt(m[1], 10);
  }

  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("Repo: " + (repoRoot ? repoRoot.fsName : "(unknown)"));
  out.push("Manifest: " + (manifestFile ? manifestFile.fsName : "(none)"));
  out.push("book_id=" + (bookId ? bookId : "(none)"));
  out.push("chapter=" + (chapterNum > 0 ? String(chapterNum) : "(unknown)"));
  out.push("");

  // Resolve profile
  var profile = null;
  if (manifest && manifest.books && manifest.books instanceof Array && bookId) {
    var book = null;
    for (var i = 0; i < manifest.books.length; i++) {
      var b = manifest.books[i];
      if (!b) continue;
      if (String(b.book_id || "") === bookId) { book = b; break; }
    }
    if (book) {
      var pf = resolveRepoPath(repoRoot, String(book.template_profile_path || ""));
      if (pf && pf.exists) profile = parseJsonLoose(readTextFile(pf));
      out.push("Profile: " + (pf ? pf.fsName : "(null)"));
    }
  }
  if (!profile) out.push("Profile: (not loaded; style checks will use keyword heuristics only)");
  out.push("");

  // Build expected chapter OPENER style set from profile, if present.
  // Prefer profile.paragraphStyles.chapterHeaders if available; fall back to paragraphStyleCandidates.chapterHeader.
  var expected = {};
  try {
    var arr = null;
    if (profile && profile.paragraphStyles && profile.paragraphStyles.chapterHeaders) arr = profile.paragraphStyles.chapterHeaders;
    else if (profile && profile.paragraphStyleCandidates && profile.paragraphStyleCandidates.chapterHeader) arr = profile.paragraphStyleCandidates.chapterHeader;
    if (arr && arr instanceof Array) {
      for (var j = 0; j < arr.length; j++) {
        var it = arr[j];
        var nm = "";
        try {
          // Support both shapes:
          // - string array: ["•Hoofdstukkop", ...]
          // - object array: [{ name: "...", count: N }, ...]
          nm = (typeof it === "string") ? String(it) : String(it && it.name ? it.name : "");
        } catch (eNm) { nm = ""; }
        if (!nm) continue;
        // Keep opener-relevant styles only (avoid subchapter/section styles).
        if (isLikelyChapterOpenerStyleName(nm)) expected[nm] = 1;
      }
    }
  } catch (eS) {}

  // We validate opener header layout by finding "Hoofdstuk/Chapter" style paragraphs
  // on the first pages of the chapter (where the opener lives). We do NOT treat numbered
  // list items ("1 ...", "2 ...") as candidates.
  var openerPagesMax = 3;
  var hits = 0;
  var expectedHits = 0;
  var samples = [];
  var expectedSamples = [];

  function pageOffsetOfPara(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
    return -1;
  }

  // Scan all stories: opener header is often on a separate header story.
  for (var s = 0; s < doc.stories.length; s++) {
    var story = doc.stories[s];
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = pageOffsetOfPara(para);
      if (off < 0 || off >= openerPagesMax) continue;

      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
      if (!isLikelyChapterOpenerStyleName(styleName)) continue;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      var one = cleanOneLine(txt);
      if (!one) continue;

      hits++;
      if (samples.length < 12) {
        samples.push(
          "page=" + paraStartPageName(para) +
            " master=" + paraStartMasterName(para) +
            " style=" + styleName +
            " :: " + one.substring(0, 160)
        );
      }

      var styleExpected = false;
      if (expected && styleName && expected.hasOwnProperty(styleName)) styleExpected = true;
      // If profile isn't present, accept any "Hoofdstuk" style as expected.
      // NOTE: ExtendScript doesn't support Object.keys reliably across versions.
      var hasExpectedAny = false;
      try { for (var ek in expected) { if (expected.hasOwnProperty(ek)) { hasExpectedAny = true; break; } } } catch (eK) { hasExpectedAny = false; }
      if (!styleExpected && (!profile || !hasExpectedAny)) styleExpected = true;

      if (styleExpected) {
        expectedHits++;
        if (expectedSamples.length < 12) expectedSamples.push("style=" + styleName + " :: " + one.substring(0, 160));
      }
    }
  }

  out.push("Opener header candidates (first " + openerPagesMax + " pages): " + hits);
  out.push("Expected opener styles matched: " + expectedHits);
  if (samples.length) out.push("Samples: " + samples.join(" | "));
  if (expectedSamples.length) out.push("Expected samples: " + expectedSamples.join(" | "));

  if (hits === 0) out.push("ERROR: no opener header candidates found (no Hoofdstuk/Chapter styles on opener pages)");
  if (hits > 0 && expectedHits === 0) out.push("ERROR: opener header styles found, but none match the expected set from the profile");

  var report = out.join("\n");
  writeTextToDesktop("validate_chapter_headers__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  if (hits === 0 || expectedHits === 0) {
    throw new Error("validate-chapter-headers.jsx HARD FAIL: opener_hits=" + String(hits) + " expected_hits=" + String(expectedHits));
  }
  report;
})();


