// Debug helper: find any line-start occurrences of "In de praktijk" / "Verdieping" in the CH1 BODY story
// that are NOT followed by a ':' (strict Option A requires "In de praktijk:" / "Verdieping:").
//
// Output: ~/Desktop/debug_nonlabel_line_starts__<doc>__<timestamp>.txt
//
// Run on the ACTIVE document.

#targetengine "session"

(function () {
  function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }
  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "_");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) s = "doc";
    return s;
  }
  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) {
    writeTextToDesktop("debug_nonlabel_line_starts__no_doc__" + isoStamp() + ".txt", "ERROR: no active document");
    return;
  }

  function resetFind() {
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e0) {}
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e1) {}
  }
  function findGrep(pat) {
    resetFind();
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
  function paraStartPageOffset(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage.documentOffset; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset; } catch (e1) {}
    return -1;
  }
  function paraStartPageName(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return String(tf.parentPage.name); } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return String(tf2.parentPage.name); } catch (e1) {}
    return "?";
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
  function detectBodyStoryIndex(startOff, endOff) {
    var best = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try { wc = storyWordCountInRange(doc.stories[s], startOff, endOff); } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }

  // Range: ^1.1 .. ^2.1-1, but if ^2.1 is before start (TOC), fall back to doc end.
  var f1 = findGrep("^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var f2 = findGrep("^2\\.1");
  var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
  var endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
  if (endOff < startOff) endOff = doc.pages.length - 1;

  var body = detectBodyStoryIndex(startOff, endOff);
  var out = [];
  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + startOff + " -> " + endOff);
  out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: could not detect body story");
    writeTextToDesktop("debug_nonlabel_line_starts__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
    return;
  }

  var story = doc.stories[body.index];
  var tokens = ["In de praktijk", "Verdieping"];
  var hits = 0;
  var pc2 = 0;
  try { pc2 = story.paragraphs.length; } catch (ePC) { pc2 = 0; }

  function cleanForLog(s) {
    var t = "";
    try { t = String(s || ""); } catch (e0) { t = ""; }
    try { t = t.replace(/\r/g, "").replace(/\n/g, "\\n"); } catch (e1) {}
    if (t.length > 260) t = t.substring(0, 260) + "…";
    return t;
  }

  for (var p = 0; p < pc2; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < startOff || off > endOff) continue;

    var txt = "";
    try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
    if (!txt) continue;
    if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);

    // Only consider paras containing either token (case-insensitive) to keep scan fast.
    var lowTxt = "";
    try { lowTxt = txt.toLowerCase(); } catch (eLow) { lowTxt = ""; }
    if (lowTxt.indexOf("praktijk") === -1 && lowTxt.indexOf("verdieping") === -1) continue;

    var lines = [];
    try { lines = txt.split("\n"); } catch (eS) { lines = [txt]; }
    for (var li = 0; li < lines.length; li++) {
      var rawLine = String(lines[li] || "");
      // Trim leading horizontal whitespace only
      var line = rawLine.replace(/^[ \t\u00A0]+/, "");
      var low = "";
      try { low = line.toLowerCase(); } catch (eL0) { low = ""; }
      for (var ti = 0; ti < tokens.length; ti++) {
        var tok = tokens[ti];
        var tokLow = tok.toLowerCase();
        if (low.indexOf(tokLow) !== 0) continue;
        var chAfter = (line.length > tok.length) ? line.charAt(tok.length) : "";
        if (chAfter === ":") continue;

        hits++;
        if (hits <= 25) {
          out.push("HIT pageOff=" + off + " page=" + paraStartPageName(para) + " lineIdx=" + li + " token=" + tok);
          out.push("  line=" + cleanForLog(line));
          out.push("  para=" + cleanForLog(txt));
          out.push("");
        }
      }
    }
  }

  out.unshift("nonLabelLineStarts_total=" + hits);
  writeTextToDesktop("debug_nonlabel_line_starts__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", out.join("\n"));
})();
































