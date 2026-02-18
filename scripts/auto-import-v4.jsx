// Auto-import Prince text V4 - Fixed formatting
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
    result = result.replace(/\[\[BOX_SPLIT\]\]/g, ' ');
    result = result.replace(/\n\n/g, ' ');
    result = result.replace(/\n/g, ' ');
    result = result.replace(/\s+/g, ' ');
    result = result.replace(/^\s+/, '');
    result = result.replace(/\s+$/, '');
    return result;
}

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
                
                var blocks = []; // Array of {type, text}
                
                for (var p = 0; p < (sub.content || []).length; p++) {
                    var para = sub.content[p];
                    if (para.type === 'list') continue;
                    
                    var basis = para.basis || '';
                    if (basis) {
                        var parsed = extractMicroTitle(basis);
                        if (parsed.title) {
                            blocks.push({ type: 'micro', text: parsed.title });
                        }
                        var bodyText = cleanText(parsed.rest);
                        if (bodyText) {
                            blocks.push({ type: 'body', text: bodyText });
                        }
                    }
                    
                    var praktijk = cleanText(para.praktijk || '');
                    if (praktijk) {
                        blocks.push({ type: 'praktijk', text: 'In de praktijk: ' + praktijk });
                    }
                    
                    var verdieping = cleanText(para.verdieping || '');
                    if (verdieping) {
                        blocks.push({ type: 'verdieping', text: 'Verdieping: ' + verdieping });
                    }
                }
                
                if (blocks.length > 0) {
                    map[sub.number] = blocks;
                }
            }
        }
    }
    return map;
}

// Main
$.writeln("=== V4 Import Started ===");

var json = readJSON(JSON_PATH);
$.writeln("Chapters: " + json.chapters.length);

var textMap = buildMap(json);
var keys = []; for (var k in textMap) keys.push(k);
$.writeln("Subparagraphs: " + keys.length);

var doc = app.open(new File(SOURCE_INDD), false);
$.writeln("Pages: " + doc.pages.length);

// Find styles
var basisStyle = null;
var mikroStyle = null;
var praktijkStyle = null;
var verdiepingStyle = null;

for (var i = 0; i < doc.paragraphStyles.length; i++) {
    var sn = doc.paragraphStyles[i].name;
    if (sn === '•Basis' || sn === 'Basis') basisStyle = doc.paragraphStyles[i];
    if (sn.indexOf('Mikro') !== -1 || sn.indexOf('Micro') !== -1) mikroStyle = doc.paragraphStyles[i];
    if (sn.toLowerCase().indexOf('praktijk') !== -1 && !praktijkStyle) praktijkStyle = doc.paragraphStyles[i];
    if (sn.toLowerCase().indexOf('verdieping') !== -1 && !verdiepingStyle) verdiepingStyle = doc.paragraphStyles[i];
}

$.writeln("Basis style: " + (basisStyle ? basisStyle.name : "NOT FOUND"));
$.writeln("Mikro style: " + (mikroStyle ? mikroStyle.name : "NOT FOUND"));

var ts = new Date().getTime();
var outPath = SOURCE_INDD.replace('.indd', '_V4_' + ts + '.indd');
doc.saveACopy(new File(outPath));
doc.close(SaveOptions.NO);
doc = app.open(new File(outPath), false);
$.writeln("Working on: " + outPath);

// Re-find styles in new doc
basisStyle = null; mikroStyle = null; praktijkStyle = null; verdiepingStyle = null;
for (var i = 0; i < doc.paragraphStyles.length; i++) {
    var sn = doc.paragraphStyles[i].name;
    if (sn === '•Basis' || sn === 'Basis') basisStyle = doc.paragraphStyles[i];
    if (sn.indexOf('Mikro') !== -1 || sn.indexOf('Micro') !== -1) mikroStyle = doc.paragraphStyles[i];
    if (sn.toLowerCase().indexOf('praktijk') !== -1 && !praktijkStyle) praktijkStyle = doc.paragraphStyles[i];
    if (sn.toLowerCase().indexOf('verdieping') !== -1 && !verdiepingStyle) verdiepingStyle = doc.paragraphStyles[i];
}

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
                    // Delete old paragraphs (from end to start to preserve indices)
                    for (var di = end - 1; di >= start; di--) {
                        try {
                            story.paragraphs[di].remove();
                        } catch(e) {}
                    }
                    
                    // Insert new content
                    var blocks = textMap[num];
                    var insertAfter = story.paragraphs[pi]; // The heading paragraph
                    
                    for (var bi = 0; bi < blocks.length; bi++) {
                        var block = blocks[bi];
                        
                        // Insert new paragraph at end of heading
                        var insertPt = insertAfter.insertionPoints[-1];
                        insertPt.contents = '\r' + block.text;
                        
                        // Get the newly created paragraph
                        var newPara = story.paragraphs[pi + bi + 1];
                        
                        // Apply style and remove any bullet formatting
                        try {
                            // First apply basis style to clear any bullet formatting
                            if (basisStyle) {
                                newPara.appliedParagraphStyle = basisStyle;
                            }
                            
                            // Then apply specific style if available
                            if (block.type === 'micro' && mikroStyle) {
                                newPara.appliedParagraphStyle = mikroStyle;
                            } else if (block.type === 'praktijk' && praktijkStyle) {
                                newPara.appliedParagraphStyle = praktijkStyle;
                            } else if (block.type === 'verdieping' && verdiepingStyle) {
                                newPara.appliedParagraphStyle = verdiepingStyle;
                            }
                            
                            // Remove any bullet character at start
                            var content = newPara.contents;
                            if (content.charAt(0) === '•' || content.charAt(0) === '-' || content.charAt(0) === '–') {
                                newPara.contents = content.substring(1).replace(/^\s+/, '');
                            }
                            
                            // Clear left indent that might come from bullet style
                            newPara.leftIndent = 0;
                            newPara.firstLineIndent = 0;
                            newPara.bulletsAndNumberingListType = ListType.NO_LIST;
                            
                        } catch(styleErr) {
                            $.writeln("Style error: " + styleErr.message);
                        }
                        
                        insertAfter = newPara;
                    }
                    
                    count++;
                    done[num] = true;
                }
            }
        } catch(e) {
            $.writeln("Error at para " + pi + ": " + e.message);
        }
    }
}

// Final cleanup - remove stray bullet/empty paragraphs
$.writeln("Final cleanup...");
for (var si = 0; si < doc.stories.length; si++) {
    var story = doc.stories[si];
    for (var pi = story.paragraphs.length - 1; pi >= 0; pi--) {
        try {
            var p = story.paragraphs[pi];
            var c = p.contents;
            // Remove if just whitespace, bullets, or dashes
            var stripped = c.replace(/[\r\n\s•\-–—]/g, '');
            if (stripped === '') {
                p.remove();
            } else {
                // Remove leading bullet chars
                if (c.charAt(0) === '•' || c.charAt(0) === '-' || c.charAt(0) === '–') {
                    p.contents = c.substring(1).replace(/^\s+/, '');
                }
                // Clear bullet formatting
                try {
                    p.leftIndent = 0;
                    p.firstLineIndent = 0;
                    p.bulletsAndNumberingListType = ListType.NO_LIST;
                } catch(e) {}
            }
        } catch(e) {}
    }
}

doc.save();
$.writeln("=== Done: " + count + " replacements ===");
$.writeln("Output: " + outPath);

