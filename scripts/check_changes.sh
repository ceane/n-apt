#!/bin/bash

# Helper script to check if source files have changed since last build
# Usage: check_changes.sh <target_dir> <source_patterns...>
# Options:
#   --reference <file>  Use specific file as timestamp reference instead of binary

set -e

# Parse options
REFERENCE_FILE=""
while [[ "$1" == --* ]]; do
    case "$1" in
        --reference)
            REFERENCE_FILE="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

TARGET_DIR="$1"
shift
SOURCE_PATTERNS=("$@")

# If target doesn't exist, we need to build
if [ ! -d "$TARGET_DIR" ]; then
    echo "Target directory $TARGET_DIR doesn't exist, building..."
    exit 0
fi

# Determine the reference file for timestamp comparison
if [ -n "$REFERENCE_FILE" ] && [ -f "$REFERENCE_FILE" ]; then
    REF_FILE="$REFERENCE_FILE"
else
    # Try common binary locations
    BINARY="$TARGET_DIR/n-apt-backend"
    WASM_FILE=$(find "$TARGET_DIR" -name "*.wasm" -o -name "*.js" 2>/dev/null | head -n 1)
    PKG_JSON="$TARGET_DIR/package.json"
    
    if [ -f "$BINARY" ]; then
        REF_FILE="$BINARY"
    elif [ -n "$WASM_FILE" ] && [ -f "$WASM_FILE" ]; then
        REF_FILE="$WASM_FILE"
    elif [ -f "$PKG_JSON" ]; then
        REF_FILE="$PKG_JSON"
    else
        echo "No reference file found in target directory, building..."
        exit 0
    fi
fi

# Get the modification time of the reference file
# Try Linux stat format first
TARGET_TIME=$(stat -c "%Y" "$REF_FILE" 2>/dev/null)
# If Linux format failed, try macOS format
if [ -z "$TARGET_TIME" ]; then
    TARGET_TIME=$(stat -f "%m" "$REF_FILE" 2>/dev/null)
fi

if [ -z "$TARGET_TIME" ]; then
    echo "Could not determine reference file timestamp, building..."
    exit 0
fi

# Check if any source files are newer than the target
NEEDS_BUILD=false
for pattern in "${SOURCE_PATTERNS[@]}"; do
    # Handle glob patterns (e.g., src/rs/wasm_simd/*.rs) by expanding them
    if [[ "$pattern" == *"*"* || "$pattern" == *"?"* ]]; then
        # Use find with -path for glob-like patterns
        # Convert glob to find-compatible path pattern
        for file in $pattern; do
            if [ -f "$file" ]; then
                # Compare modification times
                FILE_TIME=$(stat -c "%Y" "$file" 2>/dev/null || stat -f "%m" "$file" 2>/dev/null)
                if [ -n "$FILE_TIME" ] && [ "$FILE_TIME" -gt "$TARGET_TIME" ]; then
                    echo "Source file $file is newer than target, building..."
                    NEEDS_BUILD=true
                    break
                fi
            fi
        done
    else
        # Single file or directory name
        if [ -f "$pattern" ]; then
            FILE_TIME=$(stat -c "%Y" "$pattern" 2>/dev/null || stat -f "%m" "$pattern" 2>/dev/null)
            if [ -n "$FILE_TIME" ] && [ "$FILE_TIME" -gt "$TARGET_TIME" ]; then
                echo "Source file $pattern is newer than target, building..."
                NEEDS_BUILD=true
            fi
        elif find . -name "$pattern" -newermt "@$TARGET_TIME" 2>/dev/null | grep -q .; then
            echo "Source files matching $pattern are newer than target, building..."
            NEEDS_BUILD=true
        fi
    fi
    
    if [ "$NEEDS_BUILD" = true ]; then
        break
    fi
done

if [ "$NEEDS_BUILD" = true ]; then
    exit 0  # Need to build
else
    echo "  No changes detected, skipping build..."
    exit 1  # No build needed
fi
