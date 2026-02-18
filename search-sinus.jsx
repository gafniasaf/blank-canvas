// Search for "sinus" in document
#target indesign

var doc = app.activeDocument;
var outputFile = new File("/Users/asafgafni/Desktop/sinus_search.txt");
var output = "Searching for 'sinus' in all stories...\n\n";

// Search all stories
for (var i = 0; i < doc.stories.length; i++) {
    var story = doc.stories[i];
    try {
        var text = story.contents.toLowerCase();
        var idx = text.indexOf("sinus");
        if (idx >= 0) {
            // Find which page this story appears on
            var frames = story.textContainers;
            for (var j = 0; j < frames.length; j++) {
                try {
                    var page = frames[j].parentPage;
                    if (page) {
                        var snippet = text.substring(Math.max(0, idx - 30), Math.min(text.length, idx + 50));
                        output += "Page " + page.name + ": ..." + snippet.replace(/[\r\n]/g, " ") + "...\n";
                        break;
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
}

output += "\nDone searching.\n";

outputFile.open("w");
outputFile.write(output);
outputFile.close();

alert("Done - check sinus_search.txt");







