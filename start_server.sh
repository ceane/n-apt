#!/bin/bash

# Run script for N-APT Rust Backend Server
set -e

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

# Build the server
echo "Building Rust backend server..."
cargo build --release

echo "Starting server on ws://127.0.0.1:8765"
echo "Press Ctrl+C to stop"

# Set log level
export RUST_LOG=info

# Run the compiled server directly
./target/release/n-apt-backend
