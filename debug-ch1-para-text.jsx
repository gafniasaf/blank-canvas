// debug-ch1-para-text.jsx
#target indesign
var doc = app.activeDocument;
var story = doc.stories[16];
var range = [];
// Look around 261
for (var i = 258; i <= 265; i++) {
  if (i < 0 || i >= story.paragraphs.length) continue;
  var p = story.paragraphs[i];
  var txt = p.contents.replace(/\r/g, "");
  range.push("idx=" + i + " style=" + p.appliedParagraphStyle.name + " txt=" + txt.substring(0, 100));
}
alert(range.join("\n"));


