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
use log::info;
use std::collections::HashMap;
use std::env;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use url::Url;
// use tower_http::compression::CompressionLayer; // Removed unused import
use axum::http::{HeaderName, HeaderValue};
use tower::ServiceBuilder;
use webauthn_rs::prelude::*;

use crate::authentication::CredentialStore;
use crate::consts::env::{ws_host, ws_port};
use crate::infrastructure::redis::{probe as probe_redis, RedisReadiness};
use crate::session::SessionStore;

// Import sibling modules
use super::http_endpoints;
use super::shared_state;
use super::types;
use super::websocket_handlers;
use super::websocket_server;

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
  pub pending_passkey_registrations: std::sync::Mutex<
    HashMap<String, (std::time::Instant, PasskeyRegistration)>,
  >,
  pub pending_passkey_authentications: std::sync::Mutex<
    HashMap<String, (std::time::Instant, PasskeyAuthentication)>,
  >,
  pub session_store: SessionStore,
  pub webauthn: Webauthn,
  pub broadcast_tx: broadcast::Sender<String>,
  pub spectrum_tx: broadcast::Sender<Arc<types::SpectrumData>>,
  pub stream_manager: super::stream_manager::StreamingSourceModeManager,
  pub source_runtime_manager: super::source_runtime::SourceRuntimeManager,
  pub cmd_tx: std::sync::mpsc::Sender<types::SdrCommand>,
  pub sdr_processor:
    Arc<tokio::sync::Mutex<crate::sdr::processor::SdrProcessor>>,
}

struct TeeWriter {
  file: Option<Mutex<std::fs::File>>,
}

impl TeeWriter {
  fn new() -> Self {
    let log_path = std::env::var("RUST_LOG_FILE")
      .unwrap_or_else(|_| "/tmp/rust_log.txt".to_string());
    let file = OpenOptions::new()
      .create(true)
      .append(true)
      .open(&log_path)
      .ok()
      .map(Mutex::new);
    if file.is_some() {
      eprintln!("Rust backend logs will also be written to {}", log_path);
    } else {
      eprintln!("Rust backend file logging unavailable; using stderr only");
    }
    Self { file }
  }
}

impl Write for TeeWriter {
  fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
    io::stderr().write_all(buf)?;
    if let Some(file) = &self.file {
      if let Ok(mut guard) = file.lock() {
        let _ = guard.write_all(buf);
        let _ = guard.flush();
      }
    }
    Ok(buf.len())
  }

  fn flush(&mut self) -> io::Result<()> {
    io::stderr().flush()?;
    if let Some(file) = &self.file {
      if let Ok(mut guard) = file.lock() {
        let _ = guard.flush();
      }
    }
    Ok(())
  }
}

fn init_logging() {
  static INIT: OnceLock<()> = OnceLock::new();
  INIT.get_or_init(|| {
    let mut builder = env_logger::Builder::from_env(
      env_logger::Env::default().default_filter_or("info"),
    );
    builder.format_timestamp_secs();
    builder.target(env_logger::Target::Pipe(Box::new(TeeWriter::new())));
    builder.init();
  });
}

fn shutdown_signal_received_message(signal_name: &str) -> String {
  format!("Shutdown signal received ({signal_name}), signaling I/O thread...")
}

fn spawn_redis_health_monitor(
  shared: Arc<shared_state::SharedState>,
  redis_url: String,
) -> tokio::task::JoinHandle<()> {
  tokio::spawn(async move {
    let client = match redis::Client::open(redis_url.as_str()) {
      Ok(client) => client,
      Err(error) => {
        log::error!("Redis health monitor disabled: {error}");
        shared.set_redis_readiness(RedisReadiness::Unavailable);
        return;
      }
    };

    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
      interval.tick().await;
      if shared.shutdown.load(Ordering::Relaxed) {
        break;
      }

      let next_state = match probe_redis(&client).await {
        Ok(()) => RedisReadiness::Ready,
        Err(error) => {
          log::warn!("Redis health check failed: {error}");
          RedisReadiness::Unavailable
        }
      };

      if shared.redis_readiness() != next_state {
        log::info!("Redis readiness changed to {}", next_state.as_str());
        shared.set_redis_readiness(next_state);
      }
    }
  })
}

