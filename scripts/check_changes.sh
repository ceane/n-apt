#!/bin/bash

# Helper script to check if source files have changed since last build
# Usage: check_changes.sh <target_dir> <source_patterns...>

set -e

TARGET_DIR="$1"
shift
SOURCE_PATTERNS=("$@")

# If target doesn't exist, we need to build
if [ ! -d "$TARGET_DIR" ]; then
    echo "Target directory $TARGET_DIR doesn't exist, building..."
    exit 0
fi

# Find the most recent file in target directory (cross-platform)
if command -v stat >/dev/null 2>&1; then
    # Try Linux stat format first
    TARGET_TIME=$(find "$TARGET_DIR" -type f -exec stat -c "%Y" {} \; 2>/dev/null | sort -r | head -1)
fi

# If Linux format failed, try macOS format
if [ -z "$TARGET_TIME" ]; then
    TARGET_TIME=$(find "$TARGET_DIR" -type f -exec stat -f "%m" {} \; 2>/dev/null | sort -r | head -1)
fi

if [ -z "$TARGET_TIME" ]; then
    echo "No files found in target directory, building..."
    exit 0
fi

# Check if any source files are newer than the target
NEEDS_BUILD=false
for pattern in "${SOURCE_PATTERNS[@]}"; do
    if find . -name "$pattern" -newermt "@$TARGET_TIME" 2>/dev/null | grep -q .; then
        echo "Source files matching $pattern are newer than target, building..."
        NEEDS_BUILD=true
        break
    fi
done

if [ "$NEEDS_BUILD" = true ]; then
    exit 0  # Need to build
else
    echo "  No changes detected, skipping build..."
    exit 1  # No build needed
fi
