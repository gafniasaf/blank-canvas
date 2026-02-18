// Auto-import Prince PDF text into InDesign - V2
// Handles micro titles, praktijk/verdieping blocks, removes stray bullets
#target indesign

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

var JSON_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_skeleton/full_20260104_163341/af4_skeleton_pass1_merged.with_openers.json";
var SOURCE_INDD = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";

function readJSON(filePath) {
    var file = new File(filePath);
    if (!file.exists) throw new Error("JSON not found: " + filePath);
    file.open('r');
    file.encoding = 'UTF-8';
    var content = file.read();
    file.close();
    return eval('(' + content + ')');
}

// Convert markup to structured blocks for InDesign
function parseMarkup(text) {
    if (!text) return [];
    
    var blocks = [];
    var lines = text.split(/\n\n/);
    
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\n/g, ' ').replace(/\[\[BOX_SPLIT\]\]/g, ' ');
        if (!line.trim()) continue;
        
        // Check for micro title
        var microMatch = line.match(/<<MICRO_TITLE>>(.+?)<<MICRO_TITLE_END>>\s*(.*)/);
        if (microMatch) {
            blocks.push({ type: 'micro_title', text: microMatch[1].trim() });
            if (microMatch[2].trim()) {
                blocks.push({ type: 'body', text: stripAllMarkup(microMatch[2]) });
            }
        } else {
            blocks.push({ type: 'body', text: stripAllMarkup(line) });
        }
    }
    
    return blocks;
}

