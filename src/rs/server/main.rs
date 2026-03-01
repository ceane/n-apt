/// Main entry point for the N-APT SDR backend server.
/// 
/// This module contains the main server implementation that handles:
/// - HTTP API endpoints for SDR control and status
/// - WebSocket connections for real-time spectrum data streaming
/// - WebAuthn-based authentication for secure access
/// - CORS configuration for cross-origin requests
/// 
/// The server uses Axum for HTTP handling and runs on a dedicated thread
/// for SDR I/O operations to avoid blocking the async runtime.
// mod authentication; // Moved to top-level

use anyhow::Result;
use axum::routing::{get, post};
use axum::Router;
use std::env;
use log::info;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use url::Url;
use tower_http::compression::CompressionLayer;
use axum::http::{HeaderValue, HeaderName};
use tower::ServiceBuilder;
use webauthn_rs::prelude::*;

use crate::authentication::CredentialStore;
use crate::consts::rs::env::{ws_host, ws_port};
use crate::session::SessionStore;

// Import sibling modules
use super::http_endpoints;
use super::shared_state;
use super::websocket_handlers;
use super::websocket_server;
use super::types;

/// Application state shared across all HTTP handlers.
/// 
/// This struct contains all the shared state needed by the server:
/// - `shared`: Shared SDR device state and client connections
/// - `credential_store`: WebAuthn credential storage for authentication
/// - `session_store`: Session management for authenticated clients
/// - `webauthn`: WebAuthn configuration for passkey authentication
/// - `broadcast_tx`: Channel for broadcasting spectrum data to WebSocket clients
/// - `cmd_tx`: Channel for sending SDR control commands
pub struct AppState {
    pub shared: Arc<shared_state::SharedState>,
    pub credential_store: CredentialStore,
    pub session_store: SessionStore,
    pub webauthn: Webauthn,
    pub broadcast_tx: broadcast::Sender<String>,
    pub cmd_tx: std::sync::mpsc::Sender<types::SdrCommand>,
}

impl websocket_server::WebSocketServer {
    /// Create the Axum app with all routes and middleware
    pub fn create_app(state: Arc<AppState>) -> Router {
        // CORS configuration - strict origin validation using APP_URL
        let app_url = env::var("APP_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
        let mut origins: Vec<HeaderValue> = vec![];
        if let Ok(val) = app_url.parse::<HeaderValue>() {
            origins.push(val);
        }
        // common local fallbacks
        for fallback in [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ] {
            if let Ok(val) = fallback.parse::<HeaderValue>() {
                origins.push(val);
            }
        }

        let cors = CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
            ])
            .allow_credentials(true);

        // Security headers
        let security_headers = ServiceBuilder::new()
            .layer(SetResponseHeaderLayer::overriding(
                HeaderName::from_static("cross-origin-opener-policy"),
                HeaderValue::from_static("same-origin"),
            ))
            .layer(SetResponseHeaderLayer::overriding(
                HeaderName::from_static("cross-origin-embedder-policy"),
                HeaderValue::from_static("require-corp"),
            ));

        Router::new()
            // Authentication endpoints
            .route("/auth/info", get(crate::authentication::auth_handlers::auth_info_handler))
            .route("/auth/challenge", post(crate::authentication::auth_handlers::auth_challenge_handler))
            .route("/auth/verify", post(crate::authentication::auth_handlers::auth_verify_handler))
            .route("/auth/session", post(crate::authentication::auth_handlers::auth_session_handler))
            .route("/auth/passkey/register/start", post(crate::authentication::auth_handlers::passkey_register_start_handler))
            .route("/auth/passkey/register/finish", post(crate::authentication::auth_handlers::passkey_register_finish_handler))
            .route("/auth/passkey/auth/start", post(crate::authentication::auth_handlers::passkey_auth_start_handler))
            .route("/auth/passkey/auth/finish", post(crate::authentication::auth_handlers::passkey_auth_finish_handler))
            
