// Safe justification optimization for the active/target document.
// Rules:
// - Paragraph styles: FULLY_JUSTIFIED -> LEFT_JUSTIFIED (last line not justified)
// - Paragraph styles: singleWordJustification -> LEFT_ALIGN (if available)
// - Paragraph overrides: if a paragraph is FULLY_JUSTIFIED, also -> LEFT_JUSTIFIED
//
// Safe: does not save.

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

function safeEqJust(a, b) {
  try { return a === b; } catch (e) { return false; }
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document found/open.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}

  var styleChanged = 0;
  var paraChanged = 0;
  var swjChanged = 0;

  // 1) Styles
  try {
    for (var i = 0; i < doc.paragraphStyles.length; i++) {
      var ps = doc.paragraphStyles[i];
      if (!ps || ps.name === "[No Paragraph Style]") continue;

      try {
        if (ps.singleWordJustification !== SingleWordJustification.LEFT_ALIGN) {
          ps.singleWordJustification = SingleWordJustification.LEFT_ALIGN;
          swjChanged++;
        }
      } catch (eSWJ) {}

      try {
        if (safeEqJust(ps.justification, Justification.FULLY_JUSTIFIED)) {
          ps.justification = Justification.LEFT_JUSTIFIED;
          styleChanged++;
        }
      } catch (eJ) {}
    }
  } catch (eS) {}

  // 2) Paragraph overrides
  try {
    for (var s = 0; s < doc.stories.length; s++) {
      var story = doc.stories[s];
      // Skip tiny/empty stories
      try { if (story.words.length < 5) continue; } catch (eW) {}
      for (var p = 0; p < story.paragraphs.length; p++) {
        var para = story.paragraphs[p];
        try {
          if (safeEqJust(para.justification, Justification.FULLY_JUSTIFIED)) {
            para.justification = Justification.LEFT_JUSTIFIED;
            paraChanged++;
          }
        } catch (eP) {}
      }
    }
  } catch (ePO) {}

  out.push("DOC: " + doc.name);
  out.push("Styles FULLY->LEFT_JUSTIFIED: " + styleChanged);
  out.push("Styles singleWordJustification->LEFT_ALIGN: " + swjChanged);
  out.push("Paragraph overrides FULLY->LEFT_JUSTIFIED: " + paraChanged);
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


