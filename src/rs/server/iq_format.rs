use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 8] = b"NAPT-IQ3";
const HEADER_SIZE: usize = 40;
const TRAILER_MAGIC: &[u8; 8] = b"NAPTTRLR";
const TRAILER_HEADER_SIZE: usize = 24;

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
  pub trailer: Option<serde_json::Value>,
}

pub fn encode(
  file: &IqFile,
  key: Option<&[u8; 32]>,
) -> Result<Vec<u8>, String> {
  encode_versioned(file, key, 4)
}

fn encode_versioned(
  file: &IqFile,
  key: Option<&[u8; 32]>,
  version: u16,
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
  if version < 4 && file.trailer.is_some() {
    return Err("IQ trailers require format version 4".into());
  }
  let mut metadata_obj = file.metadata.clone();
  metadata_obj.format_version = version;
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
  let trailer_json = if version >= 4 {
    serde_json::to_vec(
      &file
        .trailer
        .clone()
        .unwrap_or_else(|| serde_json::json!({})),
    )
    .map_err(|e| e.to_string())?
  } else {
    Vec::new()
  };
  let trailer_len = if version >= 4 {
    TRAILER_HEADER_SIZE + trailer_json.len()
  } else {
    0
  };
  let mut metadata = Vec::new();
  let mut binary_offset = 0usize;
  let mut trailer_offset = 0usize;
  for _ in 0..8 {
    if version >= 4 {
      metadata_obj.fields.insert(
        "sections".into(),
        serde_json::json!({
          "binary": { "offset_bytes": binary_offset, "length_bytes": payload.len(), "encoding": "iq_u8_interleaved", "encrypted": key.is_some() },
          "trailer": { "offset_bytes": trailer_offset, "length_bytes": trailer_len, "encoding": "utf8_json", "version": 1 }
        }),
      );
    }
    metadata = serde_json::to_vec(&metadata_obj).map_err(|e| e.to_string())?;
    let next_binary_offset = HEADER_SIZE + metadata.len() + frames.len();
    let next_trailer_offset = next_binary_offset + payload.len();
    if binary_offset == next_binary_offset
      && trailer_offset == next_trailer_offset
    {
      break;
    }
    binary_offset = next_binary_offset;
    trailer_offset = next_trailer_offset;
  }
  let header_len = HEADER_SIZE + metadata.len() + frames.len();
  let mut out = Vec::with_capacity(header_len + payload.len() + trailer_len);
  out.extend_from_slice(MAGIC);
  out.extend_from_slice(&(metadata.len() as u64).to_le_bytes());
  out.extend_from_slice(&(frames.len() as u64).to_le_bytes());
  out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
  out.extend_from_slice(&[u8::from(key.is_some())]);
  out.extend_from_slice(&[0; 7]);
  out.extend_from_slice(&metadata);
  out.extend_from_slice(&frames);
  out.extend_from_slice(&payload);
  if version >= 4 {
    out.extend_from_slice(TRAILER_MAGIC);
    out.push(1);
    out.extend_from_slice(&[0; 7]);
    out.extend_from_slice(&(trailer_json.len() as u64).to_le_bytes());
    out.extend_from_slice(&trailer_json);
  }
  Ok(out)
}

