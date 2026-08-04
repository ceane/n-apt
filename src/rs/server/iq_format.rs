use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 8] = b"NAPT-IQ3";
const HEADER_SIZE: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IqMetadata {
  pub format: String,
  pub format_version: u16,
  pub interleaving: String,
  pub sample_encoding: SampleEncoding,
  #[serde(flatten)]
  pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SampleEncoding {
  pub element_type: String,
  pub bits_per_element: u8,
  pub signed: bool,
  pub byte_order: String,
  pub normalization: String,
}

impl Default for IqMetadata {
  fn default() -> Self {
    Self {
      format: "iq".into(),
      format_version: 3,
      interleaving: "IQ".into(),
      sample_encoding: SampleEncoding {
        element_type: "integer".into(),
        bits_per_element: 8,
        signed: false,
        byte_order: "little".into(),
        normalization: "(value - 128) / 127".into(),
      },
      fields: serde_json::Map::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameUpdate {
  pub sample_offset: u64,
  pub timestamp_us: u64,
  pub patch: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IqChunk {
  pub sample_offset: u64,
  pub channel: u32,
  pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IqFile {
  pub metadata: IqMetadata,
  pub private_metadata: Option<serde_json::Value>,
  pub frames: Vec<FrameUpdate>,
  pub chunks: Vec<IqChunk>,
}

pub fn encode(
  file: &IqFile,
  key: Option<&[u8; 32]>,
) -> Result<Vec<u8>, String> {
  if file.metadata.interleaving != "IQ" {
    return Err(format!(
      "unsupported interleaving: {}",
      file.metadata.interleaving
    ));
  }
  if file.private_metadata.is_some() && key.is_none() {
    return Err("private metadata requires encryption".into());
  }
  let metadata =
    serde_json::to_vec(&file.metadata).map_err(|e| e.to_string())?;
  let frames = serde_json::to_vec(&file.frames).map_err(|e| e.to_string())?;
  let mut payload = Vec::new();
  if let Some(private) = &file.private_metadata {
    let bytes = serde_json::to_vec(private).map_err(|e| e.to_string())?;
    payload.extend_from_slice(b"PMD3");
    payload.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    payload.extend_from_slice(&bytes);
  }
  for chunk in &file.chunks {
    payload.extend_from_slice(&chunk.sample_offset.to_le_bytes());
    payload.extend_from_slice(&chunk.channel.to_le_bytes());
    payload.extend_from_slice(&(chunk.data.len() as u64).to_le_bytes());
    payload.extend_from_slice(&chunk.data);
  }
  if let Some(key) = key {
    payload = crate::crypto::encrypt_payload_binary(key, &payload)
      .map_err(|e| format!("IQ encryption failed: {e}"))?;
  }
  let header_len = HEADER_SIZE + metadata.len() + frames.len();
  let mut out = Vec::with_capacity(header_len + payload.len());
  out.extend_from_slice(MAGIC);
  out.extend_from_slice(&(metadata.len() as u64).to_le_bytes());
  out.extend_from_slice(&(frames.len() as u64).to_le_bytes());
  out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
  out.extend_from_slice(&[u8::from(key.is_some())]);
  out.extend_from_slice(&[0; 7]);
  out.extend_from_slice(&metadata);
  out.extend_from_slice(&frames);
  out.extend_from_slice(&payload);
  Ok(out)
}

pub fn decode(bytes: &[u8], key: Option<&[u8; 32]>) -> Result<IqFile, String> {
  if bytes.len() < HEADER_SIZE || &bytes[..8] != MAGIC {
    return Err("invalid IQ v3 header".into());
  }
  let read_u64 = |start: usize| -> Result<u64, String> {
    bytes
      .get(start..start + 8)
      .ok_or("truncated IQ header".into())
      .map(|v| u64::from_le_bytes(v.try_into().unwrap()))
  };
  let metadata_len = read_u64(8)? as usize;
  let frames_len = read_u64(16)? as usize;
  let payload_len = read_u64(24)? as usize;
  let encrypted = bytes[32] != 0;
  let metadata_start = HEADER_SIZE;
  let frames_start = metadata_start + metadata_len;
  let payload_start = frames_start + frames_len;
  if payload_start + payload_len > bytes.len() {
    return Err("truncated IQ payload".into());
  }
  let metadata: IqMetadata =
    serde_json::from_slice(&bytes[metadata_start..frames_start])
      .map_err(|e| e.to_string())?;
  if metadata.interleaving != "IQ" {
    return Err(format!(
      "unsupported interleaving: {}",
      metadata.interleaving
    ));
  }
  let frames: Vec<FrameUpdate> =
    serde_json::from_slice(&bytes[frames_start..payload_start])
      .map_err(|e| e.to_string())?;
  let mut payload = bytes[payload_start..payload_start + payload_len].to_vec();
  if encrypted {
    let key = key.ok_or("IQ file is encrypted")?;
    payload = crate::crypto::decrypt_payload_binary(key, &payload)
      .map_err(|e| format!("IQ decryption failed: {e}"))?;
  }
  let mut chunks = Vec::new();
  let mut private_metadata = None;
  let mut offset = 0;
  while offset < payload.len() {
    if payload.len() - offset >= 12 && &payload[offset..offset + 4] == b"PMD3" {
      let len = u64::from_le_bytes(
        payload[offset + 4..offset + 12].try_into().unwrap(),
      ) as usize;
      offset += 12;
      if offset + len > payload.len() {
        return Err("truncated private metadata".into());
      }
      private_metadata = Some(
        serde_json::from_slice(&payload[offset..offset + len])
          .map_err(|e| e.to_string())?,
      );
      offset += len;
      continue;
    }
    if offset + 20 > payload.len() {
      return Err("truncated IQ chunk".into());
    }
    let sample_offset =
      u64::from_le_bytes(payload[offset..offset + 8].try_into().unwrap());
    let channel =
      u32::from_le_bytes(payload[offset + 8..offset + 12].try_into().unwrap());
    let len =
      u64::from_le_bytes(payload[offset + 12..offset + 20].try_into().unwrap())
        as usize;
    offset += 20;
    if offset + len > payload.len() {
      return Err("truncated IQ chunk data".into());
    }
    chunks.push(IqChunk {
      sample_offset,
      channel,
      data: payload[offset..offset + len].to_vec(),
    });
    offset += len;
  }
  Ok(IqFile {
    metadata,
    private_metadata,
    frames,
    chunks,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn round_trips_chunked_iq_with_sparse_updates() {
    let file = IqFile {
      metadata: IqMetadata::default(),
      private_metadata: Some(
        serde_json::json!({"serial_number": "trusted-only"}),
      ),
      frames: vec![FrameUpdate {
        sample_offset: 4,
        timestamp_us: 25,
        patch: serde_json::json!({"center_frequency_hz": 137500000}),
      }],
      chunks: vec![IqChunk {
        sample_offset: 0,
        channel: 0,
        data: vec![1, 2, 3, 4],
      }],
    };
    let key = [7u8; 32];
    let encoded = encode(&file, Some(&key)).unwrap();
    let decoded = decode(&encoded, Some(&key)).unwrap();
    assert_eq!(decoded.metadata.format, "iq");
    assert_eq!(decoded.metadata.format_version, 3);
    assert_eq!(decoded.metadata.interleaving, "IQ");
    assert_eq!(decoded.private_metadata, file.private_metadata);
    assert_eq!(decoded.frames, file.frames);
    assert_eq!(decoded.chunks, file.chunks);
  }

  #[test]
  fn rejects_unknown_interleaving() {
    let mut metadata = IqMetadata::default();
    metadata.interleaving = "QI".into();
    let err = encode(
      &IqFile {
        metadata,
        private_metadata: None,
        frames: vec![],
        chunks: vec![],
      },
      None,
    )
    .unwrap_err();
    assert!(err.contains("interleaving"));
  }
}
