#!/bin/bash

# Fast incremental Rustfmt with caching
# Only formats files that have changed since last run

set -e

CACHE_DIR=".cache/rustfmt"
TIMESTAMP_FILE="$CACHE_DIR/last_run"

# Create cache directory if it doesn't exist
mkdir -p "$CACHE_DIR"

# Get timestamp of last run (or 0 if first run)
LAST_RUN=0
if [ -f "$TIMESTAMP_FILE" ]; then
    LAST_RUN=$(cat "$TIMESTAMP_FILE")
fi

# Find files modified since last run
CURRENT_TIME=$(date +%s)
FILES_TO_FORMAT=$(find . -name "*.rs" -not -path "./target/*" -not -path "./pkg/*" -newermt "@$LAST_RUN")

if [ -z "$FILES_TO_FORMAT" ]; then
    echo "No Rust files modified since last format. Skipping."
    exit 0
fi

FILE_COUNT=$(echo "$FILES_TO_FORMAT" | wc -l | tr -d ' ')
echo "Formatting $FILE_COUNT modified Rust files..."

# Format the files
echo "$FILES_TO_FORMAT" | xargs -P "$(nproc)" -n 10 rustfmt

# Update timestamp
echo "$CURRENT_TIME" > "$TIMESTAMP_FILE"

echo "Fast formatting complete!"
