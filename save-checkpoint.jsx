// Save a timestamped checkpoint copy of the active document next to its current file.
// Safe: does not overwrite the original.

var CHECKPOINT_TAG = "CHECKPOINT";

function pad(n) { return (n < 10 ? "0" : "") + n; }
function ts() {
  var d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function safeBase(name) {
  return String(name || "doc").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "_");
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;
  var parentFolder = null;
  try { parentFolder = doc.fullName.parent; } catch (e0) { parentFolder = new Folder(Folder.desktop + "/Generated_Books"); }
  try { if (!parentFolder.exists) parentFolder.create(); } catch (e1) {}

  var outFile = new File(parentFolder.fsName + "/" + safeBase(doc.name) + "_" + CHECKPOINT_TAG + "_" + ts() + ".indd");
  var saved = "";
  try { doc.saveACopy(outFile); saved = outFile.fsName; } catch (e2) { saved = "ERROR: " + e2; }

  out.push("DOC: " + doc.name);
  out.push("saveACopy: " + saved);
}

out.join("\n");


































