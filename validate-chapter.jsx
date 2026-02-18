// ============================================================
// VALIDATE: chapter output (generic, profile-driven)
// ============================================================
// Hard-fail validations for a chapter-only rewritten output:
// - Missing links/fonts
// - Overset frames
// - Bold marker residue (<<BOLD_START>> / <<BOLD_END>>)
// - Option A heading structure in BODY STORY ("In de praktijk:" / "Verdieping:")
// - Justification sanity (no FULLY_JUSTIFIED; body paragraphs LEFT_JUSTIFIED)
// - Soft hyphens (U+00AD) must be 0 in BODY STORY
// - Body frame structure matches template profile on body pages (best-effort)
//
// Inputs (app.scriptArgs):
// - BIC_BOOK_ID (optional): to load the correct template profile via books/manifest.json
//
// Output:
// - Writes report to Desktop/validate_chapter__<doc>__<timestamp>.txt
// - Throws on any hard failure.
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
  function ctorName(o) { try { return o && o.constructor && o.constructor.name ? String(o.constructor.name) : ""; } catch (e0) { return ""; } }
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
  function isListLikeStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
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

  function paraStartPageName(para) {
    try {
      var ip = para.insertionPoints[0];
      var tf = ip.parentTextFrames[0];
      if (tf && tf.parentPage) return String(tf.parentPage.name);
    } catch (e0) {}
    return "?";
  }
  function masterName(pg) {
    try { return pg && pg.isValid && pg.appliedMaster ? String(pg.appliedMaster.name) : ""; } catch (e0) { return ""; }
  }
  function pageSideKey(pg) {
    try { if (pg.side === PageSideOptions.LEFT_HAND) return "left"; } catch (e0) {}
    try { if (pg.side === PageSideOptions.RIGHT_HAND) return "right"; } catch (e1) {}
    return "unknown";
  }
  function approxEq(a, b, tol) { return Math.abs(a - b) <= tol; }

  function buildStyleSet(arr) {
    var set = {};
    if (!arr || !(arr instanceof Array)) return set;
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it) continue;
      var nm = "";
      try { nm = String(it.name || ""); } catch (e0) { nm = ""; }
      if (nm) set[nm] = 1;
    }
    return set;
  }

  function buildBodyMasterSet(profile, maxN) {
    var set = {};
    var n = maxN || 6;
    try {
      var arr = profile && profile.masters && profile.masters.bodyCandidates ? profile.masters.bodyCandidates : [];
      if (arr && arr instanceof Array) {
        for (var i = 0; i < Math.min(n, arr.length); i++) {
          var nm = String(arr[i].name || "");
          if (nm) set[nm] = 1;
        }
      }
    } catch (e0) {}
    return set;
  }

  function collectBodyFramesOnPage(pg, bodyStory) {
    var frames = [];
    if (!pg || !pg.isValid || !bodyStory) return frames;
    try {
      var items = pg.allPageItems;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.isValid) continue;
        if (ctorName(it) !== "TextFrame") continue;
        var st = null;
        try { st = it.parentStory; } catch (eS) { st = null; }
        if (st !== bodyStory) continue;
        frames.push(it);
      }
    } catch (eAll) {}
    // Sort left-to-right
    frames.sort(function (a, b) {
      try { return a.geometricBounds[1] - b.geometricBounds[1]; } catch (e) { return 0; }
    });
    return frames;
  }

  function looksLikeBodyPageForStory(pg, bodyStory) {
    // Only validate frame structure on pages that actually contain body story text,
    // otherwise we can false-fail on pages that have unrelated frames (captions, headers, etc.).
    try {
      var paras = bodyStory.paragraphs;
      var pc = 0;
      try { pc = paras.length; } catch (eP) { pc = 0; }
      for (var i = 0; i < pc; i++) {
        var para = paras[i];
        var tf = null;
        try { tf = para.insertionPoints[0].parentTextFrames[0]; } catch (e0) { tf = null; }
        if (!tf || !tf.isValid || !tf.parentPage || !tf.parentPage.isValid) continue;
        // Compare by documentOffset (safe across page renumbering).
        try {
          if (tf.parentPage.documentOffset === pg.documentOffset) return true;
        } catch (e1) {}
      }
    } catch (eTop) {}
    return false;
  }

  function signatureForFrames(frames) {
    function rb(b) { return [Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3])]; }
    var parts = [];
    for (var i = 0; i < frames.length; i++) {
      var b = null;
      try { b = frames[i].geometricBounds; } catch (eB) { b = null; }
      if (!b || b.length !== 4) continue;
      parts.push(rb(b).join(","));
    }
    return parts.join("|");
  }

  function approxEq(a, b, tol) { return Math.abs(a - b) <= tol; }

  function matchFrameByLocalXBounds(frames, pg, targetBounds, sideKey, rightShift, tol) {
    // Compare x1/x2 in PAGE-LOCAL coordinates:
    // - For normal right pages, geometricBounds are in spread coords (x ~ 195..390); subtract page.bounds[1] to get local x.
    // - For single-page right spreads (e.g. first page), page.bounds[1] is 0, so local x matches directly.
    // Expected bounds in the profile are stored in spread coords; for right side, subtract rightShift to convert to local x.
    for (var i = 0; i < frames.length; i++) {
      var tf = frames[i];
      var b = null;
      try { b = tf.geometricBounds; } catch (eB) { b = null; }
      if (!b || b.length !== 4) continue;
      var pb = null;
      try { pb = pg.bounds; } catch (ePB) { pb = null; }
      var pageLeft = (pb && pb.length === 4) ? pb[1] : 0;
      var localX1 = b[1] - pageLeft;
      var localX2 = b[3] - pageLeft;
      var shift = (sideKey === "right") ? (rightShift || 0) : 0;
      var expX1 = targetBounds[1] - shift;
      var expX2 = targetBounds[3] - shift;
      if (approxEq(localX1, expX1, tol) && approxEq(localX2, expX2, tol)) return tf;
    }
    return null;
  }

  function nextNonSpaceIndex(txt, idx) {
    if (idx < 0) return -1;
    for (var i = idx; i < txt.length; i++) {
      var ch = txt.charAt(i);
      if (ch === " " || ch === "\t") continue;
      return i;
    }
    return -1;
  }

  function isBoldChar(ch) {
    try {
      var fs = String(ch.fontStyle || "");
      return fs.toLowerCase().indexOf("bold") !== -1;
    } catch (e0) {}
    return false;
  }

  // ----------------------------
  // MAIN
  // ----------------------------
  var out = [];
  var hardFailures = [];

  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("validate_chapter__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    throw new Error("validate-chapter.jsx HARD FAIL: no documents open");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("validate_chapter__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    throw new Error("validate-chapter.jsx HARD FAIL: no document resolved");
  }

  var repoRoot = resolveRepoRoot();
  var manifestFile = repoRoot ? File(repoRoot.fsName + "/books/manifest.json") : null;
  var manifest = (manifestFile && manifestFile.exists) ? parseJsonLoose(readTextFile(manifestFile)) : null;
  var bookId = "";
  try { bookId = String(app.scriptArgs.getValue("BIC_BOOK_ID") || ""); } catch (eB0) { bookId = ""; }

  var profile = null;
  if (manifest && manifest.books && manifest.books instanceof Array && bookId) {
    var book = null;
    for (var bi = 0; bi < manifest.books.length; bi++) {
      var b = manifest.books[bi];
      if (!b) continue;
      if (String(b.book_id || "") === bookId) { book = b; break; }
    }
    if (book) {
      var pf = resolveRepoPath(repoRoot, String(book.template_profile_path || ""));
      if (pf && pf.exists) profile = parseJsonLoose(readTextFile(pf));
      out.push("Profile: " + (pf ? pf.fsName : "(null)"));
    }
  }

  // Build profile sets
  var bodyMasterSet = {};
  var headingStyleSet = {};
  try {
    if (profile) {
      bodyMasterSet = buildBodyMasterSet(profile, 6);
      var chSet = buildStyleSet(profile.paragraphStyleCandidates && profile.paragraphStyleCandidates.chapterHeader ? profile.paragraphStyleCandidates.chapterHeader : []);
      var numSet = buildStyleSet(profile.paragraphStyleCandidates && profile.paragraphStyleCandidates.numberedHeadings ? profile.paragraphStyleCandidates.numberedHeadings : []);
      // Merge for heading detection
      for (var k in chSet) { if (chSet.hasOwnProperty(k)) headingStyleSet[k] = 1; }
      for (var k2 in numSet) { if (numSet.hasOwnProperty(k2)) headingStyleSet[k2] = 1; }
    }
  } catch (eS) {}

  out.unshift("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.splice(1, 0, "PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.splice(2, 0, "Repo: " + (repoRoot ? repoRoot.fsName : "(unknown)"));
  out.splice(3, 0, "Manifest: " + (manifestFile ? manifestFile.fsName : "(none)"));
  out.splice(4, 0, "book_id=" + (bookId ? bookId : "(none)"));
  out.splice(5, 0, "Pages: " + doc.pages.length);
  out.splice(6, 0, "");

  // Links/fonts hard checks
  var missingLinks = 0, outOfDateLinks = 0;
  try {
    for (var li = 0; li < doc.links.length; li++) {
      var link = doc.links[li];
      try {
        if (link.status === LinkStatus.LINK_MISSING) missingLinks++;
        else if (link.status === LinkStatus.LINK_OUT_OF_DATE) outOfDateLinks++;
      } catch (eL) {}
    }
  } catch (eLinks) {}
  var missingFonts = 0;
  try {
    for (var fi = 0; fi < doc.fonts.length; fi++) {
      try {
        if (doc.fonts[fi].status === FontStatus.NOT_AVAILABLE) missingFonts++;
      } catch (eF) {}
    }
  } catch (eFonts) {}
  out.push("[LINKS] missing=" + missingLinks + " outOfDate=" + outOfDateLinks);
  out.push("[FONTS] missing=" + missingFonts);
  if (missingLinks > 0) hardFailures.push("Missing links=" + missingLinks);
  if (outOfDateLinks > 0) hardFailures.push("Out-of-date links=" + outOfDateLinks);
  if (missingFonts > 0) hardFailures.push("Missing fonts=" + missingFonts);

  // Overset hard check
  var oversetFrames = 0;
  var oversetSamples = [];
  try {
    for (var tfi = 0; tfi < doc.textFrames.length; tfi++) {
      var tf = doc.textFrames[tfi];
      var ov = false;
      try { ov = !!tf.overflows; } catch (eO0) { ov = false; }
      if (!ov) continue;
      oversetFrames++;
      if (oversetSamples.length < 10) {
        var pgName = "unknown";
        try { if (tf.parentPage) pgName = String(tf.parentPage.name); } catch (eP) {}
        oversetSamples.push(pgName);
      }
    }
  } catch (eOv) {}
  out.push("[OVERSET FRAMES] " + oversetFrames + (oversetSamples.length ? (" samplePages=" + oversetSamples.join(",")) : ""));
  if (oversetFrames > 0) hardFailures.push("Overset frames=" + oversetFrames);

  // Bold marker residue (should never be present in output)
  var boldResidue = 0;
  try {
    resetFind();
    app.findGrepPreferences.findWhat = "<<BOLD_START>>";
    boldResidue += doc.findGrep().length;
    resetFind();
    app.findGrepPreferences.findWhat = "<<BOLD_END>>";
    boldResidue += doc.findGrep().length;
  } catch (eBR) { resetFind(); }
  out.push("[BOLD MARKER RESIDUE] " + boldResidue);
  if (boldResidue > 0) hardFailures.push("Bold marker residue=" + boldResidue);

  // Body story selection
  var body = detectBodyStoryIndex(doc);
  out.push("");
  out.push("BODY STORY: index=" + body.index + " words=" + body.words);
  if (body.index < 0) hardFailures.push("No body story detected");
  var bodyStory = (body.index >= 0) ? doc.stories[body.index] : null;

  // Body story checks
  var softHyphens = 0;
  var fullyJustified = 0;
  var wrongBodyJust = 0;
  var headingStructureErrors = 0;
  var headingSamples = [];
  var frameStructureErrors = 0;
  var frameSamples = [];

  // Frame structure vs profile (best-effort)
  if (profile && bodyStory) {
    // Compute a spread-to-page shift for the right side based on the template profile.
    // This allows us to compare frames in local page coords even when a right-hand page is a single-page spread.
    var rightShift = 0;
    try {
      var lx = 0;
      var rx = 0;
      if (profile.bodyFrames && profile.bodyFrames.left && profile.bodyFrames.left.frames && profile.bodyFrames.left.frames.length) {
        lx = profile.bodyFrames.left.frames[0].bounds[1];
      }
      if (profile.bodyFrames && profile.bodyFrames.right && profile.bodyFrames.right.frames && profile.bodyFrames.right.frames.length) {
        rx = profile.bodyFrames.right.frames[0].bounds[1];
      }
      rightShift = Math.round(rx - lx);
    } catch (eRS) { rightShift = 0; }

    for (var po = 0; po < doc.pages.length; po++) {
      var pg = doc.pages[po];
      if (!pg || !pg.isValid) continue;
      var mNm = masterName(pg);
      if (bodyMasterSet && !bodyMasterSet.hasOwnProperty(mNm)) continue;
      // Only enforce structure on pages that actually host body-story text.
      if (!looksLikeBodyPageForStory(pg, bodyStory)) continue;
      var frames = collectBodyFramesOnPage(pg, bodyStory);
      if (!frames || frames.length === 0) continue;
      var side = pageSideKey(pg);
      var expected = null;
      try { expected = (profile.bodyFrames && profile.bodyFrames[side] && profile.bodyFrames[side].frames) ? profile.bodyFrames[side].frames : null; } catch (eEx) { expected = null; }
      if (!expected || !(expected instanceof Array) || expected.length === 0) continue;

      var tol = 3;
      var missing = 0;
      for (var ei = 0; ei < expected.length; ei++) {
        var ex = expected[ei];
        if (!ex || !ex.bounds || ex.bounds.length !== 4) continue;
        var hit = matchFrameByLocalXBounds(frames, pg, ex.bounds, side, rightShift, tol);
        if (!hit) missing++;
      }
      if (missing > 0) {
        frameStructureErrors += missing;
        if (frameSamples.length < 10) {
          frameSamples.push(
            "page=" + String(pg.name) +
              " master=" + mNm +
              " side=" + side +
              " missing=" + missing + "/" + expected.length +
              " sig=" + signatureForFrames(frames)
          );
        }
      }
    }
  }

  if (frameStructureErrors > 0) {
    out.push("[BODY FRAME STRUCTURE] errors=" + frameStructureErrors);
    if (frameSamples.length) out.push("  samples=" + frameSamples.join(" | "));
    hardFailures.push("Body frame structure mismatches=" + frameStructureErrors);
  } else {
    out.push("[BODY FRAME STRUCTURE] OK (or profile not loaded)");
  }

  var wrongJustSamples = [];
  if (bodyStory) {
    var pc = 0;
    try { pc = bodyStory.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = bodyStory.paragraphs[p];
      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);
      // Skip whitespace-only paragraphs (these can be template artifacts and should not fail justification).
      if (!cleanOneLine(txt)) continue;

      // Soft hyphens
      try { softHyphens += (txt.match(/\u00AD/g) || []).length; } catch (eSH) {}

      // Justification checks (skip headings and list-like styles)
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
      var sn = String(styleName || "").toLowerCase();
      var looksHeadingLike = false;
      try { looksHeadingLike = (sn.indexOf("kop") !== -1 || sn.indexOf("header") !== -1 || sn.indexOf("titel") !== -1 || sn.indexOf("title") !== -1); } catch (eHL) { looksHeadingLike = false; }
      if (!looksHeadingLike) {
        try { looksHeadingLike = /^\d+(?:\.\d+)*\b/.test(cleanOneLine(txt)) && cleanOneLine(txt).length <= 90; } catch (eNH) { looksHeadingLike = looksHeadingLike; }
      }
      var listLike = isListLikeStyleName(styleName);
      var hasLabel = (txt.indexOf("In de praktijk:") !== -1) || (txt.indexOf("Verdieping:") !== -1);

      try {
        if (para.justification === Justification.FULLY_JUSTIFIED) fullyJustified++;
        if (!looksHeadingLike && !listLike) {
          if (para.justification !== Justification.LEFT_JUSTIFIED) {
            wrongBodyJust++;
            if (wrongJustSamples.length < 10) {
              var pgName = "?";
              try { pgName = paraStartPageName(para); } catch (ePG) { pgName = "?"; }
              wrongJustSamples.push(
                "page=" + pgName +
                  " style=" + styleName +
                  " :: " + cleanOneLine(txt).substring(0, 160)
              );
            }
          }
        }
        if (hasLabel && para.justification !== Justification.LEFT_JUSTIFIED) wrongBodyJust++;
      } catch (eJ) {}

      // Heading structure checks (Option A)
      // Detect Option B standalone line
      try {
        var trimmed = txt.replace(/^\s+|\s+$/g, "");
        if ((/^In de praktijk$/i).test(trimmed) || (/^Verdieping$/i).test(trimmed)) {
          headingStructureErrors++;
          if (headingSamples.length < 10) headingSamples.push("Option B heading standalone :: " + cleanOneLine(txt).substring(0, 160));
        }
      } catch (eOB) {}

      // Validate each label occurrence within paragraph
      var labels = ["In de praktijk:", "Verdieping:"];
      for (var li = 0; li < labels.length; li++) {
        var label = labels[li];
        var idx = txt.indexOf(label);
        while (idx !== -1) {
          // 1) Must be preceded by \n\n
          var hasBlankLine = (idx >= 2 && txt.charAt(idx - 1) === "\n" && txt.charAt(idx - 2) === "\n");
          if (!hasBlankLine) {
            headingStructureErrors++;
            if (headingSamples.length < 10) headingSamples.push(label + " missing blank line :: " + cleanOneLine(txt).substring(0, 170));
          } else {
            // Disallow >2 newlines before label
            if (idx >= 3 && txt.charAt(idx - 3) === "\n") {
              headingStructureErrors++;
              if (headingSamples.length < 10) headingSamples.push(label + " has extra blank line :: " + cleanOneLine(txt).substring(0, 170));
            }
          }

          // 2) Label must be bold
          var labelBoldOk = true;
          try {
            for (var k = 0; k < label.length; k++) {
              var cIdx = idx + k;
              if (cIdx < 0 || cIdx >= para.characters.length) { labelBoldOk = false; break; }
              if (!isBoldChar(para.characters[cIdx])) { labelBoldOk = false; break; }
            }
          } catch (eB) { labelBoldOk = false; }
          if (!labelBoldOk) {
            headingStructureErrors++;
            if (headingSamples.length < 10) headingSamples.push(label + " NOT bold :: " + cleanOneLine(txt).substring(0, 170));
          }

          // 3) Inline text after label on same line, and not bold
          var afterIdx = idx + label.length;
          var nn = nextNonSpaceIndex(txt, afterIdx);
          if (nn < 0) {
            headingStructureErrors++;
            if (headingSamples.length < 10) headingSamples.push(label + " missing inline text :: " + cleanOneLine(txt).substring(0, 170));
          } else {
            if (txt.charAt(nn) === "\n") {
              headingStructureErrors++;
              if (headingSamples.length < 10) headingSamples.push(label + " starts new line after label :: " + cleanOneLine(txt).substring(0, 170));
            } else {
              var afterBold = false;
              try { afterBold = isBoldChar(para.characters[nn]); } catch (eAB) { afterBold = false; }
              if (afterBold) {
                headingStructureErrors++;
                if (headingSamples.length < 10) headingSamples.push(label + " text after label is bold :: " + cleanOneLine(txt).substring(0, 170));
              }
            }
          }

          idx = txt.indexOf(label, idx + label.length);
        }
      }
    }
  }

  out.push("");
  out.push("[SOFT HYPHENS U+00AD] " + softHyphens);
  out.push("[JUSTIFICATION] fully_justified=" + fullyJustified + " wrong_body_justification=" + wrongBodyJust);
  if (wrongJustSamples.length) out.push("  wrong_body_samples=" + wrongJustSamples.join(" | "));
  out.push("[HEADINGS OptionA] errors=" + headingStructureErrors);
  if (headingSamples.length) out.push("  samples=" + headingSamples.join(" | "));

  if (softHyphens > 0) hardFailures.push("Soft hyphens (U+00AD)=" + softHyphens);
  if (fullyJustified > 0) hardFailures.push("FULLY_JUSTIFIED paragraphs=" + fullyJustified);
  if (wrongBodyJust > 0) hardFailures.push("Wrong body justification=" + wrongBodyJust);
  if (headingStructureErrors > 0) hardFailures.push("Option A heading structure errors=" + headingStructureErrors);

  out.push("");
  out.push("HARD FAILURES: " + hardFailures.length);
  if (hardFailures.length) out.push(" - " + hardFailures.join("\n - "));

  var report = out.join("\n");
  writeTextToDesktop("validate_chapter__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);

  if (hardFailures.length) {
    throw new Error("validate-chapter.jsx HARD FAIL: " + hardFailures.join(" | "));
  }

  report;

  // --- helper: resetFind for bold marker residue ---
  function resetFind() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e1) {}
  }
})();


