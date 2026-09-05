use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect};
use axum::Json;
use log::{error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use webauthn_rs::prelude::*;

use crate::crypto;

use crate::server::types::{
  AuthSessionRequest, AuthVerifyRequest, LogoutParams,
  PasskeyAuthFinishRequest, PasskeyRegisterFinishRequest,
};
use uuid::Uuid;

// NOTE (known security flaw, accepted for local deployments): the /auth/*
// endpoints have no rate limiting. N-APT is designed to run on localhost /
// trusted LANs where per-IP throttling is not meaningful; if this server is
// ever exposed publicly, add rate limiting to /auth/challenge, /auth/verify,
// /auth/passkey/register/* and /auth/passkey/auth/* before doing so — they
// are unauthenticated and each request performs Redis or WebAuthn work.

/// Abandoned passkey challenges expire after this long. Both start endpoints
/// are unauthenticated, so without an expiry + cap the pending-state maps
/// accumulate entries for the lifetime of the process.
const PENDING_PASSKEY_TTL: std::time::Duration =
  std::time::Duration::from_secs(300);
const PENDING_PASSKEY_MAX_ENTRIES: usize = 64;

type PendingPasskeyState<T> = HashMap<String, (std::time::Instant, T)>;

fn insert_pending_passkey_state<T>(
  map: &mut PendingPasskeyState<T>,
  challenge_id: String,
  value: T,
) {
  let now = std::time::Instant::now();
  map.retain(|_, (created_at, _)| {
    now.duration_since(*created_at) < PENDING_PASSKEY_TTL
  });
  if map.len() >= PENDING_PASSKEY_MAX_ENTRIES {
    // Evict the oldest entries to make room.
    let mut entries: Vec<(std::time::Instant, String)> = map
      .iter()
      .map(|(key, (created_at, _))| (*created_at, key.clone()))
      .collect();
    entries.sort();
    let excess = map.len() + 1 - PENDING_PASSKEY_MAX_ENTRIES;
    for (_, key) in entries.into_iter().take(excess) {
      map.remove(&key);
    }
  }
  map.insert(challenge_id, (now, value));
}

fn take_pending_passkey_state<T>(
  map: &mut PendingPasskeyState<T>,
  challenge_id: &str,
) -> Option<T> {
  let (created_at, value) = map.remove(challenge_id)?;
  if std::time::Instant::now().duration_since(created_at) >= PENDING_PASSKEY_TTL
  {
    warn!("Expired pending passkey challenge rejected");
    return None;
  }
  Some(value)
}

/// GET /auth/info — returns whether passkeys are registered (so frontend
/// knows whether to show passkey button vs password-only).
pub async fn auth_info_handler(
  State(state): State<Arc<crate::server::AppState>>,
) -> impl IntoResponse {
  let has_passkeys = state.credential_store.has_passkeys().await;
  Json(serde_json::json!({
    "has_passkeys": has_passkeys,
  }))
}

/// GET /auth/logout — clear site data and redirect to login.
/// Optionally revokes the provided session token in Redis.
pub async fn auth_logout_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Query(params): Query<LogoutParams>,
) -> impl IntoResponse {
  if let Some(token) = params.token {
    info!(
      "Revoking session token: {}…",
      token.get(..8).unwrap_or(&token)
    );
    // Fail closed: if the session cannot be revoked server-side, the client
    // must not be told it logged out while the token remains valid.
    if let Err(error) = state.session_store.revoke(&token).await {
      error!("Logout failed to revoke session: {error}");
      return (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({
          "error": "logout_failed",
          "message": "Session could not be revoked; please try again",
        })),
      )
        .into_response();
    }
  }

  info!("Logout requested, clearing site data and redirecting");
  let mut response = Redirect::to("/").into_response();

  // Clear-Site-Data: "cache", "cookies", "storage", "executionContexts"
  // This ensures all local storage, cookies, and cache are wiped on the client.
  response.headers_mut().insert(
    HeaderName::from_static("clear-site-data"),
    HeaderValue::from_static(
      "\"cache\", \"cookies\", \"storage\", \"executionContexts\"",
    ),
  );

  response
}

/// POST /auth/challenge — generate a nonce for password-based auth.
pub async fn auth_challenge_handler(
  State(state): State<Arc<crate::server::AppState>>,
) -> impl IntoResponse {
  let nonce = crypto::generate_nonce();
  let nonce_b64 = crypto::to_base64(&nonce);

  // Store the nonce temporarily in Redis (short-lived, 60s)
  let challenge_id = Uuid::new_v4().to_string();
  if let Err(e) = state
    .shared
    .redis_store
    .store_challenge(&challenge_id, nonce)
    .await
  {
    error!("Failed to store challenge in Redis: {}", e);
    return (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(serde_json::json!({ "error": "redis_error" })),
    )
      .into_response();
  }

  (
    StatusCode::OK,
    Json(serde_json::json!({
      "challenge_id": challenge_id,
      "nonce": nonce_b64,
    })),
  )
    .into_response()
}

