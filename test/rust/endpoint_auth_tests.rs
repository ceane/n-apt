use axum_test::TestServer;
use axum_test::WsMessage;
use n_apt_backend::authentication::CredentialStore;
use n_apt_backend::crypto;
use n_apt_backend::server::main::AppState;
use n_apt_backend::server::shared_state::SharedState;
use n_apt_backend::server::stream_manager::StreamingSourceModeManager;
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

async fn setup_test_server() -> (TestServer, Arc<AppState>, String, RedisGuard) {
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
    stream_manager: StreamingSourceModeManager::new(
      std::time::Duration::from_millis(250),
    ),
    cmd_tx,
    sdr_processor,
  });

  let app = WebSocketServer::create_app(state.clone());
  (
    TestServer::builder().http_transport().build(app),
    state,
    redis_url,
    guard,
  )
}

#[tokio::test]
#[serial]
async fn test_protected_endpoints_deny_unauthorized() {
  let (server, _, _url, _guard) = setup_test_server().await;

  // List of endpoints to check
  let endpoints = vec![
    ("/api/debug/stitch-diagnostic", "POST"),
    ("/api/debug/pipeline-performance", "GET"),
    ("/api/towers/bounds", "GET"),
    ("/api/capture/download", "GET"),
    ("/api/webmcp/execute", "POST"),
    ("/ws/streams?token=invalid-token", "GET"),
  ];

  for (path, method) in endpoints {
    let response = if method == "POST" {
      server.post(path).await
    } else if path.starts_with("/ws/") {
      server.get_websocket(path).await
    } else {
      server.get(path).await
    };

    response.assert_status_unauthorized();
  }
}

