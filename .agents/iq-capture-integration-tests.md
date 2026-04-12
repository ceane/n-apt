# I/Q Capture Integration Tests

Comprehensive integration test suite for I/Q capture functionality with strict 3.2MHz sample rate validation.

## Overview

This test suite ensures that the n-apt application correctly handles I/Q capture operations and enforces the 3.2MHz sample rate limit across all components - frontend UI, backend processing, and file validation.

## Test Coverage

### 🎯 Core Focus Areas

1. **Sample Rate Validation** - Strict enforcement of 3.2MHz maximum
2. **Frontend-Backend Integration** - End-to-end workflow testing
3. **Error Handling** - Graceful failure and recovery scenarios
4. **File Format Validation** - Captured data integrity checks
5. **Device Compatibility** - Mock vs real hardware testing

### 📱 Frontend Tests

#### Component Integration
- **IQCaptureControlsSection** validation
- Sample rate display and limits
- User input validation
- Error message handling

#### User Workflow Tests
- Complete capture workflow
- Progress tracking
- File download functionality
- Device state management

### 🦀 Backend Tests

#### Sample Rate Enforcement
- Default 3.2MHz rate validation
- Invalid rate rejection (>3.2MHz)
- Rate clamping behavior
- Persistence across capture cycles

#### Capture Processing
- Multi-fragment capture consistency
- Interleaved (TDMS) mode validation
- Metadata integrity
- Channel synchronization

#### Error Scenarios
- Zero/negative sample rates
- Rate changes during capture
- Device disconnection handling
- Invalid capture parameters

## Running Tests

### Quick Start

```bash
# Run all I/Q capture integration tests
npm run test:iq-capture

# Install dependencies and run tests
npm run test:iq-capture:install
```

### Individual Test Categories

```bash
# Frontend integration tests
npm test -- test/integration/iq-capture-integration.test.tsx

# Backend integration tests
cargo test iq_capture_integration_tests

# Rust capture/stitching tests
cargo test capture_stitch

# Sample rate validation tests
cargo test sample_rate

# Error handling tests
cargo test error_handling
```

## Test Structure

### Frontend Test Files

```
test/integration/
├── iq-capture-integration.test.tsx     # Main integration tests
└── IQCaptureIntegrationTest.tsx        # Test wrapper component
```

### Backend Test Files

```
test/rust/
├── iq_capture_integration_tests.rs     # Comprehensive backend tests
└── capture_stitch_tests.rs             # Existing capture/stitching tests
```

### Test Scripts

```
scripts/
└── run-iq-capture-tests.sh             # Test runner script
```

## Key Test Scenarios

### ✅ Valid Scenarios

1. **Standard Capture**: 3.2MHz sample rate, single fragment
2. **Multi-Fragment**: Multiple frequency ranges, consistent sample rate
3. **Interleaved Mode**: TDMS capture with sample rate validation
4. **File Validation**: Downloaded files contain correct metadata

### ❌ Invalid Scenarios

1. **Excessive Sample Rate**: >3.2MHz should be rejected
2. **Zero/Negative Rates**: Invalid values should fail
3. **Mid-Capture Changes**: Rate changes during active capture
4. **Device Disconnection**: Graceful handling of hardware loss

## Sample Rate Validation Rules

### ✅ Allowed Sample Rates
- 2.048MHz
- 2.4MHz  
- 2.8MHz
- **3.2MHz** (maximum)

### ❌ Rejected Sample Rates
- >3.2MHz (e.g., 4MHz, 5MHz)
- 0 Hz
- Negative values
- Non-numeric values

### 🔄 Behavior for Invalid Rates
- **Frontend**: Disable capture, show error message
- **Backend**: Reject request or clamp to 3.2MHz
- **Files**: Invalid captures should not produce files

## Test Data and Mocks

### Frontend Mocks
```typescript
// WebSocket mock
jest.mock("../../src/ts/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: true,
    deviceState: "connected", 
    captureStatus: { status: "idle", jobId: "" },
    maxSampleRateHz: 3200000,
    sendCaptureCommand: jest.fn(),
  }),
}));
```

### Backend Mocks
```rust
// Mock SDR device
let mut processor = SdrProcessor::new_mock_apt()?;
processor.initialize()?;
```

## Expected Test Results

### Successful Test Output
```
🎯 Running I/Q Capture Integration Tests
======================================

📱 Frontend Integration Tests
✅ Frontend I/Q Capture Integration PASSED

🦀 Backend Integration Tests  
✅ Backend I/Q Capture Integration PASSED

📊 Test Summary
======================================
Total tests: 6
Passed: 6
Failed: 0

🎉 All tests passed! I/Q capture integration is working correctly.
✅ 3.2MHz sample rate validation is enforced
```

### Failure Indicators
- Frontend tests failing: Check component imports and mock setup
- Backend tests failing: Verify Rust dependencies and processor initialization
- Sample rate tests failing: Ensure validation logic is properly implemented

## Troubleshooting

### Common Issues

1. **Import Errors**: Check file paths and module resolution
2. **Type Errors**: Verify TypeScript types match actual interfaces
3. **Mock Failures**: Ensure mock implementations match real APIs
4. **Async Test Timeouts**: Increase test timeouts for capture operations

### Debug Commands

```bash
# Verbose test output
npm test -- --verbose

# Debug specific test
npm test -- --testNamePattern="sample rate validation"

# Rust test with output
cargo test -- --nocapture
```

## Integration with CI/CD

### GitHub Actions
```yaml
- name: Run I/Q Capture Tests
  run: |
    npm run test:iq-capture:install
    npm run test:iq-capture
```

### Pre-commit Hooks
```bash
# Quick validation
npm run test:iq-capture
```

## Future Enhancements

### Planned Additions
1. **Real Hardware Tests**: Tests with actual RTL-SDR devices
2. **Performance Tests**: Capture speed and memory usage
3. **Network Tests**: WebSocket reliability under load
4. **File Corruption Tests**: Invalid file handling

### Test Metrics
- Code coverage targets
- Performance benchmarks
- Error rate thresholds
- Memory usage limits

## Contributing

When adding new I/Q capture tests:

1. **Follow Naming Conventions**: Use descriptive test names
2. **Include Sample Rate Tests**: Always validate 3.2MHz limit
3. **Mock Properly**: Ensure mocks don't hide real issues
4. **Test Edge Cases**: Consider invalid inputs and error conditions
5. **Document Behavior**: Explain expected test outcomes

## Related Documentation

- [Main Testing Guide](../testing.md)
- [Frontend Testing](frontend-testing.md)
- [Backend Testing](backend-testing.md)
- [Sample Rate Specification](sample-rate-spec.md)

---

**Last Updated**: 2026-03-15  
**Test Coverage**: Frontend + Backend + Integration  
**Focus**: 3.2MHz Sample Rate Validation
