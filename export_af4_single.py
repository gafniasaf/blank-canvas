#!/usr/bin/env python3
"""
Export A&F N4 (Downloads) to a test IDML via InDesign AppleScript.
This is a diagnostics script to confirm InDesign automation works on a known-good book.
"""

import os
import subprocess
import time

JSX = "/Users/asafgafni/Desktop/InDesign/TestRun/temp_scripts/export_af4_test.jsx"
OUT = "/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/AF4_AUTOMATION_TEST.idml"
LOG = "/Users/asafgafni/Desktop/InDesign/TestRun/temp_scripts/export_af4_test.log"

def main() -> int:
  # Clear previous outputs
  try:
    if os.path.exists(OUT):
      os.remove(OUT)
  except Exception:
    pass
  try:
    if os.path.exists(LOG):
      with open(LOG, "a", encoding="utf-8") as f:
        f.write("\n--- NEW RUN ---\n")
  except Exception:
    pass

  applescript = f'''
tell application "Adobe InDesign 2026"
  activate
  do script (POSIX file "{JSX}") language javascript
end tell
'''

  print("=== A&F N4 automation test export ===")
  print(f"JSX: {JSX}")
  print(f"OUT: {OUT}")
  print("Running (timeout=60s)...")

  try:
    res = subprocess.run(["osascript", "-e", applescript], capture_output=True, text=True, timeout=60)
    print(f"osascript exit={res.returncode}")
    if res.stdout.strip():
      print("stdout:", res.stdout.strip())
    if res.stderr.strip():
      print("stderr:", res.stderr.strip())
  except subprocess.TimeoutExpired:
    print("TIMEOUT: osascript did not return within 60s")
  except Exception as e:
    print("ERROR running osascript:", str(e))

  # Give filesystem a moment
  time.sleep(2)
  if os.path.exists(OUT):
    print(f"✅ IDML created ({os.path.getsize(OUT)} bytes)")
    return 0

  print("❌ IDML NOT created.")
  if os.path.exists(LOG):
    try:
      with open(LOG, "r", encoding="utf-8", errors="ignore") as f:
        tail = f.readlines()[-25:]
      print("--- ExtendScript log tail ---")
      for line in tail:
        print(line.rstrip())
    except Exception:
      pass
  return 1

if __name__ == "__main__":
  raise SystemExit(main())



