//! HTTP/WebSocket router facade.

use std::sync::Arc;

use axum::Router;

/// Build the existing router through the new application boundary. Keeping
/// this adapter small lets endpoint paths and response shapes remain stable
/// while the transport modules are migrated.
pub fn create_router(state: Arc<crate::server::AppState>) -> Router {
  crate::server::websocket_server::WebSocketServer::create_app(state)
}
