# Performance and Hot Reloading Features

This document describes the performance optimizations and hot reloading capabilities added to the N-APT Rust backend.

## Performance Optimizations

### Enhanced Build Profiles

The `Cargo.toml` now includes optimized build profiles:

- **Release Profile**: Maximum optimization for production
  - `opt-level = 3`: Maximum optimization
  - `lto = true`: Link-time optimization
  - `codegen-units = 1`: Best optimization, slower compile
  - `panic = "abort"`: Reduces binary size
  - `strip = true`: Removes debug symbols
  - `overflow-checks = false`: Faster arithmetic

- **Development Profile**: Faster builds for development
  - `opt-level = 1`: Some optimization for faster runs
  - `incremental = true`: Enable incremental compilation

- **Dev-Fast Profile**: Fastest builds for testing
  - Inherits from dev profile
  - `debug = false`: No debug info
  - `codegen-units = 16`: Faster compilation

### Build Commands

```bash
# Production build (optimized)
./start_server.sh

# Development build (faster)
./start_server.sh --dev

# Development with hot reload
./scripts/dev_server.sh

# Build only
./start_server.sh --build-only
```

## Hot Reloading

### Configuration Hot Reload

The server now supports hot reloading of mock signal configuration without restart:

#### Features

1. **File Watching**: Automatic reload when `mock_signals.yaml` changes
2. **WebSocket Command**: Manual reload via WebSocket message
3. **Configuration Structure**: YAML-based configuration for signals

#### Configuration File

`mock_signals.yaml` structure:

```yaml
# Global settings
global_settings:
  noise_floor_base: -70.0
  noise_floor_variation: 5.0
  signal_drift_rate: 0.1
  # ... other settings

# Predefined signals
signals:
  - id: "fm_radio"
    type: "wide"
    center_freq_mhz: 101.5
    strength: -35.0
    active: true
    description: "FM radio station"
```

#### Usage

1. **Automatic Reload**: Edit `mock_signals.yaml` while server is running
2. **Manual Reload**: Send WebSocket message:

```json
{"type": "reload_config"}
```

### Development Workflow

#### For Testing UI Changes

1. Start server in dev mode:

```bash
./scripts/dev_server.sh
```

1. Edit `mock_signals.yaml` to test different signal patterns:
   - Add/remove signals
   - Change signal strengths
   - Modify frequency ranges

1. Changes take effect immediately without server restart

#### For Testing Algorithm Changes

1. Use feature flags for conditional compilation:

```rust
#[cfg(feature = "new-algorithm")]
fn process_fft_new() { /* new implementation */ }
```

1. Build with specific features:

```bash
cargo build --features new-algorithm --profile dev-fast
```

## Performance Monitoring

### Build Performance

- **Incremental builds**: Only rebuild changed components
- **Parallel compilation**: Use all CPU cores
- **Cache optimization**: Faster subsequent builds

### Runtime Performance

- **Lazy initialization**: Heavy setup moved to background
- **Memory optimization**: Reusable buffers and allocations
- **SIMD optimizations**: Already implemented for FFT processing

## Troubleshooting

### Hot Reload Not Working

1. Check if `mock_signals.yaml` exists in project root
2. Verify file permissions
3. Check server logs for file watcher errors

### Build Performance Issues

1. Use `--dev` flag for faster builds during development
2. Ensure sufficient disk space for target directory
3. Check if antivirus software is interfering

### Configuration Errors

1. Validate YAML syntax
2. Check signal frequency ranges
3. Verify signal type definitions

## Best Practices

### Development

1. Use `--dev` mode for frequent changes
2. Edit configuration files instead of code for signal changes
3. Use hot reload for UI testing
4. Use feature flags for algorithm testing

### Production

1. Always use release builds for deployment
2. Test configuration changes before applying
3. Monitor server performance after changes
4. Keep backup of working configurations
