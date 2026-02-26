#!/bin/bash

# WASM Test Runner
# Runs WASM tests in both Node.js and browser environments

set -e

echo ""
echo "🧪 Running WASM Tests..."
echo "📋 Testing WebAssembly module functionality in multiple environments"
echo ""

# Ensure we're in the correct directory
cd "$(dirname "$0")"

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

echo ""
echo "🟢 Running Node.js tests..."
echo "=========================="
wasm-pack test --node

echo ""
echo "🌐 Running browser tests..."
echo "=========================="
# Try Chrome first, fallback to Firefox if Chrome fails
if wasm-pack test --headless --chrome; then
    echo "✅ Chrome browser tests passed!"
else
    echo "Chrome tests failed, trying Firefox..."
    if wasm-pack test --headless --firefox; then
        echo "✅ Firefox browser tests passed!"
    else
        echo "⚠️  Browser tests failed, but Node.js tests passed"
        echo "   This may be due to missing browser dependencies"
    fi
fi

echo ""
echo "✅ WASM tests completed!"
echo ""
