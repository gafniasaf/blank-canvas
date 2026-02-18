// Import Prince PDF text back into InDesign
// Only imports text content, preserves InDesign styling
#target indesign

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;

// Configuration
var JSON_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_skeleton/full_20260104_163341/af4_skeleton_pass1_merged.with_openers.json";
var SOURCE_INDD = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";

// Helper: Read JSON file
function readJSON(filePath) {
    var file = new File(filePath);
    if (!file.exists) {
        throw new Error("JSON file not found: " + filePath);
    }
    file.open('r');
    file.encoding = 'UTF-8';
    var content = file.read();
    file.close();
    return eval('(' + content + ')');
}

// Helper: Convert markup tags to plain text (for comparison)
function stripMarkup(text) {
    if (!text) return "";
    return text
        .replace(/<<BOLD_START>>/g, '')
        .replace(/<<BOLD_END>>/g, '')
        .replace(/<<MICRO_TITLE>>/g, '')
        .replace(/<<MICRO_TITLE_END>>/g, '')
        .replace(/\n\n/g, '\r')
        .replace(/\n/g, ' ');
}

// Helper: Convert markup to InDesign formatted text
function convertMarkupToInDesign(text, story, insertionPoint) {
    if (!text) return;
    
    // Split by markup tags
    var parts = [];
    var regex = /<<(BOLD_START|BOLD_END|MICRO_TITLE|MICRO_TITLE_END)>>/g;
    var lastIndex = 0;
    var match;
    
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
        }
        parts.push({ type: 'tag', content: match[1] });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push({ type: 'text', content: text.substring(lastIndex) });
    }
    
    // Apply formatting
    var isBold = false;
    var isMicroTitle = false;
    
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (part.type === 'tag') {
            if (part.content === 'BOLD_START') isBold = true;
            else if (part.content === 'BOLD_END') isBold = false;
            else if (part.content === 'MICRO_TITLE') isMicroTitle = true;
            else if (part.content === 'MICRO_TITLE_END') isMicroTitle = false;
        } else {
            var cleanText = part.content.replace(/\n\n/g, '\r').replace(/\n/g, ' ');
            var startIdx = insertionPoint.index;
            insertionPoint.contents = cleanText;
            
            // Move insertion point forward
            var endIdx = startIdx + cleanText.length;
            var textRange = story.characters.itemByRange(startIdx, endIdx - 1);
            
            if (isBold || isMicroTitle) {
                try {
                    textRange.fontStyle = "Bold";
                } catch(e) {
                    // Style might not exist
                }
            }
            
            // Update insertion point
            insertionPoint = story.insertionPoints[endIdx];
        }
    }
    
    return insertionPoint;
}

// Build a lookup map from the JSON
function buildTextMap(json) {
    var map = {};
    
    for (var c = 0; c < json.chapters.length; c++) {
        var chapter = json.chapters[c];
        var chapterNum = chapter.number;
        
        for (var s = 0; s < chapter.sections.length; s++) {
            var section = chapter.sections[s];
            var sectionNum = section.number;
            
            if (section.content) {
                for (var sp = 0; sp < section.content.length; sp++) {
                    var subpara = section.content[sp];
                    if (subpara.type === 'subparagraph') {
                        var subparaNum = subpara.number;
                        
                        // Collect all basis text from this subparagraph
                        var texts = [];
                        if (subpara.content) {
                            for (var p = 0; p < subpara.content.length; p++) {
                                var para = subpara.content[p];
                                if (para.basis && para.basis.length > 0) {
                                    texts.push({
                                        text: para.basis,
                                        style: para.styleHint || '',
                                        role: para.role || '',
                                        praktijk: para.praktijk || '',
                                        verdieping: para.verdieping || ''
                                    });
                                }
                            }
                        }
                        
                        if (texts.length > 0) {
                            map[subparaNum] = texts;
                        }
                    }
                }
            }
        }
    }
    
    return map;
}

// Find paragraph style by name pattern
function findStyleByPattern(doc, pattern) {
    for (var i = 0; i < doc.paragraphStyles.length; i++) {
        if (doc.paragraphStyles[i].name.indexOf(pattern) !== -1) {
            return doc.paragraphStyles[i];
        }
    }
    return null;
}

