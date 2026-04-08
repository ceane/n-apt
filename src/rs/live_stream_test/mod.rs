//! Live Stream Test Module
//!
//! A standalone test module that connects to the n-apt WebSocket API
//! to receive live FFT spectrum data and raw I/Q samples for algorithm testing.

pub mod algorithms;
pub mod data_parser;
pub mod decryption;
pub mod types;
pub mod websocket_client;

pub use algorithms::AlgorithmTester;
pub use types::*;
pub use websocket_client::WebSocketClient;

use anyhow::Result;

/// Main test harness for live stream algorithm testing
pub struct LiveStreamTester {
  client: WebSocketClient,
}

impl LiveStreamTester {
  /// Create a new live stream tester
  pub fn new(server_url: &str, passkey: &str) -> Result<Self> {
    let client = WebSocketClient::new(server_url, passkey)?;

    Ok(Self { client })
  }

  /// Start the live stream testing
  pub async fn start(&mut self) -> Result<()> {
    println!("🚀 Starting Live Stream Tester...");

    // Connect to WebSocket
    self.client.connect().await?;
    println!("✅ Connected to WebSocket");

    // Start receiving data
    self.client.start_streaming().await?;

    Ok(())
  }

  /// Run built-in example algorithms
  pub fn run_examples(&mut self) {
    self.client.run_example_algorithms();
  }
}
