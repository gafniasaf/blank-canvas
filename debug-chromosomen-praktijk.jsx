// Find the "In de praktijk:" block that mentions chromosomen and dump paragraph context.

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
    .replace(/\n/g, "{LF}");
}

var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  "ERROR: no doc";
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  app.findTextPreferences = NothingEnum.nothing;
  try { app.findChangeTextOptions.caseSensitive = true; } catch (e0) {}
  app.findTextPreferences.findWhat = "In de praktijk:";
  var f = doc.findText();
  app.findTextPreferences = NothingEnum.nothing;

  var out = [];
  out.push("matches=" + f.length);
  var shown = 0;
  for (var i = 0; i < f.length; i++) {
    var t = f[i];
    var para = null;
    try { para = t.paragraphs[0]; } catch (e1) { para = null; }
    if (!para) continue;
    var txt = "";
    try { txt = String(para.contents || ""); } catch (e2) { txt = ""; }
    if (txt.indexOf("chromosoom") === -1 && txt.indexOf("chromosomen") === -1) continue;
    shown++;
    // Jump to it for convenience
    try { app.select(t); } catch (e3) {}
    try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e4) {}
    out.push("---- HIT " + shown + " ----");
    var idx = txt.indexOf("In de praktijk:");
    if (idx < 0) idx = 0;
    var start = Math.max(0, idx - 300);
    var end = Math.min(txt.length, idx + 900);
    out.push("context_start=" + start + " idx=" + idx + " len=" + txt.length);
    out.push(esc(txt.substring(start, end)));
    if (shown >= 1) break;
  }
  out.join("\n");
}


