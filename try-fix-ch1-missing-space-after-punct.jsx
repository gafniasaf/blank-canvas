// try-fix-ch1-missing-space-after-punct.jsx
// Diagnostic + fix: Attempt to fix "woord.Zin" patterns in CH1 body story by inserting a space after sentence punctuation.
// Writes a report to Desktop with successes/failures. Modifies document (does NOT save).

(function () {
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
  function detectBodyStoryIndex(doc, startOff, endOff) {
    var best = -1, bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = 0;
      try {
        var st = doc.stories[s];
        var pc = st.paragraphs.length;
        for (var p = 0; p < pc; p++) {
          var para = st.paragraphs[p];
          var off = paraStartPageOffset(para);
          if (off < startOff || off > endOff) continue;
          try { wc += para.words.length; } catch (eW) {}
        }
      } catch (e0) { wc = 0; }
      if (wc > bestWords) { bestWords = wc; best = s; }
    }
    return { index: best, words: bestWords };
  }
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
  function snippet(text) {
    var t = String(text || "");
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    t = t.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    t = t.replace(/\s+/g, " ");
    if (t.length > 140) t = t.substring(0, 140);
    return t;
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
  } else {
    var doc = app.activeDocument;
    var range = getChapterRange(doc);
    var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
    out.push("DOC: " + doc.name);
    out.push("CH1 offsets: " + range.startOff + " -> " + range.endOff);
    out.push("Body story index=" + body.index + " words=" + body.words);
    out.push("");

    if (body.index < 0) {
      out.push("ERROR: no body story detected");
    } else {
      var story = doc.stories[body.index];
      var pc2 = 0;
      try { pc2 = story.paragraphs.length; } catch (eP) { pc2 = 0; }
      var re = /([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g;
      var hits = 0, changed = 0, failed = 0;
      for (var p = 0; p < pc2; p++) {
        var para = story.paragraphs[p];
        var off = paraStartPageOffset(para);
        if (off < range.startOff || off > range.endOff) continue;
        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        // Preserve trailing CR
        var hasCR = false;
        if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }
        if (!re.test(txt)) continue;
        // reset lastIndex side effects
        re.lastIndex = 0;
        hits++;
        var fixed = txt.replace(re, "$1$2 $3");
        if (fixed === txt) continue;
        try {
          para.contents = fixed + (hasCR ? "\r" : "");
          changed++;
          out.push("OK pageOff=" + off + " :: " + snippet(txt) + " -> " + snippet(fixed));
        } catch (eSet) {
          failed++;
          out.push("FAIL pageOff=" + off + " err=" + String(eSet));
        }
        if (hits >= 20) break;
      }
      out.unshift("Changed: " + changed + " / Hits: " + hits + " Failed: " + failed);
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  writeTextToDesktop("try_fix_ch1_missing_space_after_punct__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__" + isoStamp() + ".txt", report);
  report;
})();


































