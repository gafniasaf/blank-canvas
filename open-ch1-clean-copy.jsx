// Open and activate the saved CH1 clean copy, and close the modified original without saving
// (since the clean copy preserves the edits).

var ORIGINAL_NAME = "MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";
var CLEAN_COPY_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720_CH1_CLEAN_20251218_141935.indd";

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var cleanFile = File(CLEAN_COPY_PATH);
  if (!cleanFile.exists) {
    out.push("ERROR: clean copy not found: " + CLEAN_COPY_PATH);
  } else {
    var cleanDoc = null;
    try { cleanDoc = app.open(cleanFile); } catch (e0) { cleanDoc = null; }
    if (cleanDoc) {
      try { app.activeDocument = cleanDoc; } catch (e1) {}
      try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e2) {}
      out.push("Opened clean copy: " + cleanDoc.name);
    } else {
      out.push("ERROR: failed to open clean copy");
    }

    // Close original if open (without saving)
    try {
      var orig = app.documents.itemByName(ORIGINAL_NAME);
      // Touch to validate
      var _n = orig.name;
      try { orig.close(SaveOptions.NO); out.push("Closed original (no save): " + ORIGINAL_NAME); } catch (e3) {}
    } catch (e4) {}
  }
}

out.join("\n");


































