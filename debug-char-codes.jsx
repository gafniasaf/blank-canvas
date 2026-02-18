// debug-char-codes.jsx
#target indesign
var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath));
var f = File(Folder.desktop + "/debug_char_codes.txt");
f.open("w");

// Find "aerobe dissimilatie" again and dump first 50 chars as codes
for (var s = 0; s < doc.stories.length; s++) {
  var story = doc.stories[s];
  for (var p = 0; p < story.paragraphs.length; p++) {
    var pTxt = story.paragraphs[p].contents;
    if (pTxt.indexOf("aerobe dissimilatie") !== -1) {
      f.writeln("Story " + s + " Para " + p);
      f.writeln("Text: " + pTxt.substring(0, 50));
      var codes = [];
      for (var i = 0; i < Math.min(50, pTxt.length); i++) {
        codes.push(pTxt.charCodeAt(i));
      }
      f.writeln("Codes: " + codes.join(","));
    }
  }
}
f.close();
doc.close(SaveOptions.NO);


