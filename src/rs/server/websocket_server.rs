//! Minimal WebSocket server for compilation
//! TODO: Integrate with new SDR processor architecture

use anyhow::Result;
use log::info;

pub struct WebSocketServer;

impl WebSocketServer {
    pub fn new() -> Self {
        Self
    }
    
    pub async fn run(&self) -> Result<()> {
        info!("WebSocket server started - SDR integration pending");
        Ok(())
    }
}
