use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde::Deserialize;
use serde_json;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use validator::Validate;

use crate::crypto;

use super::shared_state::{DisplayViewport, SharedState};
use super::stream_contract::{
  stream_control_scope, StreamControlAction, StreamControlScope,
  StreamDeliveryPolicy,
};
use super::stream_manager::{
  SourceStreamCapabilities, StreamEvent, StreamKey, StreamMode, StreamOptions,
  StreamState, StreamingSourceModeManager,
};
use super::tx_log::{write_global, TxLogEntry};
use super::types::{PowerScale, SpectrumData};
use super::types::{WebSocketMessage, WsQueryParams};
use super::websocket_server::reconcile_stale_device_snapshot;
use super::websocket_server::{
  active_source_id, broadcast_channels, broadcast_signal_display_settings,
  build_channels_snapshot, build_signals_defaults_snapshot,
  build_source_info_snapshot, complex_baseband, resolve_stream_key_source_id,
};
use crate::s::ifft::complex_baseband::canonical_complex_baseband_signal_key;

const MOCK_TX_SOURCE_ID: &str = "mock-tx";
const WS_MAX_MESSAGE_BYTES: usize = 64 * 1024;
// A maximum-size RX frame is 262,144 complex samples = 524,288 interleaved
// I/Q bytes. The multiplexed stream envelope encrypts and base64-encodes that
// payload, producing roughly 700 KiB of JSON. Keep control messages bounded,
// but size the WebSocket frame/write limits for the documented FFT ceiling.
const WS_MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
const WS_MAX_WRITE_BUFFER_BYTES: usize = 2 * 1024 * 1024;

fn harden_websocket(ws: WebSocketUpgrade) -> WebSocketUpgrade {
  ws.max_message_size(WS_MAX_MESSAGE_BYTES)
    .max_frame_size(WS_MAX_FRAME_BYTES)
    .max_write_buffer_size(WS_MAX_WRITE_BUFFER_BYTES)
}

/// Cache kind for `ENCODED_FRAME_CACHE` entries.
///
/// 0 = v1 binary wire payload, 1..=4 = v2 binary wire payload per
/// `IqFrameStatus`, 5 = base64 ciphertext string bytes (JSON transport).
type EncodedFrameCacheKey = (u8, String, u64, u64, u64);

/// Every subscriber of the same frame shares one encryption result.
///
/// The process uses a single global encryption key and each frame is uniquely
/// identified by (source, epoch, sequence, timestamp), so N subscribers of the
/// same broadcast frame can reuse the encoded buffer instead of each paying an
/// AES-GCM pass plus a ~700 KiB allocation per frame per subscriber.
static ENCODED_FRAME_CACHE: std::sync::LazyLock<
  std::sync::Mutex<HashMap<EncodedFrameCacheKey, (std::time::Instant, axum::body::Bytes)>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

const ENCODED_FRAME_CACHE_MAX_ENTRIES: usize = 256;
const ENCODED_FRAME_CACHE_TTL: std::time::Duration =
  std::time::Duration::from_secs(2);
const ENCODED_FRAME_KIND_V1: u8 = 0;
const ENCODED_FRAME_KIND_JSON: u8 = 5;

fn cached_encoded_frame(
  key: EncodedFrameCacheKey,
  encode: impl FnOnce() -> Result<Vec<u8>, ()>,
) -> Result<axum::body::Bytes, ()> {
  if let Ok(cache) = ENCODED_FRAME_CACHE.try_lock() {
    if let Some((stored_at, payload)) = cache.get(&key) {
      if stored_at.elapsed() < ENCODED_FRAME_CACHE_TTL {
        return Ok(payload.clone());
      }
    }
  }

  let payload: axum::body::Bytes = encode()?.into();
  if let Ok(mut cache) = ENCODED_FRAME_CACHE.try_lock() {
    cache.retain(|_, (stored_at, _)| {
      stored_at.elapsed() < ENCODED_FRAME_CACHE_TTL
    });
    if cache.len() >= ENCODED_FRAME_CACHE_MAX_ENTRIES {
      cache.clear();
    }
    cache.insert(key, (std::time::Instant::now(), payload.clone()));
  }
  Ok(payload)
}

