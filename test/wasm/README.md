# WASM Tests

This directory contains WebAssembly tests for the N-APT project, designed to verify WASM module functionality in both Node.js and browser environments.

## Quick Start

### Run All Tests

```bash
./test_runner.sh
```

### Run Node.js Tests Only

```bash
./test_runner.sh node
```

### Run Browser Tests Only

```bash
./test_runner.sh browser
```

## Manual Testing

### Node.js Environment

```bash
wasm-pack test --node
```

### Browser Environment

```bash
wasm-pack test --headless --chrome
# or
wasm-pack test --headless --firefox
```

## Test Structure

- **`src/lib.rs`** - Main test module with console logging utilities
- **`src/simple_wasm_tests.rs`** - Core WASM functionality tests
- **`test_runner.sh`** - Automated test runner for both environments

## Test Coverage

The test suite covers:

1. **Basic WASM Functionality** - Verifies WASM compilation and execution
2. **JavaScript Interop** - Tests JS function calls (Math, random, etc.)
3. **Array Operations** - Validates Float32Array manipulation
4. **Performance Baseline** - Ensures reasonable execution performance

## Environment-Specific Behavior

- **Node.js Tests**: JavaScript interop tests are skipped (no browser APIs)
- **Browser Tests**: Full JavaScript interop testing with real browser APIs

## Dependencies

- `wasm-pack` - For building and testing WASM modules
- `wasm-bindgen` - For JavaScript/WASM interoperability
- `wasm-bindgen-test` - For WASM-specific testing framework
- Chrome/Firefox - For browser testing (automatically downloaded if needed)

## Troubleshooting

### Browser Tests Fail

- Ensure Chrome or Firefox is installed
- Check if browser drivers are properly installed
- Try running with `--no-capture` for more detailed output

### Node.js Tests Fail

- Verify Node.js is installed
- Check wasm-pack installation
- Ensure WASM target is installed: `rustup target add wasm32-unknown-unknown`

## Integration with CI

The test runner is designed to work in CI environments:

- Node.js tests run reliably without browser dependencies
- Browser tests are optional and gracefully handle missing browsers
- All tests provide clear success/failure indicators
