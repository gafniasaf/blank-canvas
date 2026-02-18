// Jump through placed images in Chapter 1 (based on first ^1.1 and first ^2.1 markers).
// Each run selects the "next" image container and zooms to its page.
// Progress is stored in the document label key "ch1_image_cursor".

var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

function getDocByPathOrActive(path) {
  var doc = null;
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try {
      if (d.fullName && d.fullName.fsName === path) {
        doc = d;
        break;
      }
    } catch (e) {}
  }
  if (!doc) {
    try { doc = app.activeDocument; } catch (e2) { doc = null; }
  }
  return doc;
}

function resetFind() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
}

function setCaseInsensitive() {
  try { app.findChangeGrepOptions.caseSensitive = false; } catch (e) {}
  try { app.findChangeTextOptions.caseSensitive = false; } catch (e2) {}
}

function findGrep(doc, pat) {
  resetFind();
  setCaseInsensitive();
  app.findGrepPreferences.findWhat = pat;
  var r = doc.findGrep();
  resetFind();
  return r;
}

function pageOfText(textObj) {
  try {
    var tf = textObj.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e) {}
  return null;
}

function getChapterRange(doc) {
  // InDesign GREP: escape literal dot as \.
  // JS string needs double backslash to produce a single backslash at runtime.
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
    startPageName: p1 ? String(p1.name) : String(doc.pages[0].name),
    endPageName: (endOff >= 0 && endOff < doc.pages.length) ? String(doc.pages[endOff].name) : String(doc.pages[doc.pages.length - 1].name)
  };
}

function containerAndPageFromLink(link) {
  var container = null;
  var page = null;
  try {
    var g = link.parent; // Image/PDF/...
    if (g && g.parent) container = g.parent; // Rectangle/Oval/Polygon
    if (container && container.parentPage) page = container.parentPage;
  } catch (e) {}
  return { container: container, page: page };
}

function buildCh1Images(doc, startOff, endOff) {
  var imgs = [];
  for (var i = 0; i < doc.links.length; i++) {
    var link = doc.links[i];
    var info = containerAndPageFromLink(link);
    if (!info.page) continue;
    var off = 999999999;
    try { off = info.page.documentOffset; } catch (e0) {}
    if (off < startOff || off > endOff) continue;
    imgs.push({
      off: off,
      pageName: String(info.page.name),
      linkName: String(link.name),
      container: info.container,
      page: info.page
    });
  }
  imgs.sort(function (a, b) {
    if (a.off !== b.off) return a.off - b.off;
    if (a.linkName < b.linkName) return -1;
    if (a.linkName > b.linkName) return 1;
    return 0;
  });
  return imgs;
}

function getCursor(doc) {
  var v = "";
  try { v = String(doc.extractLabel("ch1_image_cursor") || ""); } catch (e) { v = ""; }
  var n = parseInt(v, 10);
  if (isNaN(n) || n < 0) n = 0;
  return n;
}

function setCursor(doc, n) {
  try { doc.insertLabel("ch1_image_cursor", String(n)); } catch (e) {}
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: No documents open.");
} else {
  var doc = getDocByPathOrActive(TARGET_DOC_PATH);
  if (!doc) {
    out.push("ERROR: Could not resolve document.");
  } else {
    // Document.activate() isn't available in all InDesign scripting contexts.
    // Setting app.activeDocument is the reliable way to switch focus.
    try { app.activeDocument = doc; } catch (eAct) {}
    var range = getChapterRange(doc);
    var imgs = buildCh1Images(doc, range.startOff, range.endOff);
    out.push("DOC: " + doc.name);
    out.push("CH1 range: page " + range.startPageName + " -> " + range.endPageName);
    out.push("CH1 images: " + imgs.length);

    if (imgs.length === 0) {
      out.push("No images found in the detected Chapter 1 range.");
    } else {
      var idx = getCursor(doc);
      if (idx >= imgs.length) idx = 0;
      var it = imgs[idx];

      try { app.activeWindow.activePage = it.page; } catch (e1) {}
      try { app.select(it.container); } catch (e2) { try { app.select(it.page); } catch (e3) {} }
      try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e4) {}

      out.push("Selected: " + (idx + 1) + "/" + imgs.length + " page=" + it.pageName + " link=" + it.linkName);

      // advance cursor for next run
      setCursor(doc, idx + 1);
    }
  }
}

out.join("\n");