fn normalize_tx_signal(signal_name: Option<&str>) -> String {
  let canonical =
    canonical_complex_baseband_signal_key(signal_name.unwrap_or("wifi"));
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

fn is_tx_preview_source(snapshot: &serde_json::Value, source_id: &str) -> bool {
  snapshot["sources"]
    .as_array()
    .and_then(|sources| sources.iter().find(|source| source["id"] == source_id))
    .and_then(|source| source["capability"].as_str())
    .is_some_and(|capability| capability == "tx" || capability == "tx_rx")
}

fn apply_tx_preview_settings(message: &WebSocketMessage) {
  let previous_bandwidth_hz = *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();

  if let Some(center_frequency) = message.center_frequency {
    let center_hz = center_frequency.round().clamp(1.0, u32::MAX as f64);
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = center_hz;
    // Incomplete first preview passes often omit viewCenterHz. Leave the
    // monitor on the carrier so cold-load does not synthesize a noise floor
    // against the process-default 137.1 MHz view.
    if message.view_center_hz.is_none() {
      *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = center_hz;
    }
  }

  if let Some(view_center_hz) = message.view_center_hz {
    let view_hz = view_center_hz.round().clamp(1.0, u32::MAX as f64);
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = view_hz;
  }

  if let Some(sample_rate) = message.sample_rate {
    if sample_rate.is_finite() && sample_rate > 0.0 {
      crate::safety::TX_MONITOR_SAMPLE_RATE_HZ.store(
        sample_rate.round().clamp(1.0, u32::MAX as f64) as u32,
        Ordering::Relaxed,
      );
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
}

/// Build one source-owned Mock Tx monitor frame for an inactive Tx device.
///
/// The normal SDR loop can only read the currently active hardware source.
/// Tx Suite still needs a standby preview while a separate Rx source remains
/// active, so the source-I/Q socket answers an explicit preview request with
/// a frame that never enters the active Rx broadcast path.
pub(crate) fn build_tx_preview_frame(
  shared: &SharedState,
  source_id: &str,
) -> SpectrumData {
  let sdr_settings = shared.sdr_settings.lock().unwrap().clone();
  // A monitor preview must match the configured viewer FFT size. Keeping the
  // payload at that size prevents the browser from truncating a longer Tx
  // IFFT frame before measuring its power.
  let tx_ifft_size = *crate::safety::TX_IFFT_SIZE.lock().unwrap();
  let fft_size = super::websocket_server::resolve_mock_tx_monitor_fft_size(
    sdr_settings.fft.default_size,
    tx_ifft_size,
  );
  let sample_rate = {
    let requested =
      crate::safety::TX_MONITOR_SAMPLE_RATE_HZ.load(Ordering::Relaxed);
    if requested > 0 {
      requested
    } else {
      sdr_settings.sample_rate.max(1)
    }
  };
  let view_center_hz = {
    let requested = *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap();
    if requested > 0.0 {
      requested
    } else {
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap()
    }
  };
  let tx_center_hz = *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap();
  let tx_bandwidth_hz = *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap();
  let tx_power_dbm = *crate::safety::TX_POWER_DBM.lock().unwrap();
  let tx_signal = crate::safety::TX_SIGNAL.lock().unwrap().clone();
  let power_model = complex_baseband::resolve_mock_tx_iq_power_model();
  let raw_iq = complex_baseband::synthesize_mock_tx_monitor_iq_shared_phase(
    fft_size,
    view_center_hz,
    sample_rate,
    if tx_center_hz > 0.0 {
      tx_center_hz
    } else {
      view_center_hz
    },
    tx_bandwidth_hz,
    &tx_signal,
    tx_ifft_size,
    tx_power_dbm,
    &power_model,
    &shared.mock_tx_phase_accumulator,
  );
  build_tx_monitor_frame_from_iq(
    shared,
    source_id,
    view_center_hz,
    sample_rate,
    raw_iq,
    true,
  )
}

/// Build a monitor frame from the exact IQ payload handed to the transmitter.
/// This is the fan-out point: the HackRF TX callback and the monitor stream
/// consume the same generated bytes instead of synthesizing separate waves.
pub(crate) fn build_tx_monitor_frame_from_iq(
  shared: &SharedState,
  source_id: &str,
  view_center_hz: f64,
  sample_rate: u32,
  iq_data: Vec<u8>,
  is_tx_preview: bool,
) -> SpectrumData {
  let (stream_epoch, sequence) = shared.next_stream_frame_identity();

  SpectrumData {
    message_type: "spectrum".to_string(),
    waveform: Vec::new(),
    is_mock_apt: false,
    source_id: source_id.to_string(),
    stream_epoch,
    sequence,
    center_frequency_hz: Some(view_center_hz.round().max(1.0) as u32),
    waveform_span_hz: None,
    timestamp: chrono::Utc::now().timestamp_millis(),
    data_type: Some("iq_raw".to_string()),
    sample_rate: Some(sample_rate),
    power_scale: Some(PowerScale::DBm),
    iq_data,
    is_tx_preview: is_tx_preview.then_some(true),
  }
}

pub(crate) fn build_mock_tx_standby_preview_frame(
  shared: &SharedState,
) -> SpectrumData {
  build_tx_preview_frame(shared, MOCK_TX_SOURCE_ID)
}

fn is_transmit_status(status: Option<&str>) -> bool {
  matches!(
    status
      .map(|value| value.trim().to_ascii_lowercase())
      .as_deref(),
    Some("transmitting")
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

  harden_websocket(ws).on_upgrade(move |socket| {
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
  let has_iq_format = source_snapshot["sources"]
    .as_array()
    .and_then(|sources| {
      sources
        .iter()
        .find(|source| source["id"].as_str() == Some(source_id.as_str()))
    })
    .and_then(|source| source.get("iq_format"))
    .is_some_and(serde_json::Value::is_object);
  if !has_iq_format {
    return (
      StatusCode::BAD_REQUEST,
      "Source does not advertise a supported I/Q format",
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

  harden_websocket(ws).on_upgrade(move |socket| {
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

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum StreamCommand {
  #[serde(rename = "stream_subscribe")]
  Subscribe {
    #[serde(default = "default_subscriber_scope")]
    scope: StreamControlScope,
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    stream: StreamKey,
    options: StreamOptions,
    #[serde(default)]
    delivery_policy: StreamDeliveryPolicy,
  },
  #[serde(rename = "stream_update_options")]
  UpdateOptions {
    #[serde(default = "default_device_scope")]
    scope: StreamControlScope,
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    stream: StreamKey,
    options: StreamOptions,
  },
  #[serde(rename = "stream_unsubscribe")]
  Unsubscribe {
    #[serde(default = "default_subscriber_scope")]
    scope: StreamControlScope,
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    stream: StreamKey,
  },
  #[serde(rename = "stream_set_paused")]
  SetPaused {
    #[serde(default = "default_subscriber_scope")]
    scope: StreamControlScope,
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    stream: StreamKey,
    paused: bool,
  },
  #[serde(rename = "stream_set_delivery")]
  SetDelivery {
    #[serde(default = "default_subscriber_scope")]
    scope: StreamControlScope,
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    stream: StreamKey,
    #[serde(rename = "deliveryPolicy")]
    delivery_policy: StreamDeliveryPolicy,
  },
}

fn stream_rx_processor_settings(
  options: &super::stream_manager::RxStreamOptions,
) -> Option<(u32, super::types::SdrProcessorSettings)> {
  // Bounds mirroring the control-plane (`WebSocketMessage`) validators so an
  // out-of-range stream option (e.g. fft_size: u64::MAX) can never reach device
  // state and corrupt the acquisition pipeline.
  if options.sample_rate_hz == 0 || options.sample_rate_hz > 100_000_000 {
    return None;
  }
  if options.fft_size < 256 || options.fft_size > 8_388_608 {
    return None;
  }
  if let Some(frame_rate) = options.frame_rate {
    if frame_rate == 0 || frame_rate > 100 {
      return None;
    }
  }
  if let Some(gain) = options.gain {
    if !gain.is_finite() || gain > 100.0 {
      return None;
    }
  }
  let center_frequency_hz = u32::try_from(options.center_frequency_hz).ok()?;
  if center_frequency_hz == 0 {
    return None;
  }
  Some((
    center_frequency_hz,
    super::types::SdrProcessorSettings {
      sample_rate: Some(options.sample_rate_hz),
      fft_size: Some(options.fft_size),
      fft_window: options.fft_window.clone(),
      frame_rate: options.frame_rate,
      gain: options.gain,
      ..Default::default()
    },
  ))
}

/// Validate Tx stream options before they reach the device-owned Tx stream.
fn stream_tx_options_valid(options: &super::stream_manager::TxStreamOptions) -> bool {
  // Battery/power limits are enforced separately by the safety layer; here we
  // only reject values that would desync the IFFT device state.
  options.center_frequency_hz > 0
    && options.sample_rate_hz > 0
    && options.sample_rate_hz <= 100_000_000
    && (options.ifft_size >= 256 && options.ifft_size <= 8_388_608)
    && options.power_dbm.is_finite()
}

/// Tells whether a `StreamOptions` value is within documented runtime bounds.
/// Central gate used by both `stream_subscribe` and `stream_update_options` so
/// an out-of-range option can never reach device state.
pub fn stream_options_valid(options: &super::stream_manager::StreamOptions) -> bool {
  match options {
    super::stream_manager::StreamOptions::Rx(rx) => stream_rx_processor_settings(rx).is_some(),
    super::stream_manager::StreamOptions::Tx(tx) => stream_tx_options_valid(tx),
  }
}

fn apply_rx_stream_device_options(
  shared: &SharedState,
  center_frequency_hz: u32,
  settings: super::types::SdrProcessorSettings,
) {
  shared.request_center_frequency(center_frequency_hz);
  shared.enqueue_pending_fast_settings(settings.clone());
  let mut current = shared.sdr_settings.lock().unwrap();
  current.center_frequency = center_frequency_hz;
  if let Some(sample_rate) = settings.sample_rate {
    current.sample_rate = sample_rate;
  }
  if let Some(fft_size) = settings.fft_size {
    current.fft.default_size = fft_size;
  }
  if let Some(frame_rate) = settings.frame_rate {
    current.fft.default_frame_rate = frame_rate;
  }
  if let Some(gain) = settings.gain {
    current.gain.tuner_gain = gain;
  }
}

fn default_subscriber_scope() -> StreamControlScope {
  StreamControlScope::Subscriber
}

fn default_device_scope() -> StreamControlScope {
  StreamControlScope::Device
}

fn stream_control_scopes(mode: StreamMode) -> serde_json::Value {
  serde_json::json!({
    "pause": stream_control_scope(mode, StreamControlAction::Pause),
    "stop": stream_control_scope(mode, StreamControlAction::Stop),
    "settings": stream_control_scope(mode, StreamControlAction::Settings),
    "tune": stream_control_scope(mode, StreamControlAction::Tune),
  })
}

fn stream_source_capabilities(
  shared: &SharedState,
  source_id: &str,
) -> Option<SourceStreamCapabilities> {
  let snapshot = build_source_info_snapshot(shared);
  let source = snapshot["sources"]
    .as_array()?
    .iter()
    .find(|source| source["id"].as_str() == Some(source_id))?;
  let capability = source["capability"].as_str().unwrap_or("rx");
  let duplex_mode = source["duplex_mode"].as_str().unwrap_or("");
  Some(SourceStreamCapabilities {
    can_receive: matches!(capability, "rx" | "tx_rx" | "mock"),
    can_transmit: matches!(capability, "tx" | "tx_rx"),
    full_duplex: duplex_mode.eq_ignore_ascii_case("full_duplex")
      || duplex_mode.eq_ignore_ascii_case("full-duplex"),
  })
}

fn clamp_sample_rate_to_source(
  requested: u32,
  max_sample_rate: Option<u32>,
) -> u32 {
  requested.min(max_sample_rate.unwrap_or(u32::MAX).max(1))
}

fn active_source_max_sample_rate(shared: &SharedState) -> Option<u32> {
  let source_id = active_source_id(shared);
  let snapshot = build_source_info_snapshot(shared);
  snapshot["sources"]
    .as_array()?
    .iter()
    .find(|source| source["id"].as_str() == Some(source_id.as_str()))?
    .get("sdr")?
    .get("max_sample_rate")?
    .as_u64()
    .and_then(|rate| u32::try_from(rate).ok())
}

#[cfg(test)]
mod sample_rate_tests {
  use super::clamp_sample_rate_to_source;

  #[test]
  fn clamps_requested_rate_to_active_source_limit() {
    assert_eq!(
      clamp_sample_rate_to_source(4_372_000, Some(3_200_000)),
      3_200_000
    );
  }

  #[test]
  fn preserves_requested_rate_when_source_has_capacity() {
    assert_eq!(
      clamp_sample_rate_to_source(4_372_000, Some(20_000_000)),
      4_372_000
    );
  }
}

pub fn stream_event_json(
  event: &StreamEvent,
  enc_key: &[u8; 32],
) -> Result<serde_json::Value, String> {
  let base = |key: &StreamKey, epoch: u64, revision: u64| {
    serde_json::json!({
      "sourceId": key.source_id,
      "mode": key.mode,
      "streamEpoch": epoch,
      "optionsRevision": revision,
    })
  };
  match event {
    StreamEvent::Opened {
      key,
      stream_epoch,
      options_revision,
      options,
    } => {
      let mut value = base(key, *stream_epoch, *options_revision);
      value["type"] = serde_json::json!("stream_opened");
      value["scope"] = serde_json::json!("device");
      value["options"] =
        serde_json::to_value(options).map_err(|e| e.to_string())?;
      Ok(value)
    }
    StreamEvent::OptionsApplied {
      key,
      stream_epoch,
      options_revision,
      options,
    } => {
      let mut value = base(key, *stream_epoch, *options_revision);
      value["type"] = serde_json::json!("stream_options_applied");
      value["scope"] = serde_json::json!("device");
      value["options"] =
        serde_json::to_value(options).map_err(|e| e.to_string())?;
      Ok(value)
    }
    StreamEvent::Frame(frame) => {
      // Connections receiving the same frame share one encrypt+base64 pass.
      let cache_key: EncodedFrameCacheKey = (
        ENCODED_FRAME_KIND_JSON,
        frame.key.source_id.clone(),
        frame.stream_epoch,
        frame.sequence,
        frame.timestamp as u64,
      );
      let encoded_iq = cached_encoded_frame(cache_key, || {
        let encrypted =
          crate::crypto::encrypt_payload_binary(enc_key, &frame.iq_data)
            .map_err(|_| ())?;
        Ok(
          base64::engine::general_purpose::STANDARD
            .encode(encrypted)
            .into_bytes(),
        )
      })
      .map_err(|_| "I/Q data encryption failed".to_string())?;
      let mut value =
        base(&frame.key, frame.stream_epoch, frame.options_revision);
      value["type"] = serde_json::json!("stream_frame");
      value["sequence"] = serde_json::json!(frame.sequence);
      value["timestamp"] = serde_json::json!(frame.timestamp);
      value["centerFrequencyHz"] = serde_json::json!(frame.center_frequency_hz);
      value["sampleRateHz"] = serde_json::json!(frame.sample_rate_hz);
      value["dataType"] = serde_json::json!("iq_raw");
      value["encrypted"] = serde_json::json!(true);
      value["iqData"] = serde_json::Value::String(
        String::from_utf8_lossy(&encoded_iq).into_owned(),
      );
      Ok(value)
    }
    StreamEvent::State {
      key,
      stream_epoch,
      options_revision,
      state,
      reason,
    } => {
      let mut value = base(key, *stream_epoch, *options_revision);
      value["type"] = serde_json::json!("stream_state");
      value["state"] = serde_json::json!(match state {
        StreamState::Opening => "opening",
        StreamState::Ready => "ready",
        StreamState::Stopping => "stopping",
        StreamState::Unavailable => "unavailable",
        StreamState::Error => "error",
      });
      value["reason"] = serde_json::json!(reason);
      Ok(value)
    }
    StreamEvent::Error {
      key,
      stream_epoch,
      options_revision,
      code,
      message,
    } => {
      let mut value = base(key, *stream_epoch, *options_revision);
      value["type"] = serde_json::json!("stream_error");
      value["code"] = serde_json::json!(code);
      value["message"] = serde_json::json!(message);
      Ok(value)
    }
  }
}

fn stream_error_json(
  subscription_id: &str,
  stream: &StreamKey,
  code: &str,
  message: &str,
) -> serde_json::Value {
  serde_json::json!({
    "type": "stream_error",
    "subscriptionId": subscription_id,
    "sourceId": stream.source_id,
    "mode": stream.mode,
    "streamEpoch": 0,
    "optionsRevision": 0,
    "code": code,
    "message": message,
  })
}

/// GET /ws/streams?token=<session_token> — authenticated multiplexed stream transport.
pub async fn stream_ws_upgrade_handler(
  ws: WebSocketUpgrade,
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

  let manager = state.stream_manager.clone();
  let shared = state.shared.clone();
  let enc_key = shared.encryption_key;
  harden_websocket(ws).on_upgrade(move |socket| {
    handle_stream_connection(socket, shared, manager, enc_key)
  })
}

async fn handle_stream_connection(
  socket: WebSocket,
  shared: Arc<SharedState>,
  manager: StreamingSourceModeManager,
  enc_key: [u8; 32],
) {
  let (mut sender, mut receiver) = socket.split();
  let (event_tx, mut event_rx) = mpsc::channel::<StreamEvent>(32);
  let mut subscriptions: HashMap<String, (StreamKey, u64, JoinHandle<()>)> =
    HashMap::new();
  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);

  loop {
    tokio::select! {
      Some(event) = event_rx.recv() => {
        let Ok(payload) = stream_event_json(&event, &enc_key) else {
          continue;
        };
        if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
          break;
        }
      }
      message = receiver.next() => {
        let Some(Ok(message)) = message else { break; };
        let Message::Text(text) = message else {
          if matches!(message, Message::Close(_)) { break; }
          continue;
        };
        let Ok(command) = serde_json::from_str::<StreamCommand>(&text) else {
          let _ = sender.send(Message::Text(serde_json::json!({
            "type": "stream_error",
            "code": "protocol",
            "message": "invalid stream command",
          }).to_string().into())).await;
          continue;
        };
        match command {
          StreamCommand::Subscribe { scope, subscription_id, stream, options, delivery_policy } => {
            if scope != StreamControlScope::Subscriber {
              let error = stream_error_json(&subscription_id, &stream, "scope", "stream subscriptions are subscriber-scoped");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            if subscriptions.contains_key(&subscription_id) {
              let error = stream_error_json(&subscription_id, &stream, "protocol", "subscription id is already active");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            let Some(capabilities) = stream_source_capabilities(&shared, &stream.source_id) else {
              let error = stream_error_json(&subscription_id, &stream, "capability", "unknown source");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            };
            if !stream_options_valid(&options) {
              let error = stream_error_json(&subscription_id, &stream, "options", "invalid stream options");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            manager.register_source(stream.source_id.clone(), capabilities);
            let source_snapshot = build_source_info_snapshot(&shared);
            let source_status = source_snapshot["sources"]
              .as_array()
              .and_then(|sources| {
                sources
                  .iter()
                  .find(|source| source["id"].as_str() == Some(stream.source_id.as_str()))
              })
              .and_then(|source| source["status"].as_str())
              .unwrap_or("disconnected");
            let source_is_active = active_source_id(&shared) == stream.source_id;
            let stream_state = match source_status {
              "connected" | "receiving" | "streaming" | "transmitting"
                if source_is_active => "ready",
              "standby" if stream.mode == super::stream_manager::StreamMode::Tx => "opening",
              "loading" | "initializing" => "opening",
              _ => "unavailable",
            };
            let subscription = match manager.subscribe_with_policy(
              stream.clone(),
              options,
              delivery_policy,
            ) {
              Ok(subscription) => subscription,
              Err(error) => {
                let response = stream_error_json(&subscription_id, &stream, error.code(), &error.to_string());
                let _ = sender.send(Message::Text(response.to_string().into())).await;
                continue;
              }
            };
            let metrics = manager.metrics(&stream).expect("new stream has metrics");
            let manager_subscription_id = subscription.subscription_id();
            let response = serde_json::json!({
              "type": "stream_subscribed",
              "subscriptionId": subscription_id,
              "sourceId": stream.source_id,
              "mode": stream.mode,
              "streamEpoch": metrics.stream_epoch,
              "optionsRevision": metrics.options_revision,
              "effectiveOptions": manager.options(&stream),
              "deliveryPolicy": subscription.delivery_policy(),
              "state": stream_state,
              "controlScopes": stream_control_scopes(stream.mode),
            });
            let event_tx_for_task = event_tx.clone();
            let event_key = stream.clone();
            let task = tokio::spawn(async move {
              let mut subscription = subscription;
              loop {
                match subscription.recv().await {
                  Ok(event) => {
                    if event_tx_for_task.send(event).await.is_err() { break; }
                  }
                  Err(broadcast::error::RecvError::Lagged(count)) => {
                    if event_tx_for_task.send(StreamEvent::Error {
                      key: event_key.clone(),
                      stream_epoch: 0,
                      options_revision: 0,
                      code: "lagged".to_string(),
                      message: format!("subscriber lagged by {count} frames"),
                    }).await.is_err() { break; }
                  }
                  Err(broadcast::error::RecvError::Closed) => break,
                }
              }
            });
            subscriptions.insert(subscription_id, (stream, manager_subscription_id, task));
            // Register the subscription before acknowledging it. The client
            // treats stream_subscribed as permission to immediately apply
            // effective options; sending the acknowledgement first creates a
            // race where update_options sees a missing subscription.
            if sender.send(Message::Text(response.to_string().into())).await.is_err() {
              break;
            }
          }
          StreamCommand::UpdateOptions { scope, subscription_id, stream, options } => {
            if scope != StreamControlScope::Device {
              let error = stream_error_json(&subscription_id, &stream, "scope", "stream options are device-scoped");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            let Some((active_stream, _, _)) = subscriptions.get(&subscription_id) else {
              let error = stream_error_json(&subscription_id, &stream, "missing_stream", "subscription is not active");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            };
            if active_stream != &stream {
              let error = stream_error_json(&subscription_id, &stream, "protocol", "subscription stream does not match");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            if !stream_options_valid(&options) {
              let response = stream_error_json(
                &subscription_id,
                &stream,
                "options",
                "invalid stream options",
              );
              let _ = sender.send(Message::Text(response.to_string().into())).await;
              continue;
            }
            let rx_device_settings = match &options {
              StreamOptions::Rx(rx_options) => {
                let Some(settings) = stream_rx_processor_settings(rx_options) else {
                  let response = stream_error_json(
                    &subscription_id,
                    &stream,
                    "options",
                    "invalid RX stream options",
                  );
                  let _ = sender.send(Message::Text(response.to_string().into())).await;
                  continue;
                };
                Some(settings)
              }
              StreamOptions::Tx(_) => None,
            };
            match manager.update_options(&stream, options) {
              Err(error) => {
                let response = stream_error_json(&subscription_id, &stream, error.code(), &error.to_string());
                let _ = sender.send(Message::Text(response.to_string().into())).await;
              }
              Ok((_, _, true)) => {
                if let Some((center_frequency_hz, settings)) = rx_device_settings {
                  // Managed RX options are device-scoped, not presentation-only.
                  // Apply them through the same lock-free acquisition path used by
                  // legacy settings and VFO commands so accepted stream revisions
                  // cannot keep publishing frames from the previous channel.
                  apply_rx_stream_device_options(
                    &shared,
                    center_frequency_hz,
                    settings,
                  );
                }
              }
              Ok((_, _, false)) => {
                // A duplicate write is already represented by the authoritative
                // stream revision. Do not enqueue another hardware application
                // or create another frontend feedback event.
              }
            }
          }
          StreamCommand::SetPaused { scope, subscription_id, stream, paused } => {
            if scope != StreamControlScope::Subscriber
              || stream_control_scope(stream.mode, StreamControlAction::Pause)
                != StreamControlScope::Subscriber
            {
              let error = stream_error_json(&subscription_id, &stream, "scope", "stream pause is subscriber-scoped");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            let Some((active_stream, manager_subscription_id, _)) = subscriptions.get(&subscription_id) else {
              let error = stream_error_json(&subscription_id, &stream, "missing_stream", "subscription is not active");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            };
            if active_stream != &stream {
              let error = stream_error_json(&subscription_id, &stream, "protocol", "subscription stream does not match");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            if let Err(error) = manager.set_subscriber_paused(
              &stream,
              *manager_subscription_id,
              paused,
            ) {
              let response = stream_error_json(
                &subscription_id,
                &stream,
                error.code(),
                &error.to_string(),
              );
              let _ = sender.send(Message::Text(response.to_string().into())).await;
            }
          }
          StreamCommand::SetDelivery { scope, subscription_id, stream, delivery_policy } => {
            if scope != StreamControlScope::Subscriber {
              let error = stream_error_json(&subscription_id, &stream, "scope", "stream delivery policy is subscriber-scoped");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            let Some((active_stream, manager_subscription_id, _)) = subscriptions.get(&subscription_id) else {
              let error = stream_error_json(&subscription_id, &stream, "missing_stream", "subscription is not active");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            };
            if active_stream != &stream {
              let error = stream_error_json(&subscription_id, &stream, "protocol", "subscription stream does not match");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            if let Err(error) = manager.set_subscriber_delivery_policy(
              &stream,
              *manager_subscription_id,
              delivery_policy,
            ) {
              let response = stream_error_json(
                &subscription_id,
                &stream,
                error.code(),
                &error.to_string(),
              );
              let _ = sender.send(Message::Text(response.to_string().into())).await;
            }
          }
          StreamCommand::Unsubscribe { scope, subscription_id, stream } => {
            if scope != StreamControlScope::Subscriber {
              let error = stream_error_json(&subscription_id, &stream, "scope", "stream unsubscribe is subscriber-scoped");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            }
            let Some((active_stream, _, task)) = subscriptions.remove(&subscription_id) else {
              let error = stream_error_json(&subscription_id, &stream, "missing_stream", "subscription is not active");
              let _ = sender.send(Message::Text(error.to_string().into())).await;
              continue;
            };
            task.abort();
            let response = serde_json::json!({
              "type": "stream_unsubscribe",
              "subscriptionId": subscription_id,
              "sourceId": active_stream.source_id,
              "mode": active_stream.mode,
            });
            if sender.send(Message::Text(response.to_string().into())).await.is_err() {
              break;
            }
          }
        }
      }
    }
  }

  for (_, (_, _, task)) in subscriptions {
    task.abort();
  }
  shared.client_count.fetch_sub(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
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
pub fn encode_encrypted_iq_frame_v1(
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
pub enum IqStreamProtocol {
  V1,
  V2,
}

/// Presentation role carried by the negotiated v2 I/Q envelope.
///
/// Epoch and sequence identify ordering, but they do not identify whether a
/// frame belongs to the Rx stream or to a Tx preview. Keep the wire values
/// stable because the first byte of the six-byte status/reserved area is used
/// for this enum and the remaining five bytes are reserved for future fields.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IqFrameStatus {
  Receiving = 0,
  Standby = 1,
  Transmitting = 2,
  Paused = 3,
}

fn resolve_iq_frame_status(
  spectrum_data: &SpectrumData,
  is_paused: bool,
  is_tx_monitor: bool,
) -> IqFrameStatus {
  if spectrum_data.is_tx_preview == Some(true) {
    IqFrameStatus::Standby
  } else if is_tx_monitor {
    IqFrameStatus::Transmitting
  } else if is_paused {
    IqFrameStatus::Paused
  } else {
    IqFrameStatus::Receiving
  }
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
/// Layout: `NAPT`, version, flags, header length, source length, frame status,
/// five reserved bytes, stream epoch, sequence, timestamp, center frequency,
/// data type, sample rate, UTF-8 source ID, then the encrypted sample payload.
/// The source, generation, and presentation metadata let clients reject late
/// async decryptions and stale Tx preview frames without modifying the
/// checksum-sensitive waveform bytes.
pub fn encode_encrypted_iq_frame_v2(
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
  source_id: &str,
  stream_epoch: u64,
  sequence: u64,
  frame_status: IqFrameStatus,
) -> Result<Vec<u8>, ()> {
  const FIXED_HEADER_LEN: usize = 56;
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
  payload.push(frame_status as u8);
  payload.extend_from_slice(&[0; 5]); // reserved for future frame metadata
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

pub fn encode_encrypted_iq_frame(
  protocol: IqStreamProtocol,
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
  source_id: &str,
  stream_epoch: u64,
  sequence: u64,
  frame_status: IqFrameStatus,
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
      frame_status,
    ),
  }
}

async fn send_encrypted_iq_frame(
  ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
  enc_key: &[u8; 32],
  spectrum_data: &super::types::SpectrumData,
  protocol: IqStreamProtocol,
  frame_status: IqFrameStatus,
) -> Result<(), ()> {
  let metrics = crate::performance::pipeline_metrics();
  let binary_payload = {
    let _span = crate::performance::ProfilingSpan::start(
      metrics,
      crate::performance::Stage::EncryptSerialize,
    );
    // Subscribers of the same broadcast frame share one encoded payload.
    let cache_key: EncodedFrameCacheKey = (
      match protocol {
        IqStreamProtocol::V1 => ENCODED_FRAME_KIND_V1,
        IqStreamProtocol::V2 => 1 + frame_status as u8,
      },
      spectrum_data.source_id.clone(),
      spectrum_data.stream_epoch,
      spectrum_data.sequence,
      spectrum_data.timestamp as u64,
    );
    cached_encoded_frame(cache_key, || {
      encode_encrypted_iq_frame(
        protocol,
        enc_key,
        spectrum_data,
        &spectrum_data.source_id,
        spectrum_data.stream_epoch,
        spectrum_data.sequence,
        frame_status,
      )
    })?
  };
  metrics.increment(crate::performance::CounterKind::Copies, 1);
  metrics.increment(
    crate::performance::CounterKind::CopiedBytes,
    binary_payload.len() as u64,
  );

  // Binary frames keep the hot data path compact and avoid JSON encoding costs.
  let _span = crate::performance::ProfilingSpan::start(
    metrics,
    crate::performance::Stage::WebSocketSend,
  );
  let result = ws_sender
    .send(Message::Binary(binary_payload.into()))
    .await
    .map_err(|_| ());
  if result.is_ok() {
    metrics.increment(crate::performance::CounterKind::FramesConsumed, 1);
  }
  result
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
  is_tx_monitor_source_id(source_id) && tx_transmitting
}

fn is_tx_monitor_source_id(source_id: &str) -> bool {
  matches!(source_id, "mock-tx" | "mock-apt" | "hackrf_one")
    || source_id.starts_with("hackrf_one-")
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

fn is_frame_after_paused_request(
  frame_epoch: u64,
  frame_sequence: u64,
  request_epoch: u64,
  request_sequence_floor: u64,
) -> bool {
  frame_epoch == request_epoch && frame_sequence > request_sequence_floor
}

/// Return a paused-frame request only when it belongs to this source socket.
///
/// The global allowance is deliberately never swapped here: doing so would
/// let an old source socket consume a request intended for the newly selected
/// source before that source can publish its first frame.
fn take_source_owned_paused_frame_request(
  shared: &SharedState,
  source_id: &str,
) -> Option<(u64, u64)> {
  shared.paused_frame_request_for_source(source_id)
}

fn drain_latest_source_iq_frame(
  spectrum_rx: &mut broadcast::Receiver<Arc<super::types::SpectrumData>>,
  source_id: &str,
  iq_protocol: IqStreamProtocol,
  mut latest: Arc<super::types::SpectrumData>,
) -> Arc<super::types::SpectrumData> {
  loop {
    match spectrum_rx.try_recv() {
      Ok(candidate) => {
        let matches_source = match iq_protocol {
          IqStreamProtocol::V2 => {
            source_iq_v2_frame_matches_source(source_id, &candidate.source_id)
          }
          IqStreamProtocol::V1 => {
            source_iq_frame_matches_source(source_id, candidate.is_mock_apt)
          }
        };
        if matches_source {
          latest = candidate;
        }
      }
      Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
      Err(
        broadcast::error::TryRecvError::Empty
        | broadcast::error::TryRecvError::Closed,
      ) => break,
    }
  }
  latest
}

fn drain_latest_source_iq_frame_after_request(
  spectrum_rx: &mut broadcast::Receiver<Arc<super::types::SpectrumData>>,
  source_id: &str,
  iq_protocol: IqStreamProtocol,
  request_epoch: u64,
  request_sequence_floor: u64,
  initial: Arc<super::types::SpectrumData>,
) -> Option<Arc<super::types::SpectrumData>> {
  let is_valid_frame = |candidate: &Arc<super::types::SpectrumData>| -> bool {
    let matches_source = match iq_protocol {
      IqStreamProtocol::V2 => {
        source_iq_v2_frame_matches_source(source_id, &candidate.source_id)
      }
      IqStreamProtocol::V1 => {
        source_iq_frame_matches_source(source_id, candidate.is_mock_apt)
      }
    };
    matches_source
      && is_frame_after_paused_request(
        candidate.stream_epoch,
        candidate.sequence,
        request_epoch,
        request_sequence_floor,
      )
  };

  if is_valid_frame(&initial) {
    return Some(initial);
  }

  while let Ok(candidate) = spectrum_rx.try_recv() {
    if is_valid_frame(&candidate) {
      return Some(candidate);
    }
  }
  None
}

#[cfg(test)]
fn source_kind_hint_from_id(source_id: &str) -> Option<&'static str> {
  if source_id.starts_with("rtl-sdr") || source_id.starts_with("rtl_sdr") {
    return Some("rtl-sdr");
  }
  if source_id.starts_with("hackrf_one") || source_id.starts_with("hackrf") {
    return Some("hackrf_one");
  }
  None
}

#[cfg(test)]
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
  _stream_key: String,
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
            let is_paused = shared.is_paused.load(Ordering::SeqCst);
            let paused_request = if is_paused {
              take_source_owned_paused_frame_request(&shared, &source_id)
            } else {
              None
            };
            let spectrum_data = if let Some((request_epoch, request_floor)) =
              paused_request
            {
              let Some(fresh_frame) = drain_latest_source_iq_frame_after_request(
                &mut spectrum_rx,
                &source_id,
                iq_protocol,
                request_epoch,
                request_floor,
                spectrum_data,
              ) else {
                // Keep the request token armed. The next broadcast may be the
                // first frame produced after the new settings are applied.
                continue;
              };
              shared.clear_paused_frame_request();
              fresh_frame
            } else {
              drain_latest_source_iq_frame(
                &mut spectrum_rx,
                &source_id,
                iq_protocol,
                spectrum_data,
              )
            };
            let allow_next_paused_frame = paused_request.is_some();
            let is_tx_monitor =
              is_tx_monitor_source_id(&source_id)
                && crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed);
            if !should_send_source_iq_frame(
              &source_id,
              is_paused,
              allow_next_paused_frame,
              is_tx_monitor,
            ) {
              continue;
            }
            if send_encrypted_iq_frame(
              &mut ws_sender,
              &enc_key,
              &spectrum_data,
              iq_protocol,
              resolve_iq_frame_status(
                &spectrum_data,
                is_paused,
                is_tx_monitor,
              ),
            ).await.is_err() {
              break;
            }
          }
          Err(broadcast::error::RecvError::Lagged(n)) => {
            crate::performance::pipeline_metrics().increment(
              crate::performance::CounterKind::FramesDropped,
              n,
            );
            debug!("Source I/Q client lagged by {} spectrum frames, skipping", n);
            continue;
          }
          Err(_) => break,
        }
      }
      client_msg = ws_receiver.next() => {
        match client_msg {
          Some(Ok(Message::Close(_))) | None => break,
          Some(Ok(Message::Text(text))) => {
            if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
              if message.message_type == "request_next_frame" {
                let snapshot = build_source_info_snapshot(&shared);
                let is_tx_source = is_tx_preview_source(&snapshot, &source_id);
                if is_tx_source {
                  apply_tx_preview_settings(&message);
                }
                if is_tx_source && source_id != MOCK_TX_SOURCE_ID {
                  let frame = build_tx_preview_frame(&shared, &source_id);
                  if send_encrypted_iq_frame(
                    &mut ws_sender,
                    &enc_key,
                    &frame,
                    iq_protocol,
                    IqFrameStatus::Standby,
                  )
                  .await
                  .is_err()
                  {
                    break;
                  }
                } else if source_id == MOCK_TX_SOURCE_ID {
                  // Mock Tx standby deliberately does not run through the
                  // general SDR loop. A source-I/Q request must therefore
                  // synthesize and return its preview here; merely arming a
                  // paused-frame token leaves the monitor with no producer.
                  let frame = build_mock_tx_standby_preview_frame(&shared);
                  if send_encrypted_iq_frame(
                    &mut ws_sender,
                    &enc_key,
                    &frame,
                    iq_protocol,
                    IqFrameStatus::Standby,
                  )
                  .await
                  .is_err()
                  {
                    break;
                  }
                }
              }
            }
          }
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
  let connection_id = shared.next_connection_id();

  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);
  let _ = reconcile_stale_device_snapshot(&shared);

  // Send initial source snapshot
  let initial_defaults = build_signals_defaults_snapshot();
  if let Ok(defaults_json) = serde_json::to_string(&initial_defaults) {
    if ws_sender
      .send(Message::Text(defaults_json.into()))
      .await
      .is_err()
    {
      shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
      shared.client_count.fetch_sub(1, Ordering::Relaxed);
      return;
    }
  }

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
  let paused = shared.is_source_paused(&active_id);
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
              || plaintext_json.contains("\"type\":\"signals_defaults\"")
              || plaintext_json.contains("\"type\":\"capture_status\"")
              || plaintext_json.contains("\"type\":\"channels\"")
              // A source-switch failure must reach the initiating browser;
              // otherwise its local selection waits forever for an active
              // source confirmation that will never arrive.
              || plaintext_json.contains("\"type\":\"error\"")
              // TX safety state changes gate the transmit UI; dropping them
              // left clients showing stale safety limits.
              || plaintext_json.contains("\"type\":\"tx_safety\"")
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
                  // Track capture ownership before dispatching: this socket
                  // disconnecting must only stop captures it started, never
                  // another client's in-flight job.
                  let mut message = message;
                  if message.message_type == "capture_start" {
                    let job_id = message
                      .job_id
                      .get_or_insert_with(|| uuid::Uuid::new_v4().to_string());
                    shared.register_capture_owner(job_id, connection_id);
                  } else if message.message_type == "capture_stop" {
                    if let Some(job_id) = &message.job_id {
                      shared.clear_capture_owner_if(job_id);
                    }
                  }
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

  // Stop only a capture this connection started. `job_id: None` would stop
  // whatever capture is running globally, letting one client's refresh abort
  // another client's in-flight capture.
  if let Some(job_id) = shared.take_owned_capture_for_connection(connection_id)
  {
    let _ = cmd_tx.send(super::types::SdrCommand::StopCapture {
      job_id: Some(job_id),
    });
  }

  shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
  shared.client_count.fetch_sub(1, Ordering::Relaxed);
}

/// Handle incoming WebSocket messages from clients.
/// Sends commands to the dedicated I/O thread via mpsc channel — never blocks.
fn is_device_scoped_control(message: &WebSocketMessage) -> bool {
  match message.message_type.as_str() {
    "frequency_range"
    | "set_frequency_range"
    | "demod_tune"
    | "gain"
    | "ppm"
    | "settings"
    | "restart_device"
    | "select_source" => true,
    "status" => message.source_id.is_none(),
    _ => false,
  }
}

fn resolve_display_viewport(
  message: &WebSocketMessage,
) -> Option<DisplayViewport> {
  let min_hz = message.display_min_hz?;
  let max_hz = message.display_max_hz?;
  if !min_hz.is_finite() || !max_hz.is_finite() || max_hz <= min_hz {
    return None;
  }

  let hardware_center = match (message.min_freq, message.max_freq) {
    (Some(min), Some(max)) if min.is_finite() && max.is_finite() => {
      (min + max) / 2.0
    }
    _ => (min_hz + max_hz) / 2.0,
  };
  let display_center = (min_hz + max_hz) / 2.0;
  let pan_hz = message
    .display_pan_hz
    .filter(|pan| pan.is_finite())
    .unwrap_or(display_center - hardware_center);
  let zoom = message
    .display_zoom
    .filter(|zoom| zoom.is_finite() && *zoom > 0.0)
    .unwrap_or(1.0);

  Some(DisplayViewport {
    min_hz,
    max_hz,
    pan_hz,
    zoom,
    crosses_dc: message
      .display_crosses_dc
      .unwrap_or(min_hz < 0.0 && max_hz > 0.0),
    direction_negative: message
      .display_direction_negative
      .unwrap_or(pan_hz < 0.0),
    mirror_below_zero: message.mirror_spectrum_below_zero.unwrap_or(false),
  })
}

pub fn handle_message(
  cmd_tx: &std::sync::mpsc::Sender<super::types::SdrCommand>,
  shared: &Arc<SharedState>,
  broadcast_tx: &tokio::sync::broadcast::Sender<String>,
  message: WebSocketMessage,
) {
  if is_device_scoped_control(&message)
    && message.scope == Some(StreamControlScope::Subscriber)
  {
    warn!(
      "Ignoring subscriber-scoped device control: type={}",
      message.message_type
    );
    return;
  }

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

        shared.set_channel_selection(
          message.signal_area.clone(),
          (min_freq, _max_freq),
        );
        // A legacy or mirror-disabled client has no signed viewport to share;
        // clear the previous presentation instead of replaying stale negative
        // coordinates to the next subscriber.
        shared.set_display_viewport(resolve_display_viewport(&message));
        {
          let mut sdr_settings = shared.sdr_settings.lock().unwrap();
          sdr_settings.center_frequency = center_freq;
        }
        // The control command is device-scoped. Echo the authoritative
        // selection to every subscriber and include it in the next client's
        // initial channels snapshot for hydration. The origin tag rides along
        // so the tuning client can drop its own echo; foreign subscribers
        // still apply it as an authoritative retune.
        *shared.last_tune_origin_id.lock().unwrap() = message.origin_id.clone();
        broadcast_channels(shared, broadcast_tx);

        // Retunes are the highest-frequency control path. Publish the latest
        // value atomically and wake the frame loop; do not enqueue one mutex-
        // taking command per VFO pointer event.
        shared.request_center_frequency(center_freq);
      }
    }
    "request_next_frame" => {
      let source_id = message
        .source_id
        .clone()
        .unwrap_or_else(|| active_source_id(shared));
      let active_source = active_source_id(shared);
      let pending_switch = shared.pending_source_switch();
      let is_active = source_id == active_source;
      let is_pending_target =
        pending_switch.as_deref() == Some(source_id.as_str());
      let is_mock_tx_standby = source_id == MOCK_TX_SOURCE_ID;
      // A bound half-duplex Tx source (e.g. HackRF in Tx standby while a
      // separate Rx source remains active) is a valid preview target even
      // though it is not the active streaming source. The Tx monitor owns its
      // synthesized payload, so route the one-shot through RequestNextFrame
      // exactly like the active-source path.
      let snapshot = build_source_info_snapshot(shared);
      let is_tx_capable_source = is_tx_preview_source(&snapshot, &source_id);
      if !is_active
        && !is_pending_target
        && !is_mock_tx_standby
        && !is_tx_capable_source
      {
        debug!(
          "Ignoring request_next_frame for inactive source: requested={}, active={}, pending={:?}",
          source_id, active_source, pending_switch
        );
      } else {
        // Arm the one-shot immediately — including during a Mock APT → Mock Tx
        // handoff — so the first standby frame is ready as soon as the target
        // source commits. Mock Tx also wakes immediately so cold-start /
        // pre-pending previews publish on the Tx stream without waiting for
        // select_source; other pending targets still wake after SetActiveSource.
        apply_tx_preview_settings(&message);
        shared.mark_paused_frame_requested(&source_id);
        if is_active || is_mock_tx_standby || is_tx_capable_source {
          let _ = cmd_tx.send(super::types::SdrCommand::RequestNextFrame);
        }
      }
    }
    "pause" => {
      // RX playback is presentation state owned by the logical stream
      // subscriber. The legacy control socket has no subscriber identity, so
      // it cannot safely pause one view without pausing every other client.
      // The multiplexed stream subscription applies this locally instead.
      warn!("Ignoring legacy pause control; pause is subscriber-scoped");
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
      let max_frame_rate = message.max_frame_rate.and_then(|rate| {
        if rate > 0 {
          Some(rate)
        } else {
          warn!("Ignoring invalid max_frame_rate from client: {}", rate);
          None
        }
      });
      let sample_rate = message.sample_rate.and_then(|rate| {
        let rounded_rate = rate.round() as u32;
        if (1_000_000..=20_000_000).contains(&rounded_rate) {
          let effective_rate = clamp_sample_rate_to_source(
            rounded_rate,
            active_source_max_sample_rate(shared),
          );
          if effective_rate != rounded_rate {
            warn!(
              "Clamping sample rate {} Hz to active source limit {} Hz",
              rounded_rate, effective_rate
            );
          }
          Some(effective_rate)
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
        && max_frame_rate.is_none()
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
        max_frame_rate,
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
      if let Some(max) = max_frame_rate {
        sdr_settings.fft.max_frame_rate = max;
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
    "status" if message.source_id.is_none() => {
      let status = message.status.as_deref();
      let enabled = is_transmit_status(status);
      let device = message
        .tx_device
        .clone()
        .unwrap_or_else(|| shared.device_info.lock().unwrap().clone());
      let is_mock_tx_device = is_mock_tx_device_label(&device);
      info!(
        "Received status message: status={:?}, enabled={}, device={}",
        status, enabled, device
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
        let sample_rate_hz =
          sample_rate.round().clamp(1.0, u32::MAX as f64) as u32;
        if is_mock_tx_device {
          crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
            .store(sample_rate_hz, Ordering::Relaxed);
        }
        let is_mock_tx_active_receiver =
          is_mock_tx_device_label(&shared.device_info.lock().unwrap());
        if is_mock_tx_active_receiver {
          sdr_settings.sample_rate = sample_rate_hz;
        }
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
        Some(bw) if bw > 0 => bw as f64,
        _ if current_tx_bandwidth_hz > 0.0 => current_tx_bandwidth_hz,
        _ => sdr_settings.sample_rate as f64,
      };
      *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = tx_bw;
      let is_mock_tx_active_receiver =
        is_mock_tx_device_label(&shared.device_info.lock().unwrap());
      if let Some(sr) = message.sample_rate {
        if sr.is_finite() && sr > 0.0 {
          let sr_hz = sr.round().clamp(1.0, u32::MAX as f64) as u32;
          crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
            .store(sr_hz, Ordering::Relaxed);
          if is_mock_tx_active_receiver {
            sdr_settings.sample_rate = sr_hz;
          }
        }
      }
      let was_transmitting = crate::safety::TX_TRANSMITTING
        .swap(enabled, std::sync::atomic::Ordering::Relaxed);
      let tx_status_changed = was_transmitting != enabled;

      let _ = cmd_tx.send(super::types::SdrCommand::SetTransmitStatus {
        enabled,
        device: device.clone(),
        serial_number: serial_number.clone(),
        tx_signal: Some(tx_signal),
        center_frequency_hz: Some(tx_center_frequency_hz),
        sample_rate_hz: message
          .sample_rate
          .map(|sr| sr as u64)
          .or(Some(sdr_settings.sample_rate as u64)),
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

      // Publish the backend's normalized TX result. The frontend treats this
      // as authoritative state; it does not need the private calibration
      // model or device-specific safety tables to render the result.
      let effective_ifft_size = message
        .tx_ifft_size
        .unwrap_or_else(|| *crate::safety::TX_IFFT_SIZE.lock().unwrap());
      let tx_safety = serde_json::json!({
        "type": "tx_safety",
        "source_id": active_source_id(shared),
        "effective_power_dbm": tx_power,
        "maximum_safe_power_dbm": max_tx_power,
        "minimum_iq_power_floor_dbm": crate::safety::get_quantized_iq_power_floor_dbm(
          8,
          effective_ifft_size as u32,
          30.0,
        ),
        "recommended_ifft_size": crate::safety::get_recommended_fft_size_for_iq_power_dbm(
          tx_power,
          8,
          30.0,
        ),
        "effective_ifft_size": effective_ifft_size,
        "vga_gain_db": sdr_settings.gain.hackrf_vga_gain,
        "amp_enabled": sdr_settings.gain.hackrf_amp_enable,
        "safety_clamped": safety_enabled,
        "validation_errors": Vec::<String>::new(),
      });
      let _ = broadcast_tx.send(tx_safety.to_string());
    }
    "restart_device" => {
      let source_id = message.source_id.clone();
      match source_id.as_deref() {
        Some(id) => info!("Client requested restart of source {}", id),
        None => info!("Client requested device restart"),
      }
      let _ =
        cmd_tx.send(super::types::SdrCommand::RestartDevice { source_id });
    }
    "select_source" => {
      if let Some(mut source_id) = message.source_id.clone() {
        if source_id == "mock_tx" {
          source_id = "mock-tx".to_string();
        } else if source_id == "mock_apt" {
          source_id = "mock-apt".to_string();
        }
        info!("Client requested source switch: {}", source_id);
        let active_source = active_source_id(shared);
        let pending_source = shared.pending_source_switch();
        if pending_source.as_deref() == Some(source_id.as_str()) {
          debug!(
            "Dropping duplicate source switch while handoff is pending: {}",
            source_id
          );
          return;
        }
        if active_source == source_id && pending_source.is_none() {
          debug!(
            "Dropping source switch request for already-active source: {}",
            source_id
          );
          return;
        }
        let requested_sample_rate = message.sample_rate.and_then(|rate| {
          let rounded_rate = rate.round() as u32;
          if rate.is_finite()
            && (1_000_000..=20_000_000).contains(&rounded_rate)
          {
            Some(rounded_rate)
          } else {
            warn!(
              "Ignoring invalid source-switch sample_rate from client: {}",
              rate
            );
            None
          }
        });
        if let Some(sample_rate) = requested_sample_rate {
          // The frontend's selected rate must be visible before the blocking
          // swap command runs. The processor reads shared settings while it
          // opens the target, so queue this command and publish the requested
          // value before SetActiveSource.
          let _ = cmd_tx.send(super::types::SdrCommand::ApplySettings(
            super::types::SdrProcessorSettings {
              sample_rate: Some(sample_rate),
              ..Default::default()
            },
          ));
          shared.sdr_settings.lock().unwrap().sample_rate = sample_rate;
        }
        // Fence the old stream before queueing the blocking swap command.
        // This closes the refresh/device-switch window in which the frame
        // loop could otherwise publish a Mock APT frame to a Mock Tx client.
        shared.request_source_switch(&source_id);
        match cmd_tx.send(super::types::SdrCommand::SetActiveSource {
          source_id: source_id.clone(),
          sample_rate: requested_sample_rate,
        }) {
          Ok(()) => {
            info!("Queued source switch: {}", source_id);
          }
          Err(error) => {
            shared.clear_pending_source_switch(&source_id);
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
    apply_rx_stream_device_options, build_mock_tx_standby_preview_frame,
    build_tx_preview_frame, drain_latest_source_iq_frame,
    encode_encrypted_iq_frame, handle_message, is_frame_after_paused_request,
    is_tx_preview_source, live_tune_is_out_of_bounds,
    resolve_live_center_frequency, should_send_source_iq_frame,
    source_iq_frame_matches_source,
    source_iq_subscription_matches_active_source,
    source_iq_v2_frame_matches_source, stream_event_json,
    stream_rx_processor_settings, take_source_owned_paused_frame_request,
    IqFrameStatus, IqStreamProtocol,
  };
  use crate::sdr::processor::SdrProcessor;
  use crate::server::shared_state::SharedState;
  use crate::server::stream_manager::{
    RxStreamOptions, StreamEvent, StreamKey, StreamMode,
  };
  use crate::server::types::{
    DeviceProfile, SdrCommand, SpectrumData, WebSocketMessage,
  };
  use crate::server::websocket_server::active_source_id;
  use serial_test::serial;
  use std::sync::atomic::Ordering;
  use std::sync::mpsc;
  use std::sync::Arc;
  use std::time::Duration;

  #[test]
  fn managed_rx_options_translate_to_live_device_settings() {
    let options = RxStreamOptions {
      center_frequency_hz: 6_374_000,
      sample_rate_hz: 4_372_000,
      fft_size: 2_048,
      fft_window: Some("Rectangular".to_string()),
      frame_rate: Some(60),
      gain: Some(46.9),
    };

    let (center_frequency_hz, settings) =
      stream_rx_processor_settings(&options).expect("valid RX options");

    assert_eq!(center_frequency_hz, 6_374_000);
    assert_eq!(settings.sample_rate, Some(4_372_000));
    assert_eq!(settings.fft_size, Some(2_048));
    assert_eq!(settings.fft_window.as_deref(), Some("Rectangular"));
    assert_eq!(settings.frame_rate, Some(60));
    assert_eq!(settings.gain, Some(46.9));
  }

  #[test]
  #[serial]
  fn managed_rx_options_reach_the_acquisition_fast_path() {
    let shared = test_shared_state();
    let (_, settings) = stream_rx_processor_settings(&RxStreamOptions {
      center_frequency_hz: 6_374_000,
      sample_rate_hz: 4_372_000,
      fft_size: 2_048,
      fft_window: Some("Rectangular".to_string()),
      frame_rate: Some(60),
      gain: Some(46.9),
    })
    .expect("valid RX options");

    apply_rx_stream_device_options(&shared, 6_374_000, settings);

    assert_eq!(
      shared.pending_center_freq.load(Ordering::Acquire),
      6_374_000
    );
    assert!(shared.pending_center_freq_dirty.load(Ordering::Acquire));
    let pending = shared.pending_fast_settings.lock().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].sample_rate, Some(4_372_000));
    drop(pending);
    let current = shared.sdr_settings.lock().unwrap();
    assert_eq!(current.center_frequency, 6_374_000);
    assert_eq!(current.sample_rate, 4_372_000);
  }
  use tokio::sync::broadcast;
  use validator::Validate;

  #[test]
  fn tx_preview_accepts_hardware_tx_capabilities() {
    let snapshot = serde_json::json!({
      "sources": [
        {"id": "hackrf-1", "capability": "tx_rx"},
        {"id": "rtl-1", "capability": "rx"}
      ]
    });

    assert!(is_tx_preview_source(&snapshot, "hackrf-1"));
    assert!(!is_tx_preview_source(&snapshot, "rtl-1"));
  }

  #[test]
  #[serial]
  fn hardware_tx_preview_frame_is_source_owned_without_transmitting() {
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    let shared = test_shared_state();
    let frame = build_tx_preview_frame(&shared, "hackrf-1");

    assert_eq!(frame.source_id, "hackrf-1");
    assert!(!crate::safety::TX_TRANSMITTING.load(Ordering::Relaxed));
    assert!(!frame.iq_data.is_empty());
  }

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

  /// Compact payload-form fingerprint used by the swap regression test. It
  /// deliberately ignores source metadata and captures only byte-shape
  /// characteristics of the interleaved I/Q payload.
  fn payload_form(iq: &[u8]) -> (usize, u64, u64) {
    let mut magnitude_sum = 0u64;
    let mut adjacent_delta_sum = 0u64;
    for pair in iq.chunks_exact(2) {
      let i = i16::from(pair[0]) - 128;
      let q = i16::from(pair[1]) - 128;
      magnitude_sum +=
        u64::from(i.unsigned_abs()) + u64::from(q.unsigned_abs());
    }
    for window in iq.windows(2) {
      adjacent_delta_sum += u64::from(window[0].abs_diff(window[1]));
    }
    (iq.len(), magnitude_sum, adjacent_delta_sum)
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
  #[serial]
  fn frequency_range_selection_is_device_scoped_and_broadcast_for_hydration() {
    let shared = test_shared_state();
    let (cmd_tx, _cmd_rx, broadcast_tx) = test_channels();
    let mut broadcast_rx = broadcast_tx.subscribe();
    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"frequency_range",
        "scope":"device",
        "min_hz":24100000,
        "max_hz":30370000,
        "center_frequency":27235000,
        "signalArea":"B"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert_eq!(shared.active_signal_area(), Some("B".to_string()));
    assert_eq!(
      shared.active_frequency_range(),
      Some((24_100_000.0, 30_370_000.0))
    );
    assert_eq!(
      shared.sdr_settings.lock().unwrap().center_frequency,
      27_235_000
    );

    let snapshot: serde_json::Value =
      serde_json::from_str(&broadcast_rx.try_recv().unwrap()).unwrap();
    assert_eq!(snapshot["type"], "channels");
    assert_eq!(snapshot["active_signal_area"], "B");
    assert_eq!(snapshot["frequency_range"]["min"], 24_100_000.0);
    assert_eq!(snapshot["frequency_range"]["max"], 30_370_000.0);
    assert!(snapshot["sample_rate"].as_u64().is_some());
  }

  #[test]
  #[serial]
  fn frequency_range_broadcast_includes_signed_mirrored_viewport_state() {
    let shared = test_shared_state();
    let (cmd_tx, _cmd_rx, broadcast_tx) = test_channels();
    let mut broadcast_rx = broadcast_tx.subscribe();
    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"frequency_range",
        "scope":"device",
        "min_hz":0,
        "max_hz":4000000,
        "center_frequency":2000000,
        "display_min_hz":-3000000,
        "display_max_hz":1000000,
        "display_pan_hz":-3000000,
        "display_zoom":1,
        "display_crosses_dc":true,
        "display_direction_negative":true,
        "mirror_spectrum_below_zero":true
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let snapshot: serde_json::Value =
      serde_json::from_str(&broadcast_rx.try_recv().unwrap()).unwrap();
    assert_eq!(snapshot["display_range"]["min"], -3_000_000.0);
    assert_eq!(snapshot["display_range"]["max"], 1_000_000.0);
    assert_eq!(snapshot["display_range"]["pan_hz"], -3_000_000.0);
    assert_eq!(snapshot["display_range"]["crosses_dc"], true);
    assert_eq!(snapshot["display_range"]["direction_negative"], true);
    assert_eq!(snapshot["display_range"]["mirror_below_zero"], true);
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
  fn validates_websocket_frame_rate_protocol_ceiling() {
    let valid_frame_rate: WebSocketMessage =
      serde_json::from_str(r#"{"type":"settings","frameRate":100}"#).unwrap();
    assert!(valid_frame_rate.validate().is_ok());

    let invalid_frame_rate: WebSocketMessage =
      serde_json::from_str(r#"{"type":"settings","frameRate":101}"#).unwrap();
    assert!(invalid_frame_rate.validate().is_err());

    let valid_max_frame_rate: WebSocketMessage =
      serde_json::from_str(r#"{"type":"settings","maxFrameRate":100}"#)
        .unwrap();
    assert!(valid_max_frame_rate.validate().is_ok());

    let invalid_max_frame_rate: WebSocketMessage =
      serde_json::from_str(r#"{"type":"settings","maxFrameRate":101}"#)
        .unwrap();
    assert!(invalid_max_frame_rate.validate().is_err());
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
      SdrCommand::SetActiveSource {
        source_id,
        sample_rate,
      } => {
        assert_eq!(source_id, "rtl-sdr-1");
        assert_eq!(sample_rate, None);
      }
      other => panic!("unexpected command: {:?}", other),
    }
    assert_eq!(shared.pending_source_switch().as_deref(), Some("rtl-sdr-1"));
    assert!(
      broadcast_rx.try_recv().is_err(),
      "queue acknowledgement must not mark a warm source loading"
    );
  }

  #[test]
  #[serial]
  fn drops_duplicate_select_source_while_switch_is_pending() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    shared.request_source_switch("rtl-sdr-1");

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"select_source",
        "source_id":"rtl-sdr-1"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert!(
      cmd_rx.try_recv().is_err(),
      "a pending source switch must not be queued again"
    );
  }

  #[test]
  #[serial]
  fn forwards_frontend_sample_rate_before_selecting_source() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"select_source",
        "source_id":"hackrf-1",
        "sample_rate":18250000
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    match cmd_rx.recv().expect("expected frontend rate command first") {
      SdrCommand::ApplySettings(settings) => {
        assert_eq!(settings.sample_rate, Some(18_250_000));
      }
      other => panic!(
        "expected ApplySettings before source switch, got {:?}",
        other
      ),
    }
    match cmd_rx.recv().expect("expected source switch command") {
      SdrCommand::SetActiveSource {
        source_id,
        sample_rate,
      } => {
        assert_eq!(source_id, "hackrf-1");
        assert_eq!(sample_rate, Some(18_250_000));
      }
      other => panic!("unexpected command: {:?}", other),
    }
  }

  #[test]
  #[serial]
  fn mock_tx_status_overlays_on_active_mock_apt_source() {
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
    let initial_rx_sample_rate =
      shared.sdr_settings.lock().unwrap().sample_rate;
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
        "type":"status",
        "status":"transmitting",
        "txDevice":"Mock Tx SDR",
        "centerFrequencyHz":1600000,
        "sampleRate":2400000,
        "bandwidthHz":3200000,
        "txIfftSize":8192,
        "vgaGainDb":12
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, enable);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitStatus command");
    match cmd {
      SdrCommand::SetTransmitStatus {
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
        assert_eq!(sample_rate_hz, Some(2_400_000));
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
    assert_eq!(
      shared.sdr_settings.lock().unwrap().sample_rate,
      initial_rx_sample_rate,
      "Mock Tx monitor settings must not change the receiver sample rate"
    );
    assert_eq!(
      crate::safety::TX_MONITOR_SAMPLE_RATE_HZ.load(Ordering::Relaxed),
      2_400_000
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
    assert_eq!(active_source["status"], "receiving");
    assert_eq!(mock_tx["name"], "Mock Tx SDR");
    assert_eq!(mock_tx["status"], "transmitting");

    let disable: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"status",
        "status":"standby",
        "txDevice":"Mock Tx SDR"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, disable);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected stop SetTransmitStatus command");
    match cmd {
      SdrCommand::SetTransmitStatus {
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
    assert_eq!(mock_tx["status"], "standby");
  }

  #[test]
  #[serial]
  fn request_next_frame_applies_mock_tx_preview_settings_without_transmitting()
  {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    {
      let mut receiver_settings = shared.sdr_settings.lock().unwrap();
      receiver_settings.center_frequency = 138_000_000;
      receiver_settings.sample_rate = 4_372_000;
    }

    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 0.0;
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 0.0;
    *crate::safety::TX_POWER_DBM.lock().unwrap() = 0.0;
    *crate::safety::TX_SIGNAL.lock().unwrap() = String::new();
    *crate::safety::TX_IFFT_SIZE.lock().unwrap() = 2048;
    crate::safety::TX_MONITOR_SAMPLE_RATE_HZ.store(0, Ordering::Relaxed);
    crate::safety::TX_TRANSMITTING
      .store(false, std::sync::atomic::Ordering::Relaxed);

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "centerFrequencyHz":137100000,
        "sample_rate":2400000,
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
    assert_eq!(
      crate::safety::TX_MONITOR_SAMPLE_RATE_HZ.load(Ordering::Relaxed),
      2_400_000
    );
    assert_eq!(
      *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap(),
      137_100_000.0,
      "incomplete preview passes must still align the monitor to the carrier"
    );

    let receiver_settings = shared.sdr_settings.lock().unwrap();
    assert_eq!(receiver_settings.center_frequency, 138_000_000);
    assert_eq!(receiver_settings.sample_rate, 4_372_000);
  }

  #[test]
  #[serial]
  fn request_next_frame_without_view_center_aligns_monitor_to_carrier() {
    let shared = test_shared_state();
    let (cmd_tx, _cmd_rx, broadcast_tx) = test_channels();
    crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
      .store(3_200_000, Ordering::Relaxed);
    // Cold-load default monitor view left from process init / prior session.
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = 137_100_000.0;
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 137_100_000.0;
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 1_000_000.0;
    *crate::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *crate::safety::TX_SIGNAL.lock().unwrap() = "wifi".to_string();
    *crate::safety::TX_IFFT_SIZE.lock().unwrap() = 2048;
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);

    // First settings pass often omits viewCenterHz while moving the carrier.
    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "centerFrequencyHz":13875000,
        "sample_rate":3200000,
        "bandwidthHz":1000000,
        "powerDbm":-18,
        "txSignal":"wifi",
        "txIfftSize":2048
      }"#,
    )
    .unwrap();
    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert_eq!(
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap(),
      13_875_000.0
    );
    assert_eq!(
      *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap(),
      13_875_000.0,
      "missing viewCenter on the first preview pass must not leave the carrier off-window"
    );

    let frame = build_mock_tx_standby_preview_frame(&shared);
    let peak = frame
      .iq_data
      .iter()
      .map(|byte| (*byte as i16 - 128).abs())
      .max()
      .unwrap_or(0);
    assert!(
      peak > 3,
      "cold-load preview without viewCenter must still show a carrier, peak={peak}"
    );
  }

  #[test]
  #[serial]
  fn request_next_frame_for_inactive_mock_tx_arms_and_wakes_standby_publish() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    assert_eq!(active_source_id(&shared), "mock-apt");

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "source_id":"mock-tx",
        "centerFrequencyHz":137100000,
        "sample_rate":2400000
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    // Cold start / early Mock Tx preview must not wait for select_source to
    // become pending/active. Arm + wake so the loop can publish one standby
    // frame on the Mock Tx stream without advancing the active Rx source.
    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected RequestNextFrame for Mock Tx standby");
    match cmd {
      SdrCommand::RequestNextFrame => {}
      other => panic!("unexpected command: {:?}", other),
    }
    assert!(
      shared.paused_frame_request_for_source("mock-tx").is_some(),
      "inactive Mock Tx standby must arm for immediate publish"
    );
  }

  #[test]
  #[serial]
  fn request_next_frame_never_wakes_a_different_non_mock_tx_source() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    assert_eq!(active_source_id(&shared), "mock-apt");

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "source_id":"rtl-sdr-1",
        "centerFrequencyHz":137100000,
        "sample_rate":2400000
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert!(
      cmd_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "an inactive non-Mock-Tx preview must not wake the active SDR loop"
    );
    assert!(shared
      .paused_frame_request_for_source("rtl-sdr-1")
      .is_none());
  }

  #[test]
  #[serial]
  #[cfg(has_hackrf)]
  fn request_next_frame_wakes_tx_capable_half_duplex_source() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    assert_eq!(active_source_id(&shared), "mock-apt");

    // A physical HackRF in half-duplex mode advertises tx_rx capability even
    // when a separate Rx source is active. A standby preview request for it
    // must be honored so the Tx monitor can publish the synthesized payload.
    shared.hackrf_inventory.lock().unwrap().push(
      crate::server::shared_state::HackRfInventoryDevice {
        serial_number: "00000001".to_string(),
        index: 0,
      },
    );

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "source_id":"hackrf_one-00000001",
        "centerFrequencyHz":137100000,
        "sample_rate":2400000
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("tx-capable half-duplex preview should wake standby publish");
    match cmd {
      SdrCommand::RequestNextFrame => {}
      other => panic!("unexpected command: {:?}", other),
    }
    assert!(
      shared
        .paused_frame_request_for_source("hackrf_one-00000001")
        .is_some(),
      "half-duplex Tx preview should arm even when the source is not active"
    );
  }

  #[test]
  #[serial]
  fn request_next_frame_arms_pending_mock_tx_and_wakes_standby_publish() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();
    assert_eq!(active_source_id(&shared), "mock-apt");
    shared.request_source_switch("mock-tx");

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"request_next_frame",
        "source_id":"mock-tx",
        "centerFrequencyHz":137100000,
        "sample_rate":2400000
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("pending Mock Tx preview should wake standby publish");
    match cmd {
      SdrCommand::RequestNextFrame => {}
      other => panic!("unexpected command: {:?}", other),
    }
    assert!(
      shared.paused_frame_request_for_source("mock-tx").is_some(),
      "Mock Tx standby preview should arm during the pending handoff"
    );
  }

  #[test]
  fn paused_frame_request_cannot_be_consumed_by_another_source_socket() {
    let shared = test_shared_state();
    shared.mark_paused_frame_requested("mock-tx");

    assert!(
      take_source_owned_paused_frame_request(&shared, "mock-apt").is_none()
    );
    assert!(shared.paused_frame_request_for_source("mock-tx").is_some());
  }

  #[test]
  #[serial]
  fn mock_tx_standby_preview_is_source_owned_and_contains_iq() {
    let shared = test_shared_state();
    crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
      .store(2_400_000, Ordering::Relaxed);
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = 137_100_000.0;
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 137_100_000.0;
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 2_400_000.0;
    *crate::safety::TX_SIGNAL.lock().unwrap() = "wifi".to_string();

    let frame = build_mock_tx_standby_preview_frame(&shared);

    assert_eq!(frame.source_id, "mock-tx");
    assert_eq!(frame.data_type.as_deref(), Some("iq_raw"));
    assert_eq!(frame.sample_rate, Some(2_400_000));
    assert!(!frame.iq_data.is_empty());
  }

  #[test]
  #[serial]
  fn start_tx_status_preserves_monitor_view_so_carrier_stays_visible() {
    let shared = test_shared_state();
    let (cmd_tx, _cmd_rx, broadcast_tx) = test_channels();
    crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
      .store(3_200_000, Ordering::Relaxed);
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = 5_336_000.0;
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 5_336_000.0;
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 1_000_000.0;
    *crate::safety::TX_POWER_DBM.lock().unwrap() = -18.0;
    *crate::safety::TX_SIGNAL.lock().unwrap() = "wifi".to_string();
    *crate::safety::TX_IFFT_SIZE.lock().unwrap() = 2048;
    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);

    let standby = build_mock_tx_standby_preview_frame(&shared);
    let standby_peak = standby
      .iq_data
      .iter()
      .map(|byte| (*byte as i16 - 128).abs())
      .max()
      .unwrap_or(0);
    assert!(
      standby_peak > 3,
      "standby preview should contain a visible carrier, peak={standby_peak}"
    );

    // Reproduce the Start Tx bug: move only the carrier far outside the current
    // monitor view. Without viewCenterHz the synthesizer returns a noise floor.
    let broken: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"status",
        "status":"transmitting",
        "txDevice":"Mock Tx SDR",
        "centerFrequencyHz":137100000,
        "bandwidthHz":1000000,
        "powerDbm":-18,
        "txSignal":"wifi"
      }"#,
    )
    .unwrap();
    handle_message(&cmd_tx, &shared, &broadcast_tx, broken);
    let broken_frame = build_mock_tx_standby_preview_frame(&shared);
    let broken_peak = broken_frame
      .iq_data
      .iter()
      .map(|byte| (*byte as i16 - 128).abs())
      .max()
      .unwrap_or(0);
    assert!(
      broken_peak <= 3,
      "carrier outside the monitor view must collapse to the noise floor"
    );

    crate::safety::TX_TRANSMITTING.store(false, Ordering::Relaxed);
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = 5_336_000.0;
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 5_336_000.0;

    let aligned: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"status",
        "status":"transmitting",
        "txDevice":"Mock Tx SDR",
        "centerFrequencyHz":13875000,
        "viewCenterHz":13875000,
        "sample_rate":3200000,
        "bandwidthHz":1000000,
        "powerDbm":-18,
        "txSignal":"wifi"
      }"#,
    )
    .unwrap();
    handle_message(&cmd_tx, &shared, &broadcast_tx, aligned);
    assert_eq!(
      *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap(),
      13_875_000.0
    );
    assert_eq!(
      *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap(),
      13_875_000.0
    );
    assert_eq!(
      crate::safety::TX_MONITOR_SAMPLE_RATE_HZ.load(Ordering::Relaxed),
      3_200_000
    );

    let live = build_mock_tx_standby_preview_frame(&shared);
    let live_peak = live
      .iq_data
      .iter()
      .map(|byte| (*byte as i16 - 128).abs())
      .max()
      .unwrap_or(0);
    assert!(
      live_peak > 3,
      "Start Tx that preserves the monitor view must keep a visible carrier, peak={live_peak}"
    );
  }

  #[test]
  #[serial]
  fn device_swap_changes_payload_form_independent_of_source_identifier() {
    let shared = test_shared_state();
    let mut mock_apt =
      SdrProcessor::new_mock_apt().expect("mock apt processor");
    mock_apt
      .initialize()
      .expect("mock apt device should initialize");
    mock_apt
      .read_and_process_frame()
      .expect("mock apt should produce a frame");
    let apt_form = payload_form(&mock_apt.frame.last_frame_raw_iq);

    crate::safety::TX_MONITOR_SAMPLE_RATE_HZ
      .store(2_400_000, Ordering::Relaxed);
    *crate::safety::TX_MONITOR_VIEW_CENTER_HZ.lock().unwrap() = 137_100_000.0;
    *crate::safety::TX_CENTER_FREQUENCY_HZ.lock().unwrap() = 137_100_000.0;
    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 2_400_000.0;
    *crate::safety::TX_SIGNAL.lock().unwrap() = "wifi".to_string();
    let tx_frame = build_mock_tx_standby_preview_frame(&shared);
    let tx_form = payload_form(&tx_frame.iq_data);

    assert_ne!(
      apt_form, tx_form,
      "source swap must change the I/Q payload form"
    );
  }

  #[test]
  #[serial]
  fn status_disable_without_bandwidth_keeps_existing_tx_bandwidth() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    *crate::safety::TX_BANDWIDTH_HZ.lock().unwrap() = 2_400_000.0;
    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"status",
        "status":"standby",
        "txDevice":"Mock Tx SDR"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitStatus command");
    match cmd {
      SdrCommand::SetTransmitStatus {
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
  fn status_without_signal_defaults_to_wifi() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"status",
        "status":"transmitting",
        "txDevice":"Mock Tx SDR"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitStatus command");
    match cmd {
      SdrCommand::SetTransmitStatus {
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
  fn status_legacy_apt_signal_falls_back_to_wifi() {
    let shared = test_shared_state();
    let (cmd_tx, cmd_rx, broadcast_tx) = test_channels();

    let message: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"status",
        "status":"transmitting",
        "txDevice":"Mock Tx SDR",
        "txSignal":"apt"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    let cmd = cmd_rx
      .recv_timeout(Duration::from_millis(100))
      .expect("expected SetTransmitStatus command");
    match cmd {
      SdrCommand::SetTransmitStatus { tx_signal, .. } => {
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
  fn hackrf_tx_monitor_frames_bypass_pause_while_transmitting() {
    assert!(should_send_source_iq_frame(
      "hackrf_one-test",
      true,
      false,
      true,
    ));
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
      is_tx_preview: Some(true),
    };

    let encoded = encode_encrypted_iq_frame(
      IqStreamProtocol::V2,
      &key,
      &spectrum,
      "rtl-sdr-v4",
      7,
      11,
      IqFrameStatus::Standby,
    )
    .expect("v2 frame should encode");
    assert_eq!(&encoded[0..4], b"NAPT");
    assert_eq!(encoded[4], 2);
    assert_eq!(encoded[10], 1);
    let header_len = u16::from_le_bytes([encoded[6], encoded[7]]) as usize;
    assert_eq!(header_len, 56 + "rtl-sdr-v4".len());
    assert_eq!(u64::from_le_bytes(encoded[16..24].try_into().unwrap()), 7);
    assert_eq!(u64::from_le_bytes(encoded[24..32].try_into().unwrap()), 11);
    assert_eq!(&encoded[56..header_len], b"rtl-sdr-v4");
    let decrypted =
      crate::crypto::decrypt_payload_binary(&key, &encoded[header_len..])
        .expect("v2 payload should decrypt");
    assert_eq!(decrypted, spectrum.iq_data);
  }

  #[test]
  fn max_fft_stream_frame_fits_the_multiplexed_websocket_write_budget() {
    let event =
      StreamEvent::Frame(crate::server::stream_manager::StreamFrame {
        key: StreamKey::new("mock-apt", StreamMode::Rx),
        stream_epoch: 1,
        options_revision: 1,
        sequence: 1,
        timestamp: 1234,
        center_frequency_hz: Some(1_600_000),
        sample_rate_hz: 3_200_000,
        iq_data: Arc::new(vec![128; 262_144 * 2]),
      });

    let encoded = stream_event_json(&event, &[7u8; 32])
      .expect("maximum-size stream frame should encode");
    let encoded_bytes = serde_json::to_vec(&encoded).unwrap();
    assert!(
      encoded_bytes.len() <= super::WS_MAX_WRITE_BUFFER_BYTES,
      "encoded stream frame is {} bytes but websocket write budget is {}",
      encoded_bytes.len(),
      super::WS_MAX_WRITE_BUFFER_BYTES,
    );
  }

  #[test]
  fn v2_source_filter_requires_exact_frame_ownership() {
    assert!(source_iq_v2_frame_matches_source("rtl-sdr-1", "rtl-sdr-1"));
    assert!(!source_iq_v2_frame_matches_source("rtl-sdr-1", "rtl-sdr-2"));
  }

  #[test]
  fn source_iq_delivery_discards_backlog_and_keeps_latest_owned_frame() {
    let (spectrum_tx, mut spectrum_rx) = broadcast::channel(8);
    let frame = |source_id: &str, sequence: u64| {
      Arc::new(SpectrumData {
        message_type: "spectrum".to_string(),
        waveform: Vec::new(),
        is_mock_apt: source_id == "mock-apt",
        source_id: source_id.to_string(),
        stream_epoch: 1,
        sequence,
        center_frequency_hz: Some(137_100_000),
        waveform_span_hz: None,
        timestamp: sequence as i64,
        data_type: Some("iq_raw".to_string()),
        sample_rate: Some(3_200_000),
        power_scale: None,
        iq_data: vec![128, 128],
        is_tx_preview: None,
      })
    };

    spectrum_tx.send(frame("mock-tx", 1)).unwrap();
    spectrum_tx.send(frame("mock-apt", 2)).unwrap();
    spectrum_tx.send(frame("mock-tx", 3)).unwrap();
    let first = spectrum_rx.try_recv().unwrap();

    let latest = drain_latest_source_iq_frame(
      &mut spectrum_rx,
      "mock-tx",
      IqStreamProtocol::V2,
      first,
    );

    assert_eq!(latest.source_id, "mock-tx");
    assert_eq!(latest.sequence, 3);
    assert!(spectrum_rx.try_recv().is_err());
  }

  #[test]
  fn paused_request_rejects_frames_from_before_the_request_floor() {
    assert!(!is_frame_after_paused_request(7, 10, 7, 10));
    assert!(!is_frame_after_paused_request(7, 9, 7, 10));
    assert!(is_frame_after_paused_request(7, 11, 7, 10));
    assert!(!is_frame_after_paused_request(8, 1, 7, 10));
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
        iq_format: Some(crate::server::types::IqFormat::default()),
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
        iq_format: Some(crate::server::types::IqFormat::default()),
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
        iq_format: Some(crate::server::types::IqFormat::default()),
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
  fn legacy_pause_commands_do_not_mutate_shared_source_state() {
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
        "scope":"subscriber"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, message);

    assert!(!shared.is_source_paused("other-source"));
    assert!(!shared.is_paused.load(std::sync::atomic::Ordering::SeqCst));
  }

  #[test]
  #[serial]
  fn resume_is_ignored_while_the_active_device_is_still_loading() {
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

    // The active source is already paused.
    shared.set_active_source_pause_state("mock-apt", true);
    assert!(shared.is_source_paused("mock-apt"));
    assert!(shared.is_paused.load(std::sync::atomic::Ordering::SeqCst));

    // Enter the loading state: a resume must not clear the pause bit before
    // a veritable stream can run.
    shared.set_device_state("loading", Some("connect"));

    let resume: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"pause",
        "paused":false,
        "source_id":"mock-apt"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, resume);

    assert!(
      shared.is_source_paused("mock-apt"),
      "resume during loading must not clear the source pause state"
    );
    assert!(
      shared.is_paused.load(std::sync::atomic::Ordering::SeqCst),
      "resume during loading must not clear the streaming pause gate"
    );
  }
}
