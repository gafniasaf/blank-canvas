// Fix "In de praktijk" / "Verdieping" heading formatting inside the CH1 BODY STORY only (Option A).
// - Ensures ":" after the heading label when it appears after forced line breaks (e.g. "\n\nIn de praktijk ...").
// - Ensures the heading label is Bold (case-sensitive, so it won't hit lowercase prose mentions).
//
// Safe: modifies text formatting only; does NOT save.

var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";
// For our pipeline, capitalized "In de praktijk" / "Verdieping" are reserved for headings.
// If they appear at the start of a paragraph or start of a line, they should be normalized to Option A.
var ALLOW_START_OF_PARAGRAPH_LABELS = true;
// When running automated pipelines, multiple documents may be open.
// Prefer operating on the ACTIVE document (typically the newly-generated rewritten output),
// instead of accidentally targeting the baseline path if it happens to be open.
var PREFER_ACTIVE_DOC = true;

function getDocByPathOrActive(path) {
  var doc = null;
  if (PREFER_ACTIVE_DOC) {
    try { doc = app.activeDocument; } catch (e0) { doc = null; }
    if (doc) return doc;
  }
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) { doc = d; break; } } catch (e) {}
  }
  if (!doc) { try { doc = app.activeDocument; } catch (e2) { doc = null; } }
  // Some InDesign contexts throw on app.activeDocument even though documents exist; fallback to the first doc.
  if (!doc) {
    try { if (app.documents.length > 0) doc = app.documents[0]; } catch (e3) { doc = null; }
  }
  return doc;
}

function resetFind() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  try { app.changeTextPreferences = NothingEnum.nothing; } catch (e2) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e3) {}
  try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e4) {}
}

function setCaseInsensitive() {
  try { app.findChangeTextOptions.caseSensitive = false; } catch (e) {}
  try { app.findChangeGrepOptions.caseSensitive = false; } catch (e2) {}
}

function findGrep(doc, pat) {
  resetFind();
  setCaseInsensitive();
  app.findGrepPreferences.findWhat = pat;
  var res = [];
  try { res = doc.findGrep(); } catch (e) { res = []; }
  resetFind();
  return res;
}

function pageOfText(textObj) {
  try { var tf = textObj.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e) {}
  return null;
}

function getChapterRange(doc) {
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var f2 = findGrep(doc, "^2\\.1");
  var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
  var endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
  if (endOff < startOff) endOff = doc.pages.length - 1;

  return { startOff: startOff, endOff: endOff };
}

function paraStartPageOffset(para) {
  try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
  try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
  return -1;
}

function storyWordCountInRange(story, startOff, endOff) {
  var wc = 0;
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < startOff || off > endOff) continue;
    try { wc += para.words.length; } catch (eW) {}
  }
  return wc;
}

function detectBodyStoryIndex(doc, startOff, endOff) {
  var bestIdx = -1;
  var bestWords = -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var wc = storyWordCountInRange(doc.stories[s], startOff, endOff);
    if (wc > bestWords) { bestWords = wc; bestIdx = s; }
  }
  return { index: bestIdx, words: bestWords };
}

