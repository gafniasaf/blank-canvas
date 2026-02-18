// Auto-import Prince text V8 - Simple text replacement only
// No style changes, no background colors - just replace text content
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

function cleanText(text) {
    if (!text) return "";
    var result = String(text);
    result = result.replace(/<<BOLD_START>>/g, '');
    result = result.replace(/<<BOLD_END>>/g, '');
    result = result.replace(/<<MICRO_TITLE>>/g, '');
    result = result.replace(/<<MICRO_TITLE_END>>/g, '');
    result = result.replace(/\[\[BOX_SPLIT\]\]/g, '\r\r');
    result = result.replace(/\n\n/g, '\r\r');  // Paragraph break
    result = result.replace(/\n/g, ' ');        // Line break = space
    result = result.replace(/\r\r\r+/g, '\r\r'); // Max 2 returns
    result = result.replace(/  +/g, ' ');
    result = result.replace(/^\s+/, '');
    result = result.replace(/\s+$/, '');
    return result;
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
                
                var textParts = [];
                
                for (var p = 0; p < (sub.content || []).length; p++) {
                    var para = sub.content[p];
                    if (para.type === 'list') continue;
                    
                    var basis = cleanText(para.basis || '');
                    if (basis) textParts.push(basis);
                    
                    var praktijk = cleanText(para.praktijk || '');
                    if (praktijk) {
                        textParts.push('\rIn de praktijk: ' + praktijk);
                    }
                    
                    var verdieping = cleanText(para.verdieping || '');
                    if (verdieping) {
                        textParts.push('\rVerdieping: ' + verdieping);
                    }
                }
                
                if (textParts.length > 0) {
                    map[sub.number] = textParts.join('\r\r');
                }
            }
        }
    }
    return map;
}

// Main
$.writeln("=== V8 Simple Import ===");

var json = readJSON(JSON_PATH);
var textMap = buildMap(json);
var keys = []; for (var k in textMap) keys.push(k);
$.writeln("Subparagraphs: " + keys.length);

var doc = app.open(new File(SOURCE_INDD), false);
$.writeln("Pages: " + doc.pages.length);

var ts = new Date().getTime();
var outPath = SOURCE_INDD.replace('.indd', '_V8_' + ts + '.indd');
doc.saveACopy(new File(outPath));
doc.close(SaveOptions.NO);
doc = app.open(new File(outPath), false);

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
                
                // Find the body paragraphs following this heading
                var start = pi + 1;
                var end = start;
                
                for (var ni = start; ni < story.paragraphs.length; ni++) {
                    var np = story.paragraphs[ni];
                    var nt = np.contents;
                    // Stop at next subparagraph heading
                    if (nt.match(regex)) break;
                    // Stop at section heading
                    if (nt.match(/^\d+\.\d+\s+[A-Z]/)) break;
                    end = ni + 1;
                }
                
                if (end > start) {
                    // Simply replace the text content of the range
                    var firstPara = story.paragraphs[start];
                    var lastPara = story.paragraphs[end - 1];
                    
                    var startChar = firstPara.characters[0].index;
                    var endChar = lastPara.characters[-1].index;
                    
                    var range = story.characters.itemByRange(startChar, endChar);
                    range.contents = textMap[num] + '\r';
                    
                    count++;
                    done[num] = true;
                    $.writeln("  Replaced");
                }
            }
        } catch(e) {
            $.writeln("Error: " + e.message);
        }
    }
}

doc.save();
$.writeln("=== Done: " + count + " replacements ===");
$.writeln("Output: " + outPath);


