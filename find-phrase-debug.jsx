// Find a phrase in the active document and dump paragraph context.

var PHRASE = "eigenschappen van hun ouders";

function esc(s) {
  return String(s || "")
    .replace(/\r/g, "{CR}")
    .replace(/\n/g, "{LF}");
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  app.findTextPreferences = NothingEnum.nothing;
  app.findTextPreferences.findWhat = PHRASE;
  var f = doc.findText();
  app.findTextPreferences = NothingEnum.nothing;
  out.push("phrase=\"" + PHRASE + "\" matches=" + f.length);
  if (f.length > 0) {
    var t = f[0];
    try { app.select(t); } catch (e0) {}
    try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e1) {}
    var para = null;
    try { para = t.paragraphs[0]; } catch (e2) { para = null; }
    if (para) {
      var txt = "";
      try { txt = String(para.contents || ""); } catch (e3) { txt = ""; }
      var idx = txt.indexOf("In de praktijk:");
      out.push("paraLen=" + txt.length + " praktijkIdx=" + idx);
      if (idx >= 0) {
        var start = Math.max(0, idx - 200);
        var end = Math.min(txt.length, idx + 800);
        out.push(esc(txt.substring(start, end)));
      } else {
        out.push(esc(txt.substring(0, Math.min(800, txt.length))));
      }
    }
  }
}

out.join("\n");


































