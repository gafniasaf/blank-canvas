// Probe if Paragraph objects expose justification spacing properties.

function has(fn) { try { fn(); return true; } catch (e) { return false; } }

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var para = null;
  try {
    // Find first non-empty paragraph
    for (var s = 0; s < doc.stories.length; s++) {
      var st = doc.stories[s];
      try { if (st.paragraphs.length > 0) { para = st.paragraphs[0]; break; } } catch (e0) {}
    }
  } catch (e1) { para = null; }

  if (!para) {
    out.push("ERROR: no paragraph found");
  } else {
    out.push("has para.minimumWordSpacing=" + has(function(){ var x = para.minimumWordSpacing; }));
    out.push("has para.desiredWordSpacing=" + has(function(){ var x = para.desiredWordSpacing; }));
    out.push("has para.maximumWordSpacing=" + has(function(){ var x = para.maximumWordSpacing; }));
    out.push("has para.minimumLetterSpacing=" + has(function(){ var x = para.minimumLetterSpacing; }));
    out.push("has para.desiredLetterSpacing=" + has(function(){ var x = para.desiredLetterSpacing; }));
    out.push("has para.maximumLetterSpacing=" + has(function(){ var x = para.maximumLetterSpacing; }));
    out.push("has para.minimumGlyphScaling=" + has(function(){ var x = para.minimumGlyphScaling; }));
    out.push("has para.desiredGlyphScaling=" + has(function(){ var x = para.desiredGlyphScaling; }));
    out.push("has para.maximumGlyphScaling=" + has(function(){ var x = para.maximumGlyphScaling; }));
    out.push("has para.hyphenation=" + has(function(){ var x = para.hyphenation; }));
    out.push("has para.composer=" + has(function(){ var x = para.composer; }));
  }
}

out.join("\n");


