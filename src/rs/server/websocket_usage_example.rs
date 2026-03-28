//! # Private WebSocket Module Usage Example
//!
//! This file demonstrates how to use the private WebSocket pipeline module
//! without exposing method names in the public API.

use crate::server::private_websocket_integration::SecureWebSocketHandler;
use anyhow::Result;
use log::{info, warn};

/// Example of using the private WebSocket module in your WebSocket server
pub async fn example_websocket_usage() -> Result<()> {
  // Create the secure handler - this will only work when encrypted modules are available
  let secure_handler = SecureWebSocketHandler::new();

  // Initialize the secure connection
  secure_handler.initialize().await?;

  // Example message processing
  let sample_message = crate::server::types::WebSocketMessage {
    message_type: "test".to_string(),
    job_id: Some("test_job".to_string()),
    // ... other fields
    ..Default::default()
  };

  let (broadcast_tx, _) = tokio::sync::broadcast::channel(100);

  // Process the message securely
  secure_handler
    .process_message(&sample_message, &broadcast_tx)
    .await?;

  // Cleanup when done
  secure_handler.cleanup().await?;

  Ok(())
}

/// Example of integrating with existing WebSocket handlers
pub struct EnhancedWebSocketHandler {
  /// Secure handler for sensitive operations
  secure_handler: SecureWebSocketHandler,
  /// Your existing regular handler
  regular_handler: YourExistingHandler,
}

impl EnhancedWebSocketHandler {
  pub fn new() -> Self {
    Self {
      secure_handler: SecureWebSocketHandler::new(),
      regular_handler: YourExistingHandler::new(),
    }
  }

  /// Handle incoming WebSocket messages with secure processing when available
  pub async fn handle_message(
    &mut self,
    message: &crate::server::types::WebSocketMessage,
    broadcast_tx: &tokio::sync::broadcast::Sender<String>,
  ) -> Result<()> {
    // Try secure processing first (only available with encrypted modules)
    if let Err(_) = self
      .secure_handler
      .process_message(message, broadcast_tx)
      .await
    {
      // Fallback to regular processing if secure processing unavailable
      warn!("Secure processing unavailable, using regular handler");
      self
        .regular_handler
        .handle_message(message, broadcast_tx)
        .await?;
    }

    Ok(())
  }

  /// Initialize both handlers
  pub async fn initialize(&mut self) -> Result<()> {
    // Initialize secure handler (will gracefully fail if encryption unavailable)
    if let Err(e) = self.secure_handler.initialize().await {
      warn!("Secure handler initialization failed: {}", e);
    }

    // Initialize regular handler
    self.regular_handler.initialize().await?;

    Ok(())
  }

  /// Cleanup both handlers
  pub async fn cleanup(&mut self) -> Result<()> {
    self.secure_handler.cleanup().await?;
    self.regular_handler.cleanup().await?;
    Ok(())
  }
}

/// Placeholder for your existing handler
pub struct YourExistingHandler;

impl YourExistingHandler {
  pub fn new() -> Self {
    Self
  }

  pub async fn handle_message(
    &mut self,
    _message: &crate::server::types::WebSocketMessage,
    _broadcast_tx: &tokio::sync::broadcast::Sender<String>,
  ) -> Result<()> {
    // Your existing WebSocket handling logic
    info!("Processing message with regular handler");
    Ok(())
  }

  pub async fn initialize(&self) -> Result<()> {
    info!("Initializing regular handler");
    Ok(())
  }

  pub async fn cleanup(&self) -> Result<()> {
    info!("Cleaning up regular handler");
    Ok(())
  }
}

/// Example usage in your main WebSocket server
pub async fn run_enhanced_websocket_server() -> Result<()> {
  let mut handler = EnhancedWebSocketHandler::new();

  // Initialize
  handler.initialize().await?;

  // Your WebSocket server loop would go here
  // For each incoming message:
  // handler.handle_message(&message, &broadcast_tx).await?;

  // Cleanup when server shuts down
  handler.cleanup().await?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn test_secure_websocket_handler() {
    let handler = SecureWebSocketHandler::new();

    // Test initialization
    let result = handler.initialize().await;
    assert!(result.is_ok()); // Should succeed or fail gracefully

    // Test message processing
    let message = crate::server::types::WebSocketMessage {
      message_type: "test".to_string(),
      job_id: Some("test".to_string()),
      ..Default::default()
    };

    let (tx, _) = tokio::sync::broadcast::channel(100);
    let result = handler.process_message(&message, &tx).await;
    assert!(result.is_ok()); // Should succeed or fail gracefully

    // Test cleanup
    let result = handler.cleanup().await;
    assert!(result.is_ok());
  }

  #[tokio::test]
  async fn test_enhanced_handler() {
    let mut handler = EnhancedWebSocketHandler::new();

    // Test initialization
    let result = handler.initialize().await;
    assert!(result.is_ok());

    // Test message processing
    let message = crate::server::types::WebSocketMessage {
      message_type: "test".to_string(),
      job_id: Some("test".to_string()),
      ..Default::default()
    };

    let (tx, _) = tokio::sync::broadcast::channel(100);
    let result = handler.handle_message(&message, &tx).await;
    assert!(result.is_ok());

    // Test cleanup
    let result = handler.cleanup().await;
    assert!(result.is_ok());
  }
}
