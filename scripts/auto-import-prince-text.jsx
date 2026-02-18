// Auto-import Prince PDF text into InDesign
// Matches by subparagraph number and replaces body text including praktijk/verdieping
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

function stripMarkup(text) {
    if (!text) return "";
    return text
        .replace(/<<BOLD_START>>/g, '')
        .replace(/<<BOLD_END>>/g, '')
        .replace(/<<MICRO_TITLE>>/g, '')
        .replace(/<<MICRO_TITLE_END>>/g, '')
        .replace(/\[\[BOX_SPLIT\]\]/g, '\r\r');
}

// Build map: subparagraph number -> combined text (basis + praktijk + verdieping)
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
                var allText = [];
                
                if (subpara.content) {
                    for (var p = 0; p < subpara.content.length; p++) {
                        var para = subpara.content[p];
                        
                        var basis = stripMarkup(para.basis || '');
                        if (basis) allText.push(basis);
                        
                        var praktijk = stripMarkup(para.praktijk || '');
                        if (praktijk) {
                            allText.push("\rIn de praktijk: " + praktijk);
                        }
                        
                        var verdieping = stripMarkup(para.verdieping || '');
                        if (verdieping) {
                            allText.push("\rVerdieping: " + verdieping);
                        }
                    }
                }
                
                if (allText.length > 0) {
                    map[subparaNum] = allText.join('\r\r');
                }
            }
        }
    }
    
    return map;
}

function main() {
    $.writeln("=== Auto Import Prince Text to InDesign ===");
    $.writeln("Started: " + new Date().toLocaleString());
    $.writeln("");
    
    // Read JSON
    $.writeln("Reading JSON...");
    var json = readJSON(JSON_PATH);
    $.writeln("  Chapters: " + json.chapters.length);
    
    // Build text map
    var textMap = buildTextMap(json);
    var mapKeys = [];
    for (var k in textMap) mapKeys.push(k);
    $.writeln("  Subparagraphs in map: " + mapKeys.length);
    
    // Open document
    $.writeln("");
    $.writeln("Opening InDesign document...");
    var doc = app.open(new File(SOURCE_INDD), false);
    $.writeln("  Document: " + doc.name);
    $.writeln("  Pages: " + doc.pages.length);
    
    // Save a copy
    var timestamp = new Date().getTime();
    var copyPath = SOURCE_INDD.replace('.indd', '_PRINCE_IMPORT_' + timestamp + '.indd');
    $.writeln("");
    $.writeln("Saving copy: " + copyPath);
    doc.saveACopy(new File(copyPath));
    doc.close(SaveOptions.NO);
    
    // Open copy
    doc = app.open(new File(copyPath), false);
    
    // Process document
    $.writeln("");
    $.writeln("Processing stories...");
    
    var replacements = 0;
    var errors = 0;
    var processed = {};
    
    // Regular expression to match subparagraph headings
    var subparaRegex = /^(\d+\.\d+\.\d+)\s+/;
    
    for (var storyIdx = 0; storyIdx < doc.stories.length; storyIdx++) {
        var story = doc.stories[storyIdx];
        
        // Find all subparagraph headings in this story
        for (var paraIdx = 0; paraIdx < story.paragraphs.length; paraIdx++) {
            var para = story.paragraphs[paraIdx];
            var paraText = para.contents;
            
            // Check for subparagraph heading pattern
            var match = paraText.match(subparaRegex);
            if (match) {
                var subparaNum = match[1];
                
                // Skip if already processed or not in our map
                if (processed[subparaNum] || !textMap[subparaNum]) continue;
                
                $.writeln("  Found: " + subparaNum);
                
                // Find the range of body paragraphs to replace
                var startIdx = paraIdx + 1;
                var endIdx = startIdx;
                
                // Find where this subparagraph ends (next heading or end of story)
                for (var nextIdx = startIdx; nextIdx < story.paragraphs.length; nextIdx++) {
                    var nextPara = story.paragraphs[nextIdx];
                    var nextText = nextPara.contents;
                    var nextStyle = nextPara.appliedParagraphStyle.name;
                    
                    // Stop if we hit another subparagraph heading
                    if (nextText.match(subparaRegex)) break;
                    
                    // Stop if we hit a section heading (x.x pattern but not x.x.x)
                    if (nextText.match(/^\d+\.\d+\s+[A-Z]/) && !nextText.match(/^\d+\.\d+\.\d+/)) break;
                    
                    // Stop if we hit a chapter heading
                    if (nextStyle.indexOf('Hoofdstuk') !== -1) break;
                    
                    endIdx = nextIdx + 1;
                }
                
                // Replace the body paragraphs
                if (endIdx > startIdx) {
                    try {
                        // Get the text range to replace
                        var firstPara = story.paragraphs[startIdx];
                        var lastPara = story.paragraphs[endIdx - 1];
                        
                        var startCharIdx = firstPara.characters[0].index;
                        var endCharIdx = lastPara.characters[lastPara.characters.length - 1].index;
                        
                        var textRange = story.characters.itemByRange(startCharIdx, endCharIdx);
                        
                        // Replace with new text
                        var newText = textMap[subparaNum];
                        textRange.contents = newText + '\r';
                        
                        replacements++;
                        processed[subparaNum] = true;
                        $.writeln("    Replaced " + (endIdx - startIdx) + " paragraphs");
                        
                    } catch(e) {
                        $.writeln("    ERROR: " + e.message);
                        errors++;
                    }
                }
            }
        }
    }
    
    // Save
    $.writeln("");
    $.writeln("Saving document...");
    doc.save();
    
    $.writeln("");
    $.writeln("=== Import Complete ===");
    $.writeln("  Replacements: " + replacements);
    $.writeln("  Errors: " + errors);
    $.writeln("  Output: " + copyPath);
    $.writeln("Finished: " + new Date().toLocaleString());
}

try {
    main();
} catch(e) {
    $.writeln("FATAL ERROR: " + e.message);
}


