use axum_test::TestServer;
use n_apt_backend::authentication::CredentialStore;
use n_apt_backend::server::main::AppState;
use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::websocket_server::WebSocketServer;
use n_apt_backend::session::SessionStore;
use serial_test::serial;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use url::Url;
use webauthn_rs::prelude::*;

fn ensure_test_password() {
  if std::env::var("UNSAFE_LOCAL_USER_PASSWORD").is_err() {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
  }
}

#[tokio::test]
#[serial]
async fn test_server_status_endpoint() {
  ensure_test_password();
  // Setup mock AppState
  let (broadcast_tx, _mbr) = broadcast::channel(100);
  let (spectrum_tx, _sbr) = broadcast::channel(100);
  let (cmd_tx, _cmd_rx) = std::sync::mpsc::channel();

  // Use a temporary directory for credential/session storage by overriding HOME
  let temp_dir = tempfile::tempdir().unwrap();
  std::env::set_var("HOME", temp_dir.path());

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let credential_store =
    CredentialStore::new().expect("Failed to create credential store");
  let session_store = SessionStore::new("redis://127.0.0.1:6379").unwrap();

  // Initialize WebAuthn with dummy values
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

  let app = WebSocketServer::create_app(state);
  let server = TestServer::new(app);

  // Test /status
  let response = server.get("/status").await;
  response.assert_status_ok();

  let json = response.json::<serde_json::Value>();
  assert!(json.get("device_connected").is_some());
  assert!(json.get("clients").is_some());
  assert!(json.get("authenticated_clients").is_some());
}

#[tokio::test]
#[serial]
async fn test_auth_challenge_flow() {
  ensure_test_password();
  let (broadcast_tx, _) = broadcast::channel(10);
  let (spectrum_tx, _) = broadcast::channel(10);
  let (cmd_tx, _) = std::sync::mpsc::channel();

  let temp_dir = tempfile::tempdir().unwrap();
  std::env::set_var("HOME", temp_dir.path());

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let credential_store = CredentialStore::new().unwrap();
  let session_store = SessionStore::new("redis://127.0.0.1:6379").unwrap();
  let webauthn =
    WebauthnBuilder::new("localhost", &Url::parse("http://localhost").unwrap())
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

  let app = WebSocketServer::create_app(state);
  let server = TestServer::new(app);

  // 1. Get challenge
  let challenge_resp = server.post("/auth/challenge").await;
  challenge_resp.assert_status_ok();

  let challenge_json = challenge_resp.json::<serde_json::Value>();
  let challenge_id = challenge_json["challenge_id"].as_str().unwrap();
  let nonce_b64 = challenge_json["nonce"].as_str().unwrap();

  assert!(!challenge_id.is_empty());
  assert!(!nonce_b64.is_empty());

  // 2. Verify with WRONG HMAC
  let verify_resp = server
    .post("/auth/verify")
    .json(&serde_json::json!({
        "challenge_id": challenge_id,
        "hmac": "bm90LWEtdmFsaWQtaG1hYw==" // base64 for "not-a-valid-hmac"
    }))
    .await;

  verify_resp.assert_status_unauthorized();
}

#[tokio::test]
#[serial]
async fn test_auth_info_endpoint() {
  ensure_test_password();
  let (broadcast_tx, _) = broadcast::channel(10);
  let (spectrum_tx, _) = broadcast::channel(10);
  let (cmd_tx, _) = std::sync::mpsc::channel();

  let temp_dir = tempfile::tempdir().unwrap();
  std::env::set_var("HOME", temp_dir.path());

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let sdr_processor = Arc::new(tokio::sync::Mutex::new(
    n_apt_backend::sdr::processor::SdrProcessor::new_mock_apt().unwrap(),
  ));
  let state = Arc::new(AppState {
    shared,
    credential_store: CredentialStore::new().unwrap(),
    pending_passkey_registrations: std::sync::Mutex::new(HashMap::new()),
    pending_passkey_authentications: std::sync::Mutex::new(HashMap::new()),
    session_store: SessionStore::new("redis://127.0.0.1:6379").unwrap(),
    webauthn: WebauthnBuilder::new(
      "localhost",
      &Url::parse("http://localhost").unwrap(),
    )
    .unwrap()
    .build()
    .unwrap(),
    broadcast_tx,
    spectrum_tx,
    cmd_tx,
    sdr_processor,
  });

  let app = WebSocketServer::create_app(state);
  let server = TestServer::new(app);

  let response = server.get("/auth/info").await;
  response.assert_status_ok();

  let json = response.json::<serde_json::Value>();
  assert_eq!(json["has_passkeys"].as_bool(), Some(false));
}

