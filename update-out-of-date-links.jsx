// ============================================================
// FIX: update out-of-date links (generic)
// ============================================================
// Goal:
// - When links are LINK_OUT_OF_DATE, validation fails.
// - This script updates all out-of-date links in the active document.
//
// Safe:
// - Operates only on the active document (intended: newest rewritten output).
// - Does not relink to new files; only calls link.update().
// ============================================================

#targetengine "session"

(function () {
  function isoStamp() {
    var d = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "_" + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }

  function safeFileName(name) {
    var s = "";
    try { s = String(name || ""); } catch (e0) { s = "doc"; }
    s = s.replace(/\.indd$/i, "");
    s = s.replace(/[^a-z0-9 _-]/gi, "_");
    s = s.replace(/\s+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (!s) s = "doc";
    return s;
  }

  function writeTextToDesktop(filename, text) {
    try {
      var f = File(Folder.desktop + "/" + filename);
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(String(text || "")); f.close(); }
    } catch (e) {}
  }

  var out = [];
  if (app.documents.length === 0) {
    out.push("ERROR: no documents open");
    writeTextToDesktop("update_links__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  var doc = null;
  try { doc = app.activeDocument; } catch (e0) { doc = null; }
  if (!doc) { try { doc = app.documents[0]; } catch (e1) { doc = null; } }
  if (!doc) {
    out.push("ERROR: could not resolve a document");
    writeTextToDesktop("update_links__no_doc__" + isoStamp() + ".txt", out.join("\n"));
    return out.join("\n");
  }

  out.push("DOC: " + doc.name);
  try { if (doc.saved && doc.fullName) out.push("PATH: " + doc.fullName.fsName); } catch (eP0) {}
  out.push("Total links: " + doc.links.length);
  out.push("");

  var updated = 0;
  var stillOutOfDate = 0;
  var failures = 0;
  var samples = [];

  for (var i = 0; i < doc.links.length; i++) {
    var link = doc.links[i];
    if (!link || !link.isValid) continue;
    var status = null;
    try { status = link.status; } catch (eS) { status = null; }
    if (status !== LinkStatus.LINK_OUT_OF_DATE) continue;

    var nm = "";
    try { nm = String(link.name || ""); } catch (eN) { nm = ""; }
    try {
      link.update();
      updated++;
      if (samples.length < 12) samples.push("updated: " + nm);
    } catch (eU) {
      failures++;
      if (samples.length < 12) samples.push("FAILED update: " + nm + " :: " + String(eU));
    }
  }

  // Recount out-of-date links after updates
  for (var j = 0; j < doc.links.length; j++) {
    var link2 = doc.links[j];
    if (!link2 || !link2.isValid) continue;
    var st2 = null;
    try { st2 = link2.status; } catch (eS2) { st2 = null; }
    if (st2 === LinkStatus.LINK_OUT_OF_DATE) stillOutOfDate++;
  }

  out.push("Updated out-of-date links: " + updated);
  out.push("Update failures: " + failures);
  out.push("Still out-of-date after update: " + stillOutOfDate);
  if (samples.length) out.push("Samples: " + samples.join(" | "));

  var report = out.join("\n");
  writeTextToDesktop("update_links__" + safeFileName(doc.name) + "__" + isoStamp() + ".txt", report);
  report;
})();
































