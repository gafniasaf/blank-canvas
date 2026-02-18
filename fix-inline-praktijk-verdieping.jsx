// Convert existing rewritten paragraphs from:
//   \n\nIn de praktijk\n<text>
// to:
//   \n\nIn de praktijk <text>
// (same for "Verdieping")
//
// This is Option A: prevents a short standalone heading line from being stretched in justified text.
// Safe: text-only change; then re-apply bold formatting if the document contains <<BOLD_START>> markers.

var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

function getDocByPathOrActive(path) {
  var doc = null;
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) { doc = d; break; } } catch (e) {}
  }
  if (!doc) { try { doc = app.activeDocument; } catch (e2) { doc = null; } }
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

function applyBoldFormatting(textObj) {
  var count = 0;
  function boldReplace(findWhat, changeTo) {
    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = findWhat;
      app.changeTextPreferences.changeTo = changeTo;
      app.changeTextPreferences.fontStyle = "Bold";
      var found = textObj.changeText();
      count += found.length;
    } catch (e0) {}
  }
  boldReplace("<<BOLD_START>>In de praktijk<<BOLD_END>>", "In de praktijk");
  boldReplace("<<BOLD_START>>Verdieping<<BOLD_END>>", "Verdieping");
  boldReplace("<<BOLD_START>>In de praktijk:<<BOLD_END>>", "In de praktijk:");
  boldReplace("<<BOLD_START>>Verdieping:<<BOLD_END>>", "Verdieping:");
  boldReplace("<<BOLD_START>>Achtergrond:<<BOLD_END>>", "Achtergrond:");
  resetFind();
  return count;
}

function mergeHeadingLine(textObj, heading) {
  // Find: heading + forced line break, replace with heading + space
  // We keep ":"-free heading by default, but support both.
  var changed = 0;
  resetFind();
  // InDesign GREP: \n = forced line break. We only remove the break AFTER the heading.
  // Pattern matches either:
  //   "\n\nHeading\n"  or "\nHeading\n" (both common)
  // We replace only the last "\n" with a space by changing "Heading\n" -> "Heading ".
  try {
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
    app.findTextPreferences.findWhat = heading + "\n";
    app.changeTextPreferences.changeTo = heading + " ";
    var found = textObj.changeText();
    changed += found.length;
  } catch (e0) {}
  resetFind();
  return changed;
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: No documents open.");
} else {
  var doc = getDocByPathOrActive(TARGET_DOC_PATH);
  if (!doc) {
    out.push("ERROR: Could not resolve document.");
  } else {
    try { app.activeDocument = doc; } catch (eAct) {}
    var range = getChapterRange(doc);
    var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

    var changed = 0;
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
          if (txt.indexOf("In de praktijk") === -1 && txt.indexOf("Verdieping") === -1 && txt.indexOf("<<BOLD_START>>") === -1) continue;

          changed += mergeHeadingLine(para, "In de praktijk");
          changed += mergeHeadingLine(para, "Verdieping");
          // Also support colon variants
          changed += mergeHeadingLine(para, "In de praktijk:");
          changed += mergeHeadingLine(para, "Verdieping:");
          boldApplied += applyBoldFormatting(para);
        }
      }
    }

    out.push("DOC: " + doc.name);
    out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
    if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
    out.push("Merged heading lines: " + changed);
    out.push("Bold markers applied: " + boldApplied);
    out.push("NOTE: This does not save the document; save manually when happy.");
  }
}

out.join("\n");


