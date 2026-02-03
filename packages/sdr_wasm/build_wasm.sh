#!/bin/bash

# Build script for Rust SDR WASM package
set -e

echo "Building Rust SDR WASM package..."

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack is not installed. Installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# Build the WASM package
cd packages/sdr_wasm

echo "Building with wasm-pack..."
wasm-pack build --target web --out-dir pkg --dev

echo "WASM package built successfully!"
echo "Output: packages/sdr_wasm/pkg/"

# Copy the built files to src for easy importing
if [ -d "pkg" ]; then
    echo "Built files available in packages/sdr_wasm/pkg/"
    echo "You can now import the Rust backend in your JavaScript code."
else
    echo "Error: pkg directory not found after build"
    exit 1
fi
