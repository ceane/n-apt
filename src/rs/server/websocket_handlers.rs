use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde_json;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::broadcast;
use validator::Validate;

use crate::crypto;

use super::shared_state::SharedState;
use super::tx_log::{write_global, TxLogEntry};
use super::types::{WebSocketMessage, WsQueryParams};
use super::websocket_server::reconcile_stale_device_snapshot;
use super::websocket_server::{
  active_source_id, broadcast_device_status, broadcast_signal_display_settings,
  build_channels_snapshot, build_source_info_snapshot,
  resolve_stream_key_source_id,
};
use crate::s::ifft::mock_tx_gen::canonical_mock_tx_signal_key;

const MOCK_TX_SOURCE_ID: &str = "mock-tx";

fn normalize_tx_signal(signal_name: Option<&str>) -> String {
  let canonical = canonical_mock_tx_signal_key(signal_name.unwrap_or("wifi"));
  match canonical.as_str() {
    "d" | "d_sharp" | "wifi" | "5g" | "tone" | "noise" | "custom" => canonical,
    _ => "wifi".to_string(),
  }
}

fn is_mock_tx_device_label(device: &str) -> bool {
  let normalized = device.to_ascii_lowercase().replace(['_', '-'], " ");
  normalized == "mock tx"
    || normalized == "mock tx device"
    || normalized == "mock tx sdr"
}

fn apply_mock_tx_preview_settings(
  message: &WebSocketMessage,
  shared: &Arc<SharedState>,
) {
  let mut sdr_settings = shared.sdr_settings.lock().unwrap().clone();
  let previous_bandwidth_hz = *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();

  if let Some(center_frequency) = message.center_frequency {
    let center_hz = center_frequency.round().clamp(1.0, u32::MAX as f64);
    sdr_settings.center_frequency = center_hz as u32;
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = center_hz;
  }

  if let Some(view_center_hz) = message.view_center_hz {
    let view_hz = view_center_hz.round().clamp(1.0, u32::MAX as f64);
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = view_hz;
  }

  if let Some(sample_rate) = message.sample_rate {
    if sample_rate.is_finite() && sample_rate > 0.0 {
      sdr_settings.sample_rate = sample_rate.round() as u32;
    }
  }

  if let Some(bandwidth_hz) = message.bandwidth {
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = bandwidth_hz as f64;
    debug!(
      "mock_tx_preview bandwidth update: previous_bandwidth_hz={previous_bandwidth_hz:.0}, requested_bandwidth_hz={bandwidth_hz:.0}, tx_signal={}, tx_center_hz={:.0}, tx_ifft_size={}",
      crate::safety::TX_SIGNAL.lock().unwrap().as_str(),
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap(),
      *crate::safety::TX_IFFT_SIZE.lock().unwrap(),
    );
  }

  if let Some(power_dbm) = message.power_dbm {
    if power_dbm.is_finite() {
      *crate::safety::TX_POWER_DBM.lock().unwrap() = power_dbm;
    }
  }

  if let Some(tx_ifft_size) = message.tx_ifft_size {
    *crate::safety::TX_IFFT_SIZE.lock().unwrap() = tx_ifft_size;
  }

  if message.tx_signal.is_some() {
    let tx_signal = normalize_tx_signal(message.tx_signal.as_deref());
    *crate::safety::TX_SIGNAL.lock().unwrap() = tx_signal;
  }

  *shared.sdr_settings.lock().unwrap() = sdr_settings;
}

fn is_tx_mode_active_mode(active_mode: Option<&str>) -> bool {
  matches!(
    active_mode
      .map(|mode| mode.trim().to_ascii_lowercase())
      .as_deref(),
    Some("tx") | Some("rx_tx")
  )
}

fn resolve_live_center_frequency(
  min_freq: f64,
  max_freq: f64,
  center_frequency: Option<f64>,
) -> u32 {
  if let Some(center_freq) = center_frequency {
    return center_freq.round() as u32;
  }

  ((min_freq + max_freq) / 2.0).round() as u32
}

fn live_tune_is_out_of_bounds(
  min_freq: f64,
  max_freq: f64,
  available_spectrum: Option<(f64, f64)>,
) -> bool {
  if !min_freq.is_finite() || !max_freq.is_finite() {
    return true;
  }
  if min_freq < 0.0 || max_freq < 0.0 {
    return true;
  }
  if max_freq < min_freq {
    return true;
  }

  if let Some((available_min, available_max)) = available_spectrum {
    min_freq < available_min || max_freq > available_max
  } else {
    false
  }
}

/// GET /ws?token=<session_token> — upgrade to WebSocket after validating session.
pub async fn ws_upgrade_handler(
  ws: WebSocketUpgrade,
  Query(params): Query<WsQueryParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  // Validate session token
  match state.session_store.validate(&params.token).await {
    Some(_) => {}
    None => {
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token")
        .into_response();
    }
  };

  info!("WebSocket upgrade: valid session, starting control stream");

  let shared = state.shared.clone();
  let enc_key = shared.encryption_key;
  let broadcast_tx = state.broadcast_tx.clone();
  let spectrum_tx = state.spectrum_tx.clone();
  let cmd_tx = state.cmd_tx.clone();
  let session_token = params.token.clone();

  ws.on_upgrade(move |socket| {
    handle_ws_connection(
      socket,
      shared,
      broadcast_tx,
      spectrum_tx,
      cmd_tx,
      enc_key,
      session_token,
    )
  })
}

/// GET /ws/source/:streamKey/iq?token=<session_token> — authenticated raw I/Q stream.
pub async fn source_iq_ws_upgrade_handler(
  ws: WebSocketUpgrade,
  Path(stream_key): Path<String>,
  Query(params): Query<WsQueryParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  match state.session_store.validate(&params.token).await {
    Some(_) => {}
    None => {
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token")
        .into_response();
    }
  };

  let Some(source_id) =
    resolve_stream_key_source_id(&state.shared, stream_key.as_str())
  else {
    return (StatusCode::NOT_FOUND, "Unknown source stream key")
      .into_response();
  };
  let source_snapshot = build_source_info_snapshot(&state.shared);
  let supports_raw_iq_stream = source_snapshot["sources"]
    .as_array()
    .and_then(|sources| {
      sources
        .iter()
        .find(|source| source["id"].as_str() == Some(source_id.as_str()))
    })
    .and_then(|source| source["supports_raw_iq_stream"].as_bool())
    .unwrap_or(false);
  if !supports_raw_iq_stream {
    return (
      StatusCode::BAD_REQUEST,
      "Source does not support raw I/Q stream",
    )
      .into_response();
  }

  info!(
    "Source I/Q WebSocket upgrade: stream_key={}, source_id={}",
    stream_key, source_id
  );

  let shared = state.shared.clone();
  let enc_key = shared.encryption_key;
  let spectrum_tx = state.spectrum_tx.clone();
  let iq_protocol = IqStreamProtocol::from_requested(params.iq_protocol);

  ws.on_upgrade(move |socket| {
    handle_source_iq_connection(
      socket,
      shared,
      spectrum_tx,
      enc_key,
      source_id,
      stream_key,
      iq_protocol,
    )
  })
}

