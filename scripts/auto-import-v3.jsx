// Auto-import Prince text V3 - Simple and robust
#target indesign

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

var JSON_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_skeleton/full_20260104_163341/af4_skeleton_pass1_merged.with_openers.json";
var SOURCE_INDD = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";

function readJSON(filePath) {
    var file = new File(filePath);
    file.open('r');
    file.encoding = 'UTF-8';
    var content = file.read();
    file.close();
    return eval('(' + content + ')');
}

function formatText(text) {
    if (!text) return "";
    var result = String(text);
    result = result.replace(/<<MICRO_TITLE>>([^<]+)<<MICRO_TITLE_END>>/g, '\r$1\r');
    result = result.replace(/<<BOLD_START>>/g, '');
    result = result.replace(/<<BOLD_END>>/g, '');
    result = result.replace(/\[\[BOX_SPLIT\]\]/g, '\r');
    result = result.replace(/\n\n/g, '\r');
    result = result.replace(/\n/g, ' ');
    result = result.replace(/\r\r+/g, '\r');
    result = result.replace(/\s+/g, ' ');
    return result.replace(/^\s+|\s+$/g, '');
}

function buildMap(json) {
    var map = {};
    for (var c = 0; c < json.chapters.length; c++) {
        var chapter = json.chapters[c];
        for (var s = 0; s < (chapter.sections || []).length; s++) {
            var section = chapter.sections[s];
            for (var sp = 0; sp < (section.content || []).length; sp++) {
                var sub = section.content[sp];
                if (sub.type !== 'subparagraph') continue;
                
                var parts = [];
                for (var p = 0; p < (sub.content || []).length; p++) {
                    var para = sub.content[p];
                    if (para.type === 'list') continue;
                    
                    var basis = formatText(para.basis || '');
                    if (basis) parts.push(basis);
                    
                    var praktijk = formatText(para.praktijk || '');
                    if (praktijk) parts.push('\rIn de praktijk: ' + praktijk);
                    
                    var verdieping = formatText(para.verdieping || '');
                    if (verdieping) parts.push('\rVerdieping: ' + verdieping);
                }
                
                if (parts.length > 0) {
                    map[sub.number] = parts.join('\r');
                }
            }
        }
    }
    return map;
}

// Main
$.writeln("=== V3 Import Started ===");

var json = readJSON(JSON_PATH);
$.writeln("Chapters: " + json.chapters.length);

var textMap = buildMap(json);
var keys = []; for (var k in textMap) keys.push(k);
$.writeln("Subparagraphs: " + keys.length);

var doc = app.open(new File(SOURCE_INDD), false);
$.writeln("Pages: " + doc.pages.length);

var ts = new Date().getTime();
var outPath = SOURCE_INDD.replace('.indd', '_V3_' + ts + '.indd');
doc.saveACopy(new File(outPath));
doc.close(SaveOptions.NO);
doc = app.open(new File(outPath), false);
$.writeln("Working on: " + outPath);

var count = 0;
var regex = /^(\d+\.\d+\.\d+)\s/;
var done = {};

for (var si = 0; si < doc.stories.length; si++) {
    var story = doc.stories[si];
    
    for (var pi = 0; pi < story.paragraphs.length; pi++) {
        try {
            var para = story.paragraphs[pi];
            var text = para.contents;
            var m = text.match(regex);
            
            if (m && textMap[m[1]] && !done[m[1]]) {
                var num = m[1];
                $.writeln("Found: " + num);
                
                // Find range to replace
                var start = pi + 1;
                var end = start;
                
                for (var ni = start; ni < story.paragraphs.length; ni++) {
                    var np = story.paragraphs[ni];
                    var nt = np.contents;
                    if (nt.match(regex)) break;
                    if (nt.match(/^\d+\.\d+\s+[A-Z]/)) break;
                    end = ni + 1;
                }
                
                if (end > start) {
                    // Get char range
                    var firstP = story.paragraphs[start];
                    var lastP = story.paragraphs[end - 1];
                    var startChar = firstP.characters[0].index;
                    var endChar = lastP.characters[-1].index;
                    
                    // Replace
                    var range = story.characters.itemByRange(startChar, endChar);
                    range.contents = textMap[num] + '\r';
                    
                    count++;
                    done[num] = true;
                }
            }
        } catch(e) {
            $.writeln("Error at para " + pi + ": " + e.message);
        }
    }
}

// Remove stray bullet paragraphs
$.writeln("Cleanup...");
for (var si = 0; si < doc.stories.length; si++) {
    var story = doc.stories[si];
    for (var pi = story.paragraphs.length - 1; pi >= 0; pi--) {
        try {
            var p = story.paragraphs[pi];
            var c = p.contents.replace(/[\r\n\s•\-]/g, '');
            if (c === '') p.remove();
        } catch(e) {}
    }
}

doc.save();
$.writeln("=== Done: " + count + " replacements ===");
$.writeln("Output: " + outPath);

