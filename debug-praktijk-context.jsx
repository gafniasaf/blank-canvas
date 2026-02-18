// Debug helper: inspect how "In de praktijk" appears in the document text stream.
// Prints the first match context (chars before/after) and first character fontStyle.

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

function esc(s) {
  return String(s || "")
    .replace(/\r/g, "{CR}")
    .replace(/\n/g, "{LF}")
    .replace(/\t/g, "{TAB}")
    .replace(/ /g, "{SP}");
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: no doc");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  app.findTextPreferences = NothingEnum.nothing;
  app.findTextPreferences.findWhat = "In de praktijk";
  var f = doc.findText();
  app.findTextPreferences = NothingEnum.nothing;

  out.push("DOC: " + doc.name);
  out.push("matches=" + f.length);
  if (f.length > 0) {
    var t = f[0];
    var st = t.parentStory;
    var idx = -1;
    try { idx = t.characters[0].index; } catch (e0) { idx = -1; }
    var before = "";
    var after = "";
    for (var i = idx - 30; i < idx; i++) {
      try { before += st.characters[i].contents; } catch (e1) {}
    }
    for (var j = idx; j < idx + 18; j++) {
      try { after += st.characters[j].contents; } catch (e2) {}
    }
    var fs = "";
    try { fs = t.characters[0].fontStyle; } catch (e3) { fs = ""; }
    out.push("idx=" + idx);
    out.push("before=" + esc(before));
    out.push("after=" + esc(after));
    out.push("fontStyle=" + fs);
    // Show raw codes for the 5 chars immediately before the match
    try {
      var codes = [];
      for (var k = idx - 5; k < idx; k++) {
        var ch = "";
        try { ch = String(st.characters[k].contents); } catch (eC) { ch = ""; }
        var code = ch && ch.length ? ch.charCodeAt(0) : -1;
        codes.push(code);
      }
      out.push("prev5_codes=" + codes.join(","));
    } catch (eCodes) {}
  }
}

out.join("\n");


