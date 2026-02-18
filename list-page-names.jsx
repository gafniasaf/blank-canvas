// List first 50 page names
#target indesign

var doc = app.activeDocument;
var outputFile = new File("/Users/asafgafni/Desktop/page_names.txt");
var output = "Page names (first 50):\n\n";

var count = Math.min(50, doc.pages.length);
for (var i = 0; i < count; i++) {
    output += "Index " + i + ": Page '" + doc.pages[i].name + "'\n";
}

output += "\n...Total pages: " + doc.pages.length;

outputFile.open("w");
outputFile.write(output);
outputFile.close();

alert("Done!");







