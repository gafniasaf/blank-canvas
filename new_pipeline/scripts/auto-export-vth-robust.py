#!/usr/bin/env python3
import os
import time
import subprocess
from pathlib import Path

# Config
SOURCE_DIR = "/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03"
OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4"
TEMP_SCRIPT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/temp_scripts"
LOG_FILE = os.path.join(TEMP_SCRIPT_DIR, "export_log.txt")

def ensure_dir(d):
    if not os.path.exists(d):
        os.makedirs(d)

def generate_jsx(chapter_num):
    ch_str = f"{chapter_num:02d}"
    indd_name = f"{ch_str}-VTH_Combined_03.2024.indd"
    idml_name = f"{ch_str}-VTH_Combined_03.2024.idml"
    
    indd_path = os.path.join(SOURCE_DIR, indd_name)
    idml_path = os.path.join(OUTPUT_DIR, idml_name)
    
    # Escape paths for JSX (windows style backslashes or just forward slashes work in JS)
    # Better to use forward slashes for JS strings
    js_indd_path = indd_path.replace("\\", "/")
    js_idml_path = idml_path.replace("\\", "/")
    js_log_file = LOG_FILE.replace("\\", "/")
    
    script_content = f'''
#target "InDesign"
#targetengine "session"

(function() {{
    var logFile = File("{js_log_file}");
    function log(msg) {{
        logFile.open("a");
        logFile.writeln("CH{ch_str}: " + msg);
        logFile.close();
    }}

    try {{
        // Suppress UI
        var prevUI = app.scriptPreferences.userInteractionLevel;
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        
        var inddFile = File("{js_indd_path}");
        var idmlFile = File("{js_idml_path}");
        
        log("Starting export for " + inddFile.name);
        
        if (!inddFile.exists) {{
            log("ERROR: Source file not found: " + inddFile.fsName);
            return;
        }}
        
        if (idmlFile.exists) {{
             log("IDML already exists, skipping");
             return;
        }}

        log("Opening document...");
        var doc = app.open(inddFile, false); // Open hidden
        
        log("Exporting to IDML...");
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile, false);
        
        log("Closing document...");
        doc.close(SaveOptions.NO);
        
        log("SUCCESS");
        
    }} catch (e) {{
        log("ERROR: " + e.message);
    }} finally {{
        try {{
            app.scriptPreferences.userInteractionLevel = prevUI;
        }} catch(e) {{}}
    }}
}})();
'''
    script_path = os.path.join(TEMP_SCRIPT_DIR, f"export_ch{ch_str}.jsx")
    with open(script_path, "w") as f:
        f.write(script_content)
    return script_path, idml_path

def run_script(script_path):
    # Use AppleScript to tell InDesign to run the script
    # We use 'do script' which is standard
    cmd = f'''
tell application "Adobe InDesign 2026"
    activate
        do script (POSIX file "{script_path}") language javascript
end tell
'''
    # Run osascript
    subprocess.run(['osascript', '-e', cmd], check=True, timeout=120)

def main():
    ensure_dir(TEMP_SCRIPT_DIR)
    ensure_dir(OUTPUT_DIR)
    
    # Clean log
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "a") as f:
            f.write(f"\n--- Run started at {time.ctime()} ---\n")
    
    for ch in range(7, 31):
        script_path, idml_path = generate_jsx(ch)
        
        if os.path.exists(idml_path):
            # Check if file size is valid (not empty/corrupt)
            if os.path.getsize(idml_path) > 1000:
                print(f"Skipping Chapter {ch} (IDML exists and valid)")
                continue
            else:
                 print(f"Chapter {ch} IDML exists but too small, re-exporting...")
                 os.remove(idml_path)
            
        print(f"Exporting Chapter {ch}...")
        try:
            run_script(script_path)
            
            # Wait for file to appear
            start_time = time.time()
            success = False
            while time.time() - start_time < 180: # 3 min wait max
                if os.path.exists(idml_path):
                    # Check if file is growing or stable
                    initial_size = os.path.getsize(idml_path)
                    if initial_size > 0:
                        time.sleep(2) # wait a bit to ensure write finish
                        final_size = os.path.getsize(idml_path)
                        if final_size == initial_size and final_size > 1000:
                            print(f"✅ Chapter {ch} exported successfully! ({final_size/1024/1024:.2f} MB)")
                            success = True
                            break
                time.sleep(2)
            
            if not success:
                print(f"❌ Timeout waiting for Chapter {ch} IDML")
                # print log file tail
                if os.path.exists(LOG_FILE):
                    os.system(f"tail -n 5 {LOG_FILE}")
                
        except Exception as e:
            print(f"❌ Failed to run script for Chapter {ch}: {e}")
            
        time.sleep(2) # Cooldown

if __name__ == "__main__":
    main()


