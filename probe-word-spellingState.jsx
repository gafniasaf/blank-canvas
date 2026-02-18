// Probe if Word objects expose spellingState / spellingStatus etc.

function has(fn) { try { fn(); return true; } catch (e) { return false; } }

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  out.push("doc=" + doc.name);
  var w = null;
  try {
    // pick a word from the first non-empty story
    for (var s = 0; s < doc.stories.length; s++) {
      var st = doc.stories[s];
      try { if (st.words.length > 10) { w = st.words[0]; break; } } catch (e0) {}
    }
  } catch (e1) { w = null; }

  if (!w) {
    out.push("ERROR: no word found");
  } else {
    out.push("word sample=\"" + String(w.contents).substr(0, 30) + "\"");
    out.push("has word.spellingState=" + has(function () { var x = w.spellingState; }));
    out.push("has word.spellingStatus=" + has(function () { var x = w.spellingStatus; }));
    out.push("has word.spellingErrors=" + has(function () { var x = w.spellingErrors; }));
    out.push("has word.isSpellingCorrect=" + has(function () { var x = w.isSpellingCorrect; }));
  }
}

out.join("\n");


































