#!/usr/bin/env python3
"""Export SINGLE chapter 7 only, then STOP."""
import subprocess
import os
import time

CHAPTER = 7
SOURCE = f"/Users/asafgafni/Downloads/MBO 2024/Binnenwerk/_MBO VTH nivo 4_9789083412054_03/{CHAPTER:02d}-VTH_Combined_03.2024.indd"
OUTPUT = f"/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/_MBO_VTH_nivo_4/{CHAPTER:02d}-VTH_Combined_03.2024.idml"
JSX = f"/Users/asafgafni/Desktop/InDesign/TestRun/temp_scripts/export_ch{CHAPTER:02d}_one.jsx"
JSX_LOG = f"/Users/asafgafni/Desktop/InDesign/TestRun/temp_scripts/export_ch{CHAPTER:02d}_one.log"

print(f"=== Exporting Chapter {CHAPTER} ONLY ===")
print(f"Source: {SOURCE}")
print(f"Output: {OUTPUT}")

if os.path.exists(OUTPUT):
    print("IDML already exists. Done.")
    exit(0)

if not os.path.exists(SOURCE):
    print(f"ERROR: Source file not found!")
    exit(1)

# AppleScript: run the JSX file via a POSIX file handle (most reliable)
applescript = f'''
tell application "Adobe InDesign 2026"
    activate
    do script (POSIX file "{JSX}") language javascript
end tell
'''

print(f"Running AppleScript (120s timeout)...")
try:
    result = subprocess.run(
        ['osascript', '-e', applescript],
        capture_output=True,
        text=True,
        timeout=120
    )
    print(f"osascript exit code: {result.returncode}")
    if result.stdout.strip():
        print(f"stdout: {result.stdout}")
    if result.stderr.strip():
        print(f"stderr: {result.stderr}")
except subprocess.TimeoutExpired:
    print("TIMEOUT after 120 seconds")
except Exception as e:
    print(f"ERROR: {e}")

# Check if file was created
time.sleep(2)
if os.path.exists(OUTPUT):
    size = os.path.getsize(OUTPUT)
    print(f"SUCCESS! IDML created: {size} bytes")
else:
    print("IDML NOT created. Check InDesign for dialogs.")
    if os.path.exists(JSX_LOG):
        try:
            with open(JSX_LOG, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            print("--- export_ch07_one.log (tail) ---")
            for ln in lines[-30:]:
                print(ln.rstrip())
        except Exception:
            pass

print("=== DONE (single chapter only) ===")


