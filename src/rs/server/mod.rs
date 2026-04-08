//! Server module for N-APT backend
//!
//! This module contains the HTTP server, WebSocket handlers, and API endpoints
//! for the N-APT SDR application.

pub mod http_endpoints;
pub mod main;
pub mod shared_state;
pub mod tower_local;
pub mod types;
pub mod utils;
pub mod websocket_handlers;
pub mod websocket_server;

// Re-export AppState for use by other modules
pub use main::AppState;