/// POST /auth/verify — verify password-based HMAC response, return session token.
pub async fn auth_verify_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Json(body): Json<AuthVerifyRequest>,
) -> impl IntoResponse {
  // Look up the challenge nonce from Redis
  let nonce = match state
    .shared
    .redis_store
    .take_challenge(&body.challenge_id)
    .await
  {
    Ok(nonce) => nonce,
    Err(error) => {
      error!("Failed to consume auth challenge from Redis: {error}");
      return (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({
          "error": "redis_unavailable",
          "message": "Authentication storage is temporarily unavailable",
        })),
      )
        .into_response();
    }
  };

  let Some(nonce_bytes) = nonce else {
    return (
      StatusCode::UNAUTHORIZED,
      Json(serde_json::json!({
        "error": "invalid_challenge",
        "message": "Challenge not found or expired",
      })),
    )
      .into_response();
  };

  // Verify HMAC
  let client_hmac = match crypto::from_base64(&body.hmac) {
    Ok(h) => h,
    Err(_) => {
      return (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
          "error": "invalid_hmac",
          "message": "Invalid HMAC encoding",
        })),
      )
        .into_response();
    }
  };

  if !crypto::verify_hmac(
    &state.shared.encryption_key,
    &nonce_bytes,
    &client_hmac,
  ) {
    warn!("Password auth failed: invalid HMAC");
    return (
      StatusCode::UNAUTHORIZED,
      Json(serde_json::json!({
        "error": "auth_failed",
        "message": "Invalid passkey",
      })),
    )
      .into_response();
  }

  // Authentication successful — create session with a unique key
  let session_key = crate::crypto::generate_nonce(); // 32 random bytes
  let token = match state.session_store.create_session(session_key).await {
    Ok(token) => token,
    Err(error) => {
      error!("Failed to persist password-auth session: {error}");
      return (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({
          "error": "redis_unavailable",
          "message": "Session storage is temporarily unavailable",
        })),
      )
        .into_response();
    }
  };
  info!("Password authentication successful, session created");

  (
    StatusCode::OK,
    Json(serde_json::json!({
      "token": token,
      "expires_in": crate::session::SESSION_TTL_SECS,
    })),
  )
    .into_response()
}

/// POST /auth/session — validate an existing session token.
pub async fn auth_session_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Json(body): Json<AuthSessionRequest>,
) -> impl IntoResponse {
  match state.session_store.validate(&body.token).await {
    Some(_session) => {
      info!("Session token validated successfully");
      (
        StatusCode::OK,
        Json(serde_json::json!({
          "valid": true,
          "token": body.token,
        })),
      )
    }
    None => (
      StatusCode::UNAUTHORIZED,
      Json(serde_json::json!({
        "valid": false,
        "error": "session_expired",
      })),
    ),
  }
}

#[derive(serde::Deserialize)]
pub struct VaultKeyQuery {
  pub token: Option<String>,
}

/// GET /auth/vault-key — returns the password-derived vault key used for file
/// encryption/decryption in this local environment.
pub async fn auth_vault_key_handler(
  State(state): State<Arc<crate::server::AppState>>,
  headers: HeaderMap,
  axum::extract::Query(query): axum::extract::Query<VaultKeyQuery>,
) -> impl IntoResponse {
  let token = headers
    .get(axum::http::header::AUTHORIZATION)
    .and_then(|header| header.to_str().ok())
    .and_then(|header| header.strip_prefix("Bearer "))
    .filter(|token| !token.is_empty())
    .map(str::to_owned)
    .or(query.token);

  match token {
    Some(token) if state.session_store.validate(&token).await.is_some() => {
      info!("Vault key requested and session validated");
      (
        StatusCode::OK,
        Json(crate::server::types::VaultKeyResponse {
          vault_key: crypto::to_base64(&state.shared.encryption_key),
        }),
      )
        .into_response()
    }
    _ => (
      StatusCode::UNAUTHORIZED,
      Json(serde_json::json!({
        "error": "session_expired",
        "message": "Invalid or expired session token",
      })),
    )
      .into_response(),
  }
}

