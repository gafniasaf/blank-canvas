// Auto-import Prince text V5 - Preserve paragraph breaks
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

// Clean text but PRESERVE paragraph breaks (\n\n -> \r)
function cleanText(text) {
    if (!text) return "";
    var result = String(text);
    result = result.replace(/<<BOLD_START>>/g, '');
    result = result.replace(/<<BOLD_END>>/g, '');
    result = result.replace(/\[\[BOX_SPLIT\]\]/g, '\r');
    result = result.replace(/\n\n/g, '\r');  // Double newline = new paragraph
    result = result.replace(/\n/g, ' ');      // Single newline = space
    result = result.replace(/\r\r+/g, '\r');  // Multiple returns = single return
    result = result.replace(/  +/g, ' ');     // Multiple spaces = single space
    result = result.replace(/^\s+/, '');
    result = result.replace(/\s+$/, '');
    return result;
}

// Extract micro title if present
function extractMicroTitle(text) {
    if (!text) return { title: null, rest: text };
    var match = text.match(/<<MICRO_TITLE>>([^<]+)<<MICRO_TITLE_END>>/);
    if (match) {
        var idx = text.indexOf('<<MICRO_TITLE_END>>') + 19;
        var rest = text.substring(idx);
        return { 
            title: match[1].replace(/^\s+/, '').replace(/\s+$/, ''), 
            rest: rest 
        };
    }
    return { title: null, rest: text };
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
                
                var textParts = []; // Simple array of text strings with \r for paragraph breaks
                
                for (var p = 0; p < (sub.content || []).length; p++) {
                    var para = sub.content[p];
                    if (para.type === 'list') continue;
                    
                    var basis = para.basis || '';
                    if (basis) {
                        var parsed = extractMicroTitle(basis);
                        if (parsed.title) {
                            textParts.push(parsed.title); // Micro title as own paragraph
                        }
                        var bodyText = cleanText(parsed.rest);
                        if (bodyText) {
                            textParts.push(bodyText);
                        }
                    }
                    
                    var praktijk = cleanText(para.praktijk || '');
                    if (praktijk) {
                        textParts.push('In de praktijk: ' + praktijk);
                    }
                    
                    var verdieping = cleanText(para.verdieping || '');
                    if (verdieping) {
                        textParts.push('Verdieping: ' + verdieping);
                    }
                }
                
                if (textParts.length > 0) {
                    // Join with paragraph breaks
                    map[sub.number] = textParts.join('\r');
                }
            }
        }
    }
    return map;
}

// Main
$.writeln("=== V5 Import Started ===");

var json = readJSON(JSON_PATH);
$.writeln("Chapters: " + json.chapters.length);

var textMap = buildMap(json);
var keys = []; for (var k in textMap) keys.push(k);
$.writeln("Subparagraphs: " + keys.length);

var doc = app.open(new File(SOURCE_INDD), false);
$.writeln("Pages: " + doc.pages.length);

var ts = new Date().getTime();
var outPath = SOURCE_INDD.replace('.indd', '_V5_' + ts + '.indd');
doc.saveACopy(new File(outPath));
doc.close(SaveOptions.NO);
doc = app.open(new File(outPath), false);
$.writeln("Working on: " + outPath);

// Find basis style
var basisStyle = null;
for (var i = 0; i < doc.paragraphStyles.length; i++) {
    var sn = doc.paragraphStyles[i].name;
    if (sn === '•Basis') {
        basisStyle = doc.paragraphStyles[i];
        break;
    }
}
if (!basisStyle) {
    for (var i = 0; i < doc.paragraphStyles.length; i++) {
        if (doc.paragraphStyles[i].name.indexOf('Basis') !== -1) {
            basisStyle = doc.paragraphStyles[i];
            break;
        }
    }
}
$.writeln("Basis style: " + (basisStyle ? basisStyle.name : "NOT FOUND"));

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
                $.writeln("Processing: " + num);
                
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
                    // Get character range
                    var firstPara = story.paragraphs[start];
                    var lastPara = story.paragraphs[end - 1];
                    var startChar = firstPara.characters[0].index;
                    var endChar = lastPara.characters[-1].index;
                    
                    // Replace text
                    var range = story.characters.itemByRange(startChar, endChar);
                    var newText = textMap[num];
                    range.contents = newText + '\r';
                    
                    // Apply basis style to all new paragraphs
                    if (basisStyle) {
                        // Re-get the paragraph range after content change
                        for (var newPi = start; newPi < story.paragraphs.length; newPi++) {
                            var newPara = story.paragraphs[newPi];
                            var newText = newPara.contents;
                            
                            // Stop if we hit the next subparagraph
                            if (newText.match(regex)) break;
                            if (newText.match(/^\d+\.\d+\s+[A-Z]/)) break;
                            
                            try {
                                newPara.appliedParagraphStyle = basisStyle;
                                newPara.leftIndent = 0;
                                newPara.firstLineIndent = 0;
                                newPara.bulletsAndNumberingListType = ListType.NO_LIST;
                            } catch(e) {}
                        }
                    }
                    
                    count++;
                    done[num] = true;
                }
            }
        } catch(e) {
            $.writeln("Error: " + e.message);
        }
    }
}

// Cleanup empty paragraphs
$.writeln("Cleanup...");
for (var si = 0; si < doc.stories.length; si++) {
    var story = doc.stories[si];
    for (var pi = story.paragraphs.length - 1; pi >= 0; pi--) {
        try {
            var p = story.paragraphs[pi];
            var c = p.contents.replace(/[\r\n\s•\-–—]/g, '');
            if (c === '') p.remove();
        } catch(e) {}
    }
}

doc.save();
$.writeln("=== Done: " + count + " replacements ===");


