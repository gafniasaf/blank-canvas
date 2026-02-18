// ============================================================
// NORMALIZE: bullets for 2-column readability (chapter-only output)
// ============================================================
// Goals (based on editorial guidance for MBO-V / N3 in 2 columns):
// - Remove nested bullet levels in main text by flattening to the primary bullet style
// - Convert "explanatory bullets" (long, multi-sentence) into normal body paragraphs
//   so core explanation reads as running text (bullets remain for true lists only).
//
// Scope:
// - Intended to run on chapter-only output docs.
// - Uses the largest story as BODY STORY and operates across it.
//
// Inputs (app.scriptArgs):
// - BIC_CHAPTER_FILTER (optional): logging only.
//
// Safe:
// - Changes paragraph styles only; does NOT save.
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

  function countWords(text) {
    try { return (String(text || "").match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+/g) || []).length; } catch (e) { return 0; }
  }

  function sentenceCount(text) {
    var t = cleanOneLine(text);
    if (!t) return 0;
    // Conservative: count sentence-ending punctuation occurrences.
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

  function isNestedBulletStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    // Heuristic: most templates name nested bullets with lvl/level.
    return (s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1) && (s.indexOf("lvl") !== -1 || s.indexOf("level") !== -1);
  }

  function mostCommonKey(counts) {
    var bestK = "";
    var bestV = -1;
    for (var k in counts) {
      if (!counts.hasOwnProperty(k)) continue;
      var v = counts[k] || 0;
      if (v > bestV) { bestV = v; bestK = k; }
    }
    return bestK;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("normalize_bullets__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("normalize_bullets__no_doc__" + isoStamp() + ".txt", out.join("\n"));
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
    writeTextToDesktop("normalize_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var story = null;
  try { story = doc.stories[body.index]; } catch (eS) { story = null; }
  if (!story) {
    out.push("ERROR: could not access body story");
    writeTextToDesktop("normalize_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  // Detect primary bullet style from the story itself (most common bullet-like style)
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }

  var bulletCounts = {};
  var bodyCounts = {};
  for (var i = 0; i < pc; i++) {
    var para = story.paragraphs[i];
    var sn = "";
    try { sn = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { sn = ""; }
    if (!sn) continue;
    if (isBulletLikeStyleName(sn)) {
      bulletCounts[sn] = (bulletCounts[sn] || 0) + 1;
    } else if (!isHeadingLikeStyleName(sn)) {
      bodyCounts[sn] = (bodyCounts[sn] || 0) + 1;
    }
  }

  var primaryBulletStyleName = mostCommonKey(bulletCounts);
  var bodyStyleName = mostCommonKey(bodyCounts);
  out.push("Detected primaryBulletStyle=" + (primaryBulletStyleName ? primaryBulletStyleName : "(none)"));
  out.push("Detected bodyStyle=" + (bodyStyleName ? bodyStyleName : "(none)"));
  out.push("");

  var primaryBulletStyle = null;
  var bodyStyle = null;
  try { if (primaryBulletStyleName) primaryBulletStyle = doc.paragraphStyles.itemByName(primaryBulletStyleName); } catch (ePB) { primaryBulletStyle = null; }
  try { if (bodyStyleName) bodyStyle = doc.paragraphStyles.itemByName(bodyStyleName); } catch (eBS) { bodyStyle = null; }
  if (primaryBulletStyle && !primaryBulletStyle.isValid) primaryBulletStyle = null;
  if (bodyStyle && !bodyStyle.isValid) bodyStyle = null;

  var changedFlatten = 0;
  var changedToBody = 0;
  var samples = [];

  for (var j = 0; j < pc; j++) {
    var p2 = story.paragraphs[j];
    var txt = "";
    try { txt = String(p2.contents || ""); } catch (eT) { txt = ""; }
    txt = trimParaText(txt);
    if (!txt) continue;

    var styleName = "";
    try { styleName = String(p2.appliedParagraphStyle ? p2.appliedParagraphStyle.name : ""); } catch (eSN2) { styleName = ""; }
    if (!styleName) continue;

    var isBullet = isBulletLikeStyleName(styleName);
    if (!isBullet) continue;

    // 0) Convert bullet "list-intro" paragraphs to body style when they introduce a bullet run.
    // Example (bad in 2 columns): [bullet] "In je lederhuid ...:" then bullets.
    // We want: [body] "In je lederhuid ...:" then bullets.
    if (bodyStyle) {
      var ttrim = String(txt || "").replace(/\s+$/g, "");
      var looksLikeListIntro = false;
      try {
        if (ttrim.length && ttrim.charAt(ttrim.length - 1) === ":") looksLikeListIntro = true;
        if (/\bzoals\s*:\s*$/i.test(ttrim)) looksLikeListIntro = true;
        if (/\bnamelijk\s*:\s*$/i.test(ttrim)) looksLikeListIntro = true;
      } catch (eLI) { looksLikeListIntro = false; }

      if (looksLikeListIntro) {
        var nextIsBullet = false;
        if (j + 1 < pc) {
          try {
            var n = story.paragraphs[j + 1];
            var ns = String(n.appliedParagraphStyle ? n.appliedParagraphStyle.name : "");
            nextIsBullet = isBulletLikeStyleName(ns);
          } catch (eNB0) { nextIsBullet = false; }
        }
        if (nextIsBullet) {
          try {
            p2.appliedParagraphStyle = bodyStyle;
            changedToBody++;
            if (samples.length < 12) samples.push("toBody(listIntro) idx=" + j + " " + styleName + " -> " + bodyStyleName + " :: " + cleanOneLine(txt).substring(0, 90));
          } catch (eSetIntro) {}
          // After converting to body, skip further bullet-specific conversions for this paragraph.
          continue;
        }
      }
    }

    // 1) Flatten nested bullets to primary bullet style (remove lvl2/lvl3 indentation)
    if (primaryBulletStyle && styleName !== primaryBulletStyleName) {
      if (isNestedBulletStyleName(styleName)) {
        try {
          p2.appliedParagraphStyle = primaryBulletStyle;
          changedFlatten++;
          if (samples.length < 12) samples.push("flatten idx=" + j + " " + styleName + " -> " + primaryBulletStyleName + " :: " + cleanOneLine(txt).substring(0, 90));
          // update local style name for step 2
          styleName = primaryBulletStyleName;
        } catch (eSet0) {}
      }
    }

    // 2) Convert explanatory bullets to body paragraphs (reduce list-fatigue in 2 columns)
    // Heuristic:
    // - long (>= 18 words) OR multiple sentences (>=2 sentence-ending punct)
    // - but do NOT convert short list items (<= 8 words and <=1 sentence punct)
    var wc2 = countWords(txt);
    var sc2 = sentenceCount(txt);
    var looksShortListItem = (wc2 <= 8) && (sc2 <= 1) && (txt.indexOf(":") === -1);
    var looksExplanatory = (wc2 >= 18) || (sc2 >= 2);

    if (!looksShortListItem && looksExplanatory && bodyStyle) {
      try {
        p2.appliedParagraphStyle = bodyStyle;
        changedToBody++;
        if (samples.length < 12) samples.push("toBody idx=" + j + " " + styleName + " -> " + bodyStyleName + " :: " + cleanOneLine(txt).substring(0, 90));
      } catch (eSet1) {}
    }
  }

  out.push("flatten_nested_bullets: " + changedFlatten);
  out.push("convert_explanatory_bullets_to_body: " + changedToBody);
  if (samples.length) out.push("Samples:\n- " + samples.join("\n- "));

  var report = out.join("\n");
  writeTextToDesktop("normalize_bullets__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();


