// Probe InDesign ExtendScript spell-check related APIs (best-effort).

function has(fn) {
  try { fn(); return true; } catch (e) { return false; }
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  out.push("doc=" + doc.name);

  out.push("doc.spellingErrors exists=" + has(function () { var x = doc.spellingErrors; }));
  out.push("doc.spellingErrors.length exists=" + has(function () { var x = doc.spellingErrors.length; }));

  out.push("app.spellCheckPreferences exists=" + has(function () { var x = app.spellCheckPreferences; }));
  out.push("app.spellPreferences exists=" + has(function () { var x = app.spellPreferences; }));
  out.push("app.findChangeSpellOptions exists=" + has(function () { var x = app.findChangeSpellOptions; }));
  out.push("app.findChangeTextOptions exists=" + has(function () { var x = app.findChangeTextOptions; }));

  // Try document spelling preferences if present
  out.push("doc.spellCheckPreferences exists=" + has(function () { var x = doc.spellCheckPreferences; }));
  out.push("doc.spellPreferences exists=" + has(function () { var x = doc.spellPreferences; }));
}

out.join("\n");


































