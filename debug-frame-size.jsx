// debug-frame-size.jsx
#target indesign
var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath));
var f = File(Folder.desktop + "/debug_frame_size.txt");
f.open("w");

// Story 16, find "aerobe"
var story = doc.stories[16];
var pIndex = -1;
for(var i=0; i<story.paragraphs.length; i++) {
  if(story.paragraphs[i].contents.indexOf("aerobe dissimilatie") !== -1) {
    pIndex = i;
    break;
  }
}

if(pIndex !== -1) {
  var p = story.paragraphs[pIndex];
  if (p.parentTextFrames && p.parentTextFrames.length > 0) {
    var tf = p.parentTextFrames[0];
    var b = tf.geometricBounds; // [y1, x1, y2, x2]
    var w = Math.abs(b[3] - b[1]);
    var h = Math.abs(b[2] - b[0]);
    f.writeln("Para " + pIndex + " Frame Bounds: " + b.join(","));
    f.writeln("W=" + w + " H=" + h);
    f.writeln("Length=" + p.contents.length);
  } else {
    f.writeln("No parent text frame");
  }
} else {
  f.writeln("Para not found");
}
f.close();
doc.close(SaveOptions.NO);


