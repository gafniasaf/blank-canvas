#!/bin/bash
# Wrapper script to run InDesign export with retries

SCRIPT_PATH="/Users/asafgafni/Desktop/InDesign/TestRun/export-vth-n4-idml-manual.jsx"
MAX_RETRIES=3
RETRY_DELAY=5

for i in $(seq 1 $MAX_RETRIES); do
    echo "Attempt $i of $MAX_RETRIES..."
    
    osascript <<EOF
tell application "Adobe InDesign 2026"
    activate
    delay 3
    try
        do script (POSIX file "$SCRIPT_PATH") language javascript
        return "success"
    on error errMsg
        return "error: " & errMsg
    end try
end tell
EOF
    
    if [ $? -eq 0 ]; then
        echo "Script executed successfully"
        break
    else
        echo "Attempt $i failed, retrying in $RETRY_DELAY seconds..."
        sleep $RETRY_DELAY
    fi
done


