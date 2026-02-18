// Open the full A&F N4 book and list page range
#target indesign

var docPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
var doc = app.open(File(docPath), false);

var outputFile = new File("/Users/asafgafni/Desktop/full_book_info.txt");
var output = "Full A&F N4 Book Info:\n\n";
output += "Document: " + doc.name + "\n";
output += "Total pages: " + doc.pages.length + "\n";
output += "First page: " + doc.pages[0].name + "\n";
output += "Last page: " + doc.pages[doc.pages.length - 1].name + "\n";

outputFile.open("w");
outputFile.write(output);
outputFile.close();

alert("Done! Full book has " + doc.pages.length + " pages");







