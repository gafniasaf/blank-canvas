// Simple script to find pages with heart-related content
#target indesign

var docPath = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
var outputFile = new File("/Users/asafgafni/Desktop/heart_search.txt");

var doc = app.open(File(docPath), false);
var output = "Searching for heart-related content...\n\n";

// Search through all text frames for keywords
var keywords = ["sinusknoop", "av-knoop", "bundel van his", "purkinjevezels", "elektrisch", "prikkelgeleiding"];
var foundPages = [];

for (var i = 0; i < doc.pages.length; i++) {
    var page = doc.pages[i];
    var pageItems = page.allPageItems;
    
    for (var j = 0; j < pageItems.length; j++) {
        var item = pageItems[j];
        if (item.constructor.name === "TextFrame") {
            try {
                var text = item.contents.toLowerCase();
                for (var k = 0; k < keywords.length; k++) {
                    if (text.indexOf(keywords[k]) >= 0) {
                        var info = "Page " + page.name + ": Found '" + keywords[k] + "'";
                        if (foundPages.indexOf(info) < 0) {
                            foundPages.push(info);
                            output += info + "\n";
                        }
                    }
                }
            } catch (e) {}
        }
    }
}

if (foundPages.length === 0) {
    output += "No heart-related keywords found.\n";
}

output += "\nTotal document pages: " + doc.pages.length + "\n";

outputFile.open("w");
outputFile.write(output);
outputFile.close();

alert("Done! Check heart_search.txt");







