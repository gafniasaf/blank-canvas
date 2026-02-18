// List page names around index 200
#target indesign

var doc = app.activeDocument;
var outputFile = new File("/Users/asafgafni/Desktop/pages_200_area.txt");
var output = "Pages around index 200:\n\n";

// Check if the document is the full book
if (doc.pages.length < 300) {
    output += "WARNING: Document only has " + doc.pages.length + " pages!\n\n";
}

for (var i = 180; i < Math.min(230, doc.pages.length); i++) {
    output += "Index " + i + ": Page '" + doc.pages[i].name + "'\n";
}

outputFile.open("w");
outputFile.write(output);
outputFile.close();

alert("Done!");







