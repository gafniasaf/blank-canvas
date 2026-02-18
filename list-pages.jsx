// List all page names/numbers
#targetengine "session"

(function () {
  var BASE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk";
  var inddPath = BASE_DIR + "/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
  var LOG = "/Users/asafgafni/Desktop/pages_list.txt";
  
  var log = [];
  
  var inddFile = File(inddPath);
  if (!inddFile.exists) { alert("File not found"); return; }
  
  var doc = null;
  try { doc = app.open(inddFile, true); } catch (e) {
    try { doc = app.open(inddFile); } catch (e2) {}
  }
  if (!doc) { alert("Could not open"); return; }
  
  log.push("Total pages: " + doc.pages.length);
  log.push("");
  
  // List pages around 200
  for (var i = 190; i < Math.min(220, doc.pages.length); i++) {
    var page = doc.pages[i];
    log.push("Index " + i + " = Page name: '" + page.name + "'");
  }
  
  // Write log
  var logFile = File(LOG);
  logFile.open("w");
  logFile.write(log.join("\n"));
  logFile.close();
  
  doc.close(SaveOptions.NO);
  
  alert("Done! See: " + LOG);
})();








