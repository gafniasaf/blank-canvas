// debug-ch1-para-text-v2.jsx
#target indesign
var doc = app.activeDocument;
var story = doc.stories[16];
var f = File(Folder.desktop + "/debug_ch1_para_261.txt");
var range = [];
for (var i = 258; i <= 265; i++) {
  if (i < 0 || i >= story.paragraphs.length) continue;
  var p = story.paragraphs[i];
  var txt = p.contents.replace(/[\r\n]/g, "");
  range.push("idx=" + i + " style=" + p.appliedParagraphStyle.name + " txt=" + txt);
}
f.open("w");
f.write(range.join("\n"));
f.close();


