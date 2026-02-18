// verify-json-originals-vs-baseline-ch1.jsx
// Verify that the JSON "original" texts exist in the baseline (old) A&F INDD (CH1 body story),
// to validate extraction/ingest correctness.
//
// Output: Desktop report file.

(function () {
  var BASELINE_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";
  var JSON_PATH = "/Users/asafgafni/Desktop/rewrites_for_indesign.json";

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

  function resetFind() {
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
    try { app.changeTextPreferences = NothingEnum.nothing; } catch (e2) {}
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e3) {}
    try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e4) {}
  }
  function setFindAllScope() {
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e0) {}
    try { app.findChangeTextOptions.caseSensitive = false; } catch (e1) {}
    try { app.findChangeGrepOptions.includeFootnotes = true; } catch (e2) {}
    try { app.findChangeGrepOptions.includeHiddenLayers = true; } catch (e3) {}
    try { app.findChangeGrepOptions.includeLockedLayersForFind = true; } catch (e4) {}
    try { app.findChangeGrepOptions.includeLockedStoriesForFind = true; } catch (e5) {}
    try { app.findChangeGrepOptions.includeMasterPages = true; } catch (e6) {}
    try { app.findChangeTextOptions.includeFootnotes = true; } catch (e7) {}
    try { app.findChangeTextOptions.includeHiddenLayers = true; } catch (e8) {}
    try { app.findChangeTextOptions.includeLockedLayersForFind = true; } catch (e9) {}
    try { app.findChangeTextOptions.includeLockedStoriesForFind = true; } catch (e10) {}
    try { app.findChangeTextOptions.includeMasterPages = true; } catch (e11) {}
  }
  function findGrep(doc, pat) {
    resetFind();
    setFindAllScope();
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
  function markerOff(doc, pat) {
    var f = findGrep(doc, pat);
    if (f && f.length) {
      for (var i = 0; i < f.length; i++) {
        var pg = pageOfText(f[i]);
        if (!pg) continue;
        try { return pg.documentOffset; } catch (e0) {}
      }
    }
    return -1;
  }
  function getChapterRange(doc) {
    var startOff = markerOff(doc, "^1\\.1");
    var endMarker = markerOff(doc, "^2\\.1");
    var endOff = (endMarker >= 0) ? (endMarker - 1) : (doc.pages.length - 1);
    if (startOff < 0) startOff = 0;
    if (endOff < startOff) endOff = doc.pages.length - 1;
    return { startOff: startOff, endOff: endOff };
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
    var best = -1, bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }

  function cleanText(text) {
    if (!text) return "";
    try { text = text.replace(/<\?ACE\s*\d*\s*\?>/gi, ""); } catch (e0) {}
    try { text = text.replace(/[\u0000-\u001F\u007F]/g, " "); } catch (eCtl) {}
    try { text = text.replace(/\u00AD/g, ""); } catch (eShy) {}
    try { text = text.replace(/\uFFFC/g, ""); } catch (e3) {}
    try { text = text.replace(/\s+/g, " "); } catch (e4) {}
    try { text = text.replace(/^\s+|\s+$/g, ""); } catch (e5) {}
    return text;
  }
  function normalizeFull(text) {
    var s = String(text || "").toLowerCase();
    try { s = s.replace(/[\r\n\t]/g, " "); } catch (e0) {}
    // crude de-diacritics (matches safe-v5 approach sufficiently)
    try { s = s.replace(/[àáâãäå]/g, "a"); } catch (eD1) {}
    try { s = s.replace(/æ/g, "ae"); } catch (eD2) {}
    try { s = s.replace(/ç/g, "c"); } catch (eD3) {}
    try { s = s.replace(/[èéêë]/g, "e"); } catch (eD4) {}
    try { s = s.replace(/[ìíîï]/g, "i"); } catch (eD5) {}
    try { s = s.replace(/ñ/g, "n"); } catch (eD6) {}
    try { s = s.replace(/[òóôõöø]/g, "o"); } catch (eD7) {}
    try { s = s.replace(/œ/g, "oe"); } catch (eD8) {}
    try { s = s.replace(/[ùúûü]/g, "u"); } catch (eD9) {}
    try { s = s.replace(/[ýÿ]/g, "y"); } catch (eD10) {}
    try { s = s.replace(/ß/g, "ss"); } catch (eD11) {}
    try { s = s.replace(/[^a-z0-9\s]/g, " "); } catch (e1) {}
    try { s = s.replace(/\s+/g, " "); } catch (e2) {}
    try { s = s.replace(/^\s+|\s+$/g, ""); } catch (e3) {}
    return s;
  }
  function fnv1a32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var hex = (h >>> 0).toString(16);
    return ("00000000" + hex).slice(-8);
  }
  function buildKey(originalParagraphText) {
    var n = normalizeFull(cleanText(originalParagraphText));
    if (!n) return "";
    return String(n.length) + ":" + fnv1a32(n);
  }

  function oneLine(s) {
    var t = String(s || "");
    try { t = t.replace(/\r/g, " ").replace(/\n/g, " "); } catch (e0) {}
    try { t = t.replace(/\s+/g, " "); } catch (e1) {}
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e2) {}
    return t;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("verify_json_originals__ERROR__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  // Open baseline (or reuse if already open)
  var prev = null;
  try { prev = app.activeDocument; } catch (ePrev) { prev = null; }
  var doc = null;
  try {
    for (var di = 0; di < app.documents.length; di++) {
      var d = app.documents[di];
      try { if (d.fullName && d.fullName.fsName === BASELINE_PATH) { doc = d; break; } } catch (eCmp) {}
    }
  } catch (eLoop) {}
  if (!doc) {
    try { doc = app.open(File(BASELINE_PATH), false); } catch (eOpen0) { doc = app.open(File(BASELINE_PATH)); }
  }
  try { app.activeDocument = doc; } catch (eAct) {}

  // Load JSON
  var rewritesFile = File(JSON_PATH);
  if (!rewritesFile.exists) {
    out.push("ERROR: JSON not found: " + JSON_PATH);
    writeTextToDesktop("verify_json_originals__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    try { if (prev) app.activeDocument = prev; } catch (eBack) {}
    return;
  }
  var jsonContent = "";
  rewritesFile.open("r");
  jsonContent = rewritesFile.read();
  rewritesFile.close();
  var data = null;
  try { data = eval("(" + jsonContent + ")"); } catch (eJson) { data = null; }
  if (!data || !data.paragraphs) {
    out.push("ERROR: invalid JSON shape (expected { paragraphs: [...] })");
    writeTextToDesktop("verify_json_originals__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    try { if (prev) app.activeDocument = prev; } catch (eBack2) {}
    return;
  }

  var range = getChapterRange(doc);
  var det = detectBodyStoryIndex(doc, range.startOff, range.endOff);
  var bodyStory = null;
  try { if (det.index >= 0) bodyStory = doc.stories[det.index]; } catch (eBS) { bodyStory = null; }

  out.push("=== VERIFY JSON ORIGINALS vs BASELINE INDD (CH1) ===");
  out.push("BASELINE: " + BASELINE_PATH);
  out.push("JSON:      " + JSON_PATH);
  out.push("DOC: " + doc.name);
  out.push("CH1 offsets: " + range.startOff + " -> " + range.endOff);
  out.push("Body story: index=" + det.index + " words=" + det.words);
  out.push("");

  if (!bodyStory) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("verify_json_originals__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    try { if (prev) app.activeDocument = prev; } catch (eBack3) {}
    return;
  }

  var keyMap = {};      // buildKey -> 1
  var legacy80 = {};    // prefix80 -> 1
  var legacy30 = {};    // prefix30 -> 1
  var paraCount = 0;
  try {
    for (var p = 0; p < bodyStory.paragraphs.length; p++) {
      var para = bodyStory.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;
      paraCount++;
      var k = buildKey(txt);
      if (k) keyMap[k] = 1;
      var norm = normalizeFull(cleanText(txt));
      if (norm && norm.length >= 30) {
        var p80 = norm.substring(0, 80);
        var p30 = norm.substring(0, 30);
        legacy80[p80] = 1;
        legacy30[p30] = 1;
      }
    }
  } catch (eBuild) {}

  var total = 0;
  var foundKey = 0;
  var found80 = 0;
  var found30 = 0;
  var missing = [];

  for (var i = 0; i < data.paragraphs.length; i++) {
    var r = data.paragraphs[i];
    if (!r || !r.original) continue;
    total++;
    var ok = false;
    var okKind = "";
    var k0 = buildKey(String(r.original));
    if (k0 && keyMap[k0]) { ok = true; okKind = "key"; foundKey++; }
    if (!ok) {
      var n0 = normalizeFull(cleanText(String(r.original)));
      var p80b = (n0 && n0.length >= 30) ? n0.substring(0, 80) : "";
      var p30b = (n0 && n0.length >= 20) ? n0.substring(0, 30) : "";
      if (p80b && legacy80[p80b]) { ok = true; okKind = "legacy80"; found80++; }
      else if (p30b && legacy30[p30b]) { ok = true; okKind = "legacy30"; found30++; }
    }
    if (!ok) {
      var rec = {
        id: String(r.paragraph_id || ""),
        style: String(r.style_name || ""),
        ch: String(r.chapter || ""),
        pn: String(r.paragraph_number || ""),
        orig: oneLine(String(r.original)).substring(0, 160)
      };
      missing.push(rec);
    }
  }

  out.push("Body paragraphs in range: " + paraCount);
  out.push("JSON paragraphs considered: " + total);
  out.push("Found by exact key: " + foundKey);
  out.push("Found by legacy80:  " + found80);
  out.push("Found by legacy30:  " + found30);
  out.push("Missing:            " + missing.length);
  out.push("");

  if (missing.length) {
    out.push("=== MISSING SAMPLES (up to 25) ===");
    for (var m = 0; m < missing.length && m < 25; m++) {
      var x = missing[m];
      out.push("- id=" + x.id + " ch=" + x.ch + " para=" + x.pn + " style=" + x.style);
      out.push("  original=\"" + x.orig + "\"");
    }
  }

  var reportName = "verify_json_originals__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt";
  writeTextToDesktop(reportName, out.join("\n"));

  try { if (prev) app.activeDocument = prev; } catch (eBack4) {}
})();

































