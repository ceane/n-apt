#!/bin/bash
# Simple script to indent output line by line
while IFS= read -r line; do
    echo "  $line"
done