/// POST /auth/passkey/register/start — begin passkey registration.
pub async fn passkey_register_start_handler(
  State(state): State<Arc<crate::server::AppState>>,
) -> impl IntoResponse {
  let user_unique_id = Uuid::new_v4();
  let existing_keys = state.credential_store.get_passkeys().await;
  let exclude_credentials: Vec<CredentialID> =
    existing_keys.iter().map(|k| k.cred_id().clone()).collect();

  match state.webauthn.start_passkey_registration(
    user_unique_id,
    "n-apt-user",
    "N-APT User",
    Some(exclude_credentials),
  ) {
    Ok((ccr, reg_state)) => {
      let challenge_id = Uuid::new_v4().to_string();
      insert_pending_passkey_state(
        &mut state
          .pending_passkey_registrations
          .lock()
          .expect("passkey registration state poisoned"),
        challenge_id.clone(),
        reg_state,
      );

      let ccr_json = serde_json::to_value(&ccr).unwrap_or_else(|e| {
        error!("Failed to serialize CCR: {}", e);
        serde_json::Value::Null
      });
      info!(
        "Sending CCR to client: {}",
        serde_json::to_string_pretty(&ccr_json).unwrap_or_default()
      );

      (
        StatusCode::OK,
        Json(serde_json::json!({
          "challenge_id": challenge_id,
          "options": ccr_json,
        })),
      )
    }
    Err(e) => {
      error!("WebAuthn registration start failed: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
          "error": "webauthn_error",
          "message": format!("{}", e),
        })),
      )
    }
  }
}

/// POST /auth/passkey/register/finish — complete passkey registration.
pub async fn passkey_register_finish_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Json(body): Json<PasskeyRegisterFinishRequest>,
) -> impl IntoResponse {
  let reg_state: Option<PasskeyRegistration> = {
    let mut pending = state
      .pending_passkey_registrations
      .lock()
      .expect("passkey registration state poisoned");
    take_pending_passkey_state(&mut pending, &body.challenge_id)
  };
  let Some(reg_state) = reg_state else {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "invalid_challenge",
      })),
    );
  };

  match state
    .webauthn
    .finish_passkey_registration(&body.credential, &reg_state)
  {
    Ok(passkey) => {
      if let Err(e) = state.credential_store.add_passkey(passkey).await {
        error!("Failed to store passkey: {}", e);
        return (
          StatusCode::INTERNAL_SERVER_ERROR,
          Json(serde_json::json!({
            "error": "storage_error",
          })),
        );
      }
      info!("Passkey registered successfully");
      (
        StatusCode::OK,
        Json(serde_json::json!({
          "success": true,
        })),
      )
    }
    Err(e) => {
      warn!("Passkey registration failed: {}", e);
      (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
          "error": "registration_failed",
          "message": format!("{}", e),
        })),
      )
    }
  }
}

/// POST /auth/passkey/auth/start — begin passkey authentication.
pub async fn passkey_auth_start_handler(
  State(state): State<Arc<crate::server::AppState>>,
) -> impl IntoResponse {
  let existing_keys = state.credential_store.get_passkeys().await;
  if existing_keys.is_empty() {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "no_passkeys",
        "message": "No passkeys registered",
      })),
    );
  }

  match state.webauthn.start_passkey_authentication(&existing_keys) {
    Ok((rcr, auth_state)) => {
      let challenge_id = Uuid::new_v4().to_string();
      insert_pending_passkey_state(
        &mut state
          .pending_passkey_authentications
          .lock()
          .expect("passkey auth state poisoned"),
        challenge_id.clone(),
        auth_state,
      );

      (
        StatusCode::OK,
        Json(serde_json::json!({
          "challenge_id": challenge_id,
          "options": rcr,
        })),
      )
    }
    Err(e) => {
      error!("WebAuthn auth start failed: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
          "error": "webauthn_error",
          "message": format!("{}", e),
        })),
      )
    }
  }
}

/// POST /auth/passkey/auth/finish — complete passkey authentication.
pub async fn passkey_auth_finish_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Json(body): Json<PasskeyAuthFinishRequest>,
) -> impl IntoResponse {
  let auth_state: Option<PasskeyAuthentication> = {
    let mut pending = state
      .pending_passkey_authentications
      .lock()
      .expect("passkey auth state poisoned");
    take_pending_passkey_state(&mut pending, &body.challenge_id)
  };
  let Some(auth_state) = auth_state else {
    return (
      StatusCode::BAD_REQUEST,
      Json(serde_json::json!({
        "error": "invalid_challenge",
      })),
    );
  };

  match state
    .webauthn
    .finish_passkey_authentication(&body.credential, &auth_state)
  {
    Ok(_auth_result) => {
      // Authentication successful — create session with a unique key
      let session_key = crate::crypto::generate_nonce();
      let token = match state.session_store.create_session(session_key).await {
        Ok(token) => token,
        Err(error) => {
          error!("Failed to persist passkey-auth session: {error}");
          return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
              "error": "redis_unavailable",
              "message": "Session storage is temporarily unavailable",
            })),
          );
        }
      };
      info!("Passkey authentication successful, session created");

      (
        StatusCode::OK,
        Json(serde_json::json!({
          "token": token,
          "expires_in": crate::session::SESSION_TTL_SECS,
        })),
      )
    }
    Err(e) => {
      warn!("Passkey authentication failed: {}", e);
      (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
          "error": "auth_failed",
          "message": format!("{}", e),
        })),
      )
    }
  }
}
