// Audit active (or named) document for common layout issues and jump to Chapter 1.
// - Checks: missing/out-of-date links, missing fonts, overset stories/frames
// - Jumps view to Chapter 1 by trying: "Hoofdstuk 1", "Chapter 1", GREP "^1\.1", then a "hoofdstuk/chapter" paragraph style
//
// Safe: read-only except for changing UI view/selection (no document edits/saves).

var TARGET_DOC_NAME = "MBO A&F 3_9789083251363_03.2024.indd"; // set to "" to use active document
var CHAPTER_NUMBER = 1;

function safeStr(v) {
  try { return String(v); } catch (e) { return ""; }
}

function getTargetDoc() {
  var doc = null;
  if (TARGET_DOC_NAME && TARGET_DOC_NAME.length) {
    try {
      doc = app.documents.itemByName(TARGET_DOC_NAME);
      // Touch a property to validate
      var _n = doc.name;
    } catch (e0) {
      doc = null;
    }
  }
  if (!doc) {
    try { doc = app.activeDocument; } catch (e1) { doc = null; }
  }
  return doc;
}

function activateDoc(doc) {
  // Document.activate() isn't available in all InDesign scripting contexts.
  // Setting app.activeDocument is the reliable way to switch focus.
  try { app.activeDocument = doc; } catch (e) {}
}

function pageOfText(textObj) {
  try {
    var tfs = textObj.parentTextFrames;
    if (tfs && tfs.length > 0) {
      var tf = tfs[0];
      if (tf && tf.parentPage) return tf.parentPage;
    }
  } catch (e) {}
  return null;
}

function jumpToText(textObj) {
  var pg = pageOfText(textObj);
  if (pg) {
    try { app.activeWindow.activePage = pg; } catch (e0) {}
  }
  try { app.select(textObj); } catch (e1) {}
  try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e2) {}
  return pg ? safeStr(pg.name) : "unknown";
}

function resetFind() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
}

function setFindOptionsCaseInsensitive() {
  // InDesign exposes caseSensitive via find/change options
  try { app.findChangeTextOptions.caseSensitive = false; } catch (e) {}
  try { app.findChangeGrepOptions.caseSensitive = false; } catch (e2) {}
}

function findText(doc, what) {
  resetFind();
  setFindOptionsCaseInsensitive();
  app.findTextPreferences.findWhat = what;
  var res = doc.findText();
  resetFind();
  return res;
}

function findGrep(doc, pattern) {
  resetFind();
  setFindOptionsCaseInsensitive();
  app.findGrepPreferences.findWhat = pattern;
  var res = doc.findGrep();
  resetFind();
  return res;
}

function auditLinks(doc) {
  var total = 0, missing = 0, outOfDate = 0, ok = 0;
  var missingNames = [];
  var outNames = [];
  try { total = doc.links.length; } catch (e0) { total = 0; }
  for (var i = 0; i < total; i++) {
    var link = doc.links[i];
    var st = null;
    try { st = link.status; } catch (e1) { st = null; }
    if (st == LinkStatus.LINK_MISSING) {
      missing++;
      if (missingNames.length < 20) missingNames.push(safeStr(link.name));
    } else if (st == LinkStatus.LINK_OUT_OF_DATE) {
      outOfDate++;
      if (outNames.length < 20) outNames.push(safeStr(link.name));
    } else {
      ok++;
    }
  }
  return { total: total, missing: missing, outOfDate: outOfDate, ok: ok, missingNames: missingNames, outNames: outNames };
}

function auditFonts(doc) {
  var total = 0, missing = 0, ok = 0;
  var missingNames = [];
  try { total = doc.fonts.length; } catch (e0) { total = 0; }
  for (var i = 0; i < total; i++) {
    var f = doc.fonts[i];
    var st = null;
    try { st = f.status; } catch (e1) { st = null; }
    if (st == FontStatus.NOT_AVAILABLE) {
      missing++;
      if (missingNames.length < 50) missingNames.push(safeStr(f.name));
    } else {
      ok++;
    }
  }
  return { total: total, missing: missing, ok: ok, missingNames: missingNames };
}

function auditOverset(doc) {
  var oversetStories = 0;
  var oversetFrames = [];
  try {
    for (var s = 0; s < doc.stories.length; s++) {
      if (doc.stories[s].overset) oversetStories++;
    }
  } catch (e0) {}

  try {
    for (var i = 0; i < doc.textFrames.length; i++) {
      var tf = doc.textFrames[i];
      try {
        if (tf.overflows) oversetFrames.push(tf);
      } catch (e1) {}
    }
  } catch (e2) {}

  var frameDetails = [];
  for (var k = 0; k < Math.min(15, oversetFrames.length); k++) {
    var tfk = oversetFrames[k];
    var pg = "unknown";
    try { if (tfk.parentPage) pg = safeStr(tfk.parentPage.name); } catch (e3) {}
    var nm = "";
    try { nm = safeStr(tfk.name); } catch (e4) { nm = ""; }
    var lb = "";
    try { lb = safeStr(tfk.label); } catch (e5) { lb = ""; }
    frameDetails.push("page=" + pg + " name=" + nm + " label=" + lb);
  }

  return { oversetStories: oversetStories, oversetFrames: oversetFrames.length, frameDetails: frameDetails };
}

