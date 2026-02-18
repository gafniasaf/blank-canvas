#target indesign

function isoStamp() {
  var d = new Date();
  function z(n){return (n<10?'0':'')+n;}
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"_"+z(d.getHours())+"-"+z(d.getMinutes())+"-"+z(d.getSeconds());
}

var basePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH3_ONLY_BASELINE.indd";
var outPath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/MBO_AF4_2024_COMMON_CORE__CH3_ONLY_BASELINE_REWRITTEN_V5_SAFE.indd";

var baseDoc = app.open(File(basePath), false);
var outDoc = app.open(File(outPath), false);

var f = File(Folder.desktop + "/debug_ch3_pagecount_" + isoStamp() + ".txt");
f.encoding = 'UTF-8';
f.lineFeed = 'Unix';
f.open('w');
f.writeln('BASE pages=' + baseDoc.pages.length + ' name=' + baseDoc.name);
f.writeln('OUT  pages=' + outDoc.pages.length + ' name=' + outDoc.name);
f.close();

baseDoc.close(SaveOptions.NO);
outDoc.close(SaveOptions.NO);