            .route("/status", get(http_endpoints::status_handler))
            .route("/capture/download", get(http_endpoints::capture_download_handler))
            
            // Agent endpoints
            .route("/api/agent/info", get(http_endpoints::agent_info_handler))
            .route("/api/agent/status", get(http_endpoints::agent_status_handler))
            .route("/api/webmcp/execute", post(http_endpoints::execute_webmcp_tool_handler))
            
            // WebSocket endpoint
            .route("/ws", get(websocket_handlers::ws_upgrade_handler))
            
            .layer(cors)
            .layer(CompressionLayer::new())
            .layer(security_headers)
            .with_state(state)
    }

    /// Run the HTTP server
    pub async fn run_server(self, websocket_server: websocket_server::WebSocketServer) -> Result<()> {
        let shared = websocket_server.get_shared_state();
        let broadcast_tx = websocket_server.get_broadcast_tx();
        let credential_store = CredentialStore::new().map_err(|e| anyhow::anyhow!("Failed to create credential store: {}", e))?;
        let session_store = SessionStore::new();

        // Initialize WebAuthn
        let app_url = std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
        let parsed_app_url = Url::parse(&app_url).ok();
        let default_rp_id = parsed_app_url
            .as_ref()
            .and_then(|u| u.host_str())
            .unwrap_or("localhost")
            .to_string();
        let rp_id = std::env::var("WEBAUTHN_RP_ID").unwrap_or(default_rp_id);
        let rp_origin = std::env::var("WEBAUTHN_RP_ORIGIN").unwrap_or(app_url.clone());

        let webauthn_result = WebauthnBuilder::new(&rp_id, &rp_origin.parse().unwrap())
            .map_err(|e| anyhow::anyhow!("Failed to create WebAuthn: {}", e))?
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build WebAuthn: {}", e))?;

        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel();

        let state = Arc::new(AppState {
            shared,
            credential_store,
            session_store,
            webauthn: webauthn_result,
            broadcast_tx,
            cmd_tx,
        });

        let app = Self::create_app(state);

        let host = ws_host();
        let port = ws_port();

        info!("Starting server on {}:{}", host, port);
        let listener = tokio::net::TcpListener::bind((host, port)).await?;
        
        // Pass the command receiver to the WebSocket server's run loop
        let websocket_server_clone = websocket_server.clone();
        tokio::spawn(async move {
            if let Err(e) = websocket_server_clone.run(cmd_rx).await {
                log::error!("WebSocket server error: {}", e);
            }
        });

        axum::serve(listener, app).await?;

        Ok(())
    }
}

/// Main entry point for the N-APT Rust backend server
pub async fn run_server() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    info!("Starting N-APT Rust Backend Server");

    // Create WebSocket server with integrated SDR processor
    let websocket_server = websocket_server::WebSocketServer::new();
    let shared = websocket_server.get_shared_state();
    let _broadcast_tx = websocket_server.get_broadcast_tx();

    // Install signal handler: on SIGINT/SIGTERM, signal the I/O thread to shut down
    // so it can release the RTL-SDR device cleanly before the process exits.
    let shutdown_shared = shared.clone();
    tokio::spawn(async move {
        let ctrl_c = tokio::signal::ctrl_c();
        #[cfg(unix)]
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler");

        #[cfg(unix)]
        tokio::select! {
            _ = ctrl_c => {},
            _ = sigterm.recv() => {},
        }
        #[cfg(not(unix))]
        ctrl_c.await.ok();

        info!("Shutdown signal received, signaling I/O thread...");
        shutdown_shared.shutdown.store(true, Ordering::Relaxed);
        // Give the I/O thread time to close the device cleanly
        tokio::time::sleep(Duration::from_millis(500)).await;
        info!("Exiting.");
        std::process::exit(0);
    });

    // HTTP server runs in the main thread, WebSocket server runs in a spawned thread (handled in run_server)
    websocket_server.clone().run_server(websocket_server.clone()).await?;

    Ok(())
}

