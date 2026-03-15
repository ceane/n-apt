use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use log::{error, info, warn};
use std::sync::Arc;
use std::time::Duration;
use webauthn_rs::prelude::*;

use crate::crypto;

use crate::server::types::{
  AuthSessionRequest, AuthVerifyRequest, PasskeyAuthFinishRequest,
  PasskeyRegisterFinishRequest,
};

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

/// POST /auth/challenge — generate a nonce for password-based auth.
pub async fn auth_challenge_handler(
  State(state): State<Arc<crate::server::AppState>>,
) -> impl IntoResponse {
  let nonce = crypto::generate_nonce();
  let nonce_b64 = crypto::to_base64(&nonce);

  // Store the nonce temporarily in a session (short-lived, 60s)
  // We reuse the session store with a special prefix
  let challenge_id = Uuid::new_v4().to_string();
  let mut challenges = state.shared.pending_challenges.lock().unwrap();
  challenges.insert(challenge_id.clone(), (nonce, std::time::Instant::now()));

  Json(serde_json::json!({
    "challenge_id": challenge_id,
    "nonce": nonce_b64,
  }))
}

/// POST /auth/verify — verify password-based HMAC response, return session token.
pub async fn auth_verify_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Json(body): Json<AuthVerifyRequest>,
) -> impl IntoResponse {
  // Look up the challenge nonce
  let nonce = {
    let mut challenges = state.shared.pending_challenges.lock().unwrap();
    challenges.remove(&body.challenge_id)
  };

  let Some((nonce_bytes, created)) = nonce else {
    return (
      StatusCode::UNAUTHORIZED,
      Json(serde_json::json!({
        "error": "invalid_challenge",
        "message": "Challenge not found or expired",
      })),
    );
  };

  // Check challenge age (60s max)
  if created.elapsed() > Duration::from_secs(60) {
    return (
      StatusCode::UNAUTHORIZED,
      Json(serde_json::json!({
        "error": "challenge_expired",
        "message": "Challenge has expired",
      })),
    );
  }

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
      );
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
    );
  }

  // Authentication successful — create session
  let token = state
    .session_store
    .create_session(state.shared.encryption_key);
  info!("Password authentication successful, session created");

  (
    StatusCode::OK,
    Json(serde_json::json!({
      "token": token,
      "expires_in": 86400,
    })),
  )
}

/// POST /auth/session — validate an existing session token.
pub async fn auth_session_handler(
  State(state): State<Arc<crate::server::AppState>>,
  Json(body): Json<AuthSessionRequest>,
) -> impl IntoResponse {
  match state.session_store.validate(&body.token) {
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
      // Serialize registration state for later verification
      let state_json = serde_json::to_string(&reg_state).unwrap_or_default();
      if let Err(e) = state
        .credential_store
        .store_pending_registration(&challenge_id, &state_json)
      {
        error!("Failed to store pending registration: {}", e);
        return (
          StatusCode::INTERNAL_SERVER_ERROR,
          Json(serde_json::json!({
            "error": "storage_error",
          })),
        );
      }

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
  let state_json: String = match state
    .credential_store
    .take_pending_registration(&body.challenge_id)
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

  let reg_state: PasskeyRegistration = match serde_json::from_str(&state_json) {
    Ok(s) => s,
    Err(_) => {
      return (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
          "error": "state_corrupt",
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
      let state_json = serde_json::to_string(&auth_state).unwrap_or_default();
      if let Err(e) = state
        .credential_store
        .store_pending_registration(&challenge_id, &state_json)
      {
        error!("Failed to store pending auth state: {}", e);
        return (
          StatusCode::INTERNAL_SERVER_ERROR,
          Json(serde_json::json!({
            "error": "storage_error",
          })),
        );
      }

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
  let state_json: String = match state
    .credential_store
    .take_pending_registration(&body.challenge_id)
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

  let auth_state: PasskeyAuthentication =
    match serde_json::from_str(&state_json) {
      Ok(s) => s,
      Err(_) => {
        return (
          StatusCode::INTERNAL_SERVER_ERROR,
          Json(serde_json::json!({
            "error": "state_corrupt",
          })),
        );
      }
    };

  match state
    .webauthn
    .finish_passkey_authentication(&body.credential, &auth_state)
  {
    Ok(_auth_result) => {
      // Authentication successful — create session
      let token = state
        .session_store
        .create_session(state.shared.encryption_key);
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
