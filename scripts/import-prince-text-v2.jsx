// Import Prince PDF text back into InDesign - V2
// Properly includes praktijk and verdieping boxes
#target indesign

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;

// Configuration
var JSON_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_skeleton/full_20260104_163341/af4_skeleton_pass1_merged.with_openers.json";
var SOURCE_INDD = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/MBO A&F 4_9789083251370_03/MBO A&F 4_9789083251370_03.2024.indd";
var OUTPUT_TXT = "/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/af4_rewritten_text_for_indesign.txt";

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

// Helper: Write text file
function writeTextFile(filePath, content) {
    var file = new File(filePath);
    file.open('w');
    file.encoding = 'UTF-8';
    file.write(content);
    file.close();
}

// Helper: Strip markup tags for display
function stripMarkup(text) {
    if (!text) return "";
    return text
        .replace(/<<BOLD_START>>/g, '')
        .replace(/<<BOLD_END>>/g, '')
        .replace(/<<MICRO_TITLE>>/g, '')
        .replace(/<<MICRO_TITLE_END>>/g, '')
        .replace(/\[\[BOX_SPLIT\]\]/g, '\n\n');
}

// Build complete text output with praktijk and verdieping
function buildFullText(json) {
    var output = [];
    
    for (var c = 0; c < json.chapters.length; c++) {
        var chapter = json.chapters[c];
        var chapterNum = chapter.number;
        var chapterTitle = chapter.title || '';
        
        output.push("========================================");
        output.push("HOOFDSTUK " + chapterNum + ": " + chapterTitle);
        output.push("========================================\n");
        
        for (var s = 0; s < chapter.sections.length; s++) {
            var section = chapter.sections[s];
            var sectionNum = section.number;
            var sectionTitle = section.title || '';
            
            output.push("\n--- " + sectionNum + " " + sectionTitle + " ---\n");
            
            if (section.content) {
                for (var sp = 0; sp < section.content.length; sp++) {
                    var subpara = section.content[sp];
                    if (subpara.type === 'subparagraph') {
                        var subparaNum = subpara.number;
                        var subparaTitle = subpara.title || '';
                        
                        output.push("\n[" + subparaNum + "] " + subparaTitle + "\n");
                        
                        if (subpara.content) {
                            for (var p = 0; p < subpara.content.length; p++) {
                                var para = subpara.content[p];
                                
                                // Get basis text
                                var basis = para.basis || '';
                                if (basis) {
                                    output.push(stripMarkup(basis));
                                    output.push("");
                                }
                                
                                // Get praktijk (In de praktijk)
                                var praktijk = para.praktijk || '';
                                if (praktijk) {
                                    output.push("In de praktijk: " + stripMarkup(praktijk));
                                    output.push("");
                                }
                                
                                // Get verdieping
                                var verdieping = para.verdieping || '';
                                if (verdieping) {
                                    output.push("Verdieping: " + stripMarkup(verdieping));
                                    output.push("");
                                }
                            }
                        }
                    }
                }
            }
        }
        
        output.push("\n");
    }
    
    return output.join("\n");
}

// Main function
function main() {
    $.writeln("=== Export Prince Text for InDesign Import ===");
    $.writeln("");
    
    // Read JSON
    $.writeln("Reading JSON...");
    var json;
    try {
        json = readJSON(JSON_PATH);
        $.writeln("  Loaded " + json.chapters.length + " chapters");
    } catch(e) {
        $.writeln("ERROR: " + e.message);
        alert("Error reading JSON: " + e.message);
        return;
    }
    
    // Build full text
    $.writeln("Building text with praktijk/verdieping...");
    var fullText = buildFullText(json);
    
    // Write to file
    $.writeln("Writing to: " + OUTPUT_TXT);
    writeTextFile(OUTPUT_TXT, fullText);
    
    // Count statistics
    var praktijkCount = (fullText.match(/In de praktijk:/g) || []).length;
    var verdiepingCount = (fullText.match(/Verdieping:/g) || []).length;
    
    $.writeln("");
    $.writeln("=== Export Complete ===");
    $.writeln("  Praktijk blocks: " + praktijkCount);
    $.writeln("  Verdieping blocks: " + verdiepingCount);
    $.writeln("  Output: " + OUTPUT_TXT);
    
    alert("Export complete!\n\n" +
          "Praktijk blocks: " + praktijkCount + "\n" +
          "Verdieping blocks: " + verdiepingCount + "\n\n" +
          "Text saved to:\n" + OUTPUT_TXT + "\n\n" +
          "You can now use InDesign's Place command to import this text.");
}

// Run
main();


