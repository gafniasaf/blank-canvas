// ============================================================
// AUDIT CH1 - ALL ISSUES REPORT (read-only)
// ============================================================
// Scans the ACTIVE document for Chapter 1 issues:
// - Links/fonts (quick)
// - Overset frames on CH1 pages
// - Body story detection (largest WC in CH1 range)
// - Headings "In de praktijk:" / "Verdieping:" rules:
//    - label exists
//    - label is bold
//    - preceded by \n\n (skipped line) inside same paragraph
//    - after colon: lowercase start (except abbreviation-like tokens)
//    - paragraph justification LEFT_ALIGN
// - Justification anomalies (FULLY_JUSTIFIED anywhere in body story)
// - singleWordJustification should be LEFT_ALIGN (report only)
// - Whitespace/glue issues in body story (double spaces, space-before-punct, missing-space-after-punct)
// - Bullet/list anomalies (isolated bullets in body story)
// - Stray stories inside CH1 (non-body, words>=15)
//
// Writes a single report to ~/Desktop/audit_ch1_all_issues__<doc>__<timestamp>.txt
// ============================================================

#targetengine "session"

(function () {
  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) s = "doc";
    return s;
  }
  function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }
  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  function resetFind() {
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
    try { app.changeTextPreferences = NothingEnum.nothing; } catch (e2) {}
    try { app.findGrepPreferences = NothingEnum.nothing; } catch (e3) {}
    try { app.changeGrepPreferences = NothingEnum.nothing; } catch (e4) {}
  }
  function setCaseInsensitive() {
    try { app.findChangeGrepOptions.caseSensitive = false; } catch (e) {}
    try { app.findChangeTextOptions.caseSensitive = false; } catch (e2) {}
  }
  function findGrep(doc, pat) {
    resetFind();
    setCaseInsensitive();
    app.findGrepPreferences.findWhat = pat;
    var res = [];
    try { res = doc.findGrep(); } catch (e) { res = []; }
    resetFind();
    return res;
  }

  function cleanOneLine(s) {
    return String(s || "")
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function pageOfText(textObj) {
    try {
      var tf = textObj.parentTextFrames[0];
      if (tf && tf.parentPage) return tf.parentPage;
    } catch (e) {}
    return null;
  }

  function getChapterRange(doc) {
    // CH1 scope:
    // - Start marker: "^1.1" (stable and avoids matching numbered lists like "1 ...", "2 ...")
    // - End marker: chapter-2 CHAPTER HEADER (style-aware) if present; fallback "^2.1"
    var f1 = findGrep(doc, "^1\\.1");
    var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
    var startOff = p1 ? p1.documentOffset : 0;

    var endOff = -1;
    var ch2HeaderOff = findChapterHeaderPageOffset(doc, 2, startOff);
    if (ch2HeaderOff >= 0) {
      endOff = ch2HeaderOff - 1;
    } else {
      var f2 = findGrep(doc, "^2\\.1");
      var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
      endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
    }
    if (endOff < startOff) endOff = doc.pages.length - 1;

    return {
      startOff: startOff,
      endOff: endOff,
      startPage: p1 ? String(p1.name) : "?",
      endPage: (endOff >= 0 && endOff < doc.pages.length) ? String(doc.pages[endOff].name) : "?"
    };
  }

  function paraStartPage(para) {
    try { var ip = para.insertionPoints[0]; var tf = ip.parentTextFrames[0]; if (tf && tf.parentPage) return tf.parentPage; } catch (e0) {}
    try { var tf2 = para.parentTextFrames[0]; if (tf2 && tf2.parentPage) return tf2.parentPage; } catch (e1) {}
    return null;
  }
  function paraStartPageOffset(para) {
    var pg = paraStartPage(para);
    if (!pg) return -1;
    try { return pg.documentOffset; } catch (e) { return -1; }
  }

  function isChapterHeaderStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("chapter header") !== -1 || s.indexOf("hoofdstuk") !== -1;
  }

  function trimParaText(txt) {
    var t = "";
    try { t = String(txt || ""); } catch (e0) { t = ""; }
    if (t.length && t.charAt(t.length - 1) === "\r") t = t.substring(0, t.length - 1);
    try { t = t.replace(/^\s+|\s+$/g, ""); } catch (e1) {}
    return t;
  }

  function findChapterHeaderPageOffset(doc, chapterNum, minOffOrNull) {
    var best = -1;
    var re = null;
    try { re = new RegExp("^" + String(chapterNum) + "(?:\\\\.|\\\\b)"); } catch (eR) { re = null; }
    if (!re) return -1;
    var minOff = (minOffOrNull === 0 || (minOffOrNull && minOffOrNull > 0)) ? minOffOrNull : -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var story = doc.stories[s];
      var pc = 0;
      try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
      for (var p = 0; p < pc; p++) {
        var para = story.paragraphs[p];
        var styleName = "";
        try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eS) { styleName = ""; }
        if (!isChapterHeaderStyleName(styleName)) continue;
        var off = paraStartPageOffset(para);
        if (off < 0) continue;
        if (minOff >= 0 && off < minOff) continue;
        var t = "";
        try { t = trimParaText(para.contents); } catch (eT) { t = ""; }
        if (!t) continue;
        if (!re.test(t)) continue;
        if (best < 0 || off < best) best = off;
      }
    }
    return best;
  }
  function paraStartPageName(para) {
    var pg = paraStartPage(para);
    return pg ? String(pg.name) : "?";
  }

  function storyWordCountInRange(story, startOff, endOff) {
    var wc = 0;
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < startOff || off > endOff) continue;
      try { wc += para.words.length; } catch (eW) {}
    }
    return wc;
  }

  function detectBodyStoryIndex(doc, startOff, endOff) {
    var bestIdx = -1;
    var bestWords = -1;
    for (var s = 0; s < doc.stories.length; s++) {
      var wc = storyWordCountInRange(doc.stories[s], startOff, endOff);
      if (wc > bestWords) { bestWords = wc; bestIdx = s; }
    }
    return { index: bestIdx, words: bestWords };
  }

  function auditLinks(doc) {
    var total = 0, missing = 0, outOfDate = 0;
    try { total = doc.links.length; } catch (e0) { total = 0; }
    for (var i = 0; i < total; i++) {
      var link = doc.links[i];
      try {
        if (link.status === LinkStatus.LINK_MISSING) missing++;
        else if (link.status === LinkStatus.LINK_OUT_OF_DATE) outOfDate++;
      } catch (e1) {}
    }
    return { total: total, missing: missing, outOfDate: outOfDate };
  }

  function auditFonts(doc) {
    var missing = 0;
    try {
      for (var i = 0; i < doc.fonts.length; i++) {
        try {
          if (doc.fonts[i].status === FontStatus.SUBSTITUTED) missing++;
          if (doc.fonts[i].status === FontStatus.FAILED) missing++;
        } catch (e1) {}
      }
    } catch (e0) {}
    return { missing: missing };
  }

  function oversetFramesInRange(doc, startOff, endOff) {
    var count = 0;
    var samplePages = [];
    try {
      for (var i = 0; i < doc.textFrames.length; i++) {
        var tf = doc.textFrames[i];
        if (!tf || !tf.overflows) continue;
        var pg = null;
        try { pg = tf.parentPage; } catch (e0) { pg = null; }
        if (!pg) continue;
        var off = -1;
        try { off = pg.documentOffset; } catch (e1) { off = -1; }
        if (off < startOff || off > endOff) continue;
        count++;
        if (samplePages.length < 10) samplePages.push(String(pg.name));
      }
    } catch (e2) {}
    return { count: count, samplePages: samplePages };
  }

  function findBoldMarkerResidue(doc) {
    // markers should never survive into InDesign
    var a = findGrep(doc, "<<BOLD_START>>");
    var b = findGrep(doc, "<<BOLD_END>>");
    return { start: a.length, end: b.length };
  }

  function isListLikeStyleName(styleName) {
    var s = String(styleName || "").toLowerCase();
    return s.indexOf("bullet") !== -1 || s.indexOf("bullets") !== -1 || s.indexOf("lijst") !== -1 || s.indexOf("list") !== -1 || s.indexOf("opsom") !== -1;
  }

  function isBoldChars(textRange, len) {
    try {
      var max = Math.min(len, textRange.characters.length);
      for (var i = 0; i < max; i++) {
        var fs = "";
        try { fs = String(textRange.characters[i].fontStyle || ""); } catch (e1) { fs = ""; }
        if (fs.toLowerCase().indexOf("bold") === -1) return false;
      }
      return max > 0;
    } catch (e0) {}
    return false;
  }

  function isAbbrevLike(token) {
    var t = String(token || "").replace(/^[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+/, "").replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+$/, "");
    if (!t) return false;
    // all caps/digits like DNA, ATP, AB0, ADP
    if (t.match(/^[A-Z0-9]{2,}$/)) return true;
    // mixed like mRNA, rRNA
    if (t.match(/^[a-z][A-Z]{2,}[0-9]*$/)) return true;
    return false;
  }

  function firstTokenAfterLabel(txt, label) {
    var i = txt.indexOf(label);
    if (i < 0) return "";
    var j = i + label.length;
    // skip whitespace
    while (j < txt.length && (txt.charAt(j) === " " || txt.charAt(j) === "\t" || txt.charAt(j) === "\n")) j++;
    // token until whitespace/punct
    var k = j;
    while (k < txt.length) {
      var ch = txt.charAt(k);
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") break;
      if (ch === "," || ch === "." || ch === ";" || ch === ":" || ch === "!" || ch === "?" || ch === "(" || ch === ")" || ch === "“" || ch === "\"" ) break;
      k++;
    }
    return txt.substring(j, k);
  }

  function analyzeBodyStory(doc, storyIdx, range) {
    var story = doc.stories[storyIdx];
    var issues = {
      paras: 0,
      fullyJustified: 0,
      wrongBodyJustification: 0,
      wrongSingleWordJustification: 0,
      labelParas: 0,
      labelParasNotLeftAlign: 0,
      labelMissingBlankLine: 0,
      labelNotLowercaseAfterColon: 0,
      labelNotBold: 0,
      missingSpaceAfterPunct: 0,
      spacesBeforePunct: 0,
      doubleSpaces: 0,
      samples: {
        fullyJustified: [],
        wrongBodyJustification: [],
        wrongSingleWordJustification: [],
        labelMissingBlankLine: [],
        labelNotLowercaseAfterColon: [],
        labelNotBold: [],
        missingSpaceAfterPunct: [],
        spacesBeforePunct: [],
        doubleSpaces: []
      }
    };

    function addSample(arr, msg) { if (arr.length < 10) arr.push(msg); }

    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var p = 0; p < pc; p++) {
      var para = story.paragraphs[p];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      issues.paras++;

      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      if (txt && txt.charAt(txt.length - 1) === "\r") txt = txt.substring(0, txt.length - 1);

      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
      var sn = String(styleName || "").toLowerCase();
      var looksNumberedHeading = false;
      try { looksNumberedHeading = /^\d+(?:\.\d+)*\b/.test(cleanOneLine(txt)) && cleanOneLine(txt).length <= 90; } catch (eNH) { looksNumberedHeading = false; }
      // Also treat the chapter intro-style paragraphs on the first text page as heading-like (they often use different swj defaults).
      var isIntroLike = false;
      try { isIntroLike = (paraStartPageOffset(para) === range.startOff) && cleanOneLine(txt).length <= 220; } catch (eIL) { isIntroLike = false; }
      var isHeadingLike = (sn.indexOf("kop") !== -1 || sn.indexOf("header") !== -1 || sn.indexOf("titel") !== -1 || sn.indexOf("title") !== -1 || looksNumberedHeading || isIntroLike);

      var hasPr = txt.indexOf("In de praktijk:") >= 0;
      var hasVe = txt.indexOf("Verdieping:") >= 0;
      var hasLabel = hasPr || hasVe;

      // Justification checks
      try {
        if (para.justification === Justification.FULLY_JUSTIFIED) {
          issues.fullyJustified++;
          addSample(issues.samples.fullyJustified, "page=" + paraStartPageName(para) + " :: " + cleanOneLine(txt).substring(0, 120));
        }
        if (hasLabel) {
          issues.labelParas++;
          // Book layout: layer paragraphs should still be LEFT_JUSTIFIED (no ragged-right blocks).
          if (para.justification !== Justification.LEFT_JUSTIFIED) {
            issues.labelParasNotLeftAlign++;
          }
        } else {
          // For normal body paras, we expect LEFT_JUSTIFIED.
          // Skip headings/titles and list-like styles to avoid false positives.
          if (!isHeadingLike && !isListLikeStyleName(styleName) && para.justification !== Justification.LEFT_JUSTIFIED) {
            issues.wrongBodyJustification++;
            addSample(issues.samples.wrongBodyJustification, "page=" + paraStartPageName(para) + " just=" + String(para.justification) + " :: " + cleanOneLine(txt).substring(0, 120));
          }
        }
      } catch (eJ) {}

      // singleWordJustification
      try {
        // Skip title/heading-like paragraphs here to avoid false positives (they often use different swj defaults).
        if (!isHeadingLike && para.singleWordJustification && para.singleWordJustification !== Justification.LEFT_ALIGN) {
          issues.wrongSingleWordJustification++;
          addSample(issues.samples.wrongSingleWordJustification, "page=" + paraStartPageName(para) + " swj=" + String(para.singleWordJustification) + " :: " + cleanOneLine(txt).substring(0, 120));
        }
      } catch (eSW) {}

      // Heading formatting rules
      if (hasLabel) {
        // must be preceded by a skipped line (double \n) inside same paragraph
        if (hasPr && txt.indexOf("\n\nIn de praktijk:") === -1) {
          issues.labelMissingBlankLine++;
          addSample(issues.samples.labelMissingBlankLine, "page=" + paraStartPageName(para) + " :: " + cleanOneLine(txt).substring(0, 160));
        }
        if (hasVe && txt.indexOf("\n\nVerdieping:") === -1) {
          issues.labelMissingBlankLine++;
          addSample(issues.samples.labelMissingBlankLine, "page=" + paraStartPageName(para) + " :: " + cleanOneLine(txt).substring(0, 160));
        }

        // after colon lowercase unless abbreviation-like
        var label = hasPr ? "In de praktijk:" : "Verdieping:";
        var tok = firstTokenAfterLabel(txt, label);
        if (tok) {
          var firstChar = tok.charAt(0);
          var isUpper = !!firstChar.match(/[A-ZÀ-ÖØ-Þ]/);
          if (isUpper && !isAbbrevLike(tok)) {
            issues.labelNotLowercaseAfterColon++;
            addSample(issues.samples.labelNotLowercaseAfterColon, "page=" + paraStartPageName(para) + " label=" + label + " token=" + tok + " :: " + cleanOneLine(txt).substring(0, 170));
          }
        }
      }

      // Whitespace checks (body story only)
      if (txt) {
        // double spaces (ignore captions style by prefix; captions are usually not in body story anyway)
        if (txt.indexOf("  ") >= 0) {
          issues.doubleSpaces++;
          addSample(issues.samples.doubleSpaces, "page=" + paraStartPageName(para) + " :: " + cleanOneLine(txt).substring(0, 160));
        }
        // spaces before punctuation
        try {
          if (txt.match(/\s+[,.!?:;]/)) {
            issues.spacesBeforePunct++;
            addSample(issues.samples.spacesBeforePunct, "page=" + paraStartPageName(para) + " :: " + cleanOneLine(txt).substring(0, 160));
          }
        } catch (eSP) {}
        // missing space after sentence punctuation (.,!,?) followed by a letter
        // (protect dotted abbreviations like "o.a." / "d.w.z.")
        try {
          var m = txt.match(/([A-Za-zÀ-ÖØ-öø-ÿ0-9])([.!?])([A-Za-zÀ-ÖØ-öø-ÿ])/);
          if (m) {
            var idx = txt.indexOf(m[0]);
            var prev = idx > 0 ? txt.charAt(idx) : "";
            var punct = m[2];
            var next = m[3];
            var next2 = (idx + 3 < txt.length) ? txt.charAt(idx + 3) : "";
            var abbrev = (punct === "." && next2 === "." && next && next.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/));
            if (!abbrev) {
              issues.missingSpaceAfterPunct++;
              addSample(issues.samples.missingSpaceAfterPunct, "page=" + paraStartPageName(para) + " :: " + cleanOneLine(txt).substring(0, 170));
            }
          }
        } catch (eMP) {}
      }
    }

    // Bold label check via GREP hits in CH1 body story only
    // (Do as a separate pass to avoid expensive per-character scans on every paragraph.)
    function countBoldLabels(labelText) {
      var hits = 0;
      var boldOk = 0;
      var samples = [];
      // search within the story only by iterating paragraphs; InDesign findGrep can't be scoped to story easily without ranges.
      var pc2 = 0;
      try { pc2 = story.paragraphs.length; } catch (eP2) { pc2 = 0; }
      for (var i = 0; i < pc2; i++) {
        var para2 = story.paragraphs[i];
        var off2 = paraStartPageOffset(para2);
        if (off2 < range.startOff || off2 > range.endOff) continue;
        var t2 = "";
        try { t2 = String(para2.contents || ""); } catch (eT2) { t2 = ""; }
        if (!t2) continue;
        var idx = t2.indexOf(labelText);
        if (idx < 0) continue;
        hits++;
        try {
          var tr = para2.characters.itemByRange(idx, idx + labelText.length - 1);
          if (isBoldChars(tr, labelText.length)) boldOk++;
          else {
            if (samples.length < 10) samples.push("page=" + paraStartPageName(para2) + " :: " + cleanOneLine(t2).substring(0, 160));
          }
        } catch (eB) {
          if (samples.length < 10) samples.push("page=" + paraStartPageName(para2) + " :: (bold check failed) " + cleanOneLine(t2).substring(0, 160));
        }
      }
      return { hits: hits, boldOk: boldOk, samples: samples };
    }

    var prBold = countBoldLabels("In de praktijk:");
    var veBold = countBoldLabels("Verdieping:");
    issues.labelNotBold = (prBold.hits - prBold.boldOk) + (veBold.hits - veBold.boldOk);
    issues.samples.labelNotBold = prBold.samples.concat(veBold.samples).slice(0, 10);

    issues._labelsBold = { praktijk: prBold, verdieping: veBold };
    return issues;
  }

  function isolatedBulletsInBodyStory(doc, storyIdx, range) {
    var story = doc.stories[storyIdx];
    var isolated = 0;
    var samples = [];
    function isBulletPara(para) {
      var txt = "";
      try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
      var styleName = "";
      try { styleName = String(para.appliedParagraphStyle ? para.appliedParagraphStyle.name : ""); } catch (eSN) { styleName = ""; }
      var s = cleanOneLine(txt);
      var bulletLike = (s.indexOf("\u2022") === 0) || (s.indexOf("- ") === 0) || (s.indexOf("\u2022") >= 0 && s.indexOf("\u2022") <= 5);
      return isListLikeStyleName(styleName) || bulletLike;
    }
    var pc = 0;
    try { pc = story.paragraphs.length; } catch (eP) { pc = 0; }
    for (var i = 0; i < pc; i++) {
      var para = story.paragraphs[i];
      var off = paraStartPageOffset(para);
      if (off < range.startOff || off > range.endOff) continue;
      if (!isBulletPara(para)) continue;
      var prevIs = false, nextIs = false;
      if (i > 0) {
        var pPrev = story.paragraphs[i - 1];
        var offPrev = paraStartPageOffset(pPrev);
        if (offPrev >= range.startOff && offPrev <= range.endOff) prevIs = isBulletPara(pPrev);
      }
      if (i + 1 < pc) {
        var pNext = story.paragraphs[i + 1];
        var offNext = paraStartPageOffset(pNext);
        if (offNext >= range.startOff && offNext <= range.endOff) nextIs = isBulletPara(pNext);
      }
      if (!prevIs && !nextIs) {
        isolated++;
        if (samples.length < 10) {
          var t = "";
          try { t = String(para.contents || ""); } catch (eT2) { t = ""; }
          samples.push("page=" + paraStartPageName(para) + " :: " + cleanOneLine(t).substring(0, 170));
        }
      }
    }
    return { count: isolated, samples: samples };
  }

  function strayStoriesInRange(doc, bodyIdx, range) {
    var stray = [];
    for (var s = 0; s < doc.stories.length; s++) {
      if (s === bodyIdx) continue;
      var wc = storyWordCountInRange(doc.stories[s], range.startOff, range.endOff);
      if (wc >= 15) stray.push({ storyIndex: s, words: wc });
    }
    stray.sort(function (a, b) { return b.words - a.words; });
    return stray;
  }

  function chapterBoundaryTextFrames(doc, pageOffset) {
    if (pageOffset < 0 || pageOffset >= doc.pages.length) return { page: "?", framesWithText: 0, samples: [] };
    var pg = doc.pages[pageOffset];
    var framesWithText = 0;
    var samples = [];
    try {
      for (var i = 0; i < pg.textFrames.length; i++) {
        var tf = pg.textFrames[i];
        var t = "";
        try { t = String(tf.contents || ""); } catch (eT) { t = ""; }
        t = cleanOneLine(t);
        // ignore tiny markers/page numbers
        if (t.length < 6) continue;
        // ignore captions (they are label-like and often intentionally present on image pages)
        if (t.match(/^(Afbeelding|Figuur|Tabel|Schema)\s+\d+/i)) continue;
        framesWithText++;
        if (samples.length < 5) samples.push(t.substring(0, 140));
      }
    } catch (e0) {}
    return { page: String(pg.name), framesWithText: framesWithText, samples: samples };
  }

  // ----------------------------
  // MAIN
  // ----------------------------
  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
  } else {
    var doc = app.activeDocument;
    try { app.activeDocument = doc; } catch (eAct) {}

    out.push("=== CH1 ALL-ISSUES AUDIT (read-only) ===");
    out.push("DOC: " + doc.name);
    try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
    out.push("PAGES: " + doc.pages.length);
    out.push("");

    var range = getChapterRange(doc);
    out.push("CH1 RANGE: page " + range.startPage + " -> " + range.endPage + " (offsets " + range.startOff + " -> " + range.endOff + ")");

    var links = auditLinks(doc);
    var fonts = auditFonts(doc);
    out.push("[LINKS] total=" + links.total + " missing=" + links.missing + " outOfDate=" + links.outOfDate);
    out.push("[FONTS] missing=" + fonts.missing);

    var overset = oversetFramesInRange(doc, range.startOff, range.endOff);
    out.push("[CH1 OVERSET FRAMES] " + overset.count + (overset.samplePages.length ? (" samplePages=" + overset.samplePages.join(",")) : ""));

    var boldResidue = findBoldMarkerResidue(doc);
    out.push("[BOLD MARKER RESIDUE] <<BOLD_START>>=" + boldResidue.start + " <<BOLD_END>>=" + boldResidue.end);
    out.push("");

    var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);
    out.push("BODY STORY: index=" + body.index + " words=" + body.words);

    if (body.index < 0) {
      out.push("ERROR: could not detect body story");
    } else {
      var bodyIssues = analyzeBodyStory(doc, body.index, range);
      out.push("");
      out.push("=== BODY STORY CHECKS ===");
      out.push("[PARAS IN RANGE] " + bodyIssues.paras);
      out.push("[JUSTIFICATION] fully_justified=" + bodyIssues.fullyJustified + " wrong_body_just=" + bodyIssues.wrongBodyJustification);
      if (bodyIssues.samples.fullyJustified.length) out.push("  samples_fully_justified=" + bodyIssues.samples.fullyJustified.join(" | "));
      if (bodyIssues.samples.wrongBodyJustification.length) out.push("  samples_wrong_body_just=" + bodyIssues.samples.wrongBodyJustification.join(" | "));

      out.push("[SINGLE WORD JUSTIFICATION] non_left_align=" + bodyIssues.wrongSingleWordJustification);
      if (bodyIssues.samples.wrongSingleWordJustification.length) out.push("  samples=" + bodyIssues.samples.wrongSingleWordJustification.join(" | "));

      out.push("[LAYER LABELS FOUND] praktijk=" + bodyIssues._labelsBold.praktijk.hits + " verdieping=" + bodyIssues._labelsBold.verdieping.hits);
      out.push("[LABELS BOLD] praktijk_ok=" + bodyIssues._labelsBold.praktijk.boldOk + "/" + bodyIssues._labelsBold.praktijk.hits + " verdieping_ok=" + bodyIssues._labelsBold.verdieping.boldOk + "/" + bodyIssues._labelsBold.verdieping.hits);
      if (bodyIssues.labelNotBold > 0 && bodyIssues.samples.labelNotBold.length) out.push("  samples_label_not_bold=" + bodyIssues.samples.labelNotBold.join(" | "));

      out.push("[LABEL FORMAT] missing_blank_line=" + bodyIssues.labelMissingBlankLine + " not_lowercase_after_colon=" + bodyIssues.labelNotLowercaseAfterColon);
      if (bodyIssues.samples.labelMissingBlankLine.length) out.push("  samples_missing_blank_line=" + bodyIssues.samples.labelMissingBlankLine.join(" | "));
      if (bodyIssues.samples.labelNotLowercaseAfterColon.length) out.push("  samples_not_lowercase_after_colon=" + bodyIssues.samples.labelNotLowercaseAfterColon.join(" | "));

      out.push("[WHITESPACE] doubleSpaces=" + bodyIssues.doubleSpaces + " spacesBeforePunct=" + bodyIssues.spacesBeforePunct + " missingSpaceAfterPunct=" + bodyIssues.missingSpaceAfterPunct);
      if (bodyIssues.samples.doubleSpaces.length) out.push("  samples_double_spaces=" + bodyIssues.samples.doubleSpaces.join(" | "));
      if (bodyIssues.samples.spacesBeforePunct.length) out.push("  samples_space_before_punct=" + bodyIssues.samples.spacesBeforePunct.join(" | "));
      if (bodyIssues.samples.missingSpaceAfterPunct.length) out.push("  samples_missing_space_after_punct=" + bodyIssues.samples.missingSpaceAfterPunct.join(" | "));

      var isoBul = isolatedBulletsInBodyStory(doc, body.index, range);
      out.push("[ISOLATED BULLETS IN BODY] " + isoBul.count);
      if (isoBul.samples.length) out.push("  samples=" + isoBul.samples.join(" | "));

      var stray = strayStoriesInRange(doc, body.index, range);
      out.push("");
      out.push("=== NON-BODY STORIES IN CH1 ===");
      out.push("[STRAY STORIES words>=15] " + stray.length);
      for (var i = 0; i < Math.min(12, stray.length); i++) {
        out.push(" - storyIndex=" + stray[i].storyIndex + " words=" + stray[i].words);
      }

      out.push("");
      out.push("=== CHAPTER BOUNDARY PAGE HEURISTICS ===");
      // Boundary meaning (same as validate-ch1.jsx):
      // - CH1 start image page = page before ^1.1 (startOff - 1)
      // - CH1 end blank page    = page before CH2 start image page (endOff - 1) because endOff is (pageBefore ^2.1)
      // - CH2 start image page  = endOff
      var ch1StartImageOff = range.startOff - 1;
      var ch1EndBlankOff = range.endOff - 1;
      var ch2StartImageOff = range.endOff;

      var pStart = chapterBoundaryTextFrames(doc, ch1StartImageOff);
      var pBlank = chapterBoundaryTextFrames(doc, ch1EndBlankOff);
      var pCh2 = chapterBoundaryTextFrames(doc, ch2StartImageOff);

      out.push("CH1 start image page (offset=" + ch1StartImageOff + ", name=" + pStart.page + ") textFramesWithText=" + pStart.framesWithText + (pStart.samples.length ? (" samples=" + pStart.samples.join(" | ")) : ""));
      out.push("CH1 end blank page (offset=" + ch1EndBlankOff + ", name=" + pBlank.page + ") textFramesWithText=" + pBlank.framesWithText + (pBlank.samples.length ? (" samples=" + pBlank.samples.join(" | ")) : ""));
      out.push("CH2 start image page (offset=" + ch2StartImageOff + ", name=" + pCh2.page + ") textFramesWithText=" + pCh2.framesWithText + (pCh2.samples.length ? (" samples=" + pCh2.samples.join(" | ")) : ""));
    }
  }

  var report = out.join("\n");
  try { $.writeln(report); } catch (eW0) {}
  var fn = "audit_ch1_all_issues__" + safeFileName((app.documents.length ? app.activeDocument.name : "no_doc")) + "__" + isoStamp() + ".txt";
  writeTextToDesktop(fn, report);
  report;
})();


