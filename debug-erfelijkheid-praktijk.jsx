// Find the "In de praktijk:" block about erfelijkheid/genetica and dump paragraph context around it.

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
    if (!txt) continue;
    var idx = txt.indexOf("In de praktijk:");
    if (idx < 0) continue;
    // Filter for heredity/genetics block:
    // require clear heredity terms that the mitosis block won't have.
    var lowTxt = txt.toLowerCase();
    if (lowTxt.indexOf("diplo") === -1 && lowTxt.indexOf("eicel") === -1 && lowTxt.indexOf("zaadcel") === -1) continue;

    shown++;
    try { app.select(t); } catch (e3) {}
    try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e4) {}

    var start = Math.max(0, idx - 250);
    var end = Math.min(txt.length, idx + 900);
    out.push("---- HIT " + shown + " ----");
    out.push("context_start=" + start + " idx=" + idx + " len=" + txt.length);
    out.push(esc(txt.substring(start, end)));
    break;
  }
  if (shown === 0) out.push("No heredity praktijk block found by filter.");
  out.join("\n");
}


