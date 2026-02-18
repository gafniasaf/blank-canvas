// Audit CH1 body text quality (text + formatting) — excludes images/labels/callouts by design.
//
// Scope:
// - Chapter 1 range: first ^1.1 to first ^2.1 (page offsets)
// - Body story only: story with max word count within CH1 range
// - Excludes:
//   - anchored-object paragraphs (U+FFFC) -> often tied to images
//   - figure-caption-like paragraphs (Afbeelding X.Y␠␠...) -> often layout-sensitive, treated as image-related
//
// Output:
// - Summary counts
// - Justification distribution in body story (CH1 range)
// - Highest-signal text anomalies with page refs/snippets
//
// Run:
// osascript -e 'with timeout of 900 seconds' -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/audit-ch1-body-quality.jsx" language javascript' -e 'end timeout'

var MAX_SAMPLES_PER_BUCKET = 14;
var IGNORE_CAPTION_PARAS = true;
var IGNORE_ANCHORED_OBJECT_PARAS = true;

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

  return {
    startOff: startOff,
    endOff: endOff,
    startPage: p1 ? String(p1.name) : "?",
    endPage: (endOff >= 0 && endOff < doc.pages.length) ? String(doc.pages[endOff].name) : "?"
  };
}

function paraStartPage(para) {
  try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e0) {}
  try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage; } catch (e1) {}
  return null;
}

function paraStartPageOffset(para) {
  var pg = paraStartPage(para);
  if (!pg) return -1;
  try { return pg.documentOffset; } catch (e) { return -1; }
}

function storyWordCountInRange(story, range) {
  var wc = 0;
  var pc = 0;
  try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var off = paraStartPageOffset(para);
    if (off < range.startOff || off > range.endOff) continue;
    try { wc += para.words.length; } catch (eW) {}
  }
  return wc;
}

function detectBodyStoryIndex(doc, range) {
  var bestIdx = -1;
  var bestWords = -1;
  for (var s = 0; s < doc.stories.length; s++) {
    var wc = storyWordCountInRange(doc.stories[s], range);
    if (wc > bestWords) { bestWords = wc; bestIdx = s; }
  }
  return { index: bestIdx, words: bestWords };
}

function hasAnchors(txt) {
  try { return String(txt || "").indexOf("\uFFFC") !== -1; } catch (e) { return false; }
}

function isCaptionLikeParaText(txt) {
  var t = "";
  try { t = String(txt || ""); } catch (e0) { t = ""; }
  if (!t) return false;
  if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
  t = t.replace(/^\s+/, "");
  try { return !!t.match(/^Afbeelding\s+\d+(?:\.\d+)?\s{2,}/); } catch (e1) { return false; }
}

function cleanSnippet(txt) {
  var t = "";
  try { t = String(txt || ""); } catch (e) { t = ""; }
  t = t.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  if (t.length > 190) t = t.substring(0, 190) + "…";
  return t;
}

function justKey(j) {
  try {
    if (j && j.toString) return String(j.toString());
  } catch (e) {}
  try { return String(j); } catch (e2) { return "unknown"; }
}

function addSample(map, key, line) {
  if (!map[key]) map[key] = [];
  if (map[key].length >= MAX_SAMPLES_PER_BUCKET) return;
  map[key].push(line);
}

function countSentenceEndings(s) {
  var t = "";
  try { t = String(s || ""); } catch (e) { t = ""; }
  // Count ., !, ? but avoid counting decimals like 7.5 or 1.2 (rough heuristic)
  var cnt = 0;
  for (var i = 0; i < t.length; i++) {
    var ch = t.charAt(i);
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    var prev = (i > 0) ? t.charAt(i - 1) : "";
    var next = (i + 1 < t.length) ? t.charAt(i + 1) : "";
    // Skip digit-dot-digit patterns
    if (ch === "." && prev >= "0" && prev <= "9" && next >= "0" && next <= "9") continue;
    cnt++;
  }
  return cnt;
}