fn shutdown_signal_propagated_message(signal_name: &str) -> String {
  format!("Shutdown signal propagated ({signal_name}).")
}

#[cfg(unix)]
async fn wait_for_shutdown_signal() -> &'static str {
  let ctrl_c = tokio::signal::ctrl_c();
  let mut sigterm =
    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
      .expect("Failed to install SIGTERM handler");
  let mut sighup =
    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup())
      .expect("Failed to install SIGHUP handler");
  let mut sigquit =
    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::quit())
      .expect("Failed to install SIGQUIT handler");

  tokio::select! {
    _ = ctrl_c => "SIGINT",
    _ = sigterm.recv() => "SIGTERM",
    _ = sighup.recv() => "SIGHUP",
    _ = sigquit.recv() => "SIGQUIT",
  }
}

#[cfg(not(unix))]
async fn wait_for_shutdown_signal() -> &'static str {
  tokio::signal::ctrl_c().await.ok();
  "SIGINT"
}

impl websocket_server::WebSocketServer {
  fn spawn_sdr_thread(
    websocket_server: websocket_server::WebSocketServer,
    cmd_rx: std::sync::mpsc::Receiver<crate::server::types::SdrCommand>,
  ) -> JoinHandle<()> {
    std::thread::Builder::new()
      .name("n-apt-sdr-io".to_string())
      .spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
          .enable_all()
          .build()
          .expect("Failed to create SDR thread runtime");

        runtime.block_on(async move {
          if let Err(e) = websocket_server.run(cmd_rx).await {
            log::error!("WebSocket server error: {}", e);
          }
        });
      })
      .expect("Failed to spawn SDR thread")
  }

  #[cfg(test)]
  fn sdr_thread_name() -> &'static str {
    "n-apt-sdr-io"
  }

  /// Create the Axum app with all routes and middleware
  pub fn create_app(state: Arc<AppState>) -> Router {
    // CORS configuration - strict origin validation using APP_URL
    let app_url = env::var("APP_URL")
      .unwrap_or_else(|_| "http://localhost:5173".to_string());
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

    // Security headers (Defense-in-depth)
    let security_headers = ServiceBuilder::new()
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
      ))
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("cross-origin-embedder-policy"),
        HeaderValue::from_static("require-corp"),
      ))
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
      ))
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
      ))
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("x-xss-protection"),
        HeaderValue::from_static("1; mode=block"),
      ))
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=31536000; includeSubDomains"),
      ))
      .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:;"),
      ));

    // Protected control and diagnostic endpoints
    let protected_routes = Router::new()
      .route(
        "/api/webmcp/execute",
        post(http_endpoints::execute_webmcp_tool_handler),
      )
      .route(
        "/api/debug/stitch-diagnostic",
        post(http_endpoints::stitch_diagnostic_handler),
      )
      .route(
        "/api/debug/pipeline-performance",
        get(http_endpoints::pipeline_performance_handler),
      )
      .route(
        "/api/debug/stream-performance",
        get(http_endpoints::stream_performance_handler),
      )
      .route(
        "/api/capture/download",
        get(http_endpoints::capture_download_handler),
      )
      .route(
        "/api/cli/snapshot-frame",
        get(http_endpoints::cli_snapshot_frame_handler),
      )
      .route(
        "/api/debug/mock-tx-power-frame",
        get(http_endpoints::mock_tx_power_frame_handler),
      )
      .route(
        "/api/debug/hardware-simulation",
        post(http_endpoints::hardware_simulation_handler),
      )
      .route(
        "/api/towers/bounds",
        get(http_endpoints::towers_bounds_handler),
      )
      .route(
        "/api/towers/load-local-radius",
        post(super::tower_local::load_local_radius_towers),
      )
      .route(
        "/api/towers/local-stats",
        get(super::tower_local::get_local_cache_stats),
      )
      .route_layer(axum::middleware::from_fn_with_state(
        state.clone(),
        crate::authentication::require_session,
      ));

    // Standard routes that benefit from compression (JSON, text, etc.)
    let compressible_routes = Router::new()
      // Authentication endpoints
      // SECURITY (known flaw, accepted for local deployments): these /auth/*
      // routes are unauthenticated and have no rate limiting. N-APT targets
      // localhost / trusted LANs; add throttling before ever exposing this
      // server publicly.
      .route(
        "/auth/info",
        get(crate::authentication::auth_handlers::auth_info_handler),
      )
      .route(
        "/auth/logout",
        get(crate::authentication::auth_handlers::auth_logout_handler),
      )
      .route(
        "/logout",
        get(crate::authentication::auth_handlers::auth_logout_handler),
      )
      .route(
        "/auth/challenge",
        post(crate::authentication::auth_handlers::auth_challenge_handler),
      )
      .route(
        "/auth/verify",
        post(crate::authentication::auth_handlers::auth_verify_handler),
      )
      .route(
        "/auth/session",
        post(crate::authentication::auth_handlers::auth_session_handler),
      )
      .route(
        "/auth/vault-key",
        get(crate::authentication::auth_handlers::auth_vault_key_handler),
      )
      .route(
        "/auth/passkey/register/start",
        post(
          crate::authentication::auth_handlers::passkey_register_start_handler,
        ),
      )
      .route(
        "/auth/passkey/register/finish",
        post(
          crate::authentication::auth_handlers::passkey_register_finish_handler,
        ),
      )
      .route(
        "/auth/passkey/auth/start",
        post(crate::authentication::auth_handlers::passkey_auth_start_handler),
      )
      .route(
        "/auth/passkey/auth/finish",
        post(crate::authentication::auth_handlers::passkey_auth_finish_handler),
      )
      .route("/status", get(http_endpoints::status_handler))
      .route("/api/readiness", get(crate::app::readiness::handler))
      // Agent endpoints
      .route("/api/agent/info", get(http_endpoints::agent_info_handler))
      .route(
        "/api/agent/status",
        get(http_endpoints::agent_status_handler),
      )
      .merge(protected_routes)
      // WebSocket endpoint
      .route(
        "/ws/source/{stream_key}/iq",
        get(websocket_handlers::source_iq_ws_upgrade_handler),
      )
      .route(
        "/ws/streams",
        get(websocket_handlers::stream_ws_upgrade_handler),
      )
      .route(
        "/ws/streams/{stream_id}",
        get(websocket_handlers::stream_identity_ws_upgrade_handler),
      )
      .route("/ws", get(websocket_handlers::ws_upgrade_handler))
      .layer(tower_http::compression::CompressionLayer::new());

    Router::new()
      .merge(compressible_routes)
      .layer(cors)
      .layer(security_headers)
      .with_state(state)
  }

  /// Run the HTTP server
  pub async fn run_server(
    self,
    websocket_server: websocket_server::WebSocketServer,
    listener: tokio::net::TcpListener,
  ) -> Result<()> {
    let shared = websocket_server.get_shared_state();
    let broadcast_tx = websocket_server.get_broadcast_tx();
    let spectrum_tx = websocket_server.get_spectrum_tx();
    // Credential path validation and directory creation are deferred until an
    // authentication endpoint actually needs them, so they cannot delay the
    // HTTP listener.
    let credential_store = CredentialStore::deferred();
    let redis_url = std::env::var("REDIS_URL")
      .unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
    let session_store = SessionStore::new_or_degraded(&redis_url);

    // Initialize WebAuthn
    let app_url = std::env::var("APP_URL")
      .unwrap_or_else(|_| "http://localhost:5173".to_string());
    let parsed_app_url = Url::parse(&app_url).ok();
    let default_rp_id = parsed_app_url
      .as_ref()
      .and_then(|u| u.host_str())
      .unwrap_or("localhost")
      .to_string();
    let rp_id = std::env::var("WEBAUTHN_RP_ID").unwrap_or(default_rp_id);
    let rp_origin =
      std::env::var("WEBAUTHN_RP_ORIGIN").unwrap_or(app_url.clone());

    let webauthn_result =
      WebauthnBuilder::new(&rp_id, &rp_origin.parse().unwrap())
        .map_err(|e| anyhow::anyhow!("Failed to create WebAuthn: {}", e))?
        .build()
        .map_err(|e| anyhow::anyhow!("Failed to build WebAuthn: {}", e))?;

    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel();

    let state = Arc::new(AppState {
      shared,
      credential_store,
      pending_passkey_registrations: std::sync::Mutex::new(HashMap::new()),
      pending_passkey_authentications: std::sync::Mutex::new(HashMap::new()),
      session_store,
      webauthn: webauthn_result,
      broadcast_tx,
      spectrum_tx,
      stream_manager: websocket_server.get_stream_manager(),
      source_runtime_manager: websocket_server.get_source_runtime_manager(),
      cmd_tx,
      sdr_processor: websocket_server.get_sdr_processor(),
    });

    let app = Self::create_app(state);

    let host = ws_host();
    let port = ws_port();

    info!("Starting server on {}:{}", host, port);

    // Run SDR + websocket streaming on a dedicated OS thread so blocking I/O
    // and device work never compete with the main HTTP runtime.
    let _sdr_thread = Self::spawn_sdr_thread(websocket_server.clone(), cmd_rx);

    let shutdown_state = websocket_server.get_shared_state();
    let shutdown_signal = async move {
      while !shutdown_state.shutdown.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(50)).await;
      }
    };

    let readiness_state = websocket_server.get_shared_state();
    readiness_state.set_readiness(
      readiness_state
        .readiness_state()
        .transition(crate::app::readiness::ReadinessEvent::HttpBound),
    );

    let _redis_health_task =
      spawn_redis_health_monitor(readiness_state.clone(), redis_url);

    axum::serve(listener, app)
      .with_graceful_shutdown(shutdown_signal)
      .await?;

    readiness_state.set_readiness(
      readiness_state
        .readiness_state()
        .transition(crate::app::readiness::ReadinessEvent::Shutdown),
    );

    Ok(())
  }
}

