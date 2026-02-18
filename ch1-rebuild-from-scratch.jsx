// CH1 Rebuild Driver (A&F4) — safe-by-default, body-story-only.
//
// What it does:
// - Opens the baseline CH1 preview INDD
// - Audits links/fonts (optional abort)
// - Saves a timestamped working copy (*_CH1_REBUILD_<ts>.indd) and closes the baseline without saving
// - Opens the working copy
// - Detects CH1 range via first ^1.1 and first ^2.1 markers
// - Detects CH1 body story = story with max words in CH1 range
// - Applies fixes ONLY in that body story (and only in CH1 range):
//   - Justification: never FULLY_JUSTIFIED; enforce LEFT_JUSTIFIED; singleWordJustification left (best effort)
//   - Option A headings: make "In de praktijk:" / "Verdieping:" inline (no forced line break after label), ensure colon, ensure bold label
//   - Spacing: double spaces, spaces before punctuation, missing spaces after punctuation
//   - Mixed bold inside a word: normalize to the majority fontStyle (best effort)
//   - Isolated bullet fragments: convert to body style + rewrite fragment (known patterns)
// - Saves the working copy and also saves a release checkpoint copy (*_CH1_REBUILD_RELEASE_<ts>.indd)
//
// Notes:
// - Never uses \r except the paragraph terminator already present in paragraph contents.
// - Never edits non-body stories (protects labels/callouts/captions).
// - Does not depend on Document.activate(); uses app.activeDocument.
//
// Run via:
// osascript -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/ch1-rebuild-from-scratch.jsx" language javascript'

var BASELINE_INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

var OUTPUT_TAG = "CH1_REBUILD";
var RELEASE_TAG = "RELEASE";

var ABORT_ON_LINK_FONT_ISSUES = true;
var CREATE_RELEASE_CHECKPOINT = true;

var APPLY_JUSTIFICATION_RULES = true;
var APPLY_OPTION_A_HEADINGS = true;
var APPLY_SPACING_FIXES = true;
var APPLY_MIXED_BOLD_FIX = true;
var APPLY_ISOLATED_BULLET_FIX = true;

var ADOBE_PARAGRAPH_COMPOSER = "$ID/AdobeParagraphComposer";
// Captions (e.g., "Afbeelding 1.2␠␠...") are often layout-sensitive and may intentionally contain double spaces.
// Keep them untouched by default.
var SKIP_CAPTION_PARAS = true;

function pad(n) { return (n < 10 ? "0" : "") + n; }
function ts() {
  var d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function safeBase(name) {
  return String(name || "doc").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "_");
}

function resetFindAll() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e0) {}
  try { app.changeTextPreferences = NothingEnum.nothing; } catch (e1) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
  try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e3) {}
}

function setCaseSensitiveText(isCaseSensitive) {
  try { app.findChangeTextOptions.caseSensitive = !!isCaseSensitive; } catch (e0) {}
  try { app.findChangeGrepOptions.caseSensitive = !!isCaseSensitive; } catch (e1) {}
}

function findOpenDocByPath(path) {
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) return d; } catch (e0) {}
  }
  return null;
}

function openDocAtPath(path) {
  var f = File(path);
  if (!f.exists) return null;
  var already = findOpenDocByPath(path);
  if (already) return already;
  try { return app.open(f); } catch (e0) { return null; }
}

function pageOfText(textObj) {
  try {
    var tf = textObj.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e0) {}
  return null;
}

function findGrep(doc, pat) {
  resetFindAll();
  setCaseSensitiveText(false);
  app.findGrepPreferences.findWhat = pat;
  var res = [];
  try { res = doc.findGrep(); } catch (e0) { res = []; }
  resetFindAll();
  return res;
}

function getChapterRange(doc) {
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var f2 = findGrep(doc, "^2\\.1");
  var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
  var endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
  if (endOff < startOff) endOff = doc.pages.length - 1;

  return {
    startOff: startOff,
    endOff: endOff,
    startPage: p1 ? String(p1.name) : "?",
    endPage: (endOff >= 0 && endOff < doc.pages.length) ? String(doc.pages[endOff].name) : "?"
  };
}

