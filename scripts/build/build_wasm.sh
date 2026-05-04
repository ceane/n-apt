#!/bin/bash

# Build script for WASM SIMD module
# This script compiles the Rust code to WebAssembly with SIMD support
# Uses WASM_OUT env (default packages/n_apt_canvas) as output dir for consistency

set -euo pipefail

if [[ "${OS:-}" == "Windows_NT" && -z "${WSL_DISTRO_NAME:-}" ]]; then
    echo "❌ build_wasm.sh is intended for WSL or Unix-like shells, not native Windows cmd/powershell."
    exit 1
fi

# Parse arguments
FORCE_BUILD=false
while [[ "${1:-}" == --* ]]; do
    case "$1" in
        --force)
            FORCE_BUILD=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

echo ""
echo "🔨 Building WASM SIMD module..."
echo "📋 This will compile Rust FFT processing with SIMD optimizations for WebAssembly"
echo ""

# Ensure we're using rustup version of Rust
export PATH="$HOME/.cargo/bin:$PATH"
WASM_OUT=${WASM_OUT:-packages/n_apt_canvas}
PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PROJECT_ROOT/target}"

mkdir -p "$CARGO_TARGET_DIR"

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

# Build the WASM module only if needed or forced
echo "🔍 Checking if WASM SIMD module needs to be built..."
if [ "$FORCE_BUILD" = true ] || scripts/check_changes.sh "$WASM_OUT" "src/rs/lib.rs" "src/rs/fft/*.rs" "src/rs/simd/*.rs" "src/rs/wasm/*.rs" "Cargo.toml" "Cargo.lock"; then
    if [ "$FORCE_BUILD" = true ]; then
        echo "🔄 Force rebuild requested..."
    fi
    echo "📦 Building WASM SIMD module with optimizations..."
    mkdir -p "$WASM_OUT"
    RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir "$WASM_OUT" --dev
    echo "✅ WASM SIMD module built successfully!"
    echo "🚀 SIMD optimizations enabled for faster FFT processing"
else
    echo "✅ WASM SIMD module is up to date, skipping build..."
fi

echo "📁 Output directory: $WASM_OUT/"
echo ""
exit 0
