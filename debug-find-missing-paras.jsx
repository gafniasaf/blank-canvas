// ============================================================
// DEBUG: Find missing CH1 paragraphs in the ACTIVE document
// ============================================================
// Writes a report to ~/Desktop/debug_find_missing_paras.txt with:
// - keyword
// - page
// - storyIndex
// - paraIndex
// - snippet (first ~220 chars)
//
// Use this to debug why some JSON rewrites do not match paragraphs in InDesign.
// ============================================================

#targetengine "session"

(function () {
  if (app.documents.length === 0) {
    alert("No active document.");
    return;
  }

  var doc = app.activeDocument;
  var OUT = File(Folder.desktop + "/debug_find_missing_paras.txt");

  function safe(s) { try { return String(s); } catch (e) { return ""; } }
  function trimmed(s) {
    s = safe(s || "");
    try { s = s.replace(/\s+/g, " "); } catch (e0) {}
    try { s = s.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return s;
  }
  function pageNameForPara(para) {
    try {
      if (para.parentTextFrames && para.parentTextFrames.length) {
        var tf = para.parentTextFrames[0];
        var pg = tf.parentPage;
        if (pg && pg.isValid) return pg.name;
      }
    } catch (e0) {}
    return "";
  }
  function storyIndexOf(story) {
    try {
      for (var i = 0; i < doc.stories.length; i++) {
        try { if (doc.stories[i].id === story.id) return i; } catch (e0) {}
      }
    } catch (e1) {}
    return -1;
  }
  function paraIndexOf(story, para) {
    try {
      for (var i = 0; i < story.paragraphs.length; i++) {
        try { if (story.paragraphs[i].id === para.id) return i; } catch (e0) {}
      }
    } catch (e1) {}
    return -1;
  }

  // Keywords that should uniquely identify the missing paragraphs.
  // (We search with small substrings to avoid diacritic issues.)
  var keywords = [
    "mitochond",     // mitochondriën paragraph
    "verschillen tussen DNA", // DNA vs mRNA paragraph
    "chromosom",     // chromosomen paragraph
    "Osmose"         // osmose paragraph (capitalized start)
  ];

  function writeLine(line) {
    try {
      OUT.open("a");
      OUT.writeln(line);
      OUT.close();
    } catch (eW) {}
  }

  try { if (OUT.exists) OUT.remove(); } catch (eR) {}
  writeLine("Doc: " + safe(doc.name));
  try { writeLine("Path: " + (doc.fullName ? doc.fullName.fsName : "(no fullName)")); } catch (eP) {}
  writeLine("");

  try {
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
  } catch (e0) {}

  for (var k = 0; k < keywords.length; k++) {
    var kw = keywords[k];
    writeLine("=== keyword: " + kw + " ===");
    var hits = [];
    try {
      app.findTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = kw;
      hits = doc.findText();
    } catch (eFind) {
      writeLine("ERROR findText: " + String(eFind));
      writeLine("");
      continue;
    }

    writeLine("hits=" + String(hits.length));
    for (var i = 0; i < hits.length && i < 20; i++) {
      try {
        var t = hits[i];
        var para = null;
        try { para = t.paragraphs[0]; } catch (ePara0) { para = null; }
        if (!para) continue;
        var story = null;
        try { story = para.parentStory; } catch (eSt) { story = null; }
        if (!story) continue;
        var sIdx = storyIndexOf(story);
        var pIdx = paraIndexOf(story, para);
        var page = pageNameForPara(para);
        var snippet = "";
        try { snippet = trimmed(para.contents || ""); } catch (eTxt) { snippet = ""; }
        if (snippet.length > 220) snippet = snippet.substring(0, 220) + "...";
        writeLine(" - page=" + page + " storyIndex=" + sIdx + " paraIndex=" + pIdx + " :: " + snippet);
      } catch (eOne) {
        writeLine(" - ERROR hit: " + String(eOne));
      }
    }
    writeLine("");
  }

  try {
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
  } catch (e9) {}
})();


































