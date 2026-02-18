// Debug: inspect whether baseline INDD paragraphs/textframes carry stable UUID labels
// Usage (macOS):
//   osascript -e 'with timeout of 600 seconds' -e 'tell application id "com.adobe.InDesign" to do script POSIX file "/Users/asafgafni/Desktop/InDesign/TestRun/scripts/debug-paragraph-labels.jsx" language javascript' -e 'end timeout'
#target indesign

(function () {
  var LOG = File(Folder.desktop + "/debug_paragraph_labels.txt");
  function w(s) {
    try {
      LOG.open("a");
      LOG.writeln(String(s));
      LOG.close();
    } catch (e) {}
  }

  try { if (LOG.exists) LOG.remove(); } catch (e0) {}
  w("=== debug-paragraph-labels.jsx ===");
  w("Started: " + String(new Date()));

  // Pick one baseline book (Communicatie) as a test
  var INDD = File("/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO Communicatie_9789083251387_03/MBO Communicatie_9789083251387_03.2024.indd");
  if (!INDD.exists) {
    w("ERROR: INDD not found: " + INDD.fsName);
    alert("INDD not found:\n" + INDD.fsName);
    return;
  }

  var oldUI = null;
  try { oldUI = app.scriptPreferences.userInteractionLevel; } catch (e1) { oldUI = null; }
  try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT; } catch (e2) {}

  var doc = null;
  try { doc = app.open(INDD, true); } catch (e3) { try { doc = app.open(INDD); } catch (e4) { doc = null; } }
  if (!doc) {
    w("ERROR: failed to open INDD");
    alert("Failed to open INDD:\n" + INDD.fsName);
    return;
  }
  try { app.activeDocument = doc; } catch (e5) {}
  w("Opened: " + doc.name);
  w("Stories: " + String(doc.stories.length));

  // Pick the largest story by word count (heuristic for main body)
  var bestIdx = -1;
  var bestWords = -1;
  for (var i = 0; i < doc.stories.length; i++) {
    var st = doc.stories[i];
    var wc = 0;
    try { wc = st.words.length; } catch (eW) { wc = 0; }
    if (wc > bestWords) { bestWords = wc; bestIdx = i; }
  }
  w("Main story heuristic: idx=" + String(bestIdx) + " words=" + String(bestWords));
  if (bestIdx < 0) return;

  var story = doc.stories[bestIdx];
  var n = Math.min(40, story.paragraphs.length);
  w("Inspecting first " + String(n) + " paragraphs:");

  for (var p = 0; p < n; p++) {
    var para = story.paragraphs[p];
    var txt = "";
    try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
    try { if (txt.length && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1); } catch (eTr) {}
    try { txt = txt.replace(/\s+/g, " ").substr(0, 140); } catch (eN) {}

    var styleName = "";
    try { styleName = String(para.appliedParagraphStyle.name || ""); } catch (eS) { styleName = ""; }

    var paraLabel = "";
    try { paraLabel = String(para.label || ""); } catch (eL0) { paraLabel = ""; }

    var frameLabel = "";
    try {
      var tf = para.parentTextFrames && para.parentTextFrames.length ? para.parentTextFrames[0] : null;
      if (tf) frameLabel = String(tf.label || "");
    } catch (eL1) { frameLabel = ""; }

    w("[" + String(p) + "] style=" + styleName + " para.label=" + paraLabel + " frame.label=" + frameLabel + " :: " + txt);
  }

  w("Done.");
  alert("Wrote Desktop/debug_paragraph_labels.txt");
}());


