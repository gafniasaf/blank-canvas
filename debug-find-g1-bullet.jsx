#target indesign

function isoStamp() {
  var d = new Date();
  function z(n){return (n<10?'0':'')+n;}
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"_"+z(d.getHours())+"-"+z(d.getMinutes())+"-"+z(d.getSeconds());
}

function trimmed(s){
  try { s = String(s || ""); } catch(e){ s = ""; }
  try { s = s.replace(/\s+/g,' '); } catch(e2){}
  try { s = s.replace(/^\s+|\s+$/g,''); } catch(e3){}
  return s;
}

var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath), false);

var outPath = Folder.desktop.fsName + "/debug_find_g1_bullet_" + isoStamp() + ".txt";
var f = new File(outPath);
try { f.encoding = 'UTF-8'; } catch(eE) {}
try { f.lineFeed = 'Unix'; } catch(eLF) {}

function gb(o){ try { return o.geometricBounds; } catch(e){ return null; } }
function w(b){ return b ? Math.abs(b[3]-b[1]) : 0; }
function h(b){ return b ? Math.abs(b[2]-b[0]) : 0; }

var matches = 0;

f.open('w');
f.writeln('Baseline: ' + baselinePath);
f.writeln('Stories: ' + doc.stories.length);
f.writeln('');

for (var s = 0; s < doc.stories.length; s++) {
  var story = doc.stories[s];
  var pc = 0;
  try { pc = story.paragraphs.length; } catch(ePC){ pc = 0; }
  for (var p = 0; p < pc; p++) {
    var para = story.paragraphs[p];
    var txt = '';
    try { txt = trimmed(para.contents || ''); } catch(eT){ txt = ''; }
    if (!txt) continue;

    var low = txt.toLowerCase();
    var isG1 = (low.indexOf('g1-fase') === 0);
    if (!isG1) continue;

    matches++;

    var style = '';
    try { style = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ''); } catch(eS){ style = ''; }

    var tfInfo = '';
    try {
      if (para.parentTextFrames && para.parentTextFrames.length) {
        var tf = para.parentTextFrames[0];
        var b = gb(tf);
        tfInfo = 'frame_w=' + w(b) + ' frame_h=' + h(b) + ' bounds=' + (b ? b.join(',') : '(null)');
      }
    } catch(eTF){ tfInfo = 'frame_err=' + String(eTF); }

    f.writeln('--- MATCH #' + matches);
    f.writeln('story=' + s + ' para=' + p + ' style=' + style + ' len=' + txt.length);
    f.writeln(tfInfo);
    f.writeln('text=' + txt);
    f.writeln('');
  }
}

f.writeln('TOTAL_MATCHES=' + matches);
f.close();

doc.close(SaveOptions.NO);

