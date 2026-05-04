#!/bin/bash

# WASM Test Runner Script
# Automatically configures and runs WASM tests in both environments

set -e

echo ""
echo "🧪 WASM Test Runner"
echo "📋 Testing WebAssembly module functionality"
echo ""

# Ensure we're in the correct directory
cd "$(dirname "$0")"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack not found. Installing..."
    npm install -g wasm-pack
fi

# Verify WASM target is installed
echo "🎯 Checking WASM target..."
rustup target list --installed | grep wasm32-unknown-unknown >/dev/null || {
    echo "📦 Installing WASM target..."
    rustup target add wasm32-unknown-unknown
}

# Function to run Node.js tests
run_node_tests() {
    echo ""
    echo "🟢 Running Node.js tests..."
    echo "=========================="
    
    # Create backup if browser configuration is present
    if grep -q "wasm_bindgen_test_configure" src/lib.rs; then
        cp src/lib.rs src/lib.rs.bak
        # Temporarily remove browser configuration for Node.js testing
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/wasm_bindgen_test_configure/d' src/lib.rs
        else
            sed -i '/wasm_bindgen_test_configure/d' src/lib.rs
        fi
    fi
    
    # Run Node.js tests
    wasm-pack test --node
    
    # Restore browser configuration from backup if it exists
    if [ -f src/lib.rs.bak ]; then
        mv src/lib.rs.bak src/lib.rs
    fi
}

# Function to run browser tests
run_browser_tests() {
    echo ""
    echo "🌐 Running browser tests..."
    echo "=========================="
    
    # Ensure browser configuration is present
    if ! grep -q "wasm_bindgen_test_configure" src/lib.rs; then
        # Add browser configuration after the module declaration
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/pub mod wasm_simd_processor_tests;/a\
\
#[cfg(test)]\
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);' src/lib.rs
        else
            sed -i '/pub mod wasm_simd_processor_tests;/a \\n#[cfg(test)]\\nwasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);' src/lib.rs
        fi
    fi
    
    # Try Chrome first, fallback to Firefox if Chrome fails
    if wasm-pack test --headless --chrome; then
        echo "✅ Chrome browser tests passed!"
        # Clean up backup file if it exists
        rm -f src/lib.rs.bak
        return 0
    else
        echo "Chrome tests failed, trying Firefox..."
        if wasm-pack test --headless --firefox; then
            echo "✅ Firefox browser tests passed!"
            # Clean up backup file if it exists
            rm -f src/lib.rs.bak
            return 0
        else
            echo "⚠️  Browser tests failed"
            # Restore from backup if it exists
            if [ -f src/lib.rs.bak ]; then
                mv src/lib.rs.bak src/lib.rs
            fi
            return 1
        fi
    fi
}

# Main execution
case "${1:-all}" in
    "node")
        run_node_tests
        ;;
    "browser")
        run_browser_tests
        ;;
    "all")
        run_node_tests
        if run_browser_tests; then
            echo ""
            echo "✅ All WASM tests passed!"
        else
            echo ""
            echo "⚠️  Node.js tests passed, but browser tests failed"
            echo "   This may be due to missing browser dependencies"
        fi
        ;;
    *)
        echo "Usage: $0 [node|browser|all]"
        echo "  node    - Run Node.js tests only"
        echo "  browser - Run browser tests only"  
        echo "  all     - Run both (default)"
        exit 1
        ;;
esac

echo ""
echo "🎉 WASM testing completed!"
echo ""
