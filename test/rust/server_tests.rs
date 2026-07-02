use axum_test::TestServer;
use n_apt_backend::authentication::CredentialStore;
use n_apt_backend::server::main::AppState;
use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::types::DeviceProfile;
use n_apt_backend::server::websocket_server::build_source_info_snapshot;
use n_apt_backend::server::websocket_server::WebSocketServer;
use n_apt_backend::session::SessionStore;
use serial_test::serial;
use std::collections::HashMap;
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::Arc;
use tokio::sync::broadcast;
use url::Url;
use webauthn_rs::prelude::*;

/// Guard that kills the child redis-server when dropped.
struct RedisGuard {
  child: Child,
}

impl Drop for RedisGuard {
  fn drop(&mut self) {
    let _ = self.child.kill();
    let _ = self.child.wait();
  }
}

/// Spawn a redis-server on a free port. Returns the (url, guard).
fn spawn_test_redis() -> (String, RedisGuard) {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  let port = listener.local_addr().unwrap().port();
  drop(listener);

  let child = Command::new("redis-server")
    .args([
      "--port",
      &port.to_string(),
      "--save",
      "",
      "--appendonly",
      "no",
      "--loglevel",
      "warning",
    ])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .spawn()
    .expect(
      "redis-server must be installed to run server_tests \
       (brew install redis)",
    );

  let url = format!("redis://127.0.0.1:{port}");

  // Wait for Redis to accept connections (up to 2 s).
  for _ in 0..200 {
    if TcpListener::bind(("127.0.0.1", port)).is_err() {
      return (url, RedisGuard { child });
    }
    std::thread::sleep(std::time::Duration::from_millis(10));
  }

  (url, RedisGuard { child })
}

fn ensure_test_password() {
  if std::env::var("UNSAFE_LOCAL_USER_PASSWORD").is_err() {
    unsafe {
      std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "n-apt-dev-key");
    }
  }
}

#[test]
#[serial]
fn source_info_reports_hackrf_duplex_mode() {
  ensure_test_password();
  let shared = SharedState::new("redis://127.0.0.1:6379");
  shared.update_device_status(
    true,
    "Great Scott Gadgets HackRF - Freq: 100 Hz, Rate: 2000000 Hz".to_string(),
    DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    },
  );

  let snapshot = build_source_info_snapshot(&shared);
  let sources = snapshot["sources"].as_array().expect("sources array");
  let active = sources
    .iter()
    .find(|source| source["kind"].as_str() == Some("hackrf_one"))
    .expect("active HackRF source");

  assert_eq!(active["name"], "HackRF One");
  assert_eq!(active["capability"], "tx_rx");
  assert_eq!(active["duplex_mode"], "Half-duplex");
}

#[test]
#[serial]
fn source_info_reports_loose_hardware_as_loading() {
  ensure_test_password();
  let shared = SharedState::new("redis://127.0.0.1:6379");
  shared.update_device_status(
    true,
    "HackRF One".to_string(),
    DeviceProfile {
      kind: "hackrf_one".to_string(),
      is_rtl_sdr: false,
      supports_approx_dbm: true,
      supports_raw_iq_stream: true,
    },
  );
  shared.set_device_state("loose", None);

  let snapshot = build_source_info_snapshot(&shared);
  let sources = snapshot["sources"].as_array().expect("sources array");
  let active = sources
    .iter()
    .find(|source| source["kind"].as_str() == Some("hackrf_one"))
    .expect("active HackRF source");

  assert_eq!(active["status"], "loading");
}

async fn setup_test_server() -> (TestServer, Arc<AppState>, RedisGuard) {
  ensure_test_password();
  let (redis_url, guard) = spawn_test_redis();

  let (broadcast_tx, _) = broadcast::channel(100);
  let (spectrum_tx, _) = broadcast::channel(100);
  let (cmd_tx, _) = std::sync::mpsc::channel();

  let temp_dir = tempfile::tempdir().unwrap();
  unsafe {
    std::env::set_var("HOME", temp_dir.path());
  }

  let shared = SharedState::new(&redis_url);
  let credential_store =
    CredentialStore::new().expect("Failed to create credential store");
  let session_store = SessionStore::new(&redis_url).unwrap();

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
  (TestServer::new(app), state, guard)
}

#[tokio::test]
#[serial]
async fn test_server_status_endpoint() {
  let (server, _, _guard) = setup_test_server().await;

  // Test /status
  let response = server.get("/status").await;
  response.assert_status_ok();

  let json = response.json::<serde_json::Value>();
  let meta = json.get("meta").expect("Expected 'meta' field");
  assert!(meta.get("clients").is_some());
  assert!(meta.get("authenticated_clients").is_some());

  let status = json.get("status").expect("Expected 'status' field");
  assert_eq!(status["type"], "source_info");
  assert_eq!(status["active_source"], "mock-apt");
}

#[tokio::test]
#[serial]
async fn test_auth_challenge_flow() {
  let (server, _, _guard) = setup_test_server().await;

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
  let (server, _, _guard) = setup_test_server().await;

  let response = server.get("/auth/info").await;
  response.assert_status_ok();

  let json = response.json::<serde_json::Value>();
  assert_eq!(json["has_passkeys"].as_bool(), Some(false));
}

#[tokio::test]
#[serial]
async fn test_auth_logout_endpoint() {
  let (server, state, _guard) = setup_test_server().await;

  // 1. Create a session first to verify revocation
  let token = state.session_store.create_session([0u8; 32]).await;
  assert!(
    state.session_store.validate(&token).await.is_some(),
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
    state.session_store.validate(&token).await.is_none(),
    "Session should be revoked after logout"
  );
}

#[tokio::test]
#[serial]
async fn test_logout_alias_redirects_to_login() {
  let (server, _, _guard) = setup_test_server().await;

  let response = server.get("/logout").await;

  response.assert_status(axum::http::StatusCode::SEE_OTHER);
  response.assert_header("location", "/");
  response.assert_header(
    "clear-site-data",
    "\"cache\", \"cookies\", \"storage\", \"executionContexts\"",
  );
}