// Main import function
function importText() {
    $.writeln("=== Import Prince Text to InDesign ===");
    $.writeln("");
    
    // Read JSON
    $.writeln("Reading JSON...");
    var json;
    try {
        json = readJSON(JSON_PATH);
        $.writeln("  Loaded " + json.chapters.length + " chapters");
    } catch(e) {
        $.writeln("ERROR: " + e.message);
        return;
    }
    
    // Build text map
    var textMap = buildTextMap(json);
    var keys = [];
    for (var k in textMap) keys.push(k);
    $.writeln("  Built map with " + keys.length + " subparagraphs");
    
    // Open InDesign document
    $.writeln("");
    $.writeln("Opening InDesign document...");
    var doc;
    try {
        doc = app.open(new File(SOURCE_INDD), false);
        $.writeln("  Opened: " + doc.name);
        $.writeln("  Pages: " + doc.pages.length);
    } catch(e) {
        $.writeln("ERROR opening document: " + e.message);
        return;
    }
    
    // Save a copy first
    var copyPath = SOURCE_INDD.replace('.indd', '_REWRITTEN.indd');
    $.writeln("");
    $.writeln("Saving copy to: " + copyPath);
    doc.saveACopy(new File(copyPath));
    
    // Close original and open copy
    doc.close(SaveOptions.NO);
    doc = app.open(new File(copyPath), false);
    
    // Find all text frames and their content
    $.writeln("");
    $.writeln("Analyzing document structure...");
    
    var replacements = 0;
    var errors = 0;
    
    // Iterate through all stories (text threads)
    for (var storyIdx = 0; storyIdx < doc.stories.length; storyIdx++) {
        var story = doc.stories[storyIdx];
        
        // Look for subparagraph headings to identify sections
        for (var paraIdx = 0; paraIdx < story.paragraphs.length; paraIdx++) {
            var para = story.paragraphs[paraIdx];
            var paraText = para.contents;
            
            // Check if this looks like a subparagraph number (e.g., "1.1.1", "2.3.4")
            var subparaMatch = paraText.match(/^(\d+\.\d+\.\d+)\s/);
            if (subparaMatch) {
                var subparaNum = subparaMatch[1];
                
                if (textMap[subparaNum]) {
                    $.writeln("  Found " + subparaNum + " at story " + storyIdx + ", para " + paraIdx);
                    
                    // Get the rewritten text for this subparagraph
                    var newTexts = textMap[subparaNum];
                    
                    // Find the body paragraphs following this heading
                    var bodyParaIdx = paraIdx + 1;
                    var textIdx = 0;
                    
                    while (bodyParaIdx < story.paragraphs.length && textIdx < newTexts.length) {
                        var bodyPara = story.paragraphs[bodyParaIdx];
                        var styleName = bodyPara.appliedParagraphStyle.name;
                        
                        // Check if this is a body paragraph (not a heading)
                        if (styleName.indexOf('Basis') !== -1 || 
                            styleName.indexOf('Body') !== -1 ||
                            styleName.indexOf('Bullet') !== -1) {
                            
                            // Replace the text
                            var newText = newTexts[textIdx];
                            var cleanText = stripMarkup(newText.text);
                            
                            if (cleanText.length > 0) {
                                try {
                                    // Preserve the paragraph return at the end
                                    var hadReturn = bodyPara.contents.charAt(bodyPara.contents.length - 1) === '\r';
                                    bodyPara.contents = cleanText + (hadReturn ? '\r' : '');
                                    replacements++;
                                    textIdx++;
                                } catch(e) {
                                    $.writeln("    ERROR replacing para: " + e.message);
                                    errors++;
                                }
                            }
                        }
                        
                        // Stop if we hit the next subparagraph heading
                        var nextMatch = bodyPara.contents.match(/^(\d+\.\d+\.\d+)\s/);
                        if (nextMatch && nextMatch[1] !== subparaNum) {
                            break;
                        }
                        
                        bodyParaIdx++;
                    }
                }
            }
        }
    }
    
    $.writeln("");
    $.writeln("=== Import Complete ===");
    $.writeln("  Replacements: " + replacements);
    $.writeln("  Errors: " + errors);
    $.writeln("  Saved to: " + copyPath);
    
    // Save the document
    doc.save();
    
    alert("Import complete!\n\nReplacements: " + replacements + "\nErrors: " + errors + "\n\nSaved to:\n" + copyPath);
}

// Run
importText();


