// GPT-5.2-assisted fixups for Chapter 1 layer blocks ("In de praktijk:" / "Verdieping:").
// This addresses:
// - stray appended fragments after the layer text
// - missing/extra spaces inside these blocks
// - small wording/grammar improvements (N3: 2–3 short sentences)
//
// Scope: CH1 only (based on ^1.1 and ^2.1 markers).
// Safe: does not save.

var TARGET_DOC_PATH = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO_AF4_COMMON_CORE_CH1_PREVIEW_OVERSETFIXED_20251216_212720.indd";

function getDocByPathOrActive(path) {
  var doc = null;
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    try { if (d.fullName && d.fullName.fsName === path) { doc = d; break; } } catch (e) {}
  }
  if (!doc) { try { doc = app.activeDocument; } catch (e2) { doc = null; } }
  return doc;
}

function resetFind() {
  try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  try { app.findGrepPreferences = NothingEnum.nothing; } catch (e2) {}
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

function pageOfText(textObj) {
  try {
    var tf = textObj.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage;
  } catch (e) {}
  return null;
}

function getChapterRange(doc) {
  var f1 = findGrep(doc, "^1\\.1");
  var p1 = (f1 && f1.length > 0) ? pageOfText(f1[0]) : null;
  var startOff = p1 ? p1.documentOffset : 0;

  var f2 = findGrep(doc, "^2\\.1");
  var p2 = (f2 && f2.length > 0) ? pageOfText(f2[0]) : null;
  var endOff = p2 ? (p2.documentOffset - 1) : (doc.pages.length - 1);
  if (endOff < startOff) endOff = doc.pages.length - 1;

  return { startOff: startOff, endOff: endOff };
}

function paraStartPageOffset(para) {
  try {
    var ip = para.insertionPoints[0];
    var tf = ip.parentTextFrames[0];
    if (tf && tf.parentPage) return tf.parentPage.documentOffset;
  } catch (e0) {}
  try {
    var tf2 = para.parentTextFrames[0];
    if (tf2 && tf2.parentPage) return tf2.parentPage.documentOffset;
  } catch (e1) {}
  return -1;
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

function normalizeSpaces(s) {
  var t = String(s || "");
  t = t.replace(/ {2,}/g, " ");
  t = t.replace(/ ([,.;:!?])/g, "$1");
  t = t.replace(/([a-z\u00E0-\u00FF])([.!?])([A-Z\u00C0-\u00DD])/g, "$1$2 $3");
  t = t.replace(/:([A-Za-z\u00C0-\u00FF])/g, ": $1");
  t = t.replace(/\s+/g, " ");
  return t.replace(/^\s+|\s+$/g, "");
}

// --- Curated, GPT-reviewed replacements (CH1) ---
function fixedPraktijk(line, paraText) {
  var l = String(line || "");
  var low = (l + " " + String(paraText || "")).toLowerCase();

  if (low.indexOf("erfelijkheid") !== -1 && low.indexOf("genen") !== -1 && low.indexOf("eicel") !== -1 && low.indexOf("zaadcel") !== -1) {
    return "In de praktijk: Bij een zorgvrager die vragen stelt over erfelijkheid kun je uitleggen dat erfelijke informatie in genen zit en dat genen op chromosomen liggen. Leg ook uit dat geslachtscellen een set chromosomen hebben en dat bij het samenkomen van eicel en zaadcel het normale aantal weer ontstaat.";
  }
  if (low.indexOf("zorgvrager die benauwd") !== -1) {
    return "In de praktijk: Bij een zorgvrager die benauwd is, observeer je dat het lichaam harder werkt om genoeg zuurstof binnen te krijgen. Zuurstof is nodig voor aerobe dissimilatie in de mitochondriën. Let daarom op signalen van weinig energie, zoals snel uitgeput raken bij kleine inspanning.";
  }
  if (low.indexOf("spierkrampen") !== -1 || low.indexOf("stijve spieren") !== -1) {
    return "In de praktijk: Bij een zorgvrager met spierkrampen of stijve spieren merk je dat bewegen of opstaan moeilijker gaat. Het helpt om te weten dat het gladde endoplasmatisch reticulum in spiercellen helpt bij het samentrekken van spieren door calcium af te geven.";
  }
  if (low.indexOf("endocytose") !== -1 || low.indexOf("lysosoom") !== -1 || low.indexOf("lysosomen") !== -1) {
    return "In de praktijk: Bij een zorgvrager met een wond let je op tekenen die kunnen passen bij ziekteverwekkers, zoals roodheid, warmte en pus. In cellen kunnen stoffen of ziekteverwekkers via endocytose worden opgenomen. Lysosomen breken deze stoffen af, zodat afvalstoffen worden opgeruimd.";
  }
  if (low.indexOf("celmembraan") !== -1 && (low.indexOf("zwelling") !== -1 || low.indexOf("roodheid") !== -1)) {
    return "In de praktijk: Bij een zorgvrager met een wond let je op tekenen van roodheid of zwelling. De celmembraan laat niet alles door. Daardoor kunnen cellen hun binnenkant beschermen en het vervoer van stoffen regelen.";
  }
  if (low.indexOf("cytokinese") !== -1 || low.indexOf("cytoskelet") !== -1) {
    return "In de praktijk: Bij een zorgvrager met een wond moet het lichaam nieuwe cellen maken om weefsel te herstellen. Bij celdeling wordt het cytoplasma verdeeld over twee nieuwe cellen (cytokinese). Het cytoskelet helpt cellen hun vorm te behouden, wat herstel ondersteunt.";
  }
  if (low.indexOf("mitose") !== -1 && low.indexOf("huid") !== -1 && low.indexOf("wond") !== -1) {
    return "In de praktijk: Bij een zorgvrager met een wond zie je dat de huid in de dagen erna langzaam sluit en dat er nieuw weefsel ontstaat. Dat herstel kan alleen doordat lichaamscellen zich delen via mitose en zo beschadigde cellen vervangen.";
  }
  if (low.indexOf("koorts") !== -1 || low.indexOf("ontsteking") !== -1) {
    return "In de praktijk: Bij een zorgvrager met koorts of een ontsteking merk je dat het lichaam veel nieuwe stoffen moet maken. Dat gebeurt via eiwitsynthese: eerst wordt informatie van DNA overgeschreven naar mRNA in de celkern, daarna bouwen ribosomen een eiwit uit aminozuren.";
  }
  if (low.indexOf("transcriptie") !== -1 && low.indexOf("translatie") !== -1 && low.indexOf("wond") !== -1) {
    return "In de praktijk: Bij een zorgvrager met een wond moet het lichaam nieuwe eiwitten maken om weefsel te herstellen. Eerst wordt DNA overgeschreven naar mRNA (transcriptie). Daarna wordt met die mRNA-code een eiwit opgebouwd uit aminozuren (translatie).";
  }
  if (low.indexOf("eenzijdig") !== -1 || low.indexOf("eiwitrijke") !== -1) {
    return "In de praktijk: Bij een zorgvrager die weinig eet of een eenzijdig voedingspatroon heeft, let je op signalen van te weinig bouwstoffen, zoals minder energie en minder goed herstel. Bespreek of de zorgvrager voldoende eiwitrijke voeding binnenkrijgt, omdat essentiële aminozuren via de voeding nodig zijn om nieuwe eiwitten te maken.";
  }

  // Fallback: normalize spacing only
  return normalizeSpaces(l);
}

function fixedVerdieping(line, paraText) {
  var l = String(line || "");
  var low = (l + " " + String(paraText || "")).toLowerCase();

  if (low.indexOf("ab0-antigenen") !== -1) {
    return "Verdieping: AB0-antigenen zijn glycoproteïnen op de buitenkant van rode bloedcellen. Ze bepalen welke bloedgroep iemand heeft: A, B, AB of 0.";
  }
  if (low.indexOf("cristae") !== -1) {
    return "Verdieping: Mitochondriën hebben aan de binnenkant cristae. Dit zijn plooien die het oppervlak van het binnenste membraan groter maken. Daardoor kunnen mitochondriën meer energie aanmaken.";
  }
  if (low.indexOf("trna") !== -1 || low.indexOf("anticodon") !== -1) {
    return "Verdieping: Een codon is een code van drie stikstofbasen op mRNA en staat voor één aminozuur. tRNA herkent codons met een passend anticodon en brengt het juiste aminozuur. Zo bouwt het ribosoom stap voor stap een eiwitketen op, totdat het eiwit klaar is.";
  }
  if (low.indexOf("haarkleur") !== -1 || low.indexOf("dubbele helix") !== -1) {
    return "Verdieping: Bij transcriptie wordt DNA overgeschreven naar mRNA. Bij translatie wordt die mRNA-code gebruikt om aminozuren in de juiste volgorde aan elkaar te zetten, zodat er een eiwit ontstaat. mRNA is enkelstrengs, terwijl DNA uit twee strengen bestaat (de dubbele helix).";
  }
  if (low.indexOf("64 codons") !== -1) {
    return "Verdieping: Bij transcriptie wordt informatie uit DNA omgezet in een mRNA-kopie. Die mRNA-kopie bestaat uit codons: groepjes van drie basen. Omdat er 64 codons zijn voor twintig aminozuren, kunnen meerdere codons bij hetzelfde aminozuur horen.";
  }

  // Fallback: normalize spacing only
  return normalizeSpaces(l);
}

var out = [];
var doc = getDocByPathOrActive(TARGET_DOC_PATH);
if (!doc) {
  out.push("ERROR: No document found/open.");
} else {
  try { app.activeDocument = doc; } catch (eAct) {}
  var range = getChapterRange(doc);
  var body = detectBodyStoryIndex(doc, range.startOff, range.endOff);

  var changedLines = 0;
  var touchedParas = 0;

  if (body.index < 0) {
    out.push("ERROR: could not detect CH1 body story");
  } else {
    var story = null;
    try { story = doc.stories[body.index]; } catch (eS) { story = null; }
    if (!story) {
      out.push("ERROR: body story not found at index " + body.index);
    } else {
      try { if (story.words.length < 5) { out.push("ERROR: body story appears empty"); } } catch (eW) {}
      for (var p = 0; p < story.paragraphs.length; p++) {
        var para = story.paragraphs[p];
        var off = paraStartPageOffset(para);
        if (off < range.startOff || off > range.endOff) continue;

        var txt = "";
        try { txt = String(para.contents || ""); } catch (eT) { txt = ""; }
        if (!txt) continue;
        var hasCR = false;
        if (txt.length && txt.charAt(txt.length - 1) === "\r") { txt = txt.substring(0, txt.length - 1); hasCR = true; }

        if (txt.indexOf("In de praktijk:") === -1 && txt.indexOf("Verdieping:") === -1) continue;

        var lines = txt.split("\n");
        var localChanged = 0;
        for (var i = 0; i < lines.length; i++) {
          var line = String(lines[i] || "");
          if (line.indexOf("In de praktijk:") === 0) {
            var fixed = fixedPraktijk(line, txt);
            if (fixed !== line) { lines[i] = fixed; localChanged++; }
          }
          if (line.indexOf("Verdieping:") === 0) {
            var fixedV = fixedVerdieping(line, txt);
            if (fixedV !== line) { lines[i] = fixedV; localChanged++; }
          }
        }

        if (localChanged > 0) {
          var newTxt = lines.join("\n");
          try { para.contents = newTxt + (hasCR ? "\r" : ""); } catch (eSet) {}
          touchedParas++;
          changedLines += localChanged;
        }
      }
    }
  }

  out.push("DOC: " + doc.name);
  out.push("CH1 page offsets: " + range.startOff + " -> " + range.endOff);
  if (body.index >= 0) out.push("Body story index=" + body.index + " words=" + body.words);
  out.push("Paragraphs updated: " + touchedParas);
  out.push("Layer lines updated: " + changedLines);
  out.push("NOTE: not saved; save manually when happy.");
}

out.join("\n");


