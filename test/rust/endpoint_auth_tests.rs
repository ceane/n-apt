use axum_test::TestServer;
use axum_test::WsMessage;
use n_apt_backend::authentication::CredentialStore;
use n_apt_backend::crypto;
use n_apt_backend::server::main::AppState;
use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::types::SpectrumData;
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
  // Bind to port 0 to let the OS pick a free port, then release it.
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
      "redis-server must be installed to run endpoint_auth_tests \
       (brew install redis)",
    );

  let url = format!("redis://127.0.0.1:{port}");

  // Wait for Redis to accept connections (up to 2 s).
  for _ in 0..200 {
    if TcpListener::bind(("127.0.0.1", port)).is_err() {
      // Port is now taken by redis-server → it's ready.
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
  (
    TestServer::builder().http_transport().build(app),
    state,
    guard,
  )
}

#[tokio::test]
#[serial]
async fn test_protected_endpoints_deny_unauthorized() {
  let (server, _, _guard) = setup_test_server().await;

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
  let (server, state, _guard) = setup_test_server().await;

  // Create a valid session
  let token = state.session_store.create_session([0u8; 32]).await;

  // Test /api/towers/bounds (GET)
  let response = server
    .get("/api/towers/bounds")
    .add_header(
      axum::http::header::AUTHORIZATION,
      axum::http::HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    )
    .await;

  // Should not be 401. It might be 400 if params are missing, but not 401.
  assert_ne!(response.status_code(), axum::http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial]
async fn test_invalid_token_denied() {
  let (server, _, _guard) = setup_test_server().await;

  let response = server
    .get("/api/towers/bounds")
    .add_header(
      axum::http::header::AUTHORIZATION,
      axum::http::HeaderValue::from_static("Bearer invalid-token"),
    )
    .await;

  response.assert_status_unauthorized();
}

#[tokio::test]
#[serial]
async fn test_vault_key_matches_shared_password_key() {
  let (server, state, _guard) = setup_test_server().await;

  let token = state.session_store.create_session([0u8; 32]).await;

  let response = server.get(&format!("/auth/vault-key?token={token}")).await;
  response.assert_status_ok();

  let json = response.json::<serde_json::Value>();
  let vault_key = json["vault_key"].as_str().unwrap();

  assert_eq!(
    vault_key,
    crypto::to_base64(&state.shared.encryption_key),
    "vault key endpoint must return the password-derived key used for capture encryption"
  );
}

#[tokio::test]
#[serial]
async fn test_live_stream_uses_shared_password_key_not_session_key() {
  let (server, state, _guard) = setup_test_server().await;

  let session_key = [7u8; 32];
  assert_ne!(session_key, state.shared.encryption_key);
  let token = state.session_store.create_session(session_key).await;

  let ws_path = format!("/ws/source/mock-apt/iq?token={token}");
  let mut websocket =
    server.get_websocket(&ws_path).await.into_websocket().await;

  let original_iq = vec![0x11, 0x22, 0x33, 0x44];
  // Wait up to 500ms for the websocket handler to subscribe to the broadcast channel
  let mut send_success = false;
  for _ in 0..50 {
    if state
      .spectrum_tx
      .send(Arc::new(SpectrumData {
        message_type: "spectrum".to_string(),
        waveform: vec![],
        is_mock_apt: true,
        center_frequency_hz: Some(137_500_000),
        waveform_span_hz: None,
        timestamp: 123,
        data_type: Some("iq_raw".to_string()),
        sample_rate: Some(2_400_000),
        power_scale: None,
        iq_data: original_iq.clone(),
      }))
      .is_ok()
    {
      send_success = true;
      break;
    }
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
  }
  assert!(send_success, "spectrum frame should broadcast to websocket");

  let frame_bytes =
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
      loop {
        match websocket.receive_message().await {
          WsMessage::Binary(bytes) => return bytes,
          WsMessage::Text(_) => continue,
          other => panic!("unexpected websocket message: {other:?}"),
        }
      }
    })
    .await
    .expect("timed out waiting for encrypted live frame");

  assert_eq!(&frame_bytes[0..8], &123u64.to_le_bytes());
  assert_eq!(&frame_bytes[8..16], &137_500_000u64.to_le_bytes());
  assert_eq!(&frame_bytes[16..20], &1u32.to_le_bytes());
  assert_eq!(&frame_bytes[20..24], &2_400_000u32.to_le_bytes());

  let encrypted_iq = &frame_bytes[24..];
  let decrypted_iq =
    crypto::decrypt_payload_binary(&state.shared.encryption_key, encrypted_iq)
      .expect("live I/Q frame must decrypt with password-derived vault key");
  assert_eq!(decrypted_iq, original_iq);
  assert!(
    crypto::decrypt_payload_binary(&session_key, encrypted_iq).is_err(),
    "live I/Q frame must not be encrypted with the random session key"
  );
}