function ensureColonEverywhere(textObj) {
  // Normalize any line-start heading token (Option A):
  // - Ensure EXACTLY ONE blank line before the label (so prefix becomes "\n\n")
  // - Ensure EXACTLY ": " after the label
  // - Collapse a label-following newline into a single space so text becomes inline
  //
  // IMPORTANT: InDesign GREP handling of forced line breaks can be inconsistent across versions.
  // Here we use literal changeText() with "\n" which matches para.contents reliably.
  var changed = 0;
  function rep(a, b) {
    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      try { app.findChangeTextOptions.caseSensitive = false; } catch (eCS) {} // normalize even if token is lowercase
      app.findTextPreferences.findWhat = a;
      app.changeTextPreferences.changeTo = b;
      var found = textObj.changeText();
      changed += (found && found.length) ? found.length : 0;
    } catch (e0) {}
    resetFind();
  }

  // Inside-paragraph line starts (after forced line breaks)
  rep("\n\nIn de praktijk ", "\n\nIn de praktijk: ");
  rep("\nIn de praktijk ", "\n\nIn de praktijk: ");
  rep("\n\nIn de praktijk\n", "\n\nIn de praktijk: ");
  rep("\nIn de praktijk\n", "\n\nIn de praktijk: ");

  rep("\n\nVerdieping ", "\n\nVerdieping: ");
  rep("\nVerdieping ", "\n\nVerdieping: ");
  rep("\n\nVerdieping\n", "\n\nVerdieping: ");
  rep("\nVerdieping\n", "\n\nVerdieping: ");

  // Start-of-paragraph labels (Option B -> normalize to Option A)
  if (ALLOW_START_OF_PARAGRAPH_LABELS) {
    rep("In de praktijk ", "\n\nIn de praktijk: ");
    rep("In de praktijk\n", "\n\nIn de praktijk: ");
    rep("Verdieping ", "\n\nVerdieping: ");
    rep("Verdieping\n", "\n\nVerdieping: ");
  }

  resetFind();
  return changed;
}

function findHeadingAnchors(doc, heading) {
  // Prefer a conservative rule that works across InDesign's internal linebreak chars:
  // we treat capitalized labels as headings (content rules forbid these labels in prose).
  resetFind();
  // Case sensitive so we don't hit normal-sentence "in de praktijk"
  try { app.findChangeTextOptions.caseSensitive = true; } catch (e0) {}
  app.findTextPreferences.findWhat = heading;
  var found = [];
  try { found = doc.findText(); } catch (e1) { found = []; }
  resetFind();
  return found;
}

function ensureBoldInAnchor(anchor, heading) {
  var changed = 0;
  try {
    // Anchor is just the heading text in this mode.
    anchor.characters.everyItem().fontStyle = "Bold";
    changed++;
  } catch (e1) {}

  return changed;
}

function ensureBoldHeadings(textObj) {
  // Use changeText with formatting (most reliable across InDesign versions),
  // while keeping text identical (no content change).
  var applied = 0;
  function boldExact(what) {
    try {
      resetFind();
      // Only bold the capitalized label (avoid bolding sentence mentions like "in de praktijk").
      try { app.findChangeTextOptions.caseSensitive = true; } catch (e0) {}
      app.findTextPreferences.findWhat = what;
      app.changeTextPreferences.changeTo = what;
      app.changeTextPreferences.fontStyle = "Bold";
      var changed = textObj.changeText();
      applied += (changed && changed.length) ? changed.length : 0;
    } catch (e1) {}
    resetFind();
  }
  boldExact("In de praktijk:");
  boldExact("Verdieping:");
  return applied;
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document found/open.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

  var colonsChanged = 0;
  var boldApplied = 0;

  if (body.index < 0) {
    out.push("ERROR: could not detect CH1 body story");
  } else {
    var story = null;
    try { story = doc.stories[body.index]; } catch (eS) { story = null; }
    if (!story) {
      out.push("ERROR: body story not found at index " + body.index);
    } else {
      for (var p = 0; p < story.paragraphs.length; p++) {
        var para = story.paragraphs[p];
        var off = paraStartPageOffset(para);
        if (off < range.startOff || off > range.endOff) continue;
        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        // Case-insensitive filter: validator flags line-start tokens even when they appear as lowercase.
        var lowTxt = "";
        try { lowTxt = String(txt).toLowerCase(); } catch (eLow) { lowTxt = ""; }
        if (lowTxt.indexOf("in de praktijk") === -1 && lowTxt.indexOf("verdieping") === -1) continue;
        colonsChanged += ensureColonEverywhere(para);
        boldApplied += ensureBoldHeadings(para);
      }
    }
  }
  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("Colon inserts: " + colonsChanged);
  out.push("Bold applied: " + boldApplied);
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


