// Save a clean copy of the current CH1 preview document next to the original.
// Keeps the original file untouched (safe).

var TARGET_DOC_NAME = "MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

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
  var doc = null;
  try { doc = app.documents.itemByName(TARGET_DOC_NAME); } catch (e0) { doc = app.activeDocument; }
  try { app.activeDocument = doc; } catch (eA) {}

  var parentFolder = null;
  try { parentFolder = doc.fullName.parent; } catch (e1) { parentFolder = new Folder(Folder.desktop + "/Generated_Books"); }
  try { if (!parentFolder.exists) parentFolder.create(); } catch (e2) {}

  var outFile = new File(parentFolder.fsName + "/" + safeBase(doc.name) + "_CH1_CLEAN_" + ts() + ".indd");
  var saved = "";
  try {
    doc.saveACopy(outFile);
    saved = outFile.fsName;
  } catch (eSave) {
    saved = "ERROR: " + eSave;
  }

  out.push("DOC: " + doc.name);
  out.push("saveACopy: " + saved);
  out.push("NOTE: original not overwritten.");
}

out.join("\n");


































