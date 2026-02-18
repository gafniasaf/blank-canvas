// Validate the current CH1 preview output in InDesign.
// Checks:
// - Missing/out-of-date links
// - Missing fonts
// - Overset stories/frames (with page samples)
// - Layer headings rules:
//   - No "In de praktijk:" / "Verdieping:" (colons)
//   - Headings "In de praktijk" and "Verdieping" are Bold (case-sensitive occurrences)
// - Justification sanity:
//   - Paragraph styles should not be FULLY_JUSTIFIED ("justify all lines")
//   - Paragraph styles singleWordJustification should be LEFT_ALIGN when available
//
// Outputs a compact report string. Does not save.

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

function auditOverset(doc) {
  var oversetStories = 0;
  try {
    for (var s = 0; s < doc.stories.length; s++) {
      if (doc.stories[s].overset) oversetStories++;
    }
  } catch (e0) {}

  var oversetFrames = [];
  try {
    for (var i = 0; i < doc.textFrames.length; i++) {
      var tf = doc.textFrames[i];
      try { if (tf.overflows) oversetFrames.push(tf); } catch (e1) {}
    }
  } catch (e2) {}

  // Collect up to 10 sample pages
  var samples = [];
  for (var k = 0; k < Math.min(10, oversetFrames.length); k++) {
    var tfk = oversetFrames[k];
    var pg = "unknown";
    try { if (tfk.parentPage) pg = String(tfk.parentPage.name); } catch (e3) {}
    samples.push(pg);
  }
  return { oversetStories: oversetStories, oversetFrames: oversetFrames.length, samplePages: samples };
}

function countText(doc, what) {
  resetFind();
  app.findTextPreferences.findWhat = what;
  var f = [];
  try { f = doc.findText(); } catch (e0) { f = []; }
  resetFind();
  return f.length;
}

function countBoldLabel(doc, label) {
  // Case-sensitive occurrences only.
  resetFind();
  try { app.findChangeTextOptions.caseSensitive = true; } catch (e0) {}
  app.findTextPreferences.findWhat = label;
  var f = [];
  try { f = doc.findText(); } catch (e1) { f = []; }
  resetFind();

  var total = f.length;
  var boldOk = 0;
  for (var i = 0; i < f.length; i++) {
    try {
      var fs = String(f[i].characters[0].fontStyle || "");
      if (fs.toLowerCase().indexOf("bold") !== -1) boldOk++;
    } catch (e2) {}
  }
  return { total: total, boldOk: boldOk };
}

function auditJustification(doc) {
  var fullyJustifiedStyles = 0;
  var swjNotLeft = 0;
  try {
    for (var i = 0; i < doc.paragraphStyles.length; i++) {
      var ps = doc.paragraphStyles[i];
      if (!ps || ps.name === "[No Paragraph Style]") continue;
      try { if (ps.justification === Justification.FULLY_JUSTIFIED) fullyJustifiedStyles++; } catch (eJ) {}
      try { if (ps.singleWordJustification !== SingleWordJustification.LEFT_ALIGN) swjNotLeft++; } catch (eSWJ) {}
    }
  } catch (e0) {}
  return { fullyJustifiedStyles: fullyJustifiedStyles, swjNotLeft: swjNotLeft };
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document open/resolved.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}

  out.push("DOC: " + doc.name);

  var links = auditLinks(doc);
  out.push("[LINKS] total=" + links.total + " missing=" + links.missing + " outOfDate=" + links.outOfDate);

  var fonts = auditFonts(doc);
  out.push("[FONTS] total=" + fonts.total + " missing=" + fonts.missing);

  var ov = auditOverset(doc);
  out.push("[OVERSET] stories=" + ov.oversetStories + " frames=" + ov.oversetFrames + (ov.samplePages.length ? (" samplePages=" + ov.samplePages.join(",")) : ""));

  // Headings rules (Option A): we expect a ":" after the heading label.
  var labelP = countBoldLabel(doc, "In de praktijk:");
  var labelV = countBoldLabel(doc, "Verdieping:");
  out.push("[LABELS] praktijk=" + labelP.boldOk + "/" + labelP.total + " verdieping=" + labelV.boldOk + "/" + labelV.total);

  var just = auditJustification(doc);
  out.push("[JUSTIFY] fullyJustifiedStyles=" + just.fullyJustifiedStyles + " singleWordNotLeft=" + just.swjNotLeft);
}

out.join("\n");


