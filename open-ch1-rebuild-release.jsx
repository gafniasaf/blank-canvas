// Open the latest CH1 rebuild RELEASE file and jump to Chapter 1 start.
//
// Run:
// osascript -e 'tell application "Adobe InDesign 2026" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/open-ch1-rebuild-release.jsx" language javascript'

// Finds the newest file matching "*_CH1_REBUILD_RELEASE_*.indd" next to the baseline INDD.
var BASELINE_INDD_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

function findLatestReleasePath() {
  var baseFile = File(BASELINE_INDD_PATH);
  if (!baseFile.exists) return "";
  var folder = baseFile.parent;
  if (!folder || !folder.exists) return "";

  var files = [];
  try {
    files = folder.getFiles(function (f) {
      try {
        if (!(f instanceof File)) return false;
        var nm = String(f.name || "");
        if (nm.toLowerCase().indexOf("_ch1_rebuild_release_") === -1) return false;
        if (nm.toLowerCase().slice(-5) !== ".indd") return false;
        return true;
      } catch (e) {
        return false;
      }
    });
  } catch (e2) { files = []; }

  if (!files || files.length === 0) return "";
  // Pick newest by modified time
  files.sort(function (a, b) {
    var ta = 0, tb = 0;
    try { ta = a.modified ? a.modified.getTime() : 0; } catch (eA) { ta = 0; }
    try { tb = b.modified ? b.modified.getTime() : 0; } catch (eB) { tb = 0; }
    return tb - ta;
  });
  try { return files[0].fsName; } catch (e3) { return ""; }
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
    try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e3) {}
    return "jumped";
  }

  try { app.activeWindow.zoom(ZoomOptions.FIT_PAGE); } catch (e4) {}
  return "not_found";
}

var out = [];
var oldUI = null;
try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (eOld) { oldUI = null; }
try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (eUI) {}

try {
  var latest = findLatestReleasePath();
  if (!latest) {
    out.push("ERROR: could not find any *_CH1_REBUILD_RELEASE_*.indd next to baseline.");
  } else {
    var f = File(latest);
    if (!f.exists) {
      out.push("ERROR: file not found: " + latest);
    } else {
      var doc = findOpenDocByPath(f.fsName);
      if (!doc) {
        try { doc = app.open(f); } catch (eOpen) { doc = null; }
        if (!doc) {
          out.push("ERROR: failed to open file: " + f.fsName);
        } else {
          out.push("Opened: " + doc.name);
        }
      } else {
        out.push("Already open: " + doc.name);
      }

      if (doc) {
        try { app.activeDocument = doc; } catch (eAct) {}
        out.push("Path: " + doc.fullName.fsName);
        out.push("Chapter jump: " + jumpToChapterStart(doc));
      }
    }
  }
} catch (eTop) {
  out.push("ERROR: " + eTop);
} finally {
  try { if (oldUI !== null) app.scriptPreferences.userInteractionLevel = oldUI; } catch (eUI2) {}
}

out.join("\n");


