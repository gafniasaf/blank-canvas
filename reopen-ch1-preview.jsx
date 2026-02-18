// Close and reopen the CH1 preview document in InDesign.
// - If modified, tries to save; if save fails, saves a copy and reopens that copy.
// - After opening, jumps to the first ^1.1 marker (best effort) and fits page.

var TARGET_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

function pad(n) { return (n < 10 ? "0" : "") + n; }
function ts() {
  var d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function safeBase(name) {
  return String(name || "doc").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "_");
}

function findOpenDocByPath(path) {
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) return d; } catch (e) {}
  }
  return null;
}

function resetFind() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
}

function setCaseInsensitive() {
  try { app.findChangeGrepOptions.caseSensitive = false; } catch (e) {}
  try { app.findChangeTextOptions.caseSensitive = false; } catch (e2) {}
}

function pageOfText(textObj) {
  try {
    var tf = textObj.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e) {}
  return null;
}

function jumpToChapterStart(doc) {
  resetFind();
  setCaseInsensitive();
  app.findGrepPreferences.findWhat = "^1\\.1";
  var f = [];
  try { f = doc.findGrep(); } catch (e) { f = []; }
  resetFind();
  if (f && f.length > 0) {
    var pg = pageOfText(f[0]);
    if (pg) {
      try { app.activeWindow.activePage = pg; } catch (e1) {}
    }
    try { app.select(f[0]); } catch (e2) {}
  }
  try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e3) {}
  return (f && f.length > 0) ? "jumped" : "not_found";
}

var out = [];
var oldUI = app.scriptPreferences.userInteractionLevel;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

try {
  var f = File(TARGET_PATH);
  if (!f.exists) {
    out.push("ERROR: file not found: " + TARGET_PATH);
  } else {
    var doc = findOpenDocByPath(TARGET_PATH);
    var prevPageName = "";
    if (doc) {
      try { app.activeDocument = doc; } catch (eAct) {}
      try { prevPageName = String(app.activeWindow.activePage.name || ""); } catch (ePg) { prevPageName = ""; }

      var saveStatus = "not_modified";
      try {
        if (doc.modified) {
          try {
            doc.save();
            saveStatus = "saved";
          } catch (eSave) {
            saveStatus = "save_error: " + eSave;
            // Fallback: save a copy next to the original
            try {
              var parentFolder = doc.fullName.parent;
              var copyPath = parentFolder.fsName + "/AUTOSAVE_" + safeBase(doc.name) + "_" + ts() + ".indd";
              var outFile = new File(copyPath);
              doc.saveACopy(outFile);
              saveStatus = "saveACopy: " + outFile.fsName;
              // Switch target to the copy so we don't lose edits
              f = outFile;
            } catch (eCopy) {
              saveStatus = saveStatus + " | saveACopy_error: " + eCopy;
            }
          }
        }
      } catch (eMod) {}

      try { doc.close(SaveOptions.NO); } catch (eClose) {}
      out.push("Closed: " + doc.name + " (" + saveStatus + ")");
    } else {
      out.push("Doc was not open; opening fresh.");
    }

    var opened = app.open(f);
    try { app.activeDocument = opened; } catch (eA2) {}

    // Try to restore page first, then jump to chapter start as a fallback
    var restored = "no";
    if (prevPageName) {
      try {
        var p = opened.pages.itemByName(prevPageName);
        var _ = p.name; // validate
        app.activeWindow.activePage = p;
        restored = "yes (" + prevPageName + ")";
      } catch (eRest) { restored = "no"; }
    }

    var jumped = jumpToChapterStart(opened);
    out.push("Opened: " + opened.name + " path=" + opened.fullName.fsName);
    out.push("Restore page: " + restored);
    out.push("Chapter jump: " + jumped);
  }
} catch (eTop) {
  out.push("ERROR: " + eTop);
} finally {
  try { app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI) {}
}

out.join("\n");


