function paraStartPageOffset(para) {
  try {
    var ip = para.insertionPoints[0];
    var tf = ip.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage.documentOffset;
  } catch (e0) {}
  try {
    var tf2 = para.parentTextFrames[0];
    if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset;
  } catch (e1) {}
  return -1;
}

function hasAnchors(text) {
  try { return String(text || "").indexOf("\uFFFC") !== -1; } catch (e0) { return false; }
}

function isCaptionLikeParaText(txt) {
  // Detect common Dutch figure captions with intentional spacing, e.g.:
  // "Afbeelding 1.2␠␠Anatomie ..."
  // Keep this narrow to avoid skipping normal prose that happens to start with "Afbeelding".
  var t = "";
  try { t = String(txt || ""); } catch (e0) { t = ""; }
  if (!t) return false;
  // Remove trailing paragraph return
  if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
  // Normalize leading whitespace for matching
  t = t.replace(/^\s+/, "");
  // Only treat as caption if it matches the typical "Afbeelding <n>[.<n>]␠␠" pattern
  try {
    return !!t.match(/^Afbeelding\s+\d+(?:\.\d+)?\s{2,}/);
  } catch (e1) {
    return false;
  }
}

function auditLinks(doc) {
  var total = 0, missing = 0, outOfDate = 0;
  try { total = doc.links.length; } catch (e0) { total = 0; }
  for (var i = 0; i < total; i++) {
    var link = doc.links[i];
    var st = null;
    try { st = link.status; } catch (e1) { st = null; }
    if (st == LinkStatus.LINK_MISSING) missing++;
    else if (st == LinkStatus.LINK_OUT_OF_DATE) outOfDate++;
  }
  return { total: total, missing: missing, outOfDate: outOfDate };
}

function auditFonts(doc) {
  var total = 0, missing = 0;
  try { total = doc.fonts.length; } catch (e0) { total = 0; }
  for (var i = 0; i < total; i++) {
    var f = doc.fonts[i];
    var st = null;
    try { st = f.status; } catch (e1) { st = null; }
    if (st == FontStatus.NOT_AVAILABLE) missing++;
  }
  return { total: total, missing: missing };
}

function storyWordCountInRange(story, range) {
  var wc = 0;
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (e0) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < range.startOff || off > range.endOff) continue;
    try { wc += para.words.length; } catch (e1) {}
  }
  return wc;
}

function detectBodyStoryIndex(doc, range) {
  var bestIdx = -1;
  var bestWords = -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var wc = storyWordCountInRange(doc.stories[s], range);
    if (wc > bestWords) { bestWords = wc; bestIdx = s; }
  }
  return { index: bestIdx, words: bestWords };
}

function changeGrepInText(textObj, findWhat, changeTo, caseSensitive) {
  resetFindAll();
  setCaseSensitiveText(!!caseSensitive);
  app.findGrepPreferences.findWhat = findWhat;
  app.changeGrepPreferences.changeTo = changeTo;
  var changed = [];
  try { changed = textObj.changeGrep(); } catch (e0) { changed = []; }
  resetFindAll();
  return (changed && changed.length) ? changed.length : 0;
}

function changeTextInText(textObj, findWhat, changeTo, caseSensitive, fontStyle) {
  resetFindAll();
  setCaseSensitiveText(!!caseSensitive);
  app.findTextPreferences.findWhat = findWhat;
  app.changeTextPreferences.changeTo = changeTo;
  if (fontStyle) {
    try { app.changeTextPreferences.fontStyle = fontStyle; } catch (e0) {}
  }
  var changed = [];
  try { changed = textObj.changeText(); } catch (e1) { changed = []; }
  resetFindAll();
  return (changed && changed.length) ? changed.length : 0;
}