#[tokio::test]
#[serial]
async fn test_auth_logout_endpoint() {
  ensure_test_password();
  let (broadcast_tx, _) = broadcast::channel(10);
  let (spectrum_tx, _) = broadcast::channel(10);
  let (cmd_tx, _) = std::sync::mpsc::channel();

  let temp_dir = tempfile::tempdir().unwrap();
  std::env::set_var("HOME", temp_dir.path());

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let sdr_processor = Arc::new(tokio::sync::Mutex::new(
    n_apt_backend::sdr::processor::SdrProcessor::new_mock_apt().unwrap(),
  ));
  let state = Arc::new(AppState {
    shared,
    credential_store: CredentialStore::new().unwrap(),
    pending_passkey_registrations: std::sync::Mutex::new(HashMap::new()),
    pending_passkey_authentications: std::sync::Mutex::new(HashMap::new()),
    session_store: SessionStore::new("redis://127.0.0.1:6379").unwrap(),
    webauthn: WebauthnBuilder::new(
      "localhost",
      &Url::parse("http://localhost").unwrap(),
    )
    .unwrap()
    .build()
    .unwrap(),
    broadcast_tx,
    spectrum_tx,
    cmd_tx,
    sdr_processor,
  });

  let app = WebSocketServer::create_app(Arc::clone(&state));
  let server = TestServer::new(app);

  // 1. Create a session first to verify revocation
  let token = state.session_store.create_session([0u8; 32]);
  assert!(
    state.session_store.validate(&token).is_some(),
    "Session should be valid after creation"
  );

  // 2. Call logout with the token
  let response = server.get(&format!("/auth/logout?token={}", token)).await;

  // Assert redirect (303 See Other)
  response.assert_status(axum::http::StatusCode::SEE_OTHER);

  // Assert Location header
  response.assert_header("location", "/");

  // Assert Clear-Site-Data header
  response.assert_header(
    "clear-site-data",
    "\"cache\", \"cookies\", \"storage\", \"executionContexts\"",
  );

  // 3. Verify the session is actually revoked in Redis
  assert!(
    state.session_store.validate(&token).is_none(),
    "Session should be revoked after logout"
  );
}

#[tokio::test]
#[serial]
async fn test_logout_alias_redirects_to_login() {
  ensure_test_password();
  let (broadcast_tx, _) = broadcast::channel(10);
  let (spectrum_tx, _) = broadcast::channel(10);
  let (cmd_tx, _) = std::sync::mpsc::channel();

  let temp_dir = tempfile::tempdir().unwrap();
  std::env::set_var("HOME", temp_dir.path());

  let shared = SharedState::new("redis://127.0.0.1:6379");
  let sdr_processor = Arc::new(tokio::sync::Mutex::new(
    n_apt_backend::sdr::processor::SdrProcessor::new_mock_apt().unwrap(),
  ));
  let state = Arc::new(AppState {
    shared,
    credential_store: CredentialStore::new().unwrap(),
    pending_passkey_registrations: std::sync::Mutex::new(HashMap::new()),
    pending_passkey_authentications: std::sync::Mutex::new(HashMap::new()),
    session_store: SessionStore::new("redis://127.0.0.1:6379").unwrap(),
    webauthn: WebauthnBuilder::new(
      "localhost",
      &Url::parse("http://localhost").unwrap(),
    )
    .unwrap()
    .build()
    .unwrap(),
    broadcast_tx,
    spectrum_tx,
    cmd_tx,
    sdr_processor,
  });

  let app = WebSocketServer::create_app(Arc::clone(&state));
  let server = TestServer::new(app);

  let response = server.get("/logout").await;

  response.assert_status(axum::http::StatusCode::SEE_OTHER);
  response.assert_header("location", "/");
  response.assert_header(
    "clear-site-data",
    "\"cache\", \"cookies\", \"storage\", \"executionContexts\"",
  );
}
