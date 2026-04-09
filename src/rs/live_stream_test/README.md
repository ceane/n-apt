# Live Stream Test Module

A standalone Rust binary for connecting to the n-apt WebSocket API and receiving live FFT spectrum data and raw I/Q samples for algorithm testing.

## Features

- **Live Data Stream**: Connects to your running n-apt server's WebSocket endpoint
- **Authentication**: Uses the same challenge-response HMAC authentication as the frontend
- **Decryption**: Decrypts AES-256-GCM encrypted binary data in real-time
- **Algorithm Testing**: Built-in signal processing algorithms for testing
- **FFT & I/Q Data**: Supports both spectrum FFT data and raw I/Q samples
- **Rapid Iteration**: Edit and re-run without restarting the main server

## Usage

### Prerequisites

1. Start your n-apt server:
```bash
npm run dev
# or
cargo run --bin n-apt-backend
```

2. Make sure the server is running on `localhost:8080` (default)

### Running the Test Client

```bash
# Basic usage with default settings
cargo run --bin live_stream_test

# Custom server URL
cargo run --bin live_stream_test -- --server localhost:8080

# Custom authentication passkey from .env.local
cargo run --bin live_stream_test -- --passkey "$UNSAFE_LOCAL_USER_PASSWORD"

# Verbose logging
cargo run --bin live_stream_test -- --verbose

# All options combined
cargo run --bin live_stream_test -- --server ws://localhost:8080 --passkey "$UNSAFE_LOCAL_USER_PASSWORD" --verbose
```

### Command Line Options

- `-s, --server <URL>`: WebSocket server URL (default: `localhost:8080`)
- `-p, --passkey <PASSKEY>`: Authentication passkey (default: `UNSAFE_LOCAL_USER_PASSWORD` from `.env.local`)
- `-v, --verbose`: Enable verbose logging
- `-h, --help`: Show help information

## Output

The test client will display:

1. **Connection Status**: WebSocket connection and authentication status
2. **Live Data Processing**: Real-time algorithm results including:
   - Peak detection (frequency and power of strongest signals)
   - Signal strength analysis (average, max, min power)
   - Frequency analysis (dominant frequency and bandwidth)
   - Noise floor analysis
   - I/Q data statistics (when available)
3. **Periodic Updates**: Frame count and processing status every 10 frames

### Example Output

```
🚀 n-apt Live Stream Test Client
📡 Server: localhost:8080
🔐 Passkey: UNSAFE_LOCAL_USER_PASSWORD
──────────────────────────────────────────────────
🧪 Running example algorithms...
📊 Processing live data stream...
Press Ctrl+C to stop
🔐 Authenticating with server...
✅ Authentication successful, got session token
🔌 Connecting to WebSocket: ws://localhost:8080/ws?token=...
✅ Connected to WebSocket
📡 Starting data stream...
📊 Status update: device=Mock APT SDR, state=connected
📡 Peak 1: 101.2 MHz, -25.3 dB
📡 Peak 2: 98.7 MHz, -32.1 dB
🔊 Noise Floor: -85.2 dB (10th percentile), -78.4 dB (median)
📊 Processed 10 frames, 40 results stored
```

## Architecture

### Module Structure

```
src/rs/live_stream_test/
├── mod.rs              # Main module exports and LiveStreamTester
├── websocket_client.rs # WebSocket connection and authentication
├── decryption.rs       # AES-256-GCM decryption utilities
├── data_parser.rs      # Binary message parsing
├── algorithms.rs       # Example signal processing algorithms
├── types.rs           # Data structures and enums
└── README.md          # This documentation
```

### Data Flow

1. **Authentication**: Challenge-response HMAC authentication with the server
2. **Connection**: WebSocket connection with session token
3. **Receiving**: Binary encrypted messages and text status messages
4. **Decryption**: AES-256-GCM decryption using derived key
5. **Parsing**: Binary message format parsing
6. **Processing**: Real-time algorithm execution
7. **Output**: Console display of results

### Message Format

Binary WebSocket messages follow this format:
```
[timestamp:8][center_freq:8][data_type:4][sample_rate:4][encrypted_payload]
```

- `timestamp`: i64 - Unix timestamp in milliseconds
- `center_freq`: u64 - Center frequency in Hz
- `data_type`: u32 - 0 for spectrum data, 1 for raw I/Q data
- `sample_rate`: u32 - Sample rate in Hz
- `encrypted_payload`: Variable length encrypted data

## Extending the Module

### Adding New Algorithms

1. Add your algorithm function to `algorithms.rs`
2. Call it from the `process_data` method
3. Store results in the `results` vector

Example:
```rust
fn run_custom_algorithm(&mut self, waveform: &[f32], timestamp: i64) {
    // Your algorithm implementation here
    let result = your_algorithm_function(waveform);
    
    let algorithm_result = AlgorithmResult {
        name: "Custom Algorithm".to_string(),
        timestamp,
        result_type: AlgorithmResultType::Custom {
            data: serde_json::to_value(result).unwrap(),
        },
    };
    
    self.results.push(algorithm_result);
}
```

### Custom Data Processing

You can modify the `process_data` method in `AlgorithmTester` to add custom processing logic for different data types.

## Troubleshooting

### Connection Issues

- **Authentication Failed**: Check that your passkey matches the server's expected key
- **WebSocket Connection Failed**: Ensure the server is running and accessible
- **Session Token Expired**: Restart the client to get a new session token

### Data Issues

- **Decryption Failed**: Verify the passkey matches between client and server
- **Parse Errors**: Check that the server is sending the correct message format
- **No Data**: Ensure the SDR device is connected and streaming

### Performance

- **High CPU Usage**: The client processes data in real-time; reduce algorithm complexity if needed
- **Memory Usage**: The client keeps a history of 100 frames by default

## Dependencies

- `tokio`: Async runtime
- `tokio-tungstenite`: WebSocket client
- `aes-gcm`: AES-256-GCM encryption
- `base64`: Base64 encoding/decoding
- `serde_json`: JSON serialization
- `byteorder`: Binary data parsing
- `anyhow`: Error handling
- `clap`: Command line argument parsing
- `log`: Logging

## Security Notes

- The client uses the same encryption as the frontend (AES-256-GCM)
- Authentication uses HMAC-SHA256 with PBKDF2 key derivation
- Session tokens are temporary and expire after disconnection
- All sensitive data is encrypted in transit