function findChapterStart(doc) {
  var ch = CHAPTER_NUMBER;
  var candidates = [];

  // 1) Explicit chapter strings
  candidates.push({ kind: "text", value: "Hoofdstuk " + ch });
  candidates.push({ kind: "text", value: "HOOFDSTUK " + ch });
  candidates.push({ kind: "text", value: "Chapter " + ch });

  // 2) Common subsection marker (e.g., 1.1)
  candidates.push({ kind: "grep", value: "^" + ch + "\\.1" });
  candidates.push({ kind: "text", value: ch + ".1" });

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var res = [];
    try {
      res = (c.kind === "grep") ? findGrep(doc, c.value) : findText(doc, c.value);
    } catch (e0) { res = []; }
    if (res && res.length > 0) {
      return { method: c.kind + ":" + c.value, textObj: res[0] };
    }
  }

  // 3) Paragraph style heuristic: styles containing "hoofdstuk"/"chapter"/"chap"
  var styleCandidates = [];
  try {
    for (var ps = 0; ps < doc.paragraphStyles.length; ps++) {
      var st = doc.paragraphStyles[ps];
      var nm = "";
      try { nm = st.name; } catch (e1) { nm = ""; }
      if (!nm) continue;
      if (nm.match(/hoofdstuk|chapter|\\bchap\\b/i)) styleCandidates.push(st);
    }
  } catch (e2) {}

  var bestText = null;
  var bestMethod = "";
  var bestOffset = 999999999;

  for (var j = 0; j < styleCandidates.length; j++) {
    resetFind();
    try { app.findTextPreferences.appliedParagraphStyle = styleCandidates[j]; } catch (e3) { continue; }
    var found = [];
    try { found = doc.findText(); } catch (e4) { found = []; }
    resetFind();
    if (!found || found.length === 0) continue;
    var pg = pageOfText(found[0]);
    if (!pg) continue;
    var off = 999999999;
    try { off = pg.documentOffset; } catch (e5) {}
    if (off < bestOffset) {
      bestOffset = off;
      bestText = found[0];
      bestMethod = "style:" + safeStr(styleCandidates[j].name);
    }
  }

  if (bestText) return { method: bestMethod, textObj: bestText };
  return { method: "fallback:page1", textObj: null };
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: No documents open in InDesign.");
} else {
  var doc = getTargetDoc();
  if (!doc) {
    out.push("ERROR: Could not resolve a target document.");
  } else {
    activateDoc(doc);
    out.push("DOC: " + doc.name);
    out.push("Path: " + (doc.saved ? safeStr(doc.fullName.fsName) : "(unsaved)"));
    out.push("Pages: " + doc.pages.length);

    var linkAudit = auditLinks(doc);
    out.push("");
    out.push("[LINKS] total=" + linkAudit.total + " ok=" + linkAudit.ok + " missing=" + linkAudit.missing + " outOfDate=" + linkAudit.outOfDate);
    if (linkAudit.missingNames.length) out.push("Missing (sample): " + linkAudit.missingNames.join(" | "));
    if (linkAudit.outNames.length) out.push("Out-of-date (sample): " + linkAudit.outNames.join(" | "));

    var fontAudit = auditFonts(doc);
    out.push("");
    out.push("[FONTS] total=" + fontAudit.total + " ok=" + fontAudit.ok + " missing=" + fontAudit.missing);
    if (fontAudit.missingNames.length) out.push("Missing fonts: " + fontAudit.missingNames.join(" | "));

    var overAudit = auditOverset(doc);
    out.push("");
    out.push("[OVERSET] stories=" + overAudit.oversetStories + " frames=" + overAudit.oversetFrames);
    if (overAudit.frameDetails.length) {
      out.push("Overset frames (sample):");
      for (var od = 0; od < overAudit.frameDetails.length; od++) out.push(" - " + overAudit.frameDetails[od]);
    }

    out.push("");
    var ch = findChapterStart(doc);
    if (ch.textObj) {
      var pgName = jumpToText(ch.textObj);
      out.push("[JUMP] method=" + ch.method + " page=" + pgName);
    } else {
      // Fallback to first page
      try { app.activeWindow.activePage = doc.pages[0]; } catch (e6) {}
      try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e7) {}
      out.push("[JUMP] method=" + ch.method + " page=" + safeStr(doc.pages[0].name));
    }
  }
}

out.join("\n");


