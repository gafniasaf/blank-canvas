#target indesign

function isoStamp() {
  var d = new Date();
  function z(n){return (n<10?'0':'')+n;}
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"_"+z(d.getHours())+"-"+z(d.getMinutes())+"-"+z(d.getSeconds());
}
function ctorName(o) { try { return o && o.constructor && o.constructor.name ? String(o.constructor.name) : ""; } catch (e0) { return ""; } }
function gb(o) { try { return o.geometricBounds; } catch (e0) { return null; } }
function w(b) { return b ? Math.abs(b[3] - b[1]) : 0; }
function h(b) { return b ? Math.abs(b[2] - b[0]) : 0; }
function safeText(s) {
  try { s = String(s || ""); } catch(e){ s = ""; }
  try { s = s.replace(/[\r\n]+/g, " "); } catch(e2) {}
  try { s = s.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); } catch(e3) {}
  if (s.length > 160) s = s.substring(0,160) + "...";
  return s;
}

var docPath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/MBO_AF4_2024_COMMON_CORE__CH3_ONLY_BASELINE_REWRITTEN_V5_SAFE.indd";
var doc = app.open(File(docPath), false);

var outPath = Folder.desktop.fsName + "/debug_overset_ch3_" + isoStamp() + ".txt";
var f = new File(outPath);
try { f.encoding = 'UTF-8'; } catch(eE) {}
try { f.lineFeed = 'Unix'; } catch(eLF) {}

f.open('w');
f.writeln('Doc: ' + doc.name);
f.writeln('Path: ' + docPath);
f.writeln('TextFrames: ' + doc.textFrames.length);
f.writeln('');

var count = 0;
for (var i = 0; i < doc.textFrames.length; i++) {
  var tf = doc.textFrames[i];
  if (!tf || !tf.isValid) continue;
  var ov = false;
  try { ov = !!tf.overflows; } catch(e0) { ov = false; }
  if (!ov) continue;
  count++;

  var pgName = '';
  try {
    if (tf.parentPage && tf.parentPage.isValid) pgName = String(tf.parentPage.name);
  } catch(ePg) {}

  var b = gb(tf);
  var stIdx = -1;
  try {
    var st = tf.parentStory;
    // find story index
    for (var s = 0; s < doc.stories.length; s++) {
      if (doc.stories[s] === st) { stIdx = s; break; }
    }
  } catch(eSt) {}

  var firstPara = '';
  try {
    if (tf.parentStory && tf.parentStory.paragraphs && tf.parentStory.paragraphs.length) {
      firstPara = safeText(tf.parentStory.paragraphs[0].contents);
    }
  } catch(eFP) {}

  var storyPreview = '';
  try { storyPreview = safeText(tf.parentStory.contents); } catch(eSP) {}

  f.writeln('--- OVERSET #' + count);
  f.writeln('page=' + (pgName || '(none)') + ' storyIndex=' + stIdx);
  f.writeln('bounds=' + (b ? b.join(',') : '(null)') + ' w=' + w(b) + ' h=' + h(b));
  f.writeln('firstPara=' + firstPara);
  f.writeln('storyPreview=' + storyPreview);
  f.writeln('');
}

f.writeln('TOTAL_OVERSET=' + count);
f.close();

doc.close(SaveOptions.NO);

