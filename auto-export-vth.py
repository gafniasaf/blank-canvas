#!/usr/bin/env python3
"""
Automated VTH N4 IDML export using file watching and AppleScript
"""
import subprocess
import time
import os
from pathlib import Path

SCRIPT_PATH = "/Users/asafgafni/Desktop/InDesign/TestRun/export-vth-n4-idml-manual.jsx"
OUTPUT_DIR = "/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4"
MAX_CHAPTERS = 30

def count_idml_files():
    """Count existing IDML files"""
    return len(list(Path(OUTPUT_DIR).glob("*.idml")))

def run_export_script():
    """Run the InDesign export script via AppleScript"""
    applescript = f'''
tell application "Adobe InDesign 2026"
    activate
    delay 2
    do script (POSIX file "{SCRIPT_PATH}") language javascript
end tell
'''
    try:
        result = subprocess.run(
            ['osascript', '-e', applescript],
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", "Timeout"
    except Exception as e:
        return False, "", str(e)

def main():
    print("=== VTH N4 Auto Export ===")
    print(f"Script: {SCRIPT_PATH}")
    print(f"Output: {OUTPUT_DIR}")
    
    initial_count = count_idml_files()
    print(f"Current IDML files: {initial_count}")
    
    target_chapter = initial_count + 1
    if target_chapter > MAX_CHAPTERS:
        print("All chapters already exported!")
        return
    
    print(f"\nExporting chapter {target_chapter}...")
    
    success, stdout, stderr = run_export_script()
    
    if success:
        print("Script executed. Waiting for export to complete...")
        # Wait and check if new file appeared
        for i in range(30):  # Wait up to 30 seconds
            time.sleep(1)
            new_count = count_idml_files()
            if new_count > initial_count:
                print(f"✓ Chapter {target_chapter} exported! ({new_count} total files)")
                return
        print("⚠ Export may still be in progress...")
    else:
        print(f"✗ Failed: {stderr}")
        print(f"stdout: {stdout}")

if __name__ == '__main__':
    main()


