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

var outPathIndd = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE_REWRITTEN_V5_SAFE_V22.indd";
var doc = app.open(File(outPathIndd), false);

var outPath = Folder.desktop.fsName + "/debug_check_output_aerobe_" + isoStamp() + ".txt";
var f = new File(outPath);
try { f.encoding = 'UTF-8'; } catch(eE) {}
try { f.lineFeed = 'Unix'; } catch(eLF) {}

var find1 = 'aerobe dissimilatie:';
var find2 = 'aerobe dissimilatie.';

var count1 = 0;
var count2 = 0;

f.open('w');
f.writeln('Doc: ' + doc.name);
f.writeln('Path: ' + outPathIndd);
f.writeln('Stories: ' + doc.stories.length);
f.writeln('');

for (var s = 0; s < doc.stories.length; s++) {
  var story = doc.stories[s];
  var txt = '';
  try { txt = String(story.contents || ''); } catch(eT) { txt = ''; }
  if (!txt) continue;

  var idx1 = txt.indexOf(find1);
  while (idx1 !== -1) {
    count1++;
    idx1 = txt.indexOf(find1, idx1 + find1.length);
  }

  var idx2 = txt.indexOf(find2);
  while (idx2 !== -1) {
    count2++;
    idx2 = txt.indexOf(find2, idx2 + find2.length);
  }
}

f.writeln('count("' + find1 + '")=' + count1);
f.writeln('count("' + find2 + '")=' + count2);
f.writeln('');

// Find exact bullet paragraph by scanning paragraphs in story 16 (if exists)
try {
  if (doc.stories.length > 16) {
    var st = doc.stories[16];
    var pc = st.paragraphs.length;
    for (var p = 0; p < pc; p++) {
      var para = st.paragraphs[p];
      var pTxt = trimmed(para.contents || '');
      if (pTxt.toLowerCase().indexOf('aerobe dissimilatie') === 0 && pTxt.toLowerCase().indexOf('bij dit proces') !== -1) {
        f.writeln('FOUND paragraph in story 16 para ' + p + ' len=' + pTxt.length);
        f.writeln(pTxt);
        f.writeln('');
      }
    }
  }
} catch(eP) {
  f.writeln('ERROR scanning story16 paragraphs: ' + String(eP));
}

f.close();
doc.close(SaveOptions.NO);

