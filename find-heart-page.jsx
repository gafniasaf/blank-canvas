// Find the page with Sinusknoop/AV-knoop heart labels
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var LOG = "/Users/asafgafni/Desktop/find_heart.txt";
  
  var log = [];
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  log.push("Searching for 'Sinusknoop' in all pages...\n");
  
  // Search all pages for text containing "Sinusknoop"
  for (var i = 0; i < doc.pages.length; i++) {
    var page = doc.pages[i];
    var pageName = page.name; // This is the visible page number
    
    for (var j = 0; j < page.textFrames.length; j++) {
      var tf = page.textFrames[j];
      try {
        var txt = tf.contents;
        if (txt.indexOf("Sinusknoop") >= 0 || txt.indexOf("AV-knoop") >= 0) {
          log.push("FOUND on page index " + i + " (page name: " + pageName + ")");
          log.push("  Text: " + txt.substring(0, 100));
          log.push("");
        }
      } catch (e) {}
    }
  }
  
  // Also search for the blood vessels page
  log.push("\nSearching for 'Halsslagader' pages...\n");
  for (var i = 0; i < doc.pages.length; i++) {
    var page = doc.pages[i];
    var pageName = page.name;
    
    for (var j = 0; j < page.textFrames.length; j++) {
      var tf = page.textFrames[j];
      try {
        var txt = tf.contents;
        if (txt.indexOf("Halsslagader") >= 0) {
          log.push("Blood vessels on page index " + i + " (page name: " + pageName + ")");
          log.push("");
        }
      } catch (e) {}
    }
  }
  
  // Write log
  var logFile = File(LOG);
  logFile.open("w");
  logFile.write(log.join("\n"));
  logFile.close();
  
  doc.close(SaveOptions.NO);
  
  alert("Done! See: " + LOG);
})();








