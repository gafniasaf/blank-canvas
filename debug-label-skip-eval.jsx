#target indesign

var MAX_LABEL_FRAME_W = 700;
var MAX_LABEL_FRAME_H = 420;
var MAX_LABEL_PARA_CHARS = 300;

function ctorName(o) { try { return o && o.constructor && o.constructor.name ? o.constructor.name : ""; } catch (e0) { return ""; } }
function trimmed(s) {
  try { s = String(s || ""); } catch(e){ s = ""; }
  try { s = s.replace(/\s+/g, " "); } catch(e0) {}
  try { s = s.replace(/^\s+|\s+$/g, ""); } catch(e1) {}
  return s;
}
function gb(o) { try { return o.geometricBounds; } catch (e0) { return null; } }
function w(b) { return b ? Math.abs(b[3] - b[1]) : 0; }
function h(b) { return b ? Math.abs(b[2] - b[0]) : 0; }
function isCaptionText(text) { return /^(Afbeelding|Figuur|Tabel|Schema)\s+\d+/i.test(text || ""); }

function isLikelyLabelParagraph(para) {
  try {
    if (!para || !para.parentTextFrames || para.parentTextFrames.length === 0) return false;
    var tf = para.parentTextFrames[0];
    if (ctorName(tf) !== "TextFrame") return false;
    var b = gb(tf);
    if (!b) return false;
    if (w(b) <= MAX_LABEL_FRAME_W && h(b) <= MAX_LABEL_FRAME_H) {
      var t = "";
      try { t = trimmed(para.contents || ""); } catch (e0) { t = ""; }
      if (t && t.length <= MAX_LABEL_PARA_CHARS && !isCaptionText(t)) return true;
    }
  } catch (e1) {}
  return false;
}

function isoStamp() {
  var d = new Date();
  function z(n){return (n<10?'0':'')+n;}
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"_"+z(d.getHours())+"-"+z(d.getMinutes())+"-"+z(d.getSeconds());
}

var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath), false);
var story = doc.stories[16];

var targets = [210, 211, 212, 261];
var outPath = Folder.desktop.fsName + "/debug_label_skip_eval_" + isoStamp() + ".txt";
var f = new File(outPath);
try { f.encoding = 'UTF-8'; } catch(eE) {}
try { f.lineFeed = 'Unix'; } catch(eLF) {}

f.open('w');
f.writeln('Baseline: ' + baselinePath);
f.writeln('StoryIndex=16 paragraphs=' + story.paragraphs.length);
f.writeln('');

for (var i = 0; i < targets.length; i++) {
  var idx = targets[i];
  if (idx < 0 || idx >= story.paragraphs.length) {
    f.writeln('idx=' + idx + ' OUT_OF_RANGE');
    continue;
  }
  var para = story.paragraphs[idx];
  var txt = trimmed(para.contents || '');
  var style = '';
  try { style = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ''); } catch(eS) { style=''; }
  var pTfs = 0;
  try { pTfs = para.parentTextFrames ? para.parentTextFrames.length : 0; } catch(ePT) { pTfs = -1; }

  var b0 = null;
  var w0 = 0;
  var h0 = 0;
  try {
    if (para.parentTextFrames && para.parentTextFrames.length) {
      b0 = gb(para.parentTextFrames[0]);
      w0 = w(b0);
      h0 = h(b0);
    }
  } catch(eB0) {}

  var skip = isLikelyLabelParagraph(para);

  f.writeln('idx=' + idx + ' style=' + style + ' len=' + txt.length + ' parentTextFrames=' + pTfs);
  f.writeln('  frame0_w=' + w0 + ' frame0_h=' + h0 + ' bounds=' + (b0 ? b0.join(',') : '(null)'));
  f.writeln('  isLikelyLabelParagraph=' + (skip ? 'true' : 'false'));
  f.writeln('  text=' + txt);
  f.writeln('');
}

f.close();
doc.close(SaveOptions.NO);

