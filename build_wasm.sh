#!/bin/bash

# Build script for WASM SIMD module
# This script compiles the Rust code to WebAssembly with SIMD support

set -e

echo ""
echo "🔨 Building WASM SIMD module..."
echo "📋 This will compile Rust FFT processing with SIMD optimizations for WebAssembly"
echo ""

# Ensure we're using rustup version of Rust
export PATH="$HOME/.cargo/bin:$PATH"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack not found. Installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# Verify WASM target is installed
echo "🎯 Checking WASM target..."
rustup target list --installed | grep wasm32-unknown-unknown >/dev/null || {
    echo "📦 Installing WASM target..."
    rustup target add wasm32-unknown-unknown
}

# Build the WASM module only if needed
echo "🔍 Checking if WASM SIMD module needs to be built..."
if ./scripts/check_changes.sh "packages/n_apt_canvas" "src/lib.rs" "src/wasm_simd/*.rs" "Cargo.toml" "Cargo.lock"; then
    echo "📦 Building WASM SIMD module with optimizations..."
    mkdir -p packages/n_apt_canvas
    RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir packages/n_apt_canvas --dev
    echo "✅ WASM SIMD module built successfully!"
    echo "🚀 SIMD optimizations enabled for faster FFT processing"
else
    echo "✅ WASM SIMD module is up to date, skipping build..."
fi

echo "📁 Output directory: packages/n_apt_canvas/"
echo ""
exit 0
