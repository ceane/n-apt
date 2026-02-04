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

echo "Starting N-APT Rust Backend Server..."

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust is not installed. Please install Rust first:"
    echo "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check if RTL-SDR library is available
if ! ldconfig -p | grep -q librtlsdr; then
    echo "Warning: RTL-SDR library not found. Backend will run in mock mode."
    echo "Install RTL-SDR library for hardware support:"
    echo "  macOS: brew install librtlsdr"
    echo "  Ubuntu: sudo apt-get install librtlsdr-dev"
fi

# Change to project root (already there)
# Rust files are now at the top level

# Build the server only if needed
echo "Checking if Rust backend server needs to be built..."
if ./scripts/check_changes.sh "target/release" "*.rs" "Cargo.toml" "Cargo.lock"; then
    echo "Building Rust backend server..."
    cargo build --release
else
    echo "Backend is up to date, skipping build..."
fi

# Set log level
export RUST_LOG=info

# Run the compiled server directly (unless build-only)
if [ "$BUILD_ONLY" = false ]; then
    echo "Starting server on ws://127.0.0.1:8765"
    echo "Press Ctrl+C to stop"
    ./target/release/n-apt-backend
else
    echo "Build completed. Exiting..."
fi