/// Send an encrypted I/Q frame as a binary websocket message.
///
/// The payload is intentionally binary instead of JSON because these frames can
/// be large and arrive frequently. Keeping the transport as a compact binary
/// buffer reduces serialization overhead, lowers bandwidth usage, and avoids
/// the extra allocations and parsing cost that would come with large JSON
/// blobs on the hot streaming path.
///
/// Frame layout:
/// `[timestamp:8][center_freq:8][data_type:4][sample_rate:4][encrypted_payload...]`
fn encode_encrypted_iq_frame_v1(
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
) -> Result<Vec<u8>, ()> {
  let timestamp: u64 = spectrum_data.timestamp as u64;
  let center_frequency: u64 =
    spectrum_data.center_frequency_hz.unwrap_or(0) as u64;
  let data_type = 1u32;
  let sample_rate = spectrum_data.sample_rate.unwrap_or(0) as u32;
  let iq_bytes = &spectrum_data.iq_data;

  let mut binary_payload = Vec::with_capacity(24 + iq_bytes.len());
  binary_payload.extend_from_slice(&timestamp.to_le_bytes());
  binary_payload.extend_from_slice(&center_frequency.to_le_bytes());
  binary_payload.extend_from_slice(&data_type.to_le_bytes());
  binary_payload.extend_from_slice(&sample_rate.to_le_bytes());

  let encrypted_iq = crypto::encrypt_payload_binary(enc_key, iq_bytes)
    .map_err(|_| {
      error!("I/Q data encryption failed");
    })?;
  binary_payload.extend_from_slice(&encrypted_iq);

  Ok(binary_payload)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum IqStreamProtocol {
  V1,
  V2,
}

impl IqStreamProtocol {
  fn from_requested(requested: Option<u8>) -> Self {
    if requested == Some(2) {
      Self::V2
    } else {
      Self::V1
    }
  }
}

/// Encode the negotiated v2 I/Q envelope.
///
/// Layout: `NAPT`, version, flags, header length, source length, reserved,
/// stream epoch, sequence, timestamp, center frequency, data type, sample
/// rate, UTF-8 source ID, then the encrypted sample payload. The source and
/// generation metadata let clients reject late async decryptions without
/// modifying the checksum-sensitive waveform bytes.
fn encode_encrypted_iq_frame_v2(
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
  source_id: &str,
  stream_epoch: u64,
  sequence: u64,
) -> Result<Vec<u8>, ()> {
  const FIXED_HEADER_LEN: usize = 52;
  let source_bytes = source_id.as_bytes();
  let source_len = u16::try_from(source_bytes.len()).map_err(|_| ())?;
  let header_len = FIXED_HEADER_LEN
    .checked_add(source_bytes.len())
    .and_then(|length| u16::try_from(length).ok())
    .ok_or(())?;
  let encrypted_iq =
    crypto::encrypt_payload_binary(enc_key, &spectrum_data.iq_data).map_err(
      |_| {
        error!("I/Q data encryption failed");
      },
    )?;

  let mut payload =
    Vec::with_capacity(header_len as usize + encrypted_iq.len());
  payload.extend_from_slice(b"NAPT");
  payload.push(2);
  payload.push(u8::from(spectrum_data.is_mock_apt));
  payload.extend_from_slice(&header_len.to_le_bytes());
  payload.extend_from_slice(&source_len.to_le_bytes());
  payload.extend_from_slice(&0u16.to_le_bytes());
  payload.extend_from_slice(&stream_epoch.to_le_bytes());
  payload.extend_from_slice(&sequence.to_le_bytes());
  payload.extend_from_slice(&(spectrum_data.timestamp as u64).to_le_bytes());
  payload.extend_from_slice(
    &(spectrum_data.center_frequency_hz.unwrap_or(0) as u64).to_le_bytes(),
  );
  payload.extend_from_slice(&1u32.to_le_bytes());
  payload
    .extend_from_slice(&spectrum_data.sample_rate.unwrap_or(0).to_le_bytes());
  payload.extend_from_slice(source_bytes);
  payload.extend_from_slice(&encrypted_iq);
  Ok(payload)
}

fn encode_encrypted_iq_frame(
  protocol: IqStreamProtocol,
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
  source_id: &str,
  stream_epoch: u64,
  sequence: u64,
) -> Result<Vec<u8>, ()> {
  match protocol {
    IqStreamProtocol::V1 => {
      encode_encrypted_iq_frame_v1(enc_key, spectrum_data)
    }
    IqStreamProtocol::V2 => encode_encrypted_iq_frame_v2(
      enc_key,
      spectrum_data,
      source_id,
      stream_epoch,
      sequence,
    ),
  }
}

async fn send_encrypted_iq_frame(
  ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
  protocol: IqStreamProtocol,
) -> Result<(), ()> {
  let binary_payload = encode_encrypted_iq_frame(
    protocol,
    enc_key,
    spectrum_data,
    &spectrum_data.source_id,
    spectrum_data.stream_epoch,
    spectrum_data.sequence,
  )?;

  // Binary frames keep the hot data path compact and avoid JSON encoding costs.
  ws_sender
    .send(Message::Binary(binary_payload.into()))
    .await
    .map_err(|_| ())
}

fn should_send_source_iq_frame(
  source_id: &str,
  is_paused: bool,
  allow_next_paused_frame: bool,
  tx_transmitting: bool,
) -> bool {
  if !is_paused || allow_next_paused_frame {
    return true;
  }
  matches!(source_id, "mock-tx" | "mock-apt") && tx_transmitting
}

fn source_iq_frame_matches_source(source_id: &str, is_mock_apt: bool) -> bool {
  if source_id == "mock-tx" {
    return !is_mock_apt;
  }
  if source_id.starts_with("mock") {
    return is_mock_apt;
  }
  !is_mock_apt
}

/// V2 ownership is explicit and never inferred from device or mock flags.
fn source_iq_v2_frame_matches_source(
  subscribed_source_id: &str,
  frame_source_id: &str,
) -> bool {
  subscribed_source_id == frame_source_id
}

fn source_kind_hint_from_id(source_id: &str) -> Option<&'static str> {
  if source_id.starts_with("rtl-sdr") || source_id.starts_with("rtl_sdr") {
    return Some("rtl-sdr");
  }
  if source_id.starts_with("hackrf_one") || source_id.starts_with("hackrf") {
    return Some("hackrf_one");
  }
  None
}

fn source_iq_subscription_matches_active_source(
  shared: &SharedState,
  source_id: &str,
  stream_key: &str,
) -> bool {
  let active_id = active_source_id(shared);
  if active_id == source_id {
    return true;
  }
  if active_id.starts_with("mock") && source_id.starts_with("mock") {
    return true;
  }

  let snapshot = build_source_info_snapshot(shared);
  let Some(sources) = snapshot["sources"].as_array() else {
    return false;
  };
  let active_source = sources
    .iter()
    .find(|source| source["id"].as_str() == Some(active_id.as_str()));
  if active_source
    .and_then(|source| source["stream_key"].as_str())
    .is_some_and(|active_stream_key| active_stream_key == stream_key)
  {
    return true;
  }

  let requested_source = sources
    .iter()
    .find(|source| source["id"].as_str() == Some(source_id));
  let Some(active_source) = active_source else {
    return false;
  };

  let active_kind = active_source["kind"].as_str().unwrap_or("");
  let requested_kind = requested_source
    .and_then(|source| source["kind"].as_str())
    .or_else(|| source_kind_hint_from_id(source_id))
    .unwrap_or("");
  if active_kind.starts_with("mock")
    || requested_kind.starts_with("mock")
    || active_kind != requested_kind
  {
    return false;
  }

  let active_serial =
    active_source["serial_number"].as_str().unwrap_or("").trim();
  let requested_serial = requested_source
    .and_then(|source| source["serial_number"].as_str())
    .unwrap_or("")
    .trim();
  if !active_serial.is_empty() && active_serial == requested_serial {
    return true;
  }

  sources
    .iter()
    .filter(|source| source["kind"].as_str() == Some(active_kind))
    .count()
    == 1
}

pub(crate) async fn handle_source_iq_connection(
  socket: WebSocket,
  shared: Arc<SharedState>,
  spectrum_tx: broadcast::Sender<Arc<super::types::SpectrumData>>,
  enc_key: [u8; 32],
  source_id: String,
  stream_key: String,
  iq_protocol: IqStreamProtocol,
) {
  let (mut ws_sender, mut ws_receiver) = socket.split();
  let mut spectrum_rx = spectrum_tx.subscribe();

  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);

  loop {
    tokio::select! {
      spectrum_result = spectrum_rx.recv() => {
        match spectrum_result {
          Ok(spectrum_data) => {
            if !source_iq_subscription_matches_active_source(&shared, &source_id, &stream_key) {
              continue;
            }
            if iq_protocol == IqStreamProtocol::V2
              && !source_iq_v2_frame_matches_source(
                &source_id,
                &spectrum_data.source_id,
              )
            {
              continue;
            }
            if iq_protocol == IqStreamProtocol::V1
              && !source_iq_frame_matches_source(&source_id, spectrum_data.is_mock_apt)
            {
              continue;
            }
            let allow_next_paused_frame = shared
              .allow_next_paused_frame
              .swap(false, Ordering::SeqCst);
            let is_paused = shared.is_paused.load(Ordering::SeqCst);
            let is_mock_tx_monitor =
              source_id == "mock-tx"
                && crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
            if !should_send_source_iq_frame(
              &source_id,
              is_paused,
              allow_next_paused_frame,
              is_mock_tx_monitor,
            ) {
              continue;
            }
            if send_encrypted_iq_frame(
              &mut ws_sender,
              &enc_key,
              &spectrum_data,
              iq_protocol,
            ).await.is_err() {
              break;
            }
          }
          Err(broadcast::error::RecvError::Lagged(n)) => {
            debug!("Source I/Q client lagged by {} spectrum frames, skipping", n);
            continue;
          }
          Err(_) => break,
        }
      }
      client_msg = ws_receiver.next() => {
        match client_msg {
          Some(Ok(Message::Close(_))) | None => break,
          Some(Ok(_)) => continue,
          Some(Err(e)) => {
            warn!("Source I/Q WebSocket error: {}", e);
            break;
          }
        }
      }
    }
  }

  shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
  shared.client_count.fetch_sub(1, Ordering::Relaxed);
}

