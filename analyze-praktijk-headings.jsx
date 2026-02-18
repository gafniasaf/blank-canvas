// Analyze occurrences of "In de praktijk" and "Verdieping" to see what precedes them
// (to reliably target headings vs normal sentence mentions).

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
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
}

function analyzeLabel(doc, label) {
  resetFind();
  app.findTextPreferences.findWhat = label;
  var f = doc.findText();
  resetFind();

  var buckets = {}; // "c2,c1" -> count
  var examples = {}; // bucket -> example before/after
  for (var i = 0; i < f.length; i++) {
    var t = f[i];
    var st = t.parentStory;
    var idx = -1;
    try { idx = t.characters[0].index; } catch (e0) { idx = -1; }
    var c1 = -1, c2 = -1;
    try { var p1 = String(st.characters[idx - 1].contents || ""); c1 = p1.length ? p1.charCodeAt(0) : -1; } catch (e1) {}
    try { var p2 = String(st.characters[idx - 2].contents || ""); c2 = p2.length ? p2.charCodeAt(0) : -1; } catch (e2) {}
    var key = String(c2) + "," + String(c1);
    buckets[key] = (buckets[key] || 0) + 1;
    if (!examples[key]) {
      var before = "";
      var after = "";
      for (var b = idx - 6; b < idx; b++) { try { before += st.characters[b].contents; } catch (eB) {} }
      for (var a = idx; a < idx + 18; a++) { try { after += st.characters[a].contents; } catch (eA) {} }
      // Replace control chars for visibility
      function esc(s) {
        return String(s || "")
          .replace(/\r/g, "{CR}")
          .replace(/\n/g, "{LF}")
          .replace(/\t/g, "{TAB}")
          .replace(/ /g, "{SP}");
      }
      examples[key] = "before=" + esc(before) + " after=" + esc(after);
    }
  }

  // Sort buckets by count
  var keys = [];
  for (var k in buckets) keys.push(k);
  keys.sort(function (a, b) { return buckets[b] - buckets[a]; });

  var out = [];
  out.push(label + " matches=" + f.length);
  for (var j = 0; j < Math.min(10, keys.length); j++) {
    var kk = keys[j];
    out.push("  prev2,prev1=" + kk + " count=" + buckets[kk] + " " + examples[kk]);
  }
  return out.join("\n");
}

var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  "ERROR: no doc";
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var out = [];
  out.push("DOC: " + doc.name);
  out.push(analyzeLabel(doc, "In de praktijk"));
  out.push("");
  out.push(analyzeLabel(doc, "Verdieping"));
  out.join("\n");
}


































