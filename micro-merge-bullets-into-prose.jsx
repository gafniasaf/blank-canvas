// ============================================================
// MICRO-MERGE: short bullet runs into running text (chapter-only output)
// ============================================================
// Goal:
// - Reduce “lijstjesstress” by converting micro lists (2–4 short bullet items)
//   into a single running-text continuation in the preceding list-intro paragraph.
//
// Example:
//   "De functies van je huid zijn:" + bullets ["beschermen", "warmte regelen", ...]
//   => "De functies van je huid zijn: beschermen, warmte regelen en ... ."
//
// Safety:
// - Only merges when:
//   - preceding paragraph ends with ":" (list-intro)
//   - bullet items are short phrases (no multi-sentence/explanatory bullets)
//   - no anchored objects in involved paragraphs (skip if U+FFFC present)
// - Deletes only the bullet paragraphs in the run after merging.
// - Does NOT save.
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
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return t;
  }

  function cleanOneLine(s) {
    return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function countWords(text) {
    // Count hyphen/slash joined tokens as one word.
    try { return (String(text || "").match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-/][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g) || []).length; } catch (e) { return 0; }
  }

  function sentenceCount(text) {
    var t = cleanOneLine(text);
    if (!t) return 0;
    var m = t.match(/[.!?]+/g);
    return m ? m.length : 0;
  }

  function isBulletLikeStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
  }

  function isHeadingLikeStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("header") !== -1 || s.indexOf("kop") !== -1 || s.indexOf("title") !== -1 || s.indexOf("titel") !== -1 || s.indexOf("hoofdstuk") !== -1 || s.indexOf("subparagraaf") !== -1;
  }

  function looksLikeListIntro(text) {
    var t = String(text || "").replace(/\s+$/g, "");
    if (!t) return false;
    try {
      if (t.length && t.charAt(t.length - 1) === ":") return true;
      if (/\bzoals\s*:\s*$/i.test(t)) return true;
      if (/\bnamelijk\s*:\s*$/i.test(t)) return true;
    } catch (e) {}
    return false;
  }

  function endsWithSentencePunct(text) {
    return /[.!?]$/.test(String(text || "").replace(/\s+$/g, ""));
  }

  function stripTrailingItemPunct(text) {
    var t = String(text || "").replace(/^\s+|\s+$/g, "");
    // Remove a trailing ";" or "." or "," (common list punctuation) but keep ")" etc.
    t = t.replace(/[;.,]\s*$/g, "");
    return t.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function joinItemsDutch(items) {
    var xs = items || [];
    if (!xs.length) return "";
    if (xs.length === 1) return xs[0];
    if (xs.length === 2) return xs[0] + " en " + xs[1];
    var out = "";
    for (var i = 0; i < xs.length; i++) {
      if (i === 0) out += xs[i];
      else if (i === xs.length - 1) out += " en " + xs[i];
      else out += ", " + xs[i];
    }
    return out;
  }

  function hasAnchoredObjectChar(para) {
    try {
      var c = String(para.contents || "");
      if (c.indexOf("\uFFFC") !== -1) return true;
    } catch (e0) {}
    try {
      var chars = para.characters;
      var n = 0;
      try { n = chars.length; } catch (e1) { n = 0; }
      // Cap scan for safety on very long paragraphs
      var lim = n;
      if (lim > 2000) lim = 2000;
      for (var i = 0; i < lim; i++) {
        try { if (chars[i].contents === "\uFFFC") return true; } catch (e2) {}
      }
    } catch (e3) {}
    return false;
  }

  function isMicroBulletItem(text) {
    var t = cleanOneLine(text);
    if (!t) return false;
    // Avoid merging explanatory bullets (too long / multi sentence / contains ":" as sub-structure)
    var wc = countWords(t);
    var sc = sentenceCount(t);
    if (sc >= 2) return false;
    if (t.indexOf(":") !== -1) return false;
    if (wc <= 0) return false;
    // “micro” heuristic: short phrases only
    if (wc > 8) return false;
    return true;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("micro_merge_bullets__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("micro_merge_bullets__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var body = detectBodyStoryIndex(doc);
  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("micro_merge_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var story = null;
  try { story = doc.stories[body.index]; } catch (eS) { story = null; }
  if (!story) {
    out.push("ERROR: could not access body story");
    writeTextToDesktop("micro_merge_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }

  var mergedRuns = 0;
  var deletedParas = 0;
  var skippedAnchors = 0;
  var skippedNotMicro = 0;
  var samples = [];

  var i = 0;
  while (i < pc) {
    var p = story.paragraphs[i];
    var sn = "";
    try { sn = String(p.appliedParagraphStyle ? p.appliedParagraphStyle.name : ""); } catch (eSN) { sn = ""; }
    if (!sn || !isBulletLikeStyleName(sn)) { i++; continue; }

    // Determine bullet run [i..j]
    var start = i;
    var end = i;
    while (end < pc) {
      var pE = story.paragraphs[end];
      var sE = "";
      try { sE = String(pE.appliedParagraphStyle ? pE.appliedParagraphStyle.name : ""); } catch (eSE) { sE = ""; }
      if (!sE || !isBulletLikeStyleName(sE)) break;
      end++;
    }
    var runLen = end - start;

    // Only micro runs (2–4 items)
    if (runLen < 2 || runLen > 4) { i = end; continue; }
    if (start - 1 < 0) { i = end; continue; }

    var prev = story.paragraphs[start - 1];
    var prevStyle = "";
    try { prevStyle = String(prev.appliedParagraphStyle ? prev.appliedParagraphStyle.name : ""); } catch (ePS) { prevStyle = ""; }
    if (!prevStyle || isBulletLikeStyleName(prevStyle) || isHeadingLikeStyleName(prevStyle)) { i = end; continue; }

    var prevRaw = "";
    try { prevRaw = String(prev.contents || ""); } catch (ePrev0) { prevRaw = ""; }
    var prevTrim = trimParaText(prevRaw);
    if (!looksLikeListIntro(prevTrim)) { i = end; continue; }

    // Anchor safety: skip if any involved paragraph has anchors
    if (hasAnchoredObjectChar(prev)) { skippedAnchors++; i = end; continue; }
    var items = [];
    var bad = false;
    for (var k = start; k < end; k++) {
      var bp = story.paragraphs[k];
      if (hasAnchoredObjectChar(bp)) { bad = true; break; }
      var bRaw = "";
      try { bRaw = String(bp.contents || ""); } catch (eB0) { bRaw = ""; }
      var bTrim = stripTrailingItemPunct(trimParaText(bRaw));
      if (!bTrim) { bad = true; break; }
      if (!isMicroBulletItem(bTrim)) { bad = true; break; }
      items.push(bTrim);
    }
    if (bad || items.length !== runLen) { skippedNotMicro++; i = end; continue; }

    var joined = joinItemsDutch(items);
    if (!joined) { i = end; continue; }

    var newPrev = prevTrim;
    // Ensure exactly one space after ":" (keep colon; it becomes an inline micro-opsomming)
    newPrev = newPrev.replace(/:\s*$/g, ":");
    newPrev = newPrev + " " + joined;
    if (!endsWithSentencePunct(newPrev)) newPrev = newPrev + ".";

    // Preserve trailing paragraph return if it existed
    var hadCR = false;
    try { hadCR = (prevRaw.length && prevRaw.charAt(prevRaw.length - 1) === "\r"); } catch (eCR) { hadCR = false; }
    try {
      prev.contents = newPrev + (hadCR ? "\r" : "");
    } catch (eSet) {
      i = end;
      continue;
    }

    // Delete bullet paragraphs in the run (from end to start for stable indices)
    for (var d = end - 1; d >= start; d--) {
      try { story.paragraphs[d].remove(); deletedParas++; } catch (eDel) {}
    }
    mergedRuns++;
    if (samples.length < 10) samples.push("merge idx=" + (start - 1) + " + (" + runLen + " bullets) :: " + cleanOneLine(newPrev).substring(0, 110));

    // After deletion, story length changed
    try { pc = story.paragraphs.length; } catch (eP2) { pc = pc - runLen; }
    // Continue scanning from the paragraph after the merged intro
    i = start; // former start now points to next paragraph
  }

  out.push("micro_merge_runs: " + mergedRuns);
  out.push("deleted_bullet_paragraphs: " + deletedParas);
  out.push("skipped_due_to_anchors: " + skippedAnchors);
  out.push("skipped_not_micro_or_not_intro: " + skippedNotMicro);
  if (samples.length) out.push("Samples:\n- " + samples.join("\n- "));

  var report = out.join("\n");
  writeTextToDesktop("micro_merge_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();
































