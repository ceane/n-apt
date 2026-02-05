#!/bin/bash
# Simple script to indent output line by line with coloring for specific messages
while IFS= read -r line; do
    if [[ "$line" == *"Starting N-APT Rust Backend Server"* ]] || [[ "$line" == *"Streaming SDR processor initialized"* ]]; then
        echo -e "  \033[32m$line\033[0m"
    else
        echo "  $line"
    fi
done
