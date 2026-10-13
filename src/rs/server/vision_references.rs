//! Immutable encrypted vision references. Raw I/Q stays in the capture store.

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn pair() -> serde_json::Value {
    json!({"version": 1, "config": {"trialId": "trial-1"},
      "artifact": {"jobId": "ref_vision_1", "filename": "capture.iq", "checksum": "a".repeat(64)},
      "timeline": [], "status": "incomplete", "reasons": ["gap"]})
  }

  #[test]
  fn vision_reference_identity_is_bounded_and_bound_to_capture() {
    assert!(validate_reference("trial-1", &pair()).is_ok());
    assert!(validate_reference("other", &pair()).is_err());
    assert!(validate_reference("../trial-1", &pair()).is_err());
    let mut value = pair();
    value["artifact"]["filename"] = json!("../capture.iq");
    assert!(validate_reference("trial-1", &value).is_err());
    value = pair();
    value["version"] = json!(2);
    assert!(validate_reference("trial-1", &value).is_err());
  }

  #[test]
  fn vision_reference_encryption_roundtrips_and_rejects_tampering() {
    let value = pair();
    let key = [7; 32];
    let a = seal(&value, &key).unwrap();
    let b = seal(&value, &key).unwrap();
    assert_ne!(a.salt, b.salt);
    assert_ne!(a.envelope, b.envelope);
    assert!(!a.envelope.contains("trial-1"));
    assert_eq!(open(&a, &key).unwrap(), value);
    assert!(open(&a, &[8; 32]).is_err());
    let mut wrong = a;
    wrong.salt[0] ^= 1;
    assert!(open(&wrong, &key).is_err());
  }

  #[test]
  fn vision_reference_requires_encrypted_native_iq() {
    let mut header = [0u8; 40];
    header[..8].copy_from_slice(b"NAPT-IQ3");
    assert!(!encrypted_iq_header(&header));
    header[32] = 1;
    assert!(encrypted_iq_header(&header));
    header[0] = 0;
    assert!(!encrypted_iq_header(&header));
  }
}