#[cfg(test)]
fn encode_legacy_v3(
  file: &IqFile,
  key: Option<&[u8; 32]>,
) -> Result<Vec<u8>, String> {
  encode_versioned(file, key, 3)
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
  let trailer = if metadata.format_version >= 4 {
    let sections = metadata
      .fields
      .get("sections")
      .ok_or("missing IQ v4 section index")?;
    let binary = sections.get("binary").ok_or("missing IQ binary section")?;
    let trailer_section = sections
      .get("trailer")
      .ok_or("missing IQ trailer section")?;
    let expected_offset = binary
      .get("offset_bytes")
      .and_then(|value| value.as_u64())
      .ok_or("invalid IQ binary offset")? as usize;
    let expected_length = binary
      .get("length_bytes")
      .and_then(|value| value.as_u64())
      .ok_or("invalid IQ binary length")? as usize;
    if expected_offset != payload_start || expected_length != payload_len {
      return Err("IQ binary section does not match payload".into());
    }
    let trailer_start = payload_start + payload_len;
    let expected_trailer_offset = trailer_section
      .get("offset_bytes")
      .and_then(|value| value.as_u64())
      .ok_or("invalid IQ trailer offset")?
      as usize;
    let expected_trailer_length = trailer_section
      .get("length_bytes")
      .and_then(|value| value.as_u64())
      .ok_or("invalid IQ trailer length")?
      as usize;
    if trailer_start + TRAILER_HEADER_SIZE > bytes.len()
      || &bytes[trailer_start..trailer_start + 8] != TRAILER_MAGIC
    {
      return Err("missing IQ v4 trailer".into());
    }
    let trailer_json_len = u64::from_le_bytes(
      bytes[trailer_start + 16..trailer_start + 24]
        .try_into()
        .unwrap(),
    ) as usize;
    if trailer_start + TRAILER_HEADER_SIZE + trailer_json_len != bytes.len() {
      return Err("invalid IQ trailer length".into());
    }
    if expected_trailer_offset != trailer_start
      || expected_trailer_length != TRAILER_HEADER_SIZE + trailer_json_len
    {
      return Err("IQ trailer section does not match payload".into());
    }
    Some(
      serde_json::from_slice(
        &bytes[trailer_start + TRAILER_HEADER_SIZE
          ..trailer_start + TRAILER_HEADER_SIZE + trailer_json_len],
      )
      .map_err(|e| format!("invalid IQ trailer JSON: {e}"))?,
    )
  } else {
    None
  };
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
    trailer,
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
      trailer: None,
    };
    let key = [7u8; 32];
    let encoded = encode_legacy_v3(&file, Some(&key)).unwrap();
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
        trailer: None,
      },
      None,
    )
    .unwrap_err();
    assert!(err.contains("interleaving"));
  }

  #[test]
  fn v4_round_trips_section_index_and_readable_trailer() {
    let file = IqFile {
      metadata: IqMetadata::default(),
      private_metadata: None,
      frames: vec![],
      chunks: vec![IqChunk {
        sample_offset: 0,
        channel: 0,
        data: vec![1, 2, 3, 4],
      }],
      trailer: Some(serde_json::json!({
        "processing": { "operation": "demod", "algorithm": "fm" },
        "reference": { "location": { "lat": 1.0, "lng": 2.0 } }
      })),
    };

    let encoded = encode(&file, None).expect("encode v4 IQ");
    let decoded = decode(&encoded, None).expect("decode v4 IQ");
    assert_eq!(decoded.metadata.format_version, 4);
    assert_eq!(decoded.chunks[0].data, vec![1, 2, 3, 4]);
    assert_eq!(decoded.trailer, file.trailer);

    let sections = decoded
      .metadata
      .fields
      .get("sections")
      .expect("section index");
    assert!(sections["binary"]["length_bytes"].as_u64().unwrap() > 0);
    assert!(sections["trailer"]["length_bytes"].as_u64().unwrap() > 0);
  }

  #[test]
  fn legacy_v3_iq_without_trailer_still_decodes() {
    let file = IqFile {
      metadata: IqMetadata::default(),
      private_metadata: None,
      frames: vec![],
      chunks: vec![IqChunk {
        sample_offset: 0,
        channel: 0,
        data: vec![9, 8],
      }],
      trailer: None,
    };
    let mut encoded = encode_legacy_v3(&file, None).expect("encode legacy IQ");
    assert_eq!(decode(&encoded, None).unwrap().trailer, None);
    encoded.extend_from_slice(b"legacy trailing bytes");
    assert_eq!(decode(&encoded, None).unwrap().chunks[0].data, vec![9, 8]);
  }
}
