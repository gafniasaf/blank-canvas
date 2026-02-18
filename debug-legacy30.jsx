// debug-legacy30.jsx
#target indesign

function cleanText(text) {
  if (!text) return "";
  var t = text.replace(/<\?ACE\s*\d*\s*\?>/gi, "");
  t = t.replace(/[\u0000-\u001F\u007F]/g, " ");
  t = t.replace(/\u00AD/g, "");
  t = t.replace(/<<BOLD_START>>/g, "");
  t = t.replace(/<<BOLD_END>>/g, "");
  t = t.replace(/\uFFFC/g, "");
  t = t.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  return t;
}

function normalizeFull(text) {
  if (!text) return "";
  var s = text.toLowerCase();
  s = s.replace(/[\r\n\t]/g, " ");
  s = s.replace(/[àáâãäå]/g, "a");
  s = s.replace(/æ/g, "ae");
  s = s.replace(/ç/g, "c");
  s = s.replace(/[èéêë]/g, "e");
  s = s.replace(/[ìíîï]/g, "i");
  s = s.replace(/ñ/g, "n");
  s = s.replace(/[òóôõöø]/g, "o");
  s = s.replace(/œ/g, "oe");
  s = s.replace(/[ùúûü]/g, "u");
  s = s.replace(/[ýÿ]/g, "y");
  s = s.replace(/ß/g, "ss");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^\s+|\s+$/g, "");
  return s;
}

var baselinePath = Folder.desktop.fsName + "/Generated_Books/MBO_AF4_2024_COMMON_CORE/_chapter_baselines/MBO_AF4_2024_COMMON_CORE__CH1_ONLY_BASELINE.indd";
var doc = app.open(File(baselinePath));

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
  var pTxt = story.paragraphs[pIndex].contents;
  var norm = normalizeFull(cleanText(pTxt));
  var leg30 = norm.substring(0, 30);
  
  var f = File(Folder.desktop + "/debug_legacy30_check.txt");
  f.open("w");
  f.writeln("Found at para " + pIndex);
  f.writeln("Raw: " + pTxt.substring(0, 50));
  f.writeln("Clean: " + cleanText(pTxt).substring(0, 50));
  f.writeln("Norm: " + norm.substring(0, 50));
  f.writeln("Legacy30: '" + leg30 + "'");
  
  // Check against JSON expected
  var jsonItem = "aerobe dissimilatie: bij dit proces speelt zuurstof een belangrijke rol. Glucose en zuurstof reageren met elkaar. Bij deze reactie komen koolstofdioxide, water en energie vrij:glucose + zuurstof à koolstofdioxide + water + energie;";
  var jsonNorm = normalizeFull(cleanText(jsonItem));
  var jsonLeg30 = jsonNorm.substring(0, 30);
  
  f.writeln("JSON Legacy30: '" + jsonLeg30 + "'");
  f.writeln("Match? " + (leg30 === jsonLeg30));
  f.close();
} else {
  alert("Could not find paragraph");
}

doc.close(SaveOptions.NO);