use axum::{
  body::Bytes,
  extract::{Path, State},
  http::StatusCode,
  response::{IntoResponse, Response},
  Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::AsyncReadExt;

const MAX_REFERENCE_BYTES: usize = 1_048_576;

#[derive(Serialize, Deserialize)]
struct SealedReference {
  // One atomic, non-expiring Redis record holds salt and ciphertext together.
  salt: [u8; 32],
  envelope: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactReference {
  job_id: String,
  filename: String,
  checksum: String,
}

fn safe_id(value: &str) -> bool {
  !value.is_empty()
    && value.len() <= 96
    && value
      .bytes()
      .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

// Storage validation is deliberately separate from training eligibility. The
// frontend's versioned schema and dataset checks must also run after retrieval.
fn validate_reference(
  id: &str,
  value: &Value,
) -> Result<ArtifactReference, ()> {
  if !safe_id(id)
    || value["version"].as_u64() != Some(1)
    || value["config"]["trialId"].as_str() != Some(id)
    || !matches!(value["status"].as_str(), Some("complete" | "incomplete"))
    || value["timeline"]
      .as_array()
      .is_none_or(|events| events.len() > 600)
  {
    return Err(());
  }
  let artifact: ArtifactReference =
    serde_json::from_value(value["artifact"].clone()).map_err(|_| ())?;
  if !safe_id(&artifact.job_id)
    || artifact.filename.is_empty()
    || artifact.filename.len() > 200
    || !artifact
      .filename
      .bytes()
      .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
    || artifact.checksum.len() != 64
    || !artifact
      .checksum
      .bytes()
      .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
  {
    return Err(());
  }
  Ok(artifact)
}

fn seal(value: &Value, key: &[u8; 32]) -> Result<SealedReference, ()> {
  let bytes = serde_json::to_vec(value).map_err(|_| ())?;
  let (envelope, salt) =
    crate::crypto::encrypt_capture_envelope(key, &bytes).map_err(|_| ())?;
  Ok(SealedReference {
    salt,
    envelope: crate::crypto::to_base64(&envelope),
  })
}

fn open(record: &SealedReference, key: &[u8; 32]) -> Result<Value, ()> {
  let envelope =
    crate::crypto::from_base64(&record.envelope).map_err(|_| ())?;
  let bytes = crate::crypto::decrypt_capture_envelope_with_salt(
    key,
    &envelope,
    &record.salt,
  )
  .map_err(|_| ())?;
  serde_json::from_slice(&bytes).map_err(|_| ())
}

fn encrypted_iq_header(header: &[u8]) -> bool {
  header.len() >= 40 && &header[..8] == b"NAPT-IQ3" && header[32] == 1
}

fn error(status: StatusCode, message: &'static str) -> Response {
  (status, Json(serde_json::json!({"error": message}))).into_response()
}

/// Authenticated POST. The reference is immutable; identical retries succeed.
/// I/Q is referenced by registered filename/checksum, never by client file path.
pub async fn save_reference(
  Path(id): Path<String>,
  State(state): State<Arc<super::AppState>>,
  body: Bytes,
) -> Response {
  if body.len() > MAX_REFERENCE_BYTES {
    return error(StatusCode::PAYLOAD_TOO_LARGE, "Reference too large");
  }
  let value: Value = match serde_json::from_slice(&body) {
    Ok(value) => value,
    Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid reference JSON"),
  };
  let reference = match validate_reference(&id, &value) {
    Ok(reference) => reference,
    Err(_) => {
      return error(
        StatusCode::BAD_REQUEST,
        "Invalid reference identity or version",
      )
    }
  };
  let artifacts: Vec<super::types::CaptureArtifact> = match state
    .shared
    .redis_store
    .get_json(1, &format!("artifacts:{}", reference.job_id))
    .await
  {
    Ok(Some(artifacts)) => artifacts,
    Ok(None) => {
      match crate::capture::storage::read_job_manifest(&reference.job_id) {
        Ok(Some(artifacts)) => artifacts,
        Ok(None) => {
          return error(StatusCode::CONFLICT, "Capture has not completed")
        }
        Err(_) => {
          return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Capture metadata unavailable",
          )
        }
      }
    }
    Err(_) => {
      return error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Capture metadata unavailable",
      )
    }
  };
  let Some(artifact) = artifacts.iter().find(|artifact| {
    artifact.filename == reference.filename
      && artifact.checksum == reference.checksum
  }) else {
    return error(
      StatusCode::CONFLICT,
      "Reference does not match a completed capture",
    );
  };
  let mut file = match tokio::fs::File::open(&artifact.path).await {
    Ok(file) => file,
    Err(_) => return error(StatusCode::CONFLICT, "Capture file unavailable"),
  };
  let mut header = [0u8; 40];
  if file.read_exact(&mut header).await.is_err()
    || !encrypted_iq_header(&header)
  {
    return error(
      StatusCode::CONFLICT,
      "Vision references require encrypted native I/Q",
    );
  }
  let key = format!("vision:reference:v1:{id}");
  let record = match seal(&value, &state.shared.encryption_key)
    .and_then(|record| serde_json::to_string(&record).map_err(|_| ()))
  {
    Ok(record) => record,
    Err(_) => {
      return error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Reference encryption failed",
      )
    }
  };
  match state
    .shared
    .redis_store
    .set_string_if_absent(1, &key, &record)
    .await
  {
    Ok(true) => StatusCode::CREATED.into_response(),
    Ok(false) => {
      let existing = state
        .shared
        .redis_store
        .get_json::<SealedReference>(1, &key)
        .await;
      match existing {
        Ok(Some(record)) => match open(&record, &state.shared.encryption_key) {
          Ok(previous) if previous == value => {
            StatusCode::NO_CONTENT.into_response()
          }
          Ok(_) => error(
            StatusCode::CONFLICT,
            "Reference is immutable; use a new trial ID",
          ),
          Err(_) => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Reference cannot be decrypted",
          ),
        },
        _ => error(
          StatusCode::SERVICE_UNAVAILABLE,
          "Reference storage unavailable",
        ),
      }
    }
    Err(_) => error(
      StatusCode::SERVICE_UNAVAILABLE,
      "Reference storage unavailable",
    ),
  }
}

/// Authenticated GET returns no encryption key or salt and forbids caching.
pub async fn load_reference(
  Path(id): Path<String>,
  State(state): State<Arc<super::AppState>>,
) -> Response {
  if !safe_id(&id) {
    return error(StatusCode::BAD_REQUEST, "Invalid trial ID");
  }
  match state
    .shared
    .redis_store
    .get_json::<SealedReference>(1, &format!("vision:reference:v1:{id}"))
    .await
  {
    Ok(Some(record)) => match open(&record, &state.shared.encryption_key) {
      Ok(value) if validate_reference(&id, &value).is_ok() => (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(value),
      )
        .into_response(),
      _ => error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Reference cannot be decrypted",
      ),
    },
    Ok(None) => error(StatusCode::NOT_FOUND, "Reference not found"),
    Err(_) => error(
      StatusCode::SERVICE_UNAVAILABLE,
      "Reference storage unavailable",
    ),
  }
}
