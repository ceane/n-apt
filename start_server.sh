#!/bin/bash

# Run script for N-APT Rust Backend Server
set -e

BUILD_ONLY=false
DEV_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        --dev)
            DEV_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--build-only] [--dev]"
            echo "  --build-only: Build without running"
            echo "  --dev: Use development profile for faster builds"
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
if [ "$DEV_MODE" = true ]; then
    echo "  Building in development mode (faster builds, less optimization)..."
    echo "  Checking if Rust backend server needs to be built..."
    if ./scripts/check_changes.sh "target/dev-fast" "*.rs" "Cargo.toml" "Cargo.lock"; then
        echo -e "  \033[38;5;208mBuilding Rust backend server (dev-fast profile)...\033[0m"
        cargo build --profile dev-fast
        if [ $? -eq 0 ]; then
            echo -e "  \033[32m✓ Rust server built successfully (dev mode)\033[0m"
            BINARY_PATH="target/dev-fast/n-apt-backend"
        else
            echo -e "  \033[31m✗ Rust server build failed\033[0m"
            exit 1
        fi
    else
        echo "  Backend is up to date, skipping build..."
        BINARY_PATH="target/dev-fast/n-apt-backend"
    fi
else
    echo "  Building in release mode (optimized builds)..."
    echo "  Checking if Rust backend server needs to be built..."
    if ./scripts/check_changes.sh "target/release" "*.rs" "Cargo.toml" "Cargo.lock"; then
        echo -e "  \033[38;5;208mBuilding Rust backend server...\033[0m"  # Orange text
        cargo build --release
        if [ $? -eq 0 ]; then
            echo -e "  \033[32m✓ Rust server built successfully\033[0m"  # Green text
            BINARY_PATH="target/release/n-apt-backend"
        else
            echo -e "  \033[31m✗ Rust server build failed\033[0m"  # Red text
            exit 1
        fi
    else
        echo "  Backend is up to date, skipping build..."
        BINARY_PATH="target/release/n-apt-backend"
    fi
fi

# Set log level
export RUST_LOG=info

# Run the compiled server directly (unless build-only)
if [ "$BUILD_ONLY" = false ]; then
    echo ""
    if [ "$DEV_MODE" = true ]; then
        echo -e "\033[32m🚀 Rust server built and running at port:8765 (dev mode)\033[0m"
        echo "Hot reload enabled for mock_signals.yaml"
    else
        echo -e "\033[32m🚀 Rust server built and running at port:8765\033[0m"
    fi
    echo "Press Ctrl+C to stop"
    echo ""
    ./"$BINARY_PATH" 2>&1 | ./scripts/indent_output.sh
else
    echo "Build completed. Exiting..."
fi
