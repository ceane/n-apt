# Rust SDR Backend for N-APT

This directory contains the Rust implementation of the SDR processing backend, replacing the Python backend with better performance and WASM compatibility.

## Architecture

### Components

1. **RTL-SDR Backend** (`rtlsdr_backend.rs`)
   - Real RTL-SDR device integration using the `rtl-sdr` crate
   - Mock implementation for when hardware is not available
   - FFT processing with RustFFT
   - WASM-compatible interface

2. **Signal Processing** (`lib.rs`)
   - FFT-based spectrum analysis
   - PPM correction
   - Gain control
   - Power spectrum calculation

3. **JavaScript Wrapper** (`rust_backend.js`)
   - WebSocket server implementation
   - Automatic fallback to mock mode
   - Client management
   - Real-time streaming

## Setup

### Prerequisites

1. **Install Rust**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Install wasm-pack**
   ```bash
   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
   ```

3. **Install RTL-SDR Library**
   
   **macOS (Homebrew):**
   ```bash
   brew install librtlsdr
   ```
   
   **Ubuntu/Debian:**
   ```bash
   sudo apt-get install librtlsdr-dev
   ```
   
   **Windows:**
   - Download from https://osmocom.org/projects/rtl-sdr/wiki/rtl-sdr
   - Extract and add to PATH

### Building

1. **Build WASM Package**
   ```bash
   ./packages/sdr_wasm/build_wasm.sh
   ```

2. **Manual Build (if script fails)**
   ```bash
   cd packages/sdr_wasm
   wasm-pack build --target web --out-dir pkg --dev
   ```

## Usage

### In Your Application

```javascript
import { RustSDRBackend, RustWebSocketServer } from './src/backend/rust_backend.js';

// Option 1: Use the backend directly
const backend = new RustSDRBackend();
await backend.initialize();

const spectrum = await backend.readAndProcess();
console.log('Spectrum data:', spectrum);

// Option 2: Use WebSocket server
const server = new RustWebSocketServer(8765);
await server.start();
```

### Configuration

The Rust backend supports the same configuration as the Python backend:

- **Sample Rate**: 3.2 MHz (default)
- **Center Frequency**: 1.6 MHz (default)
- **Gain**: 49 dB (default)
- **PPM Correction**: 1 (default)
- **FFT Size**: 32768 (default)

## Features

### Real RTL-SDR Integration

When RTL-SDR hardware is available, the Rust backend provides:

- Direct hardware access
- Real-time signal processing
- Low-latency FFT computation
- Hardware-level gain and frequency control

### Mock Mode

When RTL-SDR hardware is not available, the backend automatically falls back to mock mode:

- Simulated signal generation
- Multiple frequency components
- Realistic noise patterns
- Same API as real hardware

### Performance Benefits

- **Faster FFT**: RustFFT is highly optimized
- **Lower Latency**: Direct memory access
- **Better Memory Management**: Rust's ownership system
- **WASM Compatibility**: Runs in browsers and Node.js

## API Reference

### RTLSDRBackend

```rust
pub struct RTLSDRBackend {
    // Internal state
}

impl RTLSDRBackend {
    pub fn new() -> RTLSDRBackend;
    pub fn initialize(&mut self) -> RTLSDRResult;
    pub fn set_center_frequency(&mut self, freq: u32) -> RTLSDRResult;
    pub fn set_sample_rate(&mut self, rate: u32) -> RTLSDRResult;
    pub fn set_gain(&mut self, gain: i32) -> RTLSDRResult;
    pub fn set_ppm(&mut self, ppm: i32) -> RTLSDRResult;
    pub fn read_and_process(&mut self) -> Result<Float32Array, JsValue>;
    pub fn get_device_info(&self) -> String;
    pub fn close(&mut self);
}
```

### MockRTLSDRBackend

```rust
pub struct MockRTLSDRBackend {
    // Internal state
}

impl MockRTLSDRBackend {
    pub fn new() -> MockRTLSDRBackend;
    pub fn read_and_process(&mut self) -> Float32Array;
}
```

## Troubleshooting

### Common Issues

1. **RTL-SDR not found**
   - Check if RTL-SDR is installed system-wide
   - Verify device permissions (Linux: add user to plugdev group)
   - Try running with sudo (Linux/macOS)

2. **WASM build fails**
   - Ensure wasm-pack is installed
   - Check Rust toolchain version
   - Verify target architecture support

3. **WebSocket connection issues**
   - Check if port is available
   - Verify firewall settings
   - Ensure WASM is built successfully

### Debug Mode

Enable debug logging:

```javascript
// In rust_backend.js
console.log('Using backend:', backend.isUsingMock() ? 'Mock' : 'Real');
console.log('Device info:', backend.getDeviceInfo());
```

## Migration from Python

The Rust backend is designed to be a drop-in replacement for the Python backend:

1. **Same WebSocket Protocol**: Compatible with existing frontend
2. **Same Data Format**: Identical spectrum and waterfall data
3. **Same Configuration**: Same parameter names and ranges
4. **Better Performance**: Faster processing and lower latency

## Development

### Adding New Features

1. **Rust Side**: Add to `rtlsdr_backend.rs`
2. **WASM Binding**: Add `#[wasm_bindgen]` attributes
3. **JavaScript Wrapper**: Add methods to `RustSDRBackend`
4. **WebSocket Handler**: Add message types in `handleMessage`

### Testing

```bash
# Test WASM build
cd packages/sdr_wasm
wasm-pack test --headless --firefox

# Test integration
node src/backend/rust_backend.js
```

## License

This Rust backend follows the same license as the main N-APT project.