function auditLayerParagraph(txt) {
  // Returns { issues: string[] }
  var issues = [];
  var raw = String(txt || "");
  // Strip trailing para return for analysis
  if (raw.length && raw.charAt(raw.length - 1) === "\r") raw = raw.substring(0, raw.length - 1);

  var lines = raw.split("\n");
  var praktijkLine = null;
  var verdiepingLine = null;
  for (var i = 0; i < lines.length; i++) {
    var ln = String(lines[i] || "");
    if (ln.indexOf("In de praktijk:") === 0) praktijkLine = ln;
    if (ln.indexOf("Verdieping:") === 0) verdiepingLine = ln;
  }

  function checkHeadingLine(kind, ln) {
    if (!ln) return;
    var sent = countSentenceEndings(ln);
    if (sent > 3) issues.push(kind + ": meer dan 3 zinnen (" + sent + ")");
    if (ln.indexOf(";") !== -1) issues.push(kind + ": bevat ';' (lijstopmaak/fragment?)");
    if (ln.match(/([.!?])[a-z\u00E0-\u00FF]/)) issues.push(kind + ": ontbrekende spatie na zinseinde ('.x')");
    if (ln.match(/<<BOLD_START>>|<<BOLD_END>>/)) issues.push(kind + ": bevat BOLD markers (niet opgeschoond)");
    if (ln.match(/\bSituatie\b|\bOpdracht\b|\bCriteria\b|\bVeiligheid\b/i)) issues.push(kind + ": bevat block-kopjes (niet toegestaan)");
    if (ln.length > 260) issues.push(kind + ": erg lang (" + ln.length + " chars)");
  }

  checkHeadingLine("In de praktijk", praktijkLine);
  checkHeadingLine("Verdieping", verdiepingLine);

  // If any non-empty text appears AFTER the last heading line, flag (often stray appended fragments).
  var lastIdx = -1;
  for (var j = 0; j < lines.length; j++) {
    var l2 = String(lines[j] || "");
    if (l2.indexOf("In de praktijk:") === 0 || l2.indexOf("Verdieping:") === 0) lastIdx = j;
  }
  if (lastIdx >= 0) {
    for (var k = lastIdx + 1; k < lines.length; k++) {
      var tail = String(lines[k] || "").replace(/\s+/g, "");
      if (tail.length > 0) {
        issues.push("Extra tekst na laag-blokken (na laatste kopregel)");
        break;
      }
    }
  }

  return { issues: issues };
}