/// Manages an authenticated WebSocket connection.
///
/// This function is responsible for:
/// 1. Synchronizing the client with the initial device state (connection, settings, channels).
/// 2. Starting a background loop to stream encrypted spectrum data.
/// 3. Handling incoming WebSocket messages (commands) from the client.
/// 4. Managing connection lifetime and cleanup.
///
/// # Arguments
/// * `socket` - The upgraded WebSocket connection.
/// * `shared` - Shared application state across all connections.
/// * `broadcast_tx` - Channel for broadcasting text-based updates.
/// * `spectrum_tx` - Channel for broadcasting high-frequency spectrum data.
/// * `cmd_tx` - Channel for sending commands to the SDR I/O thread.
/// * `enc_key` - 256-bit AES key for payload encryption.
pub async fn handle_ws_connection(
  socket: WebSocket,
  shared: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  _spectrum_tx: broadcast::Sender<Arc<super::types::SpectrumData>>,
  cmd_tx: std::sync::mpsc::Sender<super::types::SdrCommand>,
  _enc_key: [u8; 32],
  _session_token: String,
) {
  let (mut ws_sender, mut ws_receiver) = socket.split();
  let mut broadcast_rx = broadcast_tx.subscribe();

  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);
  let _ = reconcile_stale_device_snapshot(&shared);

  // Send initial source snapshot
  let initial_status = build_source_info_snapshot(&shared);

  if let Ok(status_json) = serde_json::to_string(&initial_status) {
    if ws_sender
      .send(Message::Text(status_json.into()))
      .await
      .is_err()
    {
      shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
      shared.client_count.fetch_sub(1, Ordering::Relaxed);
      return;
    }
  }

  // Send initial active source payload
  let active_id = active_source_id(&shared);
  let paused = shared.is_paused.load(Ordering::SeqCst);
  let active_source_payload = serde_json::json!({
    "type": "active_source",
    "source_id": active_id,
    "source_mode": if paused { "file" } else { "live" },
  });
  if let Ok(active_json) = serde_json::to_string(&active_source_payload) {
    if ws_sender
      .send(Message::Text(active_json.into()))
      .await
      .is_err()
    {
      shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
      shared.client_count.fetch_sub(1, Ordering::Relaxed);
      return;
    }
  }

  let initial_channels = build_channels_snapshot(&shared);
  if let Ok(channels_json) = serde_json::to_string(&initial_channels) {
    if ws_sender
      .send(Message::Text(channels_json.into()))
      .await
      .is_err()
    {
      shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
      shared.client_count.fetch_sub(1, Ordering::Relaxed);
      return;
    }
  }

  // Encrypted streaming loop
  loop {
    tokio::select! {
      broadcast_result = broadcast_rx.recv() => {
        match broadcast_result {
          Ok(plaintext_json) => {
            // Status messages must remain plaintext so the frontend can react
            // immediately (connected/loading/disconnected/stale) without needing
            // to decrypt them.
            // Capture status messages also need to be plaintext for the frontend
            // to handle capture state updates properly.
            if plaintext_json.contains("\"type\":\"status\"")
              || plaintext_json.contains("\"type\":\"source_info\"")
              || plaintext_json.contains("\"type\":\"capture_status\"")
              // A source-switch failure must reach the initiating browser;
              // otherwise its local selection waits forever for an active
              // source confirmation that will never arrive.
              || plaintext_json.contains("\"type\":\"error\"")
            {
              if ws_sender.send(Message::Text(plaintext_json.into())).await.is_err() {
                break;
              }
              continue;
            }
          }
          Err(broadcast::error::RecvError::Lagged(n)) => {
            debug!("Client lagged by {} frames, skipping", n);
            continue;
          }
          Err(_) => break,
        }
      }
      client_msg = ws_receiver.next() => {
        match client_msg {
          Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<WebSocketMessage>(&text) {
              Ok(message) => {
                if let Err(e) = message.validate() {
                  warn!("Invalid WebSocket message received: {}", e);
                  continue;
                }
                if message.message_type == "get_hardware_info" {
                  info!("Client requested hardware info");
                  let _device_connected = shared.device_connected.load(Ordering::Relaxed);
                  let sample_rate = shared.sdr_settings.lock().unwrap().sample_rate;
                  let available_spectrum = shared
                    .available_spectrum
                    .unwrap_or((0.0, 30_000_000_000.0));

                  // Hardware range: 0 to 1.7e9 as requested for RTL-SDR and mock
                  let response = super::types::HardwareInfoResponse {
                    message_type: "hardware_info".to_string(),
                    hardware_freq_range: super::types::HardwareFreqRange {
                      min: available_spectrum.0,
                      max: available_spectrum.1,
                    },
                    sample_rate,
                  };

                  if let Ok(response_json) = serde_json::to_string(&response) {
                    if ws_sender.send(Message::Text(response_json.into())).await.is_err() {
                      break;
                    }
                  }
                } else {
                  handle_message(&cmd_tx, &shared, &broadcast_tx, message);
                }
              }
              Err(e) => {
                warn!("Failed to deserialize WebSocket message: {:?}, raw text: {}", e, text);
              }
            }
          }
          Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
          _ => {}
        }
      }
    }
  }

  let _ = cmd_tx.send(super::types::SdrCommand::StopCapture { job_id: None });

  shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
  shared.client_count.fetch_sub(1, Ordering::Relaxed);
}

