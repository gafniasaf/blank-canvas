// ============================================================
// EXPORT: Design Tokens (Page/Grid/Styles/Swatches)
// ============================================================
// Purpose:
// - Extraction-only. Reads the currently active document and exports a
//   deterministic "design tokens" JSON for use by the Prince CSS generator.
// - Does NOT modify document content and does NOT save.
//
// Output (repo-relative):
// - <repo>/new_pipeline/extract/design_tokens.json
// - Desktop report: export_design_tokens__<timestamp>.txt
//
// Safety:
// - Hard-gates that a document is open.
// - Hard-gates that the active document matches (optional) EXPECT_DOC_NAME or EXPECT_DOC_PATH.
//
// Run:
// - InDesign: File > Scripts > Run Script... (select this file)
// ============================================================

#targetengine "session"

(function () {
  // --------------------------
  // Config (optional hard-gates)
  // --------------------------
  // If you want to hard-gate on a specific document name/path, fill these in:
  // var EXPECT_DOC_NAME = "MBO A&F 4_9789083251370_03.2024.indd";
  // var EXPECT_DOC_PATH_SUBSTR = "/Users/asafgafni/Downloads/MBO 2024/";
  var EXPECT_DOC_NAME = "";
  var EXPECT_DOC_PATH_SUBSTR = "";

  // --------------------------
  // Utilities
  // --------------------------
  function isoStamp() {
    function pad(n) { return String(n).length === 1 ? ("0" + String(n)) : String(n); }
    var d = new Date();
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "_" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  function safeStr(x) { try { return String(x); } catch (e) { return ""; } }
  function trimStr(s) { try { return safeStr(s).replace(/^\s+|\s+$/g, ""); } catch (e) { return safeStr(s); } }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function writeTextToPath(absPath, text) {
    try {
      var f = File(absPath);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      var parent = f.parent;
      try { if (parent && !parent.exists) parent.create(); } catch (e0) {}
      if (f.open("w")) { f.write(String(text || "")); f.close(); return true; }
    } catch (e) {}
    return false;
  }

  // Minimal JSON stringify for ExtendScript (safe for plain objects/arrays)
  function jsonEscape(s) {
    var t = safeStr(s);
    t = t.replace(/\\/g, "\\\\");
    t = t.replace(/\"/g, "\\\"");
    t = t.replace(/\u0008/g, "\\b");
    t = t.replace(/\u000c/g, "\\f");
    t = t.replace(/\n/g, "\\n");
    t = t.replace(/\r/g, "\\r");
    t = t.replace(/\t/g, "\\t");
    // Replace other control characters with spaces
    try { t = t.replace(/[\u0000-\u001F]/g, " "); } catch (eCtl) {}
    return t;
  }

  function isArray(x) { return x && x.constructor && x.constructor.name === "Array"; }

  function jsonStringify(val, indent, level) {
    indent = indent || 2;
    level = level || 0;
    function spaces(n) { var s = ""; for (var si = 0; si < n; si++) s += " "; return s; }
    var pad = spaces(level * indent);

    if (val === null) return "null";
    var t = typeof val;
    if (t === "number" || t === "boolean") return String(val);
    if (t === "string") return "\"" + jsonEscape(val) + "\"";
    if (t === "undefined") return "null";

    if (isArray(val)) {
      if (val.length === 0) return "[]";
      var outA = "[\n";
      for (var ai = 0; ai < val.length; ai++) {
        outA += pad + spaces(indent) + jsonStringify(val[ai], indent, level + 1);
        if (ai !== val.length - 1) outA += ",";
        outA += "\n";
      }
      outA += pad + "]";
      return outA;
    }

    // object
    var keys = [];
    for (var k in val) if (val.hasOwnProperty(k)) keys.push(k);
    if (keys.length === 0) return "{}";
    keys.sort();
    var outO = "{\n";
    for (var ki = 0; ki < keys.length; ki++) {
      var key = keys[ki];
      outO += pad + spaces(indent) + "\"" + jsonEscape(key) + "\": " + jsonStringify(val[key], indent, level + 1);
      if (ki !== keys.length - 1) outO += ",";
      outO += "\n";
    }
    outO += pad + "}";
    return outO;
  }

  var MM_PER_PT = 25.4 / 72.0;
  function ptToMm(pt) {
    try { return Number(pt) * MM_PER_PT; } catch (e) { return null; }
  }

  function safeGet(obj, prop) {
    try { return obj[prop]; } catch (e) { return null; }
  }

  function enumToString(v) {
    // ExtendScript enums often stringify as "[object EnumValue]"
    try {
      if (v === null || v === undefined) return null;
      if (typeof v === "string") return v;
      return safeStr(v);
    } catch (e) {
      return null;
    }
  }

  function getFontDescriptor(fontObj) {
    if (!fontObj) return null;
    try {
      return {
        name: safeStr(fontObj.name || ""),
        family: safeStr(fontObj.fontFamily || ""),
        style: safeStr(fontObj.fontStyleName || "")
      };
    } catch (e) {
      return { name: safeStr(fontObj), family: "", style: "" };
    }
  }

  function getStyleGroupPath(styleObj) {
    // Build a stable path like "Group/Subgroup/StyleName"
    var parts = [];
    try { parts.unshift(safeStr(styleObj.name)); } catch (e0) {}
    var parent = null;
    try { parent = styleObj.parent; } catch (e1) { parent = null; }
    var guard = 0;
    while (parent && guard < 50) {
      guard++;
      try {
        // ParagraphStyleGroup / CharacterStyleGroup have .name
        if (parent.name && parent.constructor && parent.constructor.name && parent.constructor.name.indexOf("StyleGroup") !== -1) {
          parts.unshift(safeStr(parent.name));
        }
      } catch (e2) {}
      try { parent = parent.parent; } catch (e3) { parent = null; }
    }
    return parts.join("/");
  }

  function extractParagraphStyle(ps) {
    var o = {
      name: safeStr(ps.name),
      path: getStyleGroupPath(ps),
      basedOn: null,
      nextStyle: null,
      appliedFont: null,
      pointSize: null,
      leading: null,
      spaceBefore: null,
      spaceAfter: null,
      firstLineIndent: null,
      leftIndent: null,
      rightIndent: null,
      justification: null,
      hyphenation: null,
      hyphenationZone: null,
      keepWithNext: null,
      keepTogether: null,
      fillColor: null,
      bulletsAndNumberingListType: null
    };

    try { o.basedOn = ps.basedOn ? safeStr(ps.basedOn.name) : null; } catch (e0) {}
    try { o.nextStyle = ps.nextStyle ? safeStr(ps.nextStyle.name) : null; } catch (e1) {}
    try { o.appliedFont = getFontDescriptor(ps.appliedFont); } catch (e2) {}
    try { o.pointSize = Number(ps.pointSize); } catch (e3) {}
    try { o.leading = Number(ps.leading); } catch (e4) {}
    try { o.spaceBefore = Number(ps.spaceBefore); } catch (e5) {}
    try { o.spaceAfter = Number(ps.spaceAfter); } catch (e6) {}
    try { o.firstLineIndent = Number(ps.firstLineIndent); } catch (e7) {}
    try { o.leftIndent = Number(ps.leftIndent); } catch (e8) {}
    try { o.rightIndent = Number(ps.rightIndent); } catch (e9) {}
    try { o.justification = enumToString(ps.justification); } catch (e10) {}
    try { o.hyphenation = !!ps.hyphenation; } catch (e11) {}
    try { o.hyphenationZone = Number(ps.hyphenationZone); } catch (e12) {}
    try { o.fillColor = ps.fillColor ? safeStr(ps.fillColor.name) : null; } catch (e13) {}
    try { o.bulletsAndNumberingListType = enumToString(ps.bulletsAndNumberingListType); } catch (e14) {}

    // Keep options live under keepOptions in some versions
    try { o.keepWithNext = !!(ps.keepOptions && ps.keepOptions.keepWithNext); } catch (e15) {}
    try { o.keepTogether = !!(ps.keepOptions && ps.keepOptions.keepLinesTogether); } catch (e16) {}

    return o;
  }

  function extractCharacterStyle(cs) {
    var o = {
      name: safeStr(cs.name),
      path: getStyleGroupPath(cs),
      basedOn: null,
      appliedFont: null,
      pointSize: null,
      fillColor: null
    };
    try { o.basedOn = cs.basedOn ? safeStr(cs.basedOn.name) : null; } catch (e0) {}
    try { o.appliedFont = getFontDescriptor(cs.appliedFont); } catch (e1) {}
    try { o.pointSize = Number(cs.pointSize); } catch (e2) {}
    try { o.fillColor = cs.fillColor ? safeStr(cs.fillColor.name) : null; } catch (e3) {}
    return o;
  }

  function extractObjectStyle(os) {
    var o = {
      name: safeStr(os.name),
      path: getStyleGroupPath(os),
      basedOn: null,
      fillColor: null,
      strokeColor: null,
      strokeWeight: null,
      cornerRadius: null,
      insetSpacing: null
    };
    try { o.basedOn = os.basedOn ? safeStr(os.basedOn.name) : null; } catch (e0) {}
    try { o.fillColor = os.fillColor ? safeStr(os.fillColor.name) : null; } catch (e1) {}
    try { o.strokeColor = os.strokeColor ? safeStr(os.strokeColor.name) : null; } catch (e2) {}
    try { o.strokeWeight = Number(os.strokeWeight); } catch (e3) {}
    try { o.cornerRadius = Number(os.topLeftCornerOption); } catch (e4) {} // fallback; varies by version
    try {
      if (os.textFramePreferences && os.textFramePreferences.insetSpacing) {
        o.insetSpacing = os.textFramePreferences.insetSpacing;
      }
    } catch (e5) {}
    return o;
  }

  function extractColorSwatch(sw) {
    var o = { name: safeStr(sw.name), space: null, model: null, colorValue: null };
    try { o.space = enumToString(sw.space); } catch (e0) {}
    try { o.model = enumToString(sw.model); } catch (e1) {}
    try { o.colorValue = sw.colorValue; } catch (e2) {}
    return o;
  }

  // --------------------------
  // Main
  // --------------------------
  var report = [];
  report.push("EXPORT DESIGN TOKENS");
  report.push("timestamp=" + isoStamp());

  if (!app.documents || app.documents.length === 0) {
    alert("No document open. Open the A&F INDD and run again.");
    return;
  }

  var doc = app.activeDocument;
  if (!doc) {
    alert("No active document.");
    return;
  }

  var docName = safeStr(doc.name || "");
  var docPath = "";
  try { docPath = doc.fullName ? safeStr(doc.fullName.fsName) : ""; } catch (ePath) { docPath = ""; }

  if (EXPECT_DOC_NAME && docName !== EXPECT_DOC_NAME) {
    alert("Active document name mismatch.\nExpected: " + EXPECT_DOC_NAME + "\nGot: " + docName);
    return;
  }
  if (EXPECT_DOC_PATH_SUBSTR && docPath.indexOf(EXPECT_DOC_PATH_SUBSTR) === -1) {
    alert("Active document path mismatch.\nExpected substring: " + EXPECT_DOC_PATH_SUBSTR + "\nGot: " + docPath);
    return;
  }

  report.push("doc.name=" + docName);
  report.push("doc.path=" + docPath);

  // Compute repo root based on this script location
  var scriptFile = File($.fileName);
  var repoRoot = scriptFile.parent;
  var outAbs = repoRoot.fsName + "/new_pipeline/extract/design_tokens.json";

  // Page preferences
  var dp = doc.documentPreferences;
  var pageWidthPt = safeGet(dp, "pageWidth");
  var pageHeightPt = safeGet(dp, "pageHeight");
  var facingPages = !!safeGet(dp, "facingPages");

  // Find representative left/right pages for margin/columns
  function firstPageBySide(sideName) {
    try {
      for (var i = 0; i < doc.pages.length; i++) {
        var pg = doc.pages[i];
        if (pg && pg.side && enumToString(pg.side).indexOf(sideName) !== -1) return pg;
      }
    } catch (e) {}
    return null;
  }

  var leftPage = firstPageBySide("LEFT");
  var rightPage = firstPageBySide("RIGHT");
  // fallback
  if (!leftPage && doc.pages.length > 0) leftPage = doc.pages[0];
  if (!rightPage && doc.pages.length > 0) rightPage = doc.pages[Math.min(1, doc.pages.length - 1)];

  function extractMarginsAndColumns(pg) {
    var mp = null;
    try { mp = pg.marginPreferences; } catch (e0) { mp = null; }
    if (!mp) return null;
    return {
      topPt: safeGet(mp, "top"),
      bottomPt: safeGet(mp, "bottom"),
      leftPt: safeGet(mp, "left"),
      rightPt: safeGet(mp, "right"),
      columnCount: safeGet(mp, "columnCount"),
      columnGutterPt: safeGet(mp, "columnGutter")
    };
  }

  var leftMC = extractMarginsAndColumns(leftPage);
  var rightMC = extractMarginsAndColumns(rightPage);

  // Baseline grid
  var gp = doc.gridPreferences;
  var baselineStartPt = safeGet(gp, "baselineStart");
  var baselineDivisionPt = safeGet(gp, "baselineDivision");

  // Representative body text frame (for actual columns/gutter used in layout)
  function findRepresentativeBodyTextFrame(doc) {
    var best = null;
    var bestScore = -1;
    try {
      for (var i = 0; i < doc.pages.length; i++) {
        var pg = doc.pages[i];
        if (!pg || !pg.isValid) continue;
        var tfs = [];
        try { tfs = pg.textFrames; } catch (e0) { tfs = []; }
        for (var j = 0; j < tfs.length; j++) {
          var tf = tfs[j];
          if (!tf || !tf.isValid) continue;
          var score = 0;
          try {
            var pref = tf.textFramePreferences;
            var c = Number(safeGet(pref, "textColumnCount") || 0);
            if (c > 1) score += 1000000;
          } catch (e1) {}
          try {
            // Prefer frames that actually contain text
            score += Number(tf.contents ? String(tf.contents).length : 0);
          } catch (e2) {}
          try {
            // Prefer larger frames (area)
            var gb = tf.geometricBounds; // [y1,x1,y2,x2] points
            var area = Math.abs((gb[2] - gb[0]) * (gb[3] - gb[1]));
            score += Math.min(area, 100000);
          } catch (e3) {}
          if (score > bestScore) {
            best = tf;
            bestScore = score;
          }
        }
      }
    } catch (eOuter) {}
    return best;
  }

  function arrPtToMm(arr) {
    if (!arr || !arr.length) return null;
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(ptToMm(arr[i]));
    return out;
  }

  var repTF = findRepresentativeBodyTextFrame(doc);
  var repTFToken = null;
  try {
    if (repTF && repTF.isValid) {
      var pref = repTF.textFramePreferences;
      var c = safeGet(pref, "textColumnCount");
      var gPt = safeGet(pref, "textColumnGutter");
      var inset = null;
      try { inset = pref.insetSpacing; } catch (eInset) { inset = null; }
      repTFToken = {
        textColumnCount: (c === null || c === undefined) ? null : Number(c),
        textColumnGutterMm: (gPt === null || gPt === undefined) ? null : ptToMm(gPt),
        insetSpacingMm: arrPtToMm(inset)
      };
    }
  } catch (eTF) {
    repTFToken = null;
  }

  // Styles
  var paraStyles = [];
  var charStyles = [];
  var objStyles = [];
  var swatches = [];

  try {
    var aps = doc.allParagraphStyles;
    for (var pi = 0; pi < aps.length; pi++) {
      var ps = aps[pi];
      if (!ps || !ps.isValid) continue;
      var n = safeStr(ps.name);
      if (n === "[No Paragraph Style]") continue;
      paraStyles.push(extractParagraphStyle(ps));
    }
  } catch (ePS) {
    report.push("WARN: failed paragraph styles: " + safeStr(ePS));
  }

  try {
    var acs = doc.allCharacterStyles;
    for (var ci = 0; ci < acs.length; ci++) {
      var cs = acs[ci];
      if (!cs || !cs.isValid) continue;
      var cn = safeStr(cs.name);
      if (cn === "[None]") continue;
      charStyles.push(extractCharacterStyle(cs));
    }
  } catch (eCS) {
    report.push("WARN: failed character styles: " + safeStr(eCS));
  }

  try {
    var aos = doc.allObjectStyles;
    for (var oi = 0; oi < aos.length; oi++) {
      var os = aos[oi];
      if (!os || !os.isValid) continue;
      var on = safeStr(os.name);
      if (on === "[None]") continue;
      objStyles.push(extractObjectStyle(os));
    }
  } catch (eOS) {
    report.push("WARN: failed object styles: " + safeStr(eOS));
  }

  try {
    for (var si = 0; si < doc.swatches.length; si++) {
      var sw = doc.swatches[si];
      if (!sw || !sw.isValid) continue;
      // Only export Color swatches when possible
      try {
        if (sw.constructor && sw.constructor.name === "Color") {
          swatches.push(extractColorSwatch(sw));
        }
      } catch (eType) {}
    }
  } catch (eSW) {
    report.push("WARN: failed swatches: " + safeStr(eSW));
  }

  // Token object (stable keys)
  var tokens = {
    meta: {
      exportedAt: isoStamp(),
      source: "indesign-active-document",
      docName: docName,
      docPath: docPath
    },
    page: {
      widthPt: pageWidthPt,
      heightPt: pageHeightPt,
      widthMm: ptToMm(pageWidthPt),
      heightMm: ptToMm(pageHeightPt),
      facingPages: facingPages
    },
    marginsAndColumns: {
      left: leftMC ? {
        topMm: ptToMm(leftMC.topPt),
        bottomMm: ptToMm(leftMC.bottomPt),
        leftMm: ptToMm(leftMC.leftPt),
        rightMm: ptToMm(leftMC.rightPt),
        columnCount: leftMC.columnCount,
        columnGutterMm: ptToMm(leftMC.columnGutterPt)
      } : null,
      right: rightMC ? {
        topMm: ptToMm(rightMC.topPt),
        bottomMm: ptToMm(rightMC.bottomPt),
        leftMm: ptToMm(rightMC.leftPt),
        rightMm: ptToMm(rightMC.rightPt),
        columnCount: rightMC.columnCount,
        columnGutterMm: ptToMm(rightMC.columnGutterPt)
      } : null
    },
    baselineGrid: {
      baselineStartMm: ptToMm(baselineStartPt),
      baselineDivisionMm: ptToMm(baselineDivisionPt)
    },
    textFrames: {
      representative: repTFToken
    },
    paragraphStyles: paraStyles,
    characterStyles: charStyles,
    objectStyles: objStyles,
    swatches: swatches
  };

  // Sort for deterministic output
  try { paraStyles.sort(function (a, b) { return safeStr(a.path).localeCompare(safeStr(b.path)); }); } catch (eS0) {}
  try { charStyles.sort(function (a, b) { return safeStr(a.path).localeCompare(safeStr(b.path)); }); } catch (eS1) {}
  try { objStyles.sort(function (a, b) { return safeStr(a.path).localeCompare(safeStr(b.path)); }); } catch (eS2) {}
  try { swatches.sort(function (a, b) { return safeStr(a.name).localeCompare(safeStr(b.name)); }); } catch (eS3) {}

  var json = jsonStringify(tokens, 2, 0);
  var ok = writeTextToPath(outAbs, json);

  if (!ok) {
    alert("Failed writing design_tokens.json to:\n" + outAbs);
  } else {
    alert("✅ Exported design tokens:\n" + outAbs);
  }

  // Report to Desktop
  report.push("out=" + outAbs);
  report.push("paragraphStyles=" + paraStyles.length);
  report.push("characterStyles=" + charStyles.length);
  report.push("objectStyles=" + objStyles.length);
  report.push("swatches(Color only)=" + swatches.length);
  writeTextToDesktop("export_design_tokens__" + isoStamp() + ".txt", report.join("\n"));
})();