/// Main entry point for the N-APT Rust backend server
pub async fn run_server() -> Result<()> {
  init_logging();

  info!("Starting N-APT Rust Backend Server");

  let host = ws_host();
  let port = ws_port();
  info!("Binding HTTP listener on {}:{}", host, port);
  let listener = tokio::net::TcpListener::bind((host, port)).await?;

  let redis_url = std::env::var("REDIS_URL")
    .unwrap_or_else(|_| "redis://127.0.0.1/".to_string());

  // Create WebSocket server with integrated SDR processor
  let websocket_server = websocket_server::WebSocketServer::new(&redis_url);
  let shared = websocket_server.get_shared_state();
  let _broadcast_tx = websocket_server.get_broadcast_tx();

  // Install signal handler: on shutdown signals, signal the I/O thread to
  // shut down so it can release the RTL-SDR device cleanly before exit.
  let shutdown_shared = shared.clone();
  tokio::spawn(async move {
    let signal_name = wait_for_shutdown_signal().await;
    info!("{}", shutdown_signal_received_message(signal_name));
    shutdown_shared.shutdown.store(true, Ordering::Relaxed);
    // Give the I/O thread time to observe the shutdown flag and unwind.
    tokio::time::sleep(Duration::from_millis(250)).await;
    info!("{}", shutdown_signal_propagated_message(signal_name));
  });

  // HTTP server runs in the main thread, WebSocket server runs in a spawned thread (handled in run_server)
  websocket_server
    .clone()
    .run_server(websocket_server.clone(), listener)
    .await?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sdr_thread_has_stable_name() {
    assert_eq!(
      websocket_server::WebSocketServer::sdr_thread_name(),
      "n-apt-sdr-io"
    );
  }

  #[test]
  fn shutdown_signal_messages_include_the_signal_name() {
    assert_eq!(
      shutdown_signal_received_message("SIGTERM"),
      "Shutdown signal received (SIGTERM), signaling I/O thread..."
    );
    assert_eq!(
      shutdown_signal_propagated_message("SIGINT"),
      "Shutdown signal propagated (SIGINT)."
    );
  }
}
