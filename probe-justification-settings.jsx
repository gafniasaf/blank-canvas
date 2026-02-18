// Probe which justification spacing properties exist on ParagraphStyle in this InDesign version.

function has(fn) { try { fn(); return true; } catch (e) { return false; } }

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var ps = null;
  try { ps = doc.paragraphStyles[0]; } catch (e0) { ps = null; }
  if (!ps) {
    out.push("ERROR: no paragraphStyles[0]");
  } else {
    out.push("sampleStyle=" + ps.name);
    out.push("has ps.minimumWordSpacing=" + has(function(){ var x = ps.minimumWordSpacing; }));
    out.push("has ps.desiredWordSpacing=" + has(function(){ var x = ps.desiredWordSpacing; }));
    out.push("has ps.maximumWordSpacing=" + has(function(){ var x = ps.maximumWordSpacing; }));
    out.push("has ps.minimumLetterSpacing=" + has(function(){ var x = ps.minimumLetterSpacing; }));
    out.push("has ps.desiredLetterSpacing=" + has(function(){ var x = ps.desiredLetterSpacing; }));
    out.push("has ps.maximumLetterSpacing=" + has(function(){ var x = ps.maximumLetterSpacing; }));
    out.push("has ps.minimumGlyphScaling=" + has(function(){ var x = ps.minimumGlyphScaling; }));
    out.push("has ps.desiredGlyphScaling=" + has(function(){ var x = ps.desiredGlyphScaling; }));
    out.push("has ps.maximumGlyphScaling=" + has(function(){ var x = ps.maximumGlyphScaling; }));
    out.push("has ps.justificationSettings=" + has(function(){ var x = ps.justificationSettings; }));
    out.push("has ps.hyphenation=" + has(function(){ var x = ps.hyphenation; }));
    out.push("has ps.hyphenate=" + has(function(){ var x = ps.hyphenate; }));
  }
}

out.join("\n");


