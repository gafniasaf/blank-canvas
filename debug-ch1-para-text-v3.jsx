// debug-ch1-para-text-v3.jsx
#target indesign
var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath));
var story = doc.stories[16]; // assuming story index 16 from previous logs
var f = File(Folder.desktop + "/debug_ch1_para_261_v3.txt");
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
doc.close(SaveOptions.NO);


