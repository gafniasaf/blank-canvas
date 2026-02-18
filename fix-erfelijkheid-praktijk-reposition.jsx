// Reposition the heredity/genetics "In de praktijk:" block to the END of its paragraph (Option A),
// so the basis explanation doesn't continue after the praktijk block.
//
// Targets the unique paragraph containing the phrase: "eigenschappen van hun ouders".
// Safe: does not save.

var TARGET_PHRASE = "eigenschappen van hun ouders";

function normalizeSpaces(s) {
  return String(s || "").replace(/[ \t]{2,}/g, " ").replace(/^\s+|\s+$/g, "");
}

function findSecondSentenceEnd(text, startIdx) {
  // Find the end index (inclusive) of the 2nd sentence (.) after startIdx.
  // Conservative: counts '.' only.
  var count = 0;
  for (var i = startIdx; i < text.length; i++) {
    if (text.charAt(i) === ".") {
      count++;
      if (count >= 2) return i;
    }
  }
  return -1;
}

var out = [];
if (app.documents.length === 0) {
  out.push("ERROR: no documents open");
} else {
  var doc = app.activeDocument;

  app.findTextPreferences = NothingEnum.nothing;
  app.findTextPreferences.findWhat = TARGET_PHRASE;
  var f = doc.findText();
  app.findTextPreferences = NothingEnum.nothing;

  if (!f || f.length === 0) {
    out.push("ERROR: phrase not found");
  } else {
    var t = f[0];
    var para = null;
    try { para = t.paragraphs[0]; } catch (e0) { para = null; }
    if (!para) {
      out.push("ERROR: no paragraph");
    } else {
      var txt = "";
      try { txt = String(para.contents || ""); } catch (e1) { txt = ""; }
      var hasCR = false;
      if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }

      var idx = txt.indexOf("In de praktijk:");
      if (idx < 0) {
        out.push("ERROR: no 'In de praktijk:' in paragraph");
      } else {
        // Extract the current praktijk block (first 2 sentences), but replace with a cleaner GPT-reviewed 2-sentence block.
        var end2 = findSecondSentenceEnd(txt, idx);
        if (end2 < 0) end2 = Math.min(txt.length - 1, idx + 500);
        var originalBlock = txt.substring(idx, end2 + 1);

        // Remove optional preceding forced line breaks right before the block.
        var removeStart = idx;
        while (removeStart > 0 && (txt.charAt(removeStart - 1) === "\n")) removeStart--;
        var before = txt.substring(0, removeStart);
        var after = txt.substring(end2 + 1); // keep remainder (basis continuation)

        // Clean up spacing around join
        before = before.replace(/\n{3,}/g, "\n\n");
        after = after.replace(/^\s+/, "");

        // New block (Option A; 2 short sentences)
        var newBlock =
          "In de praktijk: Bij een zorgvrager die vragen stelt over erfelijkheid kun je uitleggen dat erfelijke informatie in genen zit en dat genen op chromosomen liggen. Leg ook uit dat geslachtscellen een set chromosomen hebben en dat bij het samenkomen van eicel en zaadcel het normale aantal weer ontstaat.";

        // Rebuild: basis (before + after), then blank line + new praktijk block at end
        var rebuilt = normalizeSpaces(before) + (before && before.charAt(before.length - 1) === "\n" ? "" : "\n") + after;
        // Trim end whitespace/newlines and then add block
        rebuilt = String(rebuilt || "").replace(/\s+$/g, "");
        rebuilt = rebuilt.replace(/\n{3,}/g, "\n\n");
        rebuilt = rebuilt + "\n\n" + newBlock;

        try { para.contents = rebuilt + (hasCR ? "\r" : ""); } catch (eSet) {}

        out.push("UPDATED paragraph containing phrase: " + TARGET_PHRASE);
        out.push("Original praktijk block (first 120): " + String(originalBlock).substring(0, 120));
        out.push("NOTE: not saved; save manually when happy.");
      }
    }
  }
}

out.join("\n");


