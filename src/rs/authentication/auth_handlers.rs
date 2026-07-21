use axum::extract::{Query, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect};
use axum::Json;
use log::{error, info, warn};
use std::sync::Arc;
use webauthn_rs::prelude::*;

use crate::crypto;

use crate::server::types::{
  AuthSessionRequest, AuthVerifyRequest, LogoutParams,
  PasskeyAuthFinishRequest, PasskeyRegisterFinishRequest,
};
use uuid::Uuid;

/// GET /auth/info — returns whether passkeys are registered (so frontend
/// knows whether to show passkey button vs password-only).
pub async fn auth_info_handler(
  State(state): State<Arc<crate::server::AppState>>,
) -> impl IntoResponse {
  let has_passkeys = state.credential_store.has_passkeys();
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
    info!("Revoking session token: {}…", &token[..token.len().min(8)]);
    state.session_store.revoke(&token).await;
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
  if let Err(e) = state.shared.store_challenge(&challenge_id, nonce) {
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
  let nonce = state.shared.take_challenge(&body.challenge_id);

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
  let token = state.session_store.create_session(session_key).await;
  info!("Password authentication successful, session created");

  (
    StatusCode::OK,
    Json(serde_json::json!({
      "token": token,
      "expires_in": 86400,
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
  pub token: String,
}

/// GET /auth/vault-key — returns the password-derived vault key used for file
/// encryption/decryption in this local environment.
pub async fn auth_vault_key_handler(
  State(state): State<Arc<crate::server::AppState>>,
  axum::extract::Query(query): axum::extract::Query<VaultKeyQuery>,
) -> impl IntoResponse {
  match state.session_store.validate(&query.token).await {
    Some(_session) => {
      info!("Vault key requested and session validated");
      (
        StatusCode::OK,
        Json(crate::server::types::VaultKeyResponse {
          vault_key: crypto::to_base64(&state.shared.encryption_key),
        }),
      )
        .into_response()
    }
    None => (
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
  let existing_keys = state.credential_store.get_passkeys();
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
      state
        .pending_passkey_registrations
        .lock()
        .expect("passkey registration state poisoned")
        .insert(challenge_id.clone(), reg_state);

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
  let reg_state: PasskeyRegistration = match state
    .pending_passkey_registrations
    .lock()
    .expect("passkey registration state poisoned")
    .remove(&body.challenge_id)
  {
    Some(s) => s,
    None => {
      return (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
          "error": "invalid_challenge",
        })),
      );
    }
  };

  match state
    .webauthn
    .finish_passkey_registration(&body.credential, &reg_state)
  {
    Ok(passkey) => {
      if let Err(e) = state.credential_store.add_passkey(passkey) {
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
  let existing_keys = state.credential_store.get_passkeys();
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
      state
        .pending_passkey_authentications
        .lock()
        .expect("passkey auth state poisoned")
        .insert(challenge_id.clone(), auth_state);

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
  let auth_state: PasskeyAuthentication = match state
    .pending_passkey_authentications
    .lock()
    .expect("passkey auth state poisoned")
    .remove(&body.challenge_id)
  {
    Some(s) => s,
    None => {
      return (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
          "error": "invalid_challenge",
        })),
      );
    }
  };

  match state
    .webauthn
    .finish_passkey_authentication(&body.credential, &auth_state)
  {
    Ok(_auth_result) => {
      // Authentication successful — create session with a unique key
      let session_key = crate::crypto::generate_nonce();
      let token = state.session_store.create_session(session_key).await;
      info!("Passkey authentication successful, session created");

      (
        StatusCode::OK,
        Json(serde_json::json!({
          "token": token,
          "expires_in": 86400,
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