function applyJustificationRulesToPara(para, stats) {
  if (!APPLY_JUSTIFICATION_RULES) return;

  var txt = "";
  try { txt = String(para.contents || ""); } catch (e0) { txt = ""; }

  // Detect layer-heading paragraphs (headings are capitalized, appear after forced line breaks, and should include ':').
  var isLayerPara =
    (txt.indexOf("In de praktijk:") !== -1) ||
    (txt.indexOf("Verdieping:") !== -1) ||
    (txt.indexOf("\nIn de praktijk") !== -1) ||
    (txt.indexOf("\nVerdieping") !== -1);

  // Detect list-like paragraphs by style name (avoid justifying bullets/lists).
  var styleName = "";
  try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
  var listLike = isListLikeStyleName(styleName);

  var j = null;
  try { j = para.justification; } catch (eJ0) { j = null; }

  // Approximate "body-ish" paragraph length (for deciding whether to re-justify left-aligned overrides)
  var len = 0;
  try {
    var t2 = String(txt || "").replace(/\uFFFC/g, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    len = t2.length;
  } catch (eLen) { len = 0; }

  // Policy:
  // - Layer paragraphs: LEFT_ALIGN (no justification stretching anywhere in the paragraph).
  // - List-like paragraphs: LEFT_ALIGN.
  // - Long body paragraphs: LEFT_JUSTIFIED (last line align left; never justify-all-lines).
  if (isLayerPara) {
    try {
      if (para.justification !== Justification.LEFT_ALIGN) {
        para.justification = Justification.LEFT_ALIGN;
        stats.layerParasLeftAlign++;
      }
    } catch (eJL) {}
  } else if (listLike) {
    try {
      if (para.justification !== Justification.LEFT_ALIGN) {
        para.justification = Justification.LEFT_ALIGN;
        stats.listParasLeftAlign++;
      }
    } catch (eJList) {}
  } else {
    try {
      if (j === Justification.FULLY_JUSTIFIED) {
        para.justification = Justification.LEFT_JUSTIFIED;
        stats.justificationConverted++;
        stats.bodyParasLeftJustified++;
      } else if (len >= 80 && para.justification !== Justification.LEFT_JUSTIFIED) {
        para.justification = Justification.LEFT_JUSTIFIED;
        stats.bodyParasLeftJustified++;
      }
    } catch (eJB) {}
  }

  // Enforce single-word justification left align (best effort)
  try {
    // Some InDesign builds expose singleWordJustification on Paragraph.
    para.singleWordJustification = Justification.LEFT_ALIGN;
    stats.singleWordJustSet++;
  } catch (eJ1) {}
}

function applyOptionalComposerTuningToPara(para) {
  // Only if we ever decide to enforce it globally; kept minimal for now.
  try { para.composer = ADOBE_PARAGRAPH_COMPOSER; } catch (e0) {}
  try { para.hyphenation = true; } catch (e1) {}
}

function applyOptionAHeadingFixesToPara(para, stats) {
  if (!APPLY_OPTION_A_HEADINGS) return;
  var txt = "";
  try { txt = String(para.contents || ""); } catch (e0) { txt = ""; }
  if (!txt) return;
  if (hasAnchors(txt)) return;

  // Merge forced line break after heading label (Option A) and ensure colon.
  // "In de praktijk\n"   -> "In de praktijk: "
  // "In de praktijk:\n"  -> "In de praktijk: "
  // Same for "Verdieping".
  var m = 0;
  m += changeTextInText(para, "In de praktijk:\n", "In de praktijk: ", true, null);
  m += changeTextInText(para, "In de praktijk\n", "In de praktijk: ", true, null);
  m += changeTextInText(para, "Verdieping:\n", "Verdieping: ", true, null);
  m += changeTextInText(para, "Verdieping\n", "Verdieping: ", true, null);
  if (m) stats.headingLineMerges += m;

  // If the heading is used as a label without a colon inside the paragraph, add it (conservatively: only after forced line breaks).
  var c = 0;
  c += changeTextInText(para, "\n\nIn de praktijk ", "\n\nIn de praktijk: ", true, null);
  c += changeTextInText(para, "\nIn de praktijk ", "\nIn de praktijk: ", true, null);
  c += changeTextInText(para, "\n\nVerdieping ", "\n\nVerdieping: ", true, null);
  c += changeTextInText(para, "\nVerdieping ", "\nVerdieping: ", true, null);
  if (c) stats.headingColonInserts += c;

  // Ensure space after colon when missing (targeted).
  var sp = 0;
  sp += changeGrepInText(para, "In de praktijk:([A-Za-z\u00C0-\u00FF])", "In de praktijk: $1", true);
  sp += changeGrepInText(para, "Verdieping:([A-Za-z\u00C0-\u00FF])", "Verdieping: $1", true);
  if (sp) stats.headingColonSpaces += sp;

  // Bold the labels (best effort).
  // We do this after structural edits so the label exists in its final form.
  var b = 0;
  b += changeTextInText(para, "In de praktijk:", "In de praktijk:", true, "Bold");
  b += changeTextInText(para, "Verdieping:", "Verdieping:", true, "Bold");
  if (b) stats.headingBoldApplied += b;
}

function applySpacingFixesToPara(para, stats) {
  if (!APPLY_SPACING_FIXES) return;
  var txt = "";
  try { txt = String(para.contents || ""); } catch (e0) { txt = ""; }
  if (!txt) return;
  if (hasAnchors(txt)) { stats.spacingSkippedAnchors++; return; }
  if (SKIP_CAPTION_PARAS && isCaptionLikeParaText(txt)) { stats.spacingSkippedCaptions++; return; }

  var changed = 0;

  // Double spaces
  changed += changeGrepInText(para, " {2,}", " ", false);

  // Spaces before punctuation
  changed += changeGrepInText(para, " ([,.;:!?])", "$1", false);

  // Missing spaces after punctuation (Dutch-ish heuristics)
  changed += changeGrepInText(para, "([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])", "$1$2 $3", false);
  changed += changeGrepInText(para, "([A-Za-z\u00C0-\u00FF]);([A-Za-z\u00C0-\u00FF])", "$1; $2", false);
  changed += changeGrepInText(para, "([A-Za-z\u00C0-\u00FF]),([A-Za-z\u00C0-\u00FF])", "$1, $2", false);
  changed += changeGrepInText(para, "([A-Za-z\u00C0-\u00FF]):([A-Za-z\u00C0-\u00FF])", "$1: $2", false);

  // Parentheses spacing
  changed += changeGrepInText(para, "([A-Za-z\u00C0-\u00FF])\\(", "$1 (", false);
  changed += changeGrepInText(para, "\\(\\s+", "(", false);
  changed += changeGrepInText(para, "\\s+\\)", ")", false);

  // Collapse again
  changed += changeGrepInText(para, " {2,}", " ", false);

  if (changed) stats.spacingChanges += changed;
}

function charBoldness(ch) {
  var fs = "";
  try { fs = String(ch.fontStyle || ""); } catch (e0) { fs = ""; }
  var fb = false;
  try { fb = !!ch.fauxBold; } catch (e1) { fb = false; }
  return (fs.toLowerCase().indexOf("bold") !== -1) || fb;
}

function normalizeMixedBoldInWord(word) {
  var chars = null;
  try { chars = word.characters; } catch (e0) { chars = null; }
  if (!chars) return false;
  var n = 0;
  try { n = chars.length; } catch (e1) { n = 0; }
  if (n <= 1) return false;

  var styleCounts = {};
  var boldT = 0, boldF = 0;
  var fauxT = 0, fauxF = 0;
  for (var i = 0; i < n; i++) {
    var ch = chars[i];
    var fs = "";
    try { fs = String(ch.fontStyle || ""); } catch (e2) { fs = ""; }
    styleCounts[fs] = (styleCounts[fs] || 0) + 1;
    if (charBoldness(ch)) boldT++; else boldF++;
    try { if (ch.fauxBold) fauxT++; else fauxF++; } catch (e3) {}
  }

  var keys = [];
  for (var k in styleCounts) keys.push(k);
  var hasMixedBold = (boldT > 0 && boldF > 0);
  var hasMixedFaux = (fauxT > 0 && fauxF > 0);
  var hasMixedStyle = (keys.length > 1);
  if (!hasMixedBold && !hasMixedFaux && !hasMixedStyle) return false;

  // Pick most common style; tie-break prefer non-bold.
  var bestStyle = "";
  var bestCount = -1;
  for (var kk in styleCounts) {
    var c = styleCounts[kk];
    if (c > bestCount) { bestCount = c; bestStyle = kk; }
    else if (c === bestCount) {
      var kb = String(kk).toLowerCase().indexOf("bold") !== -1;
      var bb = String(bestStyle).toLowerCase().indexOf("bold") !== -1;
      if (bb && !kb) bestStyle = kk;
    }
  }
  if (!bestStyle) return false;
  var bestFaux = (fauxT >= fauxF);

  try { word.characters.everyItem().fontStyle = bestStyle; } catch (e4) {}
  try { word.characters.everyItem().fauxBold = bestFaux; } catch (e5) {}
  return true;
}

function applyMixedBoldFixesToPara(para, stats) {
  if (!APPLY_MIXED_BOLD_FIX) return;
  var txt = "";
  try { txt = String(para.contents || ""); } catch (e0) { txt = ""; }
  if (!txt) return;
  if (hasAnchors(txt)) return;

  var wc = 0;
  try { wc = para.words.length; } catch (e1) { wc = 0; }
  for (var wi = 0; wi < wc; wi++) {
    var w = para.words[wi];
    var wtxt = "";
    try { wtxt = String(w.contents || ""); } catch (e2) { wtxt = ""; }
    if (!wtxt || wtxt.length < 2) continue;
    if (normalizeMixedBoldInWord(w)) stats.mixedBoldWordsFixed++;
  }
}

function isListLikeStyleName(styleName) {
  var s = String(styleName || "").toLowerCase();
  return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
}
function cleanOneLine(s) {
  return String(s || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}
function isBulletLikeText(t) {
  var s = cleanOneLine(t);
  if (!s) return false;
  if (s.indexOf("\u2022") === 0) return true;
  if (s.indexOf("- ") === 0) return true;
  if (s.indexOf("\u2022") >= 0 && s.indexOf("\u2022") <= 5) return true;
  return false;
}
function isBulletPara(para) {
  var txt = "";
  try { txt = String(para.contents || ""); } catch (e0) { txt = ""; }
  var styleName = "";
  try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (e1) { styleName = ""; }
  return isListLikeStyleName(styleName) || isBulletLikeText(txt);
}

function fixIsolatedBulletFragment(text) {
  var t = cleanOneLine(text);
  if (t.toLowerCase().indexOf("zakjes.") === 0 && t.toLowerCase().indexOf("cisternae") !== -1) {
    return "Er zijn ook zakjes. Die heten ook wel cisternae.";
  }
  if (t.toLowerCase().indexOf("eiwit.") === 0 && t.indexOf("40%") !== -1) {
    return "Eiwit vormt 40% van de ribosomen.";
  }
  if (t.toLowerCase().indexOf("translatiefase.") === 0) {
    var rest = t.substring("translatiefase.".length);
    rest = rest.replace(/^\s+/, "");
    if (rest.toLowerCase().indexOf("dit is de fase waarin") === 0) {
      rest = rest.substring("Dit is de fase waarin".length);
      rest = rest.replace(/^\s+/, "");
      return "De translatiefase is de fase waarin " + rest;
    }
    return "De translatiefase. " + rest;
  }
  if (t.length > 1 && t.charAt(0) >= "a" && t.charAt(0) <= "z") {
    t = t.charAt(0).toUpperCase() + t.substring(1);
  }
  return t;
}

function fixIsolatedBulletsInBodyStory(story, range, stats) {
  if (!APPLY_ISOLATED_BULLET_FIX) return;
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (e0) { pc = 0; }
  var fixed = 0;

  for (var i = 0; i < pc; i++) {
    var para = story.paragraphs[i];
    var off = paraStartPageOffset(para);
    if (off < range.startOff || off > range.endOff) continue;
    if (!isBulletPara(para)) continue;

    var prevIs = false, nextIs = false;
    if (i > 0) {
      var prev = story.paragraphs[i - 1];
      var offPrev = paraStartPageOffset(prev);
      if (offPrev >= range.startOff && offPrev <= range.endOff) prevIs = isBulletPara(prev);
    }
    if (i + 1 < pc) {
      var next = story.paragraphs[i + 1];
      var offNext = paraStartPageOffset(next);
      if (offNext >= range.startOff && offNext <= range.endOff) nextIs = isBulletPara(next);
    }
    if (prevIs || nextIs) continue; // not isolated

    var txt = "";
    try { txt = String(para.contents || ""); } catch (e1) { txt = ""; }
    if (!txt) continue;
    if (hasAnchors(txt)) continue;

    // Apply previous paragraph style (usually body)
    if (i > 0) {
      try {
        var ps = story.paragraphs[i - 1].appliedParagraphStyle;
        if (ps) para.appliedParagraphStyle = ps;
      } catch (e2) {}
    }

    // Rewrite fragment (standalone sentence)
    var hasCR = false;
    if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
    var fixedTxt = fixIsolatedBulletFragment(txt);
    try { para.contents = fixedTxt + (hasCR ? "\r" : ""); } catch (e3) {}
    fixed++;
  }

  stats.isolatedBulletsFixed += fixed;
}

function oversetFramesInRange(doc, range) {
  var count = 0;
  var sample = [];
  try {
    for (var i = 0; i < doc.textFrames.length; i++) {
      var tf = doc.textFrames[i];
      var ov = false;
      try { ov = !!tf.overflows; } catch (e0) { ov = false; }
      if (!ov) continue;
      var pg = null;
      var off = -1;
      try { pg = tf.parentPage; } catch (e1) { pg = null; }
      if (!pg) continue;
      try { off = pg.documentOffset; } catch (e2) { off = -1; }
      if (off < range.startOff || off > range.endOff) continue;
      count++;
      if (sample.length < 10) sample.push(String(pg.name));
    }
  } catch (e3) {}
  return { count: count, samplePages: sample };
}

var out = [];
var oldUI = null;
try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (eOld) { oldUI = null; }
try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI) {}

try {
  var baselineDoc = openDocAtPath(BASELINE_INDD_PATH);
  if (!baselineDoc) {
    out.push("ERROR: Could not open baseline INDD: " + BASELINE_INDD_PATH);
    out.join("\n");
  } else {
    try { app.activeDocument = baselineDoc; } catch (eAct0) {}

    out.push("BASELINE: " + baselineDoc.name);
    try { if (baselineDoc.fullName) out.push("BASELINE PATH: " + baselineDoc.fullName.fsName); } catch (eP0) {}

    var links0 = auditLinks(baselineDoc);
    var fonts0 = auditFonts(baselineDoc);
    out.push("[BASELINE LINKS] missing=" + links0.missing + " outOfDate=" + links0.outOfDate);
    out.push("[BASELINE FONTS] missing=" + fonts0.missing);

    if (ABORT_ON_LINK_FONT_ISSUES && (links0.missing > 0 || links0.outOfDate > 0 || fonts0.missing > 0)) {
      out.push("ABORT: baseline has link/font issues. Fix links/fonts first or set ABORT_ON_LINK_FONT_ISSUES=false.");
      out.join("\n");
    } else {
      // Save working copy next to baseline
      var parentFolder = null;
      try { parentFolder = baselineDoc.fullName.parent; } catch (eF0) { parentFolder = new Folder(Folder.desktop + "/Generated_Books"); }
      try { if (!parentFolder.exists) parentFolder.create(); } catch (eF1) {}

      var stamp = ts();
      var base = safeBase(baselineDoc.name);
      var workingFile = new File(parentFolder.fsName + "/" + base + "_" + OUTPUT_TAG + "_" + stamp + ".indd");
      var releaseFile = new File(parentFolder.fsName + "/" + base + "_" + OUTPUT_TAG + "_" + RELEASE_TAG + "_" + stamp + ".indd");

      try { baselineDoc.saveACopy(workingFile); } catch (eCopy) {
        out.push("ERROR: saveACopy failed: " + eCopy);
        out.join("\n");
      }

      // Close baseline without saving (protect original)
      try { baselineDoc.close(SaveOptions.NO); } catch (eClose0) {}

      // Open working copy
      var workDoc = null;
      try { workDoc = app.open(workingFile); } catch (eOpen1) { workDoc = null; }
      if (!workDoc) {
        out.push("ERROR: Could not open working copy: " + workingFile.fsName);
        out.join("\n");
      } else {
        try { app.activeDocument = workDoc; } catch (eAct1) {}

        var range = getChapterRange(workDoc);
        var body = detectBodyStoryIndex(workDoc, range);

        out.push("");
        out.push("WORKING: " + workDoc.name);
        out.push("WORKING PATH: " + workDoc.fullName.fsName);
        out.push("CH1 range: page " + range.startPage + " -> " + range.endPage + " (offsets " + range.startOff + " -> " + range.endOff + ")");
        out.push("Body story: index=" + body.index + " words=" + body.words);

        if (body.index < 0) {
          out.push("ERROR: Could not detect body story.");
          out.join("\n");
        } else {
          var stats = {
            paragraphsInScope: 0,
            justificationConverted: 0,
            singleWordJustSet: 0,
            layerParasLeftAlign: 0,
            listParasLeftAlign: 0,
            bodyParasLeftJustified: 0,
            headingLineMerges: 0,
            headingColonInserts: 0,
            headingColonSpaces: 0,
            headingBoldApplied: 0,
            spacingChanges: 0,
            spacingSkippedAnchors: 0,
            spacingSkippedCaptions: 0,
            mixedBoldWordsFixed: 0,
            isolatedBulletsFixed: 0
          };

          var story = workDoc.stories[body.index];
          var pc = 0;
          try { pc = story.paragraphs.length; } catch (ePC) { pc = 0; }

          for (var p = 0; p < pc; p++) {
            var para = story.paragraphs[p];
            var off = paraStartPageOffset(para);
            if (off < range.startOff || off > range.endOff) continue;
            stats.paragraphsInScope++;

            applyOptionAHeadingFixesToPara(para, stats);
            applyJustificationRulesToPara(para, stats);
            applySpacingFixesToPara(para, stats);
            applyMixedBoldFixesToPara(para, stats);
          }

          // Second pass: isolated bullet repair (depends on neighbors)
          fixIsolatedBulletsInBodyStory(story, range, stats);

          // Save work in place and save a checkpoint copy
          try { workDoc.save(); } catch (eSave) {}
          if (CREATE_RELEASE_CHECKPOINT) {
            try { workDoc.saveACopy(releaseFile); } catch (eRel) {}
          }

          // Quick post-checks
          var links1 = auditLinks(workDoc);
          var fonts1 = auditFonts(workDoc);
          var ov = oversetFramesInRange(workDoc, range);

          out.push("");
          out.push("APPLIED (body story only):");
          out.push(" - paragraphs in scope: " + stats.paragraphsInScope);
          out.push(" - justification FULLY_JUSTIFIED -> LEFT_JUSTIFIED: " + stats.justificationConverted);
          out.push(" - singleWordJustification set attempts: " + stats.singleWordJustSet);
          out.push(" - layer paragraphs LEFT_ALIGN: " + stats.layerParasLeftAlign);
          out.push(" - list-like paragraphs LEFT_ALIGN: " + stats.listParasLeftAlign);
          out.push(" - body paragraphs LEFT_JUSTIFIED (enforced): " + stats.bodyParasLeftJustified);
          out.push(" - heading line merges (Option A): " + stats.headingLineMerges);
          out.push(" - heading colon inserts: " + stats.headingColonInserts);
          out.push(" - heading colon-space fixes: " + stats.headingColonSpaces);
          out.push(" - heading bold applied: " + stats.headingBoldApplied);
          out.push(" - spacing change operations: " + stats.spacingChanges + " (skipped anchors: " + stats.spacingSkippedAnchors + ", skipped captions: " + stats.spacingSkippedCaptions + ")");
          out.push(" - mixed-bold words fixed: " + stats.mixedBoldWordsFixed);
          out.push(" - isolated bullets fixed: " + stats.isolatedBulletsFixed);

          out.push("");
          out.push("POSTCHECK:");
          out.push("[LINKS] missing=" + links1.missing + " outOfDate=" + links1.outOfDate);
          out.push("[FONTS] missing=" + fonts1.missing);
          out.push("[CH1 OVERSET FRAMES] " + ov.count + (ov.samplePages.length ? (" samplePages=" + ov.samplePages.join(",")) : ""));
          out.push("RELEASE COPY: " + (CREATE_RELEASE_CHECKPOINT ? releaseFile.fsName : "(disabled)"));
          out.push("");
          out.push("NEXT: run validate-ch1.jsx, scan-ch1-anomalies.jsx, scan-ch1-isolated-bullets.jsx, check-links.jsx on the working/release doc.");
        }
      }
    }
  }
} catch (eTop) {
  out.push("ERROR: " + eTop);
} finally {
  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI2) {}
}

out.join("\n");


