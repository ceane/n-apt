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
mod auth_handlers;
mod http_endpoints;
mod shared_state;
mod sdr_processor;
mod types;
mod utils;
mod websocket_handlers;
mod websocket_server;

use anyhow::Result;
use axum::routing::{get, post};
use axum::Router;
use log::info;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use axum::http::{HeaderValue, HeaderName};
use tower::ServiceBuilder;
use webauthn_rs::prelude::*;

use n_apt_backend::credentials::CredentialStore;
use n_apt_backend::session::SessionStore;
use n_apt_backend::consts::rs::env::{WS_HOST, WS_PORT};

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
        // CORS configuration - strict origin validation
        let cors = CorsLayer::new()
            .allow_origin([
                "http://localhost:5173".parse::<HeaderValue>().unwrap(),
                "http://127.0.0.1:5173".parse::<HeaderValue>().unwrap(),
                "http://localhost:3000".parse::<HeaderValue>().unwrap(),
                "http://127.0.0.1:3000".parse::<HeaderValue>().unwrap(),
            ])
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
            .route("/auth/info", get(auth_handlers::auth_info_handler))
            .route("/auth/challenge", post(auth_handlers::auth_challenge_handler))
            .route("/auth/verify", post(auth_handlers::auth_verify_handler))
            .route("/auth/session", post(auth_handlers::auth_session_handler))
            .route("/auth/passkey/register/start", post(auth_handlers::passkey_register_start_handler))
            .route("/auth/passkey/register/finish", post(auth_handlers::passkey_register_finish_handler))
            .route("/auth/passkey/auth/start", post(auth_handlers::passkey_auth_start_handler))
            .route("/auth/passkey/auth/finish", post(auth_handlers::passkey_auth_finish_handler))
            
            // HTTP endpoints
            .route("/status", get(http_endpoints::status_handler))
            .route("/capture/download", get(http_endpoints::capture_download_handler))
            
            // Agent endpoints
            .route("/api/agent/info", get(http_endpoints::agent_info_handler))
            .route("/api/agent/status", get(http_endpoints::agent_status_handler))
            .route("/api/webmcp/execute", post(http_endpoints::execute_webmcp_tool_handler))
            
            // WebSocket endpoint
            .route("/ws", get(websocket_handlers::ws_upgrade_handler))
            
            .layer(cors)
            .layer(security_headers)
            .with_state(state)
    }

    /// Run the HTTP server
    pub async fn run_server(self) -> Result<()> {
        let shared = self.shared.clone();
        let credential_store = CredentialStore::new().map_err(|e| anyhow::anyhow!("Failed to create credential store: {}", e))?;
        let session_store = SessionStore::new();

        // Initialize WebAuthn
        let rp_id = match std::env::var("WEBAUTHN_RP_ID") {
            Ok(id) => id,
            Err(_) => "localhost".to_string(),
        };
        let rp_origin = match std::env::var("WEBAUTHN_RP_ORIGIN") {
            Ok(origin) => origin,
            Err(_) => "http://localhost:8765".to_string(),
        };

        let webauthn_result = WebauthnBuilder::new(&rp_id, &rp_origin.parse().unwrap())
            .map_err(|e| anyhow::anyhow!("Failed to create WebAuthn: {}", e))?
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build WebAuthn: {}", e))?;

        let state = Arc::new(AppState {
            shared,
            credential_store,
            session_store,
            webauthn: webauthn_result,
            broadcast_tx: self.broadcast_tx.clone(),
            cmd_tx: self.cmd_tx.clone(),
        });

        let app = Self::create_app(state);

        let host = WS_HOST.to_string();
        let port = WS_PORT;

        info!("Starting server on {}:{}", host, port);
        let listener = tokio::net::TcpListener::bind((host, port)).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

/// Main entry point for the N-APT Rust backend server
#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    info!("Starting N-APT Rust Backend Server");

    let shared = shared_state::SharedState::new();
    let server = websocket_server::WebSocketServer::new(shared.clone());

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

    server.run_server().await?;

    Ok(())
}

