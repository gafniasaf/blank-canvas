// debug-find-aerobe.jsx
#target indesign
var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath));
var f = File(Folder.desktop + "/debug_aerobe_loc.txt");
f.open("w");

for (var s = 0; s < doc.stories.length; s++) {
  var story = doc.stories[s];
  // Simple check
  var txt = story.contents;
  var idx = txt.indexOf("aerobe dissimilatie");
  if (idx !== -1) {
    f.writeln("Found in story " + s + " at index " + idx);
    // Find para index
    for (var p = 0; p < story.paragraphs.length; p++) {
      var pTxt = story.paragraphs[p].contents;
      if (pTxt.indexOf("aerobe dissimilatie") !== -1) {
        f.writeln("  Para " + p + " style=" + story.paragraphs[p].appliedParagraphStyle.name);
        f.writeln("  Content: " + pTxt.replace(/[\r\n]/g, ""));
      }
    }
  }
}
f.close();
doc.close(SaveOptions.NO);