/// Handle incoming WebSocket messages from clients.
/// Sends commands to the dedicated I/O thread via mpsc channel — never blocks.
pub fn handle_message(
  cmd_tx: &std::sync::mpsc::Sender<super::types::SdrCommand>,
  shared: &Arc<SharedState>,
  broadcast_tx: &tokio::sync::broadcast::Sender<String>,
  message: WebSocketMessage,
) {
  match message.message_type.as_str() {
    "frequency_range" | "set_frequency_range" | "demod_tune" => {
      if let (Some(min_freq), Some(_max_freq)) =
        (message.min_freq, message.max_freq)
      {
        let available_spectrum = shared.available_spectrum;
        if live_tune_is_out_of_bounds(min_freq, _max_freq, available_spectrum) {
          warn!(
            "Ignoring out-of-bounds live tune request: {}..{} Hz",
            min_freq, _max_freq
          );
          shared.force_noise.store(true, Ordering::Relaxed);
          return;
        }

        shared.force_noise.store(false, Ordering::Relaxed);
        // The frontend treats this as a live-tune request. The backend already
        // knows the sample rate, so center directly on the requested frequency
        // when provided, otherwise fall back to the midpoint of the range.
        let center_freq = resolve_live_center_frequency(
          min_freq,
          _max_freq,
          message.center_frequency,
        );

        shared
          .pending_center_freq
          .store(center_freq, Ordering::Relaxed);
        shared
          .pending_center_freq_dirty
          .store(true, Ordering::Relaxed);

        let _ =
          cmd_tx.send(super::types::SdrCommand::SetFrequency(center_freq));
      }
    }
    "request_next_frame" => {
      apply_mock_tx_preview_settings(&message, shared);
      shared.allow_next_paused_frame.store(true, Ordering::SeqCst);
      let _ = cmd_tx.send(super::types::SdrCommand::RequestNextFrame);
    }
    "pause" => {
      if let Some(paused) = message.paused {
        let source_id = message
          .source_id
          .clone()
          .unwrap_or_else(|| active_source_id(shared));
        shared.set_source_pause_state(&source_id, paused);
        if source_id == active_source_id(shared) {
          shared.is_paused.store(paused, Ordering::SeqCst);
          shared
            .allow_next_paused_frame
            .store(false, Ordering::SeqCst);
        }
        broadcast_device_status(&shared, &broadcast_tx);
      }
    }
    "gain" => {
      if let Some(gain) = message.gain {
        let _ = cmd_tx.send(super::types::SdrCommand::SetGain(gain));
      }
    }
    "ppm" => {
      if let Some(ppm) = message.ppm {
        let _ = cmd_tx.send(super::types::SdrCommand::SetPpm(ppm));
      }
    }
    "settings" => {
      let fft_size = message.fft_size.and_then(|size| {
        if size > 0 && (size & (size - 1)) == 0 {
          Some(size)
        } else {
          warn!("Ignoring invalid fft_size from client: {}", size);
          None
        }
      });

      let frame_rate = message.frame_rate.and_then(|rate| {
        if rate > 0 {
          Some(rate)
        } else {
          warn!("Ignoring invalid frame_rate from client: {}", rate);
          None
        }
      });
      let sample_rate = message.sample_rate.and_then(|rate| {
        let rounded_rate = rate.round() as u32;
        if (1_000_000..=20_000_000).contains(&rounded_rate) {
          Some(rounded_rate)
        } else {
          warn!("Ignoring invalid sample_rate from client: {}", rate);
          None
        }
      });

      let gain = message.gain.and_then(|g| {
        if g.is_finite() && g >= 0.0 {
          Some(g)
        } else {
          warn!("Ignoring invalid gain from client: {}", g);
          None
        }
      });
      let hackrf_lna_gain = message.hackrf_lna_gain.and_then(|g| {
        if g.is_finite() && (0.0..=49.6).contains(&g) {
          Some(g)
        } else {
          warn!("Ignoring invalid HackRF LNA gain from client: {}", g);
          None
        }
      });
      let hackrf_vga_gain = message.hackrf_vga_gain.and_then(|g| {
        if g.is_finite() && (0.0..=62.0).contains(&g) {
          Some(g)
        } else {
          warn!("Ignoring invalid HackRF VGA gain from client: {}", g);
          None
        }
      });
      let hackrf_amp_enable = message.hackrf_amp_enable;

      let ppm = message.ppm.and_then(|p| {
        const MAX_PPM: u32 = 200;
        if (0..=MAX_PPM).contains(&p) {
          Some(p)
        } else {
          warn!("Ignoring implausible ppm from client: {}", p);
          None
        }
      });

      if fft_size.is_none()
        && message.fft_window.is_none()
        && frame_rate.is_none()
        && gain.is_none()
        && hackrf_lna_gain.is_none()
        && hackrf_vga_gain.is_none()
        && hackrf_amp_enable.is_none()
        && message.tuner_bandwidth.is_none()
        && ppm.is_none()
        && sample_rate.is_none()
        && message.tuner_agc.is_none()
        && message.rtl_agc.is_none()
      {
        debug!("Dropping settings message with no valid fields");
        return;
      }

      let settings_payload = super::types::SdrProcessorSettings {
        fft_size,
        fft_window: message.fft_window,
        frame_rate,
        sample_rate,
        gain,
        hackrf_lna_gain,
        hackrf_vga_gain,
        hackrf_amp_enable,
        ppm,
        tuner_agc: message.tuner_agc,
        rtl_agc: message.rtl_agc,
        offset_tuning: message.offset_tuning,
        direct_sampling: message.direct_sampling,
        tuner_bandwidth: message.tuner_bandwidth,
      };
      let _ = cmd_tx.send(super::types::SdrCommand::ApplySettings(
        settings_payload.clone(),
      ));
      let device = shared.device_info.lock().unwrap().clone();
      let serial_number = shared.device_serial.lock().unwrap().clone();
      let current_settings = shared.sdr_settings.lock().unwrap().clone();
      let entry = TxLogEntry::start(
        device,
        serial_number,
        Some(current_settings.center_frequency as u64),
        Some(sample_rate.unwrap_or(current_settings.sample_rate) as u64),
        gain,
        hackrf_lna_gain,
        hackrf_vga_gain,
        hackrf_amp_enable,
        message.tuner_agc,
        message.rtl_agc,
        ppm,
      )
      .change();
      write_global(&entry);

      // Update the shared settings so that future status broadcasts
      // reflect the new settings requested by the client.
      let mut sdr_settings = shared.sdr_settings.lock().unwrap();
      if let Some(size) = fft_size {
        sdr_settings.fft.default_size = size;
      }
      if let Some(fr) = frame_rate {
        sdr_settings.fft.default_frame_rate = fr;
      }
      if let Some(sr) = sample_rate {
        sdr_settings.sample_rate = sr;
      }
      if let Some(g) = gain {
        sdr_settings.gain.tuner_gain = g;
      }
      if let Some(lna) = hackrf_lna_gain {
        sdr_settings.gain.hackrf_lna_gain = Some(lna);
      }
      if let Some(vga) = hackrf_vga_gain {
        sdr_settings.gain.hackrf_vga_gain = Some(vga);
      }
      if let Some(amp) = hackrf_amp_enable {
        sdr_settings.gain.hackrf_amp_enable = Some(amp);
      }
      if let Some(bandwidth) = message.tuner_bandwidth {
        sdr_settings.gain.tuner_bandwidth = Some(bandwidth);
      }
      if let Some(p) = ppm {
        sdr_settings.ppm = p as f64;
      }
      if let Some(tagc) = message.tuner_agc {
        sdr_settings.gain.tuner_agc = tagc;
      }
      if let Some(ragc) = message.rtl_agc {
        sdr_settings.gain.rtl_agc = ragc;
      }
      let kind = shared.device_profile.lock().unwrap().kind.clone();
      sdr_settings.fft = crate::server::utils::resolve_fft_config(
        &kind,
        sdr_settings.sample_rate,
        Some(sdr_settings.fft.default_size),
        Some(&sdr_settings),
      );
      drop(sdr_settings);
      let source_id = active_source_id(shared);
      if let (Some(fft_size), Some(frame_rate), Some(sample_rate)) = (
        settings_payload.fft_size,
        settings_payload.frame_rate,
        settings_payload.sample_rate,
      ) {
        broadcast_signal_display_settings(
          shared,
          broadcast_tx,
          sample_rate,
          fft_size,
          frame_rate,
        );
      } else {
        let payload = serde_json::json!({
          "type": "signal_display_settings",
          "source_id": source_id,
          "sample_rate": shared.sdr_settings.lock().unwrap().sample_rate,
          "fft_size": shared.sdr_settings.lock().unwrap().fft.default_size,
          "frame_rate": shared.sdr_settings.lock().unwrap().fft.default_frame_rate,
        });
        let _ = broadcast_tx.send(payload.to_string());
      }
    }
    "tx_mode" => {
      let active_mode = message.active_mode.as_deref();
      let enabled = is_tx_mode_active_mode(active_mode);
      let device = message
        .tx_device
        .clone()
        .unwrap_or_else(|| shared.device_info.lock().unwrap().clone());
      let is_mock_tx_device = is_mock_tx_device_label(&device);
      info!(
        "Received tx_mode message: active_mode={:?}, enabled={}, device={}",
        active_mode, enabled, device
      );
      let serial_number = if is_mock_tx_device {
        MOCK_TX_SOURCE_ID.to_string()
      } else {
        shared.device_serial.lock().unwrap().clone()
      };
      let mut sdr_settings = shared.sdr_settings.lock().unwrap().clone();
      let mut tx_center_frequency_hz = if is_mock_tx_device {
        let current_tx_center =
          *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap();
        if current_tx_center > 0.0 {
          current_tx_center.round() as u64
        } else {
          sdr_settings.center_frequency as u64
        }
      } else {
        sdr_settings.center_frequency as u64
      };
      if let Some(center_frequency) = message.center_frequency {
        let center_hz = center_frequency.round().clamp(1.0, u32::MAX as f64);
        tx_center_frequency_hz = center_hz as u64;
        if !is_mock_tx_device {
          sdr_settings.center_frequency = center_hz as u32;
        }
      }
      if let Some(view_center_hz) = message.view_center_hz {
        let view_hz = view_center_hz.round().clamp(1.0, u32::MAX as f64);
        *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = view_hz;
      }
      if let Some(sample_rate) = message.sample_rate {
        sdr_settings.sample_rate = sample_rate.round() as u32;
      }
      if let Some(vga_gain) = message.hackrf_vga_gain {
        sdr_settings.gain.hackrf_vga_gain = Some(vga_gain);
      }
      if let Some(lna_gain) = message.hackrf_lna_gain {
        sdr_settings.gain.hackrf_lna_gain = Some(lna_gain);
      }
      if let Some(amp_enabled) = message.hackrf_amp_enable {
        sdr_settings.gain.hackrf_amp_enable = Some(amp_enabled);
      }
      if let Some(tuner_agc) = message.tuner_agc {
        sdr_settings.gain.tuner_agc = tuner_agc;
      }
      if let Some(rtl_agc) = message.rtl_agc {
        sdr_settings.gain.rtl_agc = rtl_agc;
      }
      if let Some(ppm) = message.ppm {
        sdr_settings.ppm = ppm as f64;
      }

      // safety and hopping configuration updates
      let safety_enabled = message.tx_safety_enabled.unwrap_or(
        shared
          .tx_safety_enabled
          .load(std::sync::atomic::Ordering::Relaxed),
      );
      let safety_limit = message
        .tx_safety_limit
        .clone()
        .unwrap_or_else(|| shared.tx_safety_limit.lock().unwrap().clone());

      shared
        .tx_safety_enabled
        .store(safety_enabled, std::sync::atomic::Ordering::Relaxed);
      *shared.tx_safety_limit.lock().unwrap() = safety_limit.clone();

      crate::safety::TX_SAFETY_ENABLED
        .store(safety_enabled, std::sync::atomic::Ordering::Relaxed);
      crate::safety::TX_SAFETY_LIMIT_IS_PERSON.store(
        safety_limit == "person",
        std::sync::atomic::Ordering::Relaxed,
      );

      if let Some(hop_type) = &message.tx_hop_type {
        *shared.tx_hop_type.lock().unwrap() = hop_type.clone();
        crate::safety::TX_HOP_TYPE_IS_RANGE
          .store(hop_type == "range", std::sync::atomic::Ordering::Relaxed);
      }
      if let Some(hop_start) = message.tx_hop_start_frequency_hz {
        *shared.tx_hop_start_frequency_hz.lock().unwrap() = hop_start;
        *crate::safety::TX_HOP_START_HZ.lock().unwrap() = hop_start;
      }
      if let Some(hop_end) = message.tx_hop_end_frequency_hz {
        *shared.tx_hop_end_frequency_hz.lock().unwrap() = hop_end;
        *crate::safety::TX_HOP_END_HZ.lock().unwrap() = hop_end;
      }
      if let Some(hop_channels) = &message.tx_hop_channels {
        *shared.tx_hop_channels.lock().unwrap() = hop_channels.clone();
        let mut mask: u32 = 0;
        for ch in hop_channels {
          if ch.eq_ignore_ascii_case("a") {
            mask |= 1;
          } else if ch.eq_ignore_ascii_case("b") {
            mask |= 2;
          } else if ch.eq_ignore_ascii_case("c") {
            mask |= 4;
          }
        }
        crate::safety::TX_HOP_CHANNELS_MASK
          .store(mask, std::sync::atomic::Ordering::Relaxed);
      }
      if let Some(hop_rate) = message.tx_hop_rate_hz {
        *shared.tx_hop_rate_hz.lock().unwrap() = hop_rate;
        *crate::safety::TX_HOP_RATE_HZ.lock().unwrap() = hop_rate;
      }

      let tx_signal = normalize_tx_signal(message.tx_signal.as_deref());
      *crate::safety::TX_SIGNAL.lock().unwrap() = tx_signal.clone();

      let hop_active = message.tx_hop_enabled.unwrap_or_else(|| {
        shared
          .tx_hop_enabled
          .load(std::sync::atomic::Ordering::Relaxed)
      });
      shared
        .tx_hop_enabled
        .store(hop_active, std::sync::atomic::Ordering::Relaxed);
      crate::safety::TX_HOP_ENABLED
        .store(hop_active, std::sync::atomic::Ordering::Relaxed);

      // Enforce safety clamps on VGA gain and AMP enabled
      if safety_enabled {
        if safety_limit == "min" {
          sdr_settings.gain.hackrf_vga_gain = Some(0.0);
          sdr_settings.gain.hackrf_amp_enable = Some(false);
        } else {
          let max_dist = if safety_limit == "person" { 1.0 } else { 3.0 };
          let freq = tx_center_frequency_hz as f64;
          let limit_dbm =
            crate::safety::calculate_room_power_limit(freq, max_dist);
          let safe_gains = crate::safety::get_max_safe_vga_and_amp(limit_dbm);

          if let Some(vga) = sdr_settings.gain.hackrf_vga_gain {
            sdr_settings.gain.hackrf_vga_gain = Some(vga.min(safe_gains.vga));
          } else {
            sdr_settings.gain.hackrf_vga_gain =
              Some(0.0f64.min(safe_gains.vga));
          }
          if !safe_gains.amp {
            sdr_settings.gain.hackrf_amp_enable = Some(false);
          }
        }
      }

      *shared.sdr_settings.lock().unwrap() = sdr_settings.clone();

      let max_tx_power = crate::safety::get_approx_output_power(
        sdr_settings.gain.hackrf_vga_gain.unwrap_or(0.0),
        sdr_settings.gain.hackrf_amp_enable.unwrap_or(false),
      );
      let mut tx_power =
        message.power_dbm.unwrap_or(max_tx_power).min(max_tx_power);
      if safety_enabled && safety_limit == "min" {
        tx_power = -70.0;
      }
      *crate::safety::TX_POWER_DBM.lock().unwrap() = tx_power;
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() =
        tx_center_frequency_hz as f64;
      let current_tx_bandwidth_hz =
        *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();
      let tx_bw = match message.bandwidth {
        Some(bw) => bw as f64,
        None if !enabled && current_tx_bandwidth_hz > 0.0 => {
          current_tx_bandwidth_hz
        }
        None => sdr_settings.sample_rate as f64,
      };
      *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = tx_bw;
      if let Some(tx_ifft_size) = message.tx_ifft_size {
        *crate::safety::TX_IFFT_SIZE.lock().unwrap() = tx_ifft_size;
      }
      let was_transmitting = crate::safety::TX_TRANSMITTING
        .swap(enabled, std::sync::atomic::Ordering::Relaxed);
      let tx_status_changed = was_transmitting != enabled;

      let _ = cmd_tx.send(super::types::SdrCommand::SetTransmitMode {
        enabled,
        device: device.clone(),
        serial_number: serial_number.clone(),
        tx_signal: Some(tx_signal),
        center_frequency_hz: Some(tx_center_frequency_hz),
        sample_rate_hz: Some(sdr_settings.sample_rate as u64),
        bandwidth_hz: Some(tx_bw),
        tx_ifft_size: message.tx_ifft_size,
        power_dbm: Some(tx_power),
        lna_gain_db: sdr_settings.gain.hackrf_lna_gain,
        vga_gain_db: sdr_settings.gain.hackrf_vga_gain,
        amp_enabled: sdr_settings.gain.hackrf_amp_enable,
        tuner_agc: Some(sdr_settings.gain.tuner_agc),
        rtl_agc: Some(sdr_settings.gain.rtl_agc),
        ppm: Some(sdr_settings.ppm as u32),
      });

      if tx_status_changed {
        let entry = if enabled {
          TxLogEntry::start(
            device.clone(),
            serial_number,
            Some(tx_center_frequency_hz),
            Some(sdr_settings.sample_rate as u64),
            Some(sdr_settings.gain.tuner_gain),
            sdr_settings.gain.hackrf_lna_gain,
            sdr_settings.gain.hackrf_vga_gain,
            sdr_settings.gain.hackrf_amp_enable,
            Some(sdr_settings.gain.tuner_agc),
            Some(sdr_settings.gain.rtl_agc),
            Some(sdr_settings.ppm as u32),
          )
        } else {
          TxLogEntry::start(
            device.clone(),
            serial_number,
            Some(tx_center_frequency_hz),
            Some(sdr_settings.sample_rate as u64),
            Some(sdr_settings.gain.tuner_gain),
            sdr_settings.gain.hackrf_lna_gain,
            sdr_settings.gain.hackrf_vga_gain,
            sdr_settings.gain.hackrf_amp_enable,
            Some(sdr_settings.gain.tuner_agc),
            Some(sdr_settings.gain.rtl_agc),
            Some(sdr_settings.ppm as u32),
          )
          .end()
        };
        write_global(&entry);
      }
      if is_mock_tx_device
        || shared.device_profile.lock().unwrap().kind == "mock_tx"
      {
        let mock_tx_was_transmitting = shared
          .mock_tx_transmitting
          .swap(enabled, std::sync::atomic::Ordering::Relaxed);
        let mock_tx_status_changed = mock_tx_was_transmitting != enabled;
        if mock_tx_status_changed
          && shared.device_profile.lock().unwrap().kind == "mock_tx"
        {
          shared.set_device_state(
            if enabled { "transmitting" } else { "connected" },
            None,
          );
        }
        if tx_status_changed || mock_tx_status_changed {
          super::websocket_server::broadcast_device_status(
            shared,
            broadcast_tx,
          );
        }
      }
    }
    "restart_device" => {
      info!("Client requested device restart");
      let _ = cmd_tx.send(super::types::SdrCommand::RestartDevice);
    }
    "select_source" => {
      if let Some(mut source_id) = message.source_id.clone() {
        if source_id == "mock_tx" {
          source_id = "mock-tx".to_string();
        } else if source_id == "mock_apt" {
          source_id = "mock-apt".to_string();
        }
        info!("Client requested source switch: {}", source_id);
        match cmd_tx.send(super::types::SdrCommand::SetActiveSource {
          source_id: source_id.clone(),
        }) {
          Ok(()) => {
            info!("Queued source switch: {}", source_id);
          }
          Err(error) => {
            error!("Failed to enqueue source switch {}: {}", source_id, error);
            let payload = serde_json::json!({
              "type": "error",
              "source_id": source_id,
              "code": "source_switch_enqueue_failed",
              "message": format!("Unable to queue source switch: {error}"),
            });
            let _ = broadcast_tx.send(payload.to_string());
          }
        }
      } else {
        debug!("Ignoring select_source message without source_id");
      }
    }
    "training_capture" => {
      if let Some(action) = message.action.as_deref() {
        match action {
          "start" => {
            let label = message.label.unwrap_or_else(|| "target".to_string());
            let signal_area =
              message.signal_area.unwrap_or_else(|| "A".to_string());
            info!(
              "Client requested training start: label={}, area={}",
              label, signal_area
            );
            let _ = cmd_tx.send(super::types::SdrCommand::StartTraining {
              label,
              signal_area,
            });
          }
          "stop" => {
            info!("Client requested training stop");
            let _ = cmd_tx.send(super::types::SdrCommand::StopTraining);
          }
          _ => {
            debug!("Unknown training action: {}", action);
          }
        }
      }
    }
    "capture" => {
      let duration_mode = message
        .duration_mode
        .clone()
        .unwrap_or_else(|| "timed".to_string());

      let current_settings = shared.sdr_settings.lock().unwrap().clone();
      let bandwidth = message.bandwidth;
      let bandwidth_center_frequency = message.bandwidth_center_frequency;

      let capture_cmd = super::types::SdrCommand::StartCapture {
        job_id: message
          .job_id
          .clone()
          .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        fragments: message
          .fragments
          .as_ref()
          .map(|f| {
            f.iter()
              .map(|fr| (fr.min_freq, fr.max_freq))
              .collect::<Vec<(f64, f64)>>()
          })
          .unwrap_or_default(),
        duration_mode,
        duration_s: message.duration_s.unwrap_or(1.0),
        file_type: message
          .file_type
          .clone()
          .unwrap_or_else(|| ".napt".to_string()),
        acquisition_mode: message
          .acquisition_mode
          .clone()
          .unwrap_or_else(|| "whole_sample".to_string()),
        encrypted: message.encrypted.unwrap_or(true),
        fft_size: message
          .fft_size
          .unwrap_or(current_settings.fft.default_size),
        fft_window: message
          .fft_window
          .clone()
          .unwrap_or_else(|| "hann".to_string()),
        geolocation: message.geolocation,
        ref_based_demod_baseline: message.ref_based_demod_baseline,
        is_ephemeral: message.live_mode.unwrap_or(false),
        channels: message.channels.clone(),
        bandwidth,
        bandwidth_center_frequency,
      };
      log::info!("Client requested capture: {:?}", capture_cmd);
      let _ = cmd_tx.send(capture_cmd);
    }
    "capture_stop" => {
      info!("Client requested capture stop");
      let _ = cmd_tx.send(super::types::SdrCommand::StopCapture {
        job_id: message.job_id.clone(),
      });
    }
    "scan" => {
      if let (Some(min_freq), Some(max_freq), Some(job_id)) =
        (message.min_freq, message.max_freq, message.job_id.clone())
      {
        let window_size_hz = 25000.0; // Default
        let step_size_hz = 10000.0; // Default
        let audio_threshold = 0.3; // Default

        let _ = cmd_tx.send(super::types::SdrCommand::ScanForAudio {
          job_id,
          frequency_range: (min_freq, max_freq),
          window_size_hz,
          step_size_hz,
          audio_threshold,
        });
      }
    }
    "demodulate" => {
      // Logic would be here if there's a specific demod message from frontend
      // For now, scan results might trigger demodulation
    }
    "apt_analysis" => {
      if let Some(job_id) = message.job_id.clone() {
        // Parse APT analysis configuration from message
        // For now, create a basic config - in a real implementation,
        // this would parse from message fields
        let apt_config = super::types::AptAnalysisConfig {
          content_type: super::types::AptContentType::AudioHearing, // Default
          window_size_hz: message
            .min_freq
            .map(|f| message.max_freq.unwrap_or(f) - f)
            .unwrap_or(25000.0),
          sub_channel_range: (
            message.min_freq.unwrap_or(0.0) + 350000.0,
            message.min_freq.unwrap_or(0.0) + 500000.0,
          ),
          script_content: None, // Would be parsed from message
          media_content: None,  // Would be parsed from message
          baseline_vector: None, // Would be parsed from message
          demod_processor: "APT Pipeline v1.0".to_string(),
        };

        let _ = cmd_tx.send(super::types::SdrCommand::StartAptAnalysis {
          job_id,
          config: apt_config,
        });
      }
    }
    "power_scale" => {
      if let Some(scale_str) = message.power_scale.as_deref() {
        match scale_str {
          "dB" => {
            let _ = cmd_tx.send(super::types::SdrCommand::SetPowerScale {
              scale: super::types::PowerScale::DB,
            });
          }
          "dBm" => {
            let _ = cmd_tx.send(super::types::SdrCommand::SetPowerScale {
              scale: super::types::PowerScale::DBm,
            });
          }
          _ => {
            debug!("Unknown power scale: {}", scale_str);
          }
        }
      }
    }
    _ => {
      debug!("Unknown message type: {}", message.message_type);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::{
    encode_encrypted_iq_frame, handle_message, live_tune_is_out_of_bounds,
    resolve_live_center_frequency, should_send_source_iq_frame,
    source_iq_frame_matches_source,
    source_iq_subscription_matches_active_source,
    source_iq_v2_frame_matches_source, IqStreamProtocol,
  };
  use crate::server::shared_state::SharedState;
  use crate::server::types::{
    DeviceProfile, SdrCommand, SpectrumData, WebSocketMessage,
  };
  use serial_test::serial;
  use std::sync::mpsc;
  use std::sync::Arc;
  use std::time::Duration;
  use tokio::sync::broadcast;
  use validator::Validate;

  fn test_shared_state() -> Arc<SharedState> {
    std::env::set_var("UNSAFE_LOCAL_USER_PASSWORD", "test-password");
    SharedState::new("redis://127.0.0.1:6379")
  }

  fn test_channels() -> (
    mpsc::Sender<SdrCommand>,
    mpsc::Receiver<SdrCommand>,
    broadcast::Sender<String>,
  ) {
    let (cmd_tx, cmd_rx) = mpsc::channel();
    let (broadcast_tx, _) = broadcast::channel(8);
    (cmd_tx, cmd_rx, broadcast_tx)
  }

  #[test]
  fn resolves_frequency_center_from_range_midpoint() {
    let center = resolve_live_center_frequency(1_190_000.0, 4_390_000.0, None);
    assert_eq!(center, 2_790_000);
  }

  #[test]
  fn prefers_bandwidth_center_frequency_when_present() {
    let center = resolve_live_center_frequency(
      1_190_000.0,
      4_390_000.0,
      Some(2_812_345.0),
    );
    assert_eq!(center, 2_812_345);
  }

  #[test]
  fn accepts_fractional_bandwidth_center_frequency_from_client() {
    let msg: WebSocketMessage = serde_json::from_str(
      r#"{"type":"frequency_range","min_hz":2204000,"max_hz":2204001,"center_frequency":2204001,"bandwidth_center_frequency":2204499.5}"#,
    )
    .unwrap();

    assert_eq!(msg.bandwidth_center_frequency, Some(2_204_500));
  }

  #[test]
  fn rejects_negative_or_out_of_bounds_live_tunes() {
    assert!(live_tune_is_out_of_bounds(
      -10.0,
      4_390_000.0,
      Some((0.0, 30_000_000_000.0))
    ));
    assert!(live_tune_is_out_of_bounds(
      1_000.0,
      31_000_000_000.0,
      Some((0.0, 30_000_000_000.0))
    ));
    assert!(!live_tune_is_out_of_bounds(
      1_190_000.0,
      4_390_000.0,
      Some((0.0, 30_000_000_000.0))
    ));
  }

  #[test]
  fn validates_websocket_message_ppm() {
    // Valid PPM values
    let msg: WebSocketMessage =
      serde_json::from_str(r#"{"type": "ppm", "ppm": 10}"#).unwrap();
    assert!(msg.validate().is_ok());

    let msg: WebSocketMessage =
      serde_json::from_str(r#"{"type": "ppm", "ppm": 0}"#).unwrap();
    assert!(msg.validate().is_ok());

    // Invalid PPM values (negative)
    let msg_result: Result<WebSocketMessage, _> =
      serde_json::from_str(r#"{"type": "ppm", "ppm": -5}"#);
    // Since ppm is u32, deserializing a negative number should either fail to deserialize
    // or if we deserialize, it shouldn't validate. Actually, serde_json fails to deserialize
    // a negative number into a u32, which is correct and safe! Let's assert either case.
    assert!(msg_result.is_err() || msg_result.unwrap().validate().is_err());
  }

  #[test]
  #[serial]
  fn sanitizes_invalid_hackrf_gains_and_ppm_before_emitting_settings() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"settings",
        "gain":12.5,
        "hackrfLnaGain":51.0,
        "hackrfVgaGain":63.0,
        "ppm":201,
        "tunerAGC":true
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx.recv().expect("expected ApplySettings command");
    match cmd {
      SdrCommand::ApplySettings(settings) => {
        assert_eq!(settings.gain, Some(12.5));
        assert_eq!(settings.hackrf_lna_gain, None);
        assert_eq!(settings.hackrf_vga_gain, None);
        assert_eq!(settings.ppm, None);
        assert_eq!(settings.tuner_agc, Some(true));
      }
      other => panic!("unexpected command: {:?}", other),
    }
  }

  #[test]
  #[serial]
  fn preserves_valid_hackrf_gains_and_ppm_in_settings() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"settings",
        "hackrfLnaGain":40.0,
        "hackrfVgaGain":62.0,
        "ppm":200
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx.recv().expect("expected ApplySettings command");
    match cmd {
      SdrCommand::ApplySettings(settings) => {
        assert_eq!(settings.hackrf_lna_gain, Some(40.0));
        assert_eq!(settings.hackrf_vga_gain, Some(62.0));
        assert_eq!(settings.ppm, Some(200));
      }
      other => panic!("unexpected command: {:?}", other),
    }
  }

  #[test]
  #[serial]
  fn forwards_sample_rate_and_tuner_bandwidth_in_settings() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"settings",
        "sampleRate":5200000,
        "tunerBandwidth":5200000
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx.recv().expect("expected ApplySettings command");
    match cmd {
      SdrCommand::ApplySettings(settings) => {
        assert_eq!(settings.sample_rate, Some(5_200_000));
        assert_eq!(settings.tuner_bandwidth, Some(5_200_000));
      }
      other => panic!("unexpected command: {:?}", other),
    }
  }

  #[test]
  #[serial]
  fn forwards_select_source_as_active_source_command() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    let mut broadcast_rx = broadcast_tx.subscribe();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"select_source",
        "source_id":"rtl-sdr-1"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx.recv().expect("expected SetActiveSource command");
    match cmd {
      SdrCommand::SetActiveSource { source_id } => {
        assert_eq!(source_id, "rtl-sdr-1");
      }
      other => panic!("unexpected command: {:?}", other),
    }
    assert!(
      broadcast_rx.try_recv().is_err(),
      "queue acknowledgement must not mark a warm source loading"
    );
  }

  #[test]
  #[serial]
  fn mock_tx_mode_overlays_on_active_mock_apt_source() {
    let shared = test_shared_state();
    shared.update_device_status(
      false,
      "Mock APT SDR".to_string(),
      crate::server::websocket_server::build_device_profile("mock_apt"),
    );
    shared.update_device_usb_strings(
      "mock-apt".to_string(),
      "N-APT".to_string(),
      "Mock APT SDR".to_string(),
    );
    let initial_rx_center_frequency =
      shared.sdr_settings.lock().unwrap().center_frequency;
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    let mut broadcast_rx = broadcast_tx.subscribe();
    let mut next_source_info = || -> serde_json::Value {
      for _ in 0..4 {
        let payload: serde_json::Value = serde_json::from_str(
          &broadcast_rx.try_recv().expect("broadcast payload"),
        )
        .expect("valid broadcast payload");
        if payload["type"] == "source_info" {
          return payload;
        }
      }
      panic!("expected source_info broadcast");
    };

    let enable: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"tx_mode",
        "active_mode":"tx",
        "txDevice":"Mock Tx SDR",
        "centerFrequencyHz":1600000,
        "bandwidthHz":3200000,
        "txIfftSize":8192,
        "vgaGainDb":12
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, enable);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitMode command");
    match cmd {
      SdrCommand::SetTransmitMode {
        enabled,
        device,
        serial_number,
        center_frequency_hz,
        sample_rate_hz,
        tx_ifft_size,
        power_dbm,
        vga_gain_db,
        ..
      } => {
        assert!(enabled);
        assert_eq!(device, "Mock Tx SDR");
        assert_eq!(serial_number, "mock-tx");
        assert_eq!(center_frequency_hz, Some(1_600_000));
        assert_eq!(sample_rate_hz, Some(3_200_000));
        assert_eq!(tx_ifft_size, Some(8192));
        assert_eq!(
          power_dbm,
          Some(crate::safety::get_approx_output_power(12.0, false))
        );
        assert_eq!(vga_gain_db, Some(12.0));
      }
      other => panic!("unexpected command: {:?}", other),
    }
    assert_eq!(
      shared.sdr_settings.lock().unwrap().center_frequency,
      initial_rx_center_frequency,
      "Mock Tx coordinate updates must not retune the receiver/VFO"
    );

    assert!(shared
      .mock_tx_transmitting
      .load(std::sync::atomic::Ordering::Relaxed));

    let payload = next_source_info();
    assert_eq!(payload["active_source"], "mock-apt");
    let sources = payload["sources"].as_array().expect("sources array");
    let active_source = sources
      .iter()
      .find(|source| source["id"].as_str() == Some("mock-apt"))
      .expect("active mock APT source");
    let mock_tx = sources
      .iter()
      .find(|source| source["id"].as_str() == Some("mock-tx"))
      .expect("mock Tx source");
    assert_eq!(active_source["status"], "streaming");
    assert_eq!(mock_tx["name"], "Mock Tx SDR");
    assert_eq!(mock_tx["status"], "transmitting");

    let disable: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"tx_mode",
        "active_mode":"rx",
        "txDevice":"Mock Tx SDR"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, disable);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected stop SetTransmitMode command");
    match cmd {
      SdrCommand::SetTransmitMode {
        enabled,
        device,
        serial_number,
        ..
      } => {
        assert!(!enabled);
        assert_eq!(device, "Mock Tx SDR");
        assert_eq!(serial_number, "mock-tx");
      }
      other => panic!("unexpected command: {:?}", other),
    }

    assert!(!shared
      .mock_tx_transmitting
      .load(std::sync::atomic::Ordering::Relaxed));

    let payload = next_source_info();
    assert_eq!(payload["active_source"], "mock-apt");
    let sources = payload["sources"].as_array().expect("sources array");
    let mock_tx = sources
      .iter()
      .find(|source| source["id"].as_str() == Some("mock-tx"))
      .expect("mock Tx source");
    assert_eq!(mock_tx["status"], "connected");
  }

  #[test]
  #[serial]
  fn request_next_frame_applies_mock_tx_preview_settings_without_transmitting()
  {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 0.0;
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;
    *crate::safety::TX_POWER_DBM.lock().unwrap() = 0.0;
    *crate::safety::TX_SIGNAL.lock().unwrap() = String::new();
    *crate::safety::TX_IFFT_SIZE.lock().unwrap() = 2048;
    crate::safety::TX_TRANSMITTING
      .store(false, std::sync::atomic::Ordering::Relaxed);

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "centerFrequencyHz":137100000,
        "bandwidthHz":2400000,
        "powerDbm":-18,
        "txSignal":"wifi",
        "txIfftSize":8192
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected RequestNextFrame command");
    match cmd {
      SdrCommand::RequestNextFrame => {}
      other => panic!("unexpected command: {:?}", other),
    }
    assert!(shared
      .allow_next_paused_frame
      .load(std::sync::atomic::Ordering::SeqCst));
    assert!(!shared
      .mock_tx_transmitting
      .load(std::sync::atomic::Ordering::Relaxed));
    assert!(!crate::safety::TX_TRANSMITTING
      .load(std::sync::atomic::Ordering::Relaxed));
    assert_eq!(
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap(),
      137_100_000.0
    );
    assert_eq!(*crate::safety::TX_BANDWIDTH_HZ.lock().unwrap(), 2_400_000.0);
    assert_eq!(*crate::safety::TX_POWER_DBM.lock().unwrap(), -18.0);
    assert_eq!(crate::safety::TX_SIGNAL.lock().unwrap().as_str(), "wifi");
    assert_eq!(*crate::safety::TX_IFFT_SIZE.lock().unwrap(), 8192);
  }

  #[test]
  #[serial]
  fn tx_mode_disable_without_bandwidth_keeps_existing_tx_bandwidth() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 2_400_000.0;
    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"tx_mode",
        "active_mode":"rx",
        "txDevice":"Mock Tx SDR"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitMode command");
    match cmd {
      SdrCommand::SetTransmitMode {
        enabled,
        bandwidth_hz,
        ..
      } => {
        assert!(!enabled);
        assert_eq!(bandwidth_hz, Some(2_400_000.0));
      }
      other => panic!("unexpected command: {:?}", other),
    }
    assert_eq!(*crate::safety::TX_BANDWIDTH_HZ.lock().unwrap(), 2_400_000.0);
  }

  #[test]
  #[serial]
  fn tx_mode_without_signal_defaults_to_wifi() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"tx_mode",
        "active_mode":"tx",
        "txDevice":"Mock Tx SDR"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitMode command");
    match cmd {
      SdrCommand::SetTransmitMode {
        enabled,
        device,
        serial_number,
        tx_signal,
        ..
      } => {
        assert!(enabled);
        assert_eq!(device, "Mock Tx SDR");
        assert_eq!(serial_number, "mock-tx");
        assert_eq!(tx_signal.as_deref(), Some("wifi"));
      }
      other => panic!("unexpected command: {:?}", other),
    }

    assert_eq!(crate::safety::TX_SIGNAL.lock().unwrap().as_str(), "wifi");
  }

  #[test]
  #[serial]
  fn tx_mode_legacy_apt_signal_falls_back_to_wifi() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"tx_mode",
        "active_mode":"tx",
        "txDevice":"Mock Tx SDR",
        "txSignal":"apt"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitMode command");
    match cmd {
      SdrCommand::SetTransmitMode { tx_signal, .. } => {
        assert_eq!(tx_signal.as_deref(), Some("wifi"));
      }
      other => panic!("unexpected command: {:?}", other),
    }
  }

  #[test]
  #[serial]
  fn drops_settings_messages_with_only_invalid_backend_fields() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"settings",
        "hackrfLnaGain":-1.0,
        "hackrfVgaGain":99.0,
        "ppm":1001
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert!(cmd_rx.try_recv().is_err());
  }

  #[test]
  fn mock_tx_source_iq_frames_bypass_pause_while_transmitting() {
    assert!(should_send_source_iq_frame("mock-tx", true, false, true));
    assert!(should_send_source_iq_frame("mock-tx", true, true, false));
    assert!(should_send_source_iq_frame("mock-tx", false, false, false));
    assert!(!should_send_source_iq_frame("mock-tx", true, false, false));
    assert!(should_send_source_iq_frame("mock-apt", true, false, true));
  }

  #[test]
  fn v2_iq_envelope_carries_source_epoch_sequence_and_decryptable_payload() {
    let key = [7u8; 32];
    let spectrum = SpectrumData {
      message_type: "spectrum".to_string(),
      waveform: Vec::new(),
      is_mock_apt: false,
      source_id: "rtl-sdr-v4".to_string(),
      stream_epoch: 7,
      sequence: 11,
      center_frequency_hz: Some(137_100_000),
      waveform_span_hz: None,
      timestamp: 1234,
      data_type: Some("iq_raw".to_string()),
      sample_rate: Some(2_400_000),
      power_scale: None,
      iq_data: vec![128, 129, 127, 126],
    };

    let encoded = encode_encrypted_iq_frame(
      IqStreamProtocol::V2,
      &key,
      &spectrum,
      "rtl-sdr-v4",
      7,
      11,
    )
    .expect("v2 frame should encode");
    assert_eq!(&encoded[0..4], b"NAPT");
    assert_eq!(encoded[4], 2);
    let header_len = u16::from_le_bytes([encoded[6], encoded[7]]) as usize;
    assert_eq!(u64::from_le_bytes(encoded[12..20].try_into().unwrap()), 7);
    assert_eq!(u64::from_le_bytes(encoded[20..28].try_into().unwrap()), 11);
    assert_eq!(&encoded[52..header_len], b"rtl-sdr-v4");
    let decrypted =
      crate::crypto::decrypt_payload_binary(&key, &encoded[header_len..])
        .expect("v2 payload should decrypt");
    assert_eq!(decrypted, spectrum.iq_data);
  }

  #[test]
  fn v2_source_filter_requires_exact_frame_ownership() {
    assert!(source_iq_v2_frame_matches_source("rtl-sdr-1", "rtl-sdr-1"));
    assert!(!source_iq_v2_frame_matches_source("rtl-sdr-1", "rtl-sdr-2"));
  }

  #[test]
  fn source_iq_frames_must_match_the_subscribed_source_origin() {
    assert!(source_iq_frame_matches_source("mock-apt", true));
    assert!(!source_iq_frame_matches_source("rtl-sdr-00000001", true));
    assert!(source_iq_frame_matches_source("rtl-sdr-00000001", false));
    assert!(!source_iq_frame_matches_source("mock-apt", false));
  }

  #[test]
  fn source_iq_subscription_accepts_the_active_rtl_source() {
    let shared = test_shared_state();
    shared.update_device_status(
      true,
      "RTL-SDR v4".to_string(),
      DeviceProfile {
        kind: "rtl-sdr".to_string(),
        is_rtl_sdr: true,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      },
    );
    shared.update_device_usb_strings(
      "00000001".to_string(),
      "RTLSDRBlog".to_string(),
      "Blog V4".to_string(),
    );

    assert!(source_iq_subscription_matches_active_source(
      &shared,
      "rtl-sdr-00000001",
      "00000001"
    ));
    assert!(!source_iq_subscription_matches_active_source(
      &shared, "mock-apt", "mock-apt"
    ));
  }

  #[test]
  fn source_iq_subscription_rejects_mock_active_for_hardware_subscription() {
    let shared = test_shared_state();
    shared.update_device_status(
      false,
      "Mock APT SDR".to_string(),
      crate::server::websocket_server::build_device_profile("mock_apt"),
    );
    shared.update_device_usb_strings(
      "mock-apt".to_string(),
      "N-APT".to_string(),
      "Mock APT SDR".to_string(),
    );

    assert!(!source_iq_subscription_matches_active_source(
      &shared,
      "rtl-sdr-00000001",
      "00000001"
    ));
    assert!(source_iq_subscription_matches_active_source(
      &shared, "mock-tx", "mock-tx"
    ));
  }

  #[test]
  fn source_iq_subscription_accepts_active_rtl_stream_key_alias() {
    let shared = test_shared_state();
    shared.update_device_status(
      true,
      "RTL-SDR v4".to_string(),
      DeviceProfile {
        kind: "rtl-sdr".to_string(),
        is_rtl_sdr: true,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      },
    );
    shared.update_device_usb_strings(
      "00000001".to_string(),
      "RTLSDRBlog".to_string(),
      "Blog V4".to_string(),
    );

    assert!(source_iq_subscription_matches_active_source(
      &shared,
      "rtl-sdr-stale-id",
      "00000001"
    ));
  }

  #[test]
  fn source_iq_subscription_accepts_pre_serial_rtl_socket_after_id_stabilizes()
  {
    let shared = test_shared_state();
    shared.update_device_status(
      true,
      "RTL-SDR v4".to_string(),
      DeviceProfile {
        kind: "rtl-sdr".to_string(),
        is_rtl_sdr: true,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      },
    );
    shared.update_device_usb_strings(
      "00000001".to_string(),
      "RTLSDRBlog".to_string(),
      "Blog V4".to_string(),
    );

    assert!(source_iq_subscription_matches_active_source(
      &shared,
      "rtl-sdr-0",
      "rtl-sdr-0"
    ));
  }

  #[test]
  #[serial]
  fn pause_commands_are_scoped_to_their_source() {
    let shared = test_shared_state();
    shared.update_device_status(
      false,
      "Mock APT SDR".to_string(),
      crate::server::websocket_server::build_device_profile("mock_apt"),
    );
    shared.update_device_usb_strings(
      "mock-apt".to_string(),
      "N-APT".to_string(),
      "Mock APT SDR".to_string(),
    );
    let (cmd_tx, _cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"pause",
        "paused":true,
        "source_id":"other-source",
        "duplex_mode":"half_duplex",
        "active_mode":"rx"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert!(shared.is_source_paused("other-source"));
    assert!(!shared.is_paused.load(std::sync::atomic::Ordering::SeqCst));

    let active_pause: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"pause",
        "paused":true,
        "source_id":"mock-apt",
        "duplex_mode":"half_duplex",
        "active_mode":"rx"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, active_pause);

    assert!(shared.is_source_paused("mock-apt"));
    assert!(shared.is_paused.load(std::sync::atomic::Ordering::SeqCst));
  }
}
