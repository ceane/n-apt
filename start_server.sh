#!/bin/bash

# Run script for N-APT Rust Backend Server
set -e

BUILD_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Wait a moment for Vite to start first
sleep 2

echo ""
echo -e "\033[38;5;208mStarting N-APT Rust Backend Server...\033[0m"
echo ""

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust is not installed. Please install Rust first:"
    echo "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check if RTL-SDR library is available
if command -v brew &> /dev/null; then
    # macOS systems
    if ! brew list librtlsdr &> /dev/null 2>&1; then
        echo "  Warning: RTL-SDR library not found. Backend will run in mock mode."
        echo "  Install RTL-SDR library for hardware support:"
        echo "    macOS: brew install librtlsdr"
        echo "    Ubuntu: sudo apt-get install librtlsdr-dev"
    fi
elif command -v ldconfig &> /dev/null; then
    # Linux systems
    if ! ldconfig -p | grep -q librtlsdr; then
        echo "  Warning: RTL-SDR library not found. Backend will run in mock mode."
        echo "  Install RTL-SDR library for hardware support:"
        echo "    macOS: brew install librtlsdr"
        echo "    Ubuntu: sudo apt-get install librtlsdr-dev"
    fi
fi

# Change to project root (already there)
# Rust files are now at the top level

# Build the server only if needed
echo "  Checking if Rust backend server needs to be built..."
if ./scripts/check_changes.sh "target/release" "*.rs" "Cargo.toml" "Cargo.lock"; then
    echo -e "  \033[38;5;208mBuilding Rust backend server...\033[0m"  # Orange text
    cargo build --release
    if [ $? -eq 0 ]; then
        echo -e "  \033[32m✓ Rust server built successfully\033[0m"  # Green text
    else
        echo -e "  \033[31m✗ Rust server build failed\033[0m"  # Red text
        exit 1
    fi
else
    echo "  Backend is up to date, skipping build..."
fi

# Set log level
export RUST_LOG=info

# Run the compiled server directly (unless build-only)
if [ "$BUILD_ONLY" = false ]; then
    echo ""
    echo -e "\033[32m🚀 Rust server built and running at port:8765\033[0m"  # Green text
    echo "Press Ctrl+C to stop"
    echo ""
    ./target/release/n-apt-backend 2>&1 | ./scripts/indent_output.sh
else
    echo "Build completed. Exiting..."
fi