var out = [];
var __docForFile = null;
if (app.documents.length === 0) {
  out.push("ERROR: geen documenten open in InDesign.");
  out.join("\n");
} else {
  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  __docForFile = doc;
  if (!doc) {
    out.push("ERROR: kon geen document bepalen (activeDocument faalde).");
    out.join("\n");
  } else {
  try { app.activeDocument = doc; } catch (eAct) {}

  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range);

  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP) {}
  out.push("CH1 range: page " + range.startPage + " -> " + range.endPage + " (offsets " + range.startOff + " -> " + range.endOff + ")");
  out.push("Body story: index=" + body.index + " words=" + body.words);
  out.push("");

  if (body.index < 0) {
    out.push("ERROR: kon body story niet bepalen.");
    out.join("\n");
  } else {
    var story = doc.stories[body.index];

    var counts = {
      parasTotal: 0,
      parasSkippedCaptions: 0,
      parasSkippedAnchors: 0,
      layerParas: 0
    };

    var justCounts = {};
    var issuesByBucket = {}; // bucket -> sample strings

    var pc = 0;
    try { pc = story.paragraphs.length; } catch (ePC) { pc = 0; }

    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;

      var pg = paraStartPage(para);
      var pageName = pg ? String(pg.name) : "?";

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (!txt) continue;

      // Exclusions
      if (IGNORE_ANCHORED_OBJECT_PARAS && hasAnchors(txt)) { counts.parasSkippedAnchors++; continue; }
      if (IGNORE_CAPTION_PARAS && isCaptionLikeParaText(txt)) { counts.parasSkippedCaptions++; continue; }

      counts.parasTotal++;

      // Justification distribution
      try {
        var jk = justKey(para.justification);
        justCounts[jk] = (justCounts[jk] || 0) + 1;
      } catch (eJ) {}

      var snippet = cleanSnippet(txt);
      var ref = "page=" + pageName + " off=" + off + " :: " + snippet;

      // General textual anomalies (teacher mode)
      // 1) leftover markers
      if (txt.match(/<<BOLD_START>>|<<BOLD_END>>/)) addSample(issuesByBucket, "BOLD markers gevonden", ref);

      // 2) suspicious missing space after sentence punctuation when next char is lowercase (e.g. "woord.zin")
      if (txt.match(/([A-Za-z\u00C0-\u00FF0-9])([.!?])([a-z\u00E0-\u00FF])/)) addSample(issuesByBucket, "Ontbrekende spatie na zinseinde ('.x')", ref);

      // 3) double punctuation
      if (txt.match(/\.{2,}|,{2,}|;{2,}|:{2,}|\?\?|!!/)) addSample(issuesByBucket, "Dubbele leestekens", ref);

      // 4) space before punctuation
      if (txt.match(/ ([,.;:!?])/)) addSample(issuesByBucket, "Spatie vóór leesteken", ref);

      // 5) weird invisible characters
      if (txt.indexOf("\u00AD") !== -1) addSample(issuesByBucket, "Soft hyphen (U+00AD) aanwezig", ref);
      if (txt.indexOf("\u00A0") !== -1) addSample(issuesByBucket, "Non‑breaking space (U+00A0) aanwezig", ref);

      // Layer paragraphs deep check
      var isLayer = (txt.indexOf("In de praktijk:") !== -1) || (txt.indexOf("Verdieping:") !== -1);
      if (isLayer) {
        counts.layerParas++;
        // Formatting rule: keep book layout consistent — layer paragraphs should also be LEFT_JUSTIFIED
        // (requirement: last line aligned left; avoid FULLY_JUSTIFIED).
        try {
          if (para.justification !== Justification.LEFT_JUSTIFIED) addSample(issuesByBucket, "OPMAAK: laag-alinea niet LEFT_JUSTIFIED", "page=" + pageName + " off=" + off + " just=" + justKey(para.justification));
        } catch (eJL) {}

        var layerAudit = auditLayerParagraph(txt);
        for (var ii = 0; ii < layerAudit.issues.length; ii++) {
          addSample(issuesByBucket, "LAAGTEKST: " + layerAudit.issues[ii], ref);
        }
      }
    }

    out.push("SCOPE (body story only, CH1 range):");
    out.push(" - paragraphs analyzed: " + counts.parasTotal);
    out.push(" - skipped anchored-object paras: " + counts.parasSkippedAnchors);
    out.push(" - skipped caption-like paras: " + counts.parasSkippedCaptions);
    out.push(" - layer paragraphs (contain In de praktijk:/Verdieping:): " + counts.layerParas);
    out.push("");

    out.push("JUSTIFICATION DISTRIBUTION (body story, CH1 range):");
    for (var k in justCounts) {
      out.push(" - " + k + ": " + justCounts[k]);
    }
    out.push("");

    function dumpBucket(title) {
      var arr = issuesByBucket[title];
      if (!arr || arr.length === 0) return;
      out.push(title + " (" + arr.length + " samples):");
      for (var i = 0; i < arr.length; i++) out.push(" - " + arr[i]);
      out.push("");
    }

    // Print in descending "severity"/signal order
    dumpBucket("OPMAAK: laag-alinea niet LEFT_JUSTIFIED");
    dumpBucket("LAAGTEKST: Extra tekst na laag-blokken (na laatste kopregel)");
    dumpBucket("LAAGTEKST: In de praktijk: bevat ';' (lijstopmaak/fragment?)");
    dumpBucket("LAAGTEKST: Verdieping: bevat ';' (lijstopmaak/fragment?)");
    dumpBucket("LAAGTEKST: In de praktijk: ontbrekende spatie na zinseinde ('.x')");
    dumpBucket("LAAGTEKST: Verdieping: ontbrekende spatie na zinseinde ('.x')");
    dumpBucket("Ontbrekende spatie na zinseinde ('.x')");
    dumpBucket("Dubbele leestekens");
    dumpBucket("Spatie vóór leesteken");
    dumpBucket("BOLD markers gevonden");
    dumpBucket("Soft hyphen (U+00AD) aanwezig");
    dumpBucket("Non‑breaking space (U+00A0) aanwezig");

    out.push("DONE.");
  }
  }
}

out.join("\n");

// Persist to Desktop so it can be reviewed alongside the other suite reports.
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

try {
  var nameForFile = "no_doc";
  try {
    if (__docForFile && __docForFile.isValid) nameForFile = __docForFile.name;
    else if (app.documents.length > 0) nameForFile = app.documents[0].name;
  } catch (eN) { nameForFile = "no_doc"; }
  writeTextToDesktop("audit_ch1_body_quality__" + safeFileName(nameForFile) + "__" + isoStamp() + ".txt", out.join("\n"));
} catch (eW) {}



