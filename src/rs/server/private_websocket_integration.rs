//! # Private WebSocket Integration
//!
//! This module shows how to import and use the private WebSocket pipeline module
//! without exposing method names in the public API.

use anyhow::Result;
use log::info;
#[cfg(not(rs_decrypted))]
use log::warn;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::encrypted_modules::obfuscated_websocket as secure_ws;

/// Wrapper for private WebSocket processing
/// This provides a clean interface while keeping the sensitive implementation private
pub struct SecureWebSocketHandler {
    processor: Arc<Mutex<secure_ws::SecureProcessor>>,
}

impl SecureWebSocketHandler {
    /// Create a new secure handler
    pub fn new() -> Self {
        Self {
            processor: Arc::new(Mutex::new(secure_ws::create_obfuscated_processor())),
        }
    }

    /// Process a WebSocket message securely
    pub async fn process_message(
        &self,
        message: &crate::server::types::WebSocketMessage,
        broadcast_tx: &tokio::sync::broadcast::Sender<String>,
    ) -> Result<()> {
        let mut processor = self.processor.lock().await;

        #[cfg(rs_decrypted)]
        {
            secure_ws::process_secure_message(&mut processor, message, broadcast_tx).await?;
            info!("Secure WebSocket message processed");
            Ok(())
        }

        #[cfg(not(rs_decrypted))]
        {
            if let Err(err) = secure_ws::process_secure_message(&mut processor, message, broadcast_tx).await {
                warn!("Secure WebSocket processing not available: {}", err);
            }
            Ok(())
        }
    }

    /// Initialize secure connection
    pub async fn initialize(&self) -> Result<()> {
        let mut processor = self.processor.lock().await;

        #[cfg(rs_decrypted)]
        {
            secure_ws::initialize_secure_processor(&mut processor)?;
            info!("Secure WebSocket handler initialized");
            Ok(())
        }

        #[cfg(not(rs_decrypted))]
        {
            if let Err(err) = secure_ws::initialize_secure_processor(&mut processor) {
                warn!("Secure WebSocket initialization not available: {}", err);
            }
            Ok(())
        }
    }

    /// Cleanup sensitive data
    pub async fn cleanup(&self) -> Result<()> {
        let mut processor = self.processor.lock().await;
        secure_ws::cleanup_secure_processor(&mut processor);
        info!("Secure WebSocket handler cleaned up");
        Ok(())
    }
}

/// Factory function for creating secure handlers
pub fn create_secure_websocket_handler() -> SecureWebSocketHandler {
    SecureWebSocketHandler::new()
}

/// Example usage in WebSocket server
pub async fn handle_secure_websocket_connection(
    _socket: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    _broadcast_tx: tokio::sync::broadcast::Sender<String>,
) -> Result<()> {
    // Create secure handler
    let handler = create_secure_websocket_handler();
    
    // Initialize secure connection
    handler.initialize().await?;
    
    // Process messages securely
    // (This would be your actual WebSocket message loop)
    
    // Cleanup when done
    handler.cleanup().await?;
    
    Ok(())
}