#[tokio::test]
#[serial]
async fn test_protected_endpoints_allow_authorized() {
  let (server, state, _url, _guard) = setup_test_server().await;

  // Create a valid session
  let token = state
    .session_store
    .create_session([0u8; 32])
    .await
    .expect("test Redis must be available");

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
  let (server, _, _url, _guard) = setup_test_server().await;

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
  let (server, state, _url, _guard) = setup_test_server().await;

  let token = state
    .session_store
    .create_session([0u8; 32])
    .await
    .expect("test Redis must be available");

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
  let (server, state, _url, _guard) = setup_test_server().await;

  let session_key = [7u8; 32];
  assert_ne!(session_key, state.shared.encryption_key);
  let token = state
    .session_store
    .create_session(session_key)
    .await
    .expect("test Redis must be available");

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
        source_id: "mock-apt".to_string(),
        stream_epoch: 1,
        sequence: 1,
        center_frequency_hz: Some(137_500_000),
        waveform_span_hz: None,
        timestamp: 123,
        data_type: Some("iq_raw".to_string()),
        sample_rate: Some(2_400_000),
        power_scale: None,
        iq_data: original_iq.clone(),
        is_tx_preview: None,
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

/// Full password auth flow: challenge → HMAC proof with the password-derived
/// key → verify → usable session. This pins the contract that the server's
/// HMAC verification proves password knowledge without the password ever
/// crossing the wire.
#[tokio::test]
#[serial]
async fn test_password_auth_flow_issues_working_session() {
  let (server, state, _url, _guard) = setup_test_server().await;

  // Step 1: challenge
  let challenge_res = server.post("/auth/challenge").await;
  challenge_res.assert_status_ok();
  let challenge = challenge_res.json::<serde_json::Value>();
  let challenge_id = challenge["challenge_id"].as_str().unwrap().to_string();
  let nonce_b64 = challenge["nonce"].as_str().unwrap().to_string();

  // Step 2: client-side HMAC over the nonce with PBKDF2(password)
  let nonce_bytes = crypto::from_base64(&nonce_b64).expect("base64 nonce");
  let mut key_material = [0u8; 32];
  key_material.copy_from_slice(&nonce_bytes);
  let _ = key_material; // nonce is exactly the HMAC input
  let derived = crypto::derive_key(
    &std::env::var("UNSAFE_LOCAL_USER_PASSWORD").unwrap(),
  );
  let hmac = crypto::to_base64(&crypto::compute_hmac(&derived, &nonce_bytes));

  // Step 3: verify — wrong-password proof must be rejected first
  let other_key = crypto::derive_key("definitely-not-the-password");
  let bad_hmac =
    crypto::to_base64(&crypto::compute_hmac(&other_key, &nonce_bytes));
  server
    .post("/auth/verify")
    .json(&serde_json::json!({ "challenge_id": challenge_id, "hmac": bad_hmac }))
    .await
    .assert_status_unauthorized();

  // The failed attempt consumed the challenge; request a fresh one.
  let challenge_res = server.post("/auth/challenge").await;
  challenge_res.assert_status_ok();
  let challenge = challenge_res.json::<serde_json::Value>();
  let challenge_id = challenge["challenge_id"].as_str().unwrap().to_string();
  let nonce_bytes =
    crypto::from_base64(challenge["nonce"].as_str().unwrap()).unwrap();
  let hmac = crypto::to_base64(&crypto::compute_hmac(&derived, &nonce_bytes));

  // Step 4: correct proof issues a session token that authenticates requests.
  let verify_res = server
    .post("/auth/verify")
    .json(&serde_json::json!({ "challenge_id": challenge_id, "hmac": hmac }))
    .await;
  verify_res.assert_status_ok();
  let token = verify_res.json::<serde_json::Value>()["token"]
    .as_str()
    .unwrap()
    .to_string();

  let response = server
    .get("/api/towers/bounds")
    .add_header(
      axum::http::header::AUTHORIZATION,
      axum::http::HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    )
    .await;
  assert_ne!(response.status_code(), axum::http::StatusCode::UNAUTHORIZED);

  // Sanity: the session store really issued this token against live Redis.
  assert!(state.session_store.validate(&token).await.is_some());
}

/// Session lifecycle (#4): validate returns the exact per-session AES key
/// material stored at create time, revoke invalidates it, and revocation is
/// idempotent for well-formed tokens.
#[tokio::test]
#[serial]
async fn test_session_lifecycle_roundtrip_and_revoke() {
  let (_server, state, _url, _guard) = setup_test_server().await;

  let session_key = [9u8; 32];
  let token = state
    .session_store
    .create_session(session_key)
    .await
    .expect("test Redis must be available");

  let session = state
    .session_store.validate(&token)
    .await
    .expect("fresh session must validate");
  assert_eq!(
    session.encryption_key,
    session_key.to_vec(),
    "validate must return the same per-session AES key material"
  );

  state.session_store.revoke(&token).await.expect("revoke ok");
  assert!(
    state.session_store.validate(&token).await.is_none(),
    "revoked session must no longer validate"
  );
  state
    .session_store.revoke(&token)
    .await
    .expect("re-revoking a well-formed deleted token stays Ok (idempotent DEL)");
}

/// Pins the current at-rest representation (#4): sessions are stored as
/// plaintext JSON containing the `encryption_key` field. If this ever moves
/// to encrypted-at-rest or memory-only keys, this test fails on purpose so
/// the trade-off is chosen consciously.
#[tokio::test]
#[serial]
async fn test_session_key_material_stored_in_redis_json() {
  let (_server, state, redis_url, _guard) = setup_test_server().await;

  let session_key = [42u8; 32];
  let token = state
    .session_store
    .create_session(session_key)
    .await
    .expect("test Redis must be available");

  let client = redis::Client::open(redis_url.as_str()).unwrap();
  let mut conn = client
    .get_multiplexed_async_connection()
    .await
    .unwrap();
  redis::cmd("SELECT").arg(1).query_async::<()>(&mut conn).await.unwrap();

  let raw: Option<String> = redis::cmd("GET")
    .arg(format!("session:{}", token))
    .query_async(&mut conn)
    .await
    .unwrap();
  let raw = raw.expect("session blob must exist in Redis DB 1");

  let parsed: serde_json::Value = serde_json::from_str(&raw).expect("blob is JSON");
  let stored_key = parsed["encryption_key"]
    .as_array()
    .expect("encryption_key serialized as byte array")
    .iter()
    .map(|v| v.as_u64().unwrap() as u8)
    .collect::<Vec<u8>>();
  assert_eq!(stored_key, session_key.to_vec());
}

/// Vault-key accepts the preferred Authorization header form (#5).
#[tokio::test]
#[serial]
async fn test_vault_key_accepts_bearer_header() {
  let (server, state, _url, _guard) = setup_test_server().await;

  let token = state
    .session_store
    .create_session([0u8; 32])
    .await
    .expect("test Redis must be available");

  let response = server
    .get("/auth/vault-key")
    .add_header(
      axum::http::header::AUTHORIZATION,
      axum::http::HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    )
    .await;
  response.assert_status_ok();

  let json = response.json::<serde_json::Value>();
  assert_eq!(
    json["vault_key"].as_str().unwrap(),
    crypto::to_base64(&state.shared.encryption_key),
    "header-based vault-key must return the same password-derived key"
  );
}

/// Vault-key without any token must be rejected.
#[tokio::test]
#[serial]
async fn test_vault_key_without_token_denied() {
  let (server, _, _url, _guard) = setup_test_server().await;
  server.get("/auth/vault-key").await.assert_status_unauthorized();
}

/// Protected endpoints still accept the legacy query-token form (#5) — the
/// documented fallback used by direct-download links and older clients.
#[tokio::test]
#[serial]
async fn test_protected_endpoint_accepts_query_token() {
  let (server, state, _url, _guard) = setup_test_server().await;

  let token = state
    .session_store
    .create_session([0u8; 32])
    .await
    .expect("test Redis must be available");

  let response = server
    .get(&format!("/api/towers/bounds?token={}", token))
    .await;
  assert_ne!(response.status_code(), axum::http::StatusCode::UNAUTHORIZED);
}
