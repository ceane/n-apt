use axum_test::TestServer;
use n_apt_backend::authentication::CredentialStore;
use n_apt_backend::server::main::AppState;
use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::websocket_server::WebSocketServer;
use n_apt_backend::session::SessionStore;
use serial_test::serial;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::broadcast;
use url::Url;
use webauthn_rs::prelude::*;

fn ensure_test_password() {
  if std::env::var("UNSAFE_LOCAL_USER_PASSWORD").is_err() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  }
}

async fn setup_test_server() -> (TestServer, Arc<AppState>) {
  ensure_test_password();
  let (broadcast_tx, _) = broadcast::channel(100);
  let (spectrum_tx, _) = broadcast::channel(100);
  let (cmd_tx, _) = std::sync::mpsc::channel();

  let temp_dir = tempfile::tempdir().unwrap();
  std::env::set_var("HOME", temp_dir.path());

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let credential_store = CredentialStore::new().expect("Failed to create credential store");
  let session_store = SessionStore::new("redis://127.0.0.1:6379").unwrap();

  let rp_id = "localhost";
  let rp_origin = Url::parse("http://localhost:5173").unwrap();
  let webauthn = WebauthnBuilder::new(rp_id, &rp_origin)
    .unwrap()
    .build()
    .unwrap();

  let sdr_processor = Arc::new(tokio::sync::Mutex::new(
    n_apt_backend::sdr::processor::SdrProcessor::new_mock_apt().unwrap(),
  ));

  let state = Arc::new(AppState {
    shared,
    credential_store,
    pending_passkey_registrations: std::sync::Mutex::new(HashMap::new()),
    pending_passkey_authentications: std::sync::Mutex::new(HashMap::new()),
    session_store,
    webauthn,
    broadcast_tx,
    spectrum_tx,
    cmd_tx,
    sdr_processor,
  });

  let app = WebSocketServer::create_app(state.clone());
  (TestServer::new(app), state)
}

#[tokio::test]
#[serial]
async fn test_protected_endpoints_deny_unauthorized() {
  let (server, _) = setup_test_server().await;

  // List of endpoints to check
  let endpoints = vec![
    ("/api/debug/stitch-diagnostic", "POST"),
    ("/api/towers/bounds", "GET"),
    ("/api/capture/download", "GET"),
    ("/api/webmcp/execute", "POST"),
  ];

  for (path, method) in endpoints {
    let response = if method == "POST" {
      server.post(path).await
    } else {
      server.get(path).await
    };
    
    response.assert_status_unauthorized();
  }
}

#[tokio::test]
#[serial]
async fn test_protected_endpoints_allow_authorized() {
  let (server, state) = setup_test_server().await;

  // Create a valid session
  let token = state.session_store.create_session([0u8; 32]);

  // Test /api/towers/bounds (GET)
  let response = server
    .get("/api/towers/bounds")
    .add_header(
      axum::http::header::AUTHORIZATION,
      axum::http::HeaderValue::from_str(&format!("Bearer {}", token)).unwrap()
    )
    .await;
  
  // Should not be 401. It might be 400 if params are missing, but not 401.
  assert_ne!(response.status_code(), axum::http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial]
async fn test_invalid_token_denied() {
  let (server, _) = setup_test_server().await;

  let response = server
    .get("/api/towers/bounds")
    .add_header(
      axum::http::header::AUTHORIZATION,
      axum::http::HeaderValue::from_static("Bearer invalid-token")
    )
    .await;
  
  response.assert_status_unauthorized();
}