function stripAllMarkup(text) {
    if (!text) return "";
    return text
        .replace(/<<BOLD_START>>/g, '')
        .replace(/<<BOLD_END>>/g, '')
        .replace(/<<MICRO_TITLE>>/g, '')
        .replace(/<<MICRO_TITLE_END>>/g, '')
        .replace(/\[\[BOX_SPLIT\]\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Build map: subparagraph number -> structured content
function buildTextMap(json) {
    var map = {};
    
    for (var c = 0; c < json.chapters.length; c++) {
        var chapter = json.chapters[c];
        
        for (var s = 0; s < chapter.sections.length; s++) {
            var section = chapter.sections[s];
            if (!section.content) continue;
            
            for (var sp = 0; sp < section.content.length; sp++) {
                var subpara = section.content[sp];
                if (subpara.type !== 'subparagraph') continue;
                
                var subparaNum = subpara.number;
                var contentBlocks = [];
                
                if (subpara.content) {
                    for (var p = 0; p < subpara.content.length; p++) {
                        var para = subpara.content[p];
                        
                        // Skip list/bullet items (they're merged into basis in JSON)
                        if (para.type === 'list') continue;
                        
                        var basis = para.basis || '';
                        if (basis) {
                            var parsed = parseMarkup(basis);
                            for (var b = 0; b < parsed.length; b++) {
                                contentBlocks.push(parsed[b]);
                            }
                        }
                        
                        var praktijk = para.praktijk || '';
                        if (praktijk) {
                            contentBlocks.push({ 
                                type: 'praktijk', 
                                text: 'In de praktijk: ' + stripAllMarkup(praktijk)
                            });
                        }
                        
                        var verdieping = para.verdieping || '';
                        if (verdieping) {
                            contentBlocks.push({ 
                                type: 'verdieping', 
                                text: 'Verdieping: ' + stripAllMarkup(verdieping)
                            });
                        }
                    }
                }
                
                if (contentBlocks.length > 0) {
                    map[subparaNum] = contentBlocks;
                }
            }
        }
    }
    
    return map;
}

// Find or create paragraph style
function getOrCreateStyle(doc, baseName, props) {
    try {
        return doc.paragraphStyles.itemByName(baseName);
    } catch(e) {
        return doc.paragraphStyles[0]; // Return default style
    }
}

function main() {
    $.writeln("=== Auto Import Prince Text V2 ===");
    $.writeln("Started: " + new Date().toLocaleString());
    
    // Read JSON
    $.writeln("Reading JSON...");
    var json = readJSON(JSON_PATH);
    $.writeln("  Chapters: " + json.chapters.length);
    
    // Build text map
    var textMap = buildTextMap(json);
    var mapKeys = [];
    for (var k in textMap) mapKeys.push(k);
    $.writeln("  Subparagraphs: " + mapKeys.length);
    
    // Open document
    $.writeln("Opening document...");
    var doc = app.open(new File(SOURCE_INDD), false);
    $.writeln("  Pages: " + doc.pages.length);
    
    // Save copy
    var timestamp = new Date().getTime();
    var copyPath = SOURCE_INDD.replace('.indd', '_PRINCE_V2_' + timestamp + '.indd');
    $.writeln("Saving copy: " + copyPath);
    doc.saveACopy(new File(copyPath));
    doc.close(SaveOptions.NO);
    doc = app.open(new File(copyPath), false);
    
    // Find styles
    var basisStyle = null;
    var mikroKopStyle = null;
    var praktijkStyle = null;
    var verdiepingStyle = null;
    
    for (var i = 0; i < doc.paragraphStyles.length; i++) {
        var styleName = doc.paragraphStyles[i].name;
        if (styleName.indexOf('Basis') !== -1 && !basisStyle) basisStyle = doc.paragraphStyles[i];
        if (styleName.indexOf('Mikro') !== -1 || styleName.indexOf('Micro') !== -1) mikroKopStyle = doc.paragraphStyles[i];
        if (styleName.toLowerCase().indexOf('praktijk') !== -1) praktijkStyle = doc.paragraphStyles[i];
        if (styleName.toLowerCase().indexOf('verdieping') !== -1) verdiepingStyle = doc.paragraphStyles[i];
    }
    
    $.writeln("  Basis style: " + (basisStyle ? basisStyle.name : "not found"));
    $.writeln("  MikroKop style: " + (mikroKopStyle ? mikroKopStyle.name : "not found"));
    
    // Process
    $.writeln("Processing stories...");
    var replacements = 0;
    var errors = 0;
    var processed = {};
    var subparaRegex = /^(\d+\.\d+\.\d+)\s+/;
    
    for (var storyIdx = 0; storyIdx < doc.stories.length; storyIdx++) {
        var story = doc.stories[storyIdx];
        var paraIdx = 0;
        
        while (paraIdx < story.paragraphs.length) {
            var para = story.paragraphs[paraIdx];
            var paraText = para.contents;
            var match = paraText.match(subparaRegex);
            
            if (match && textMap[match[1]] && !processed[match[1]]) {
                var subparaNum = match[1];
                $.writeln("  Processing: " + subparaNum);
                
                // Find end of this subparagraph's content
                var startIdx = paraIdx + 1;
                var endIdx = startIdx;
                
                for (var nextIdx = startIdx; nextIdx < story.paragraphs.length; nextIdx++) {
                    var nextPara = story.paragraphs[nextIdx];
                    var nextText = nextPara.contents;
                    
                    if (nextText.match(subparaRegex)) break;
                    if (nextText.match(/^\d+\.\d+\s+[A-Z]/) && !nextText.match(/^\d+\.\d+\.\d+/)) break;
                    
                    endIdx = nextIdx + 1;
                }
                
                if (endIdx > startIdx) {
                    try {
                        // Delete old content
                        for (var delIdx = endIdx - 1; delIdx >= startIdx; delIdx--) {
                            if (delIdx < story.paragraphs.length) {
                                story.paragraphs[delIdx].contents = '';
                            }
                        }
                        
                        // Insert new content after the heading
                        var insertPoint = story.paragraphs[paraIdx].insertionPoints[-1];
                        var blocks = textMap[subparaNum];
                        
                        for (var bIdx = 0; bIdx < blocks.length; bIdx++) {
                            var block = blocks[bIdx];
                            var newPara = insertPoint.contents = '\r' + block.text;
                            
                            // Try to apply appropriate style
                            try {
                                var newParaObj = story.paragraphs[paraIdx + bIdx + 1];
                                if (block.type === 'micro_title' && mikroKopStyle) {
                                    newParaObj.appliedParagraphStyle = mikroKopStyle;
                                } else if (block.type === 'praktijk' && praktijkStyle) {
                                    newParaObj.appliedParagraphStyle = praktijkStyle;
                                } else if (block.type === 'verdieping' && verdiepingStyle) {
                                    newParaObj.appliedParagraphStyle = verdiepingStyle;
                                } else if (basisStyle) {
                                    newParaObj.appliedParagraphStyle = basisStyle;
                                }
                            } catch(styleErr) {
                                // Style application failed, continue
                            }
                            
                            insertPoint = story.paragraphs[paraIdx + bIdx + 1].insertionPoints[-1];
                        }
                        
                        replacements++;
                        processed[subparaNum] = true;
                        
                    } catch(e) {
                        $.writeln("    ERROR: " + e.message);
                        errors++;
                    }
                }
            }
            
            paraIdx++;
        }
    }
    
    // Clean up empty paragraphs and stray bullets
    $.writeln("Cleaning up...");
    for (var sIdx = 0; sIdx < doc.stories.length; sIdx++) {
        var s = doc.stories[sIdx];
        for (var pIdx = s.paragraphs.length - 1; pIdx >= 0; pIdx--) {
            try {
                var p = s.paragraphs[pIdx];
                var content = p.contents.replace(/[\r\n\s]/g, '');
                // Remove empty paragraphs or single bullet characters
                if (content === '' || content === '•' || content === '-') {
                    p.remove();
                }
            } catch(e) {}
        }
    }
    
    // Save
    $.writeln("Saving...");
    doc.save();
    
    $.writeln("");
    $.writeln("=== Complete ===");
    $.writeln("  Replacements: " + replacements);
    $.writeln("  Errors: " + errors);
    $.writeln("  Output: " + copyPath);
}

try {
    main();
} catch(e) {
    $.writeln("FATAL: " + e.message);
}


