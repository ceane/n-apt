#!/bin/bash

# Build script for WASM SIMD module
# This script compiles the Rust code to WebAssembly with SIMD support

set -e

echo "🔨 Building WASM SIMD module..."

# Ensure we're using rustup version of Rust
export PATH="$HOME/.cargo/bin:$PATH"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack not found. Installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# Verify WASM target is installed
echo "🎯 Checking WASM target..."
rustup target list --installed | grep wasm32-unknown-unknown || {
    echo "📦 Installing WASM target..."
    rustup target add wasm32-unknown-unknown
}

# Build the WASM module only if needed
echo "Checking if WASM module needs to be built..."
if ./scripts/check_changes.sh "pkg" "src/lib.rs" "src/wasm_simd/*.rs" "Cargo.toml" "Cargo.lock"; then
    echo "📦 Building with SIMD support..."
    RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir pkg --dev
    echo "✅ WASM SIMD module built successfully!"
else
    echo "WASM module is up to date, skipping build..."
fi

echo "📁 Output directory: pkg/"
echo "🚀 You can now import the SIMD module in your TypeScript code"
