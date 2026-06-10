use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
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
  active_source_id, broadcast_active_source, broadcast_signal_display_settings,
  broadcast_source_status, build_channels_snapshot, build_source_info_snapshot,
};

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

  info!("WebSocket upgrade: valid session, starting encrypted stream");

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
  spectrum_tx: broadcast::Sender<Arc<super::types::SpectrumData>>,
  cmd_tx: std::sync::mpsc::Sender<super::types::SdrCommand>,
  enc_key: [u8; 32],
  _session_token: String,
) {
  let (mut ws_sender, mut ws_receiver) = socket.split();
  let mut broadcast_rx = broadcast_tx.subscribe();
  let mut spectrum_rx = spectrum_tx.subscribe();

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
      spectrum_result = spectrum_rx.recv() => {
        match spectrum_result {
          Ok(spectrum_data) => {
            let allow_next_paused_frame = shared
              .allow_next_paused_frame
              .swap(false, Ordering::SeqCst);
            let is_paused = shared.is_paused.load(Ordering::SeqCst);
            if is_paused && !allow_next_paused_frame {
              continue;
            }

            let timestamp: u64 = spectrum_data.timestamp as u64; // i64 to u64
             let center_frequency: u64 = spectrum_data.center_frequency_hz.unwrap_or(0) as u64;

            let data_type = 1u32;
            let sample_rate = spectrum_data.sample_rate.unwrap_or(0) as u32;
            let iq_bytes = &spectrum_data.iq_data;

            // Construct header: [timestamp: 8][center_freq: 8][data_type: 4][sample_rate: 4]
            let mut binary_payload = Vec::with_capacity(24 + iq_bytes.len());
            binary_payload.extend_from_slice(&timestamp.to_le_bytes());
            binary_payload.extend_from_slice(&center_frequency.to_le_bytes());
            binary_payload.extend_from_slice(&data_type.to_le_bytes());
            binary_payload.extend_from_slice(&sample_rate.to_le_bytes());

            let frame_bytes = match crypto::encrypt_payload_binary(&enc_key, iq_bytes) {
              Ok(encrypted_iq) => {
                binary_payload.extend_from_slice(&encrypted_iq);
                binary_payload
              }
              Err(_) => {
                error!("I/Q data encryption failed");
                continue;
              }
            };

            // Send the binary message
            if ws_sender.send(Message::Binary(frame_bytes.into())).await.is_err() {
              break;
            }
          }
          Err(broadcast::error::RecvError::Lagged(n)) => {
            debug!("Client lagged by {} spectrum frames, skipping", n);
            continue;
          }
          Err(_) => break,
        }
      }
      client_msg = ws_receiver.next() => {
        match client_msg {
          Some(Ok(Message::Text(text))) => {
            if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
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
      shared.allow_next_paused_frame.store(true, Ordering::SeqCst);
      let _ = cmd_tx.send(super::types::SdrCommand::RequestNextFrame);
    }
    "pause" => {
      if let Some(paused) = message.paused {
        shared.is_paused.store(paused, Ordering::SeqCst);
        broadcast_source_status(&shared, &broadcast_tx, "connected");
        broadcast_active_source(&shared, &broadcast_tx);
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
        if (1_000_000..=20_000_000).contains(&rate) {
          Some(rate)
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
      let enabled = message.tx_mode.unwrap_or(false);
      let device = message
        .tx_device
        .clone()
        .unwrap_or_else(|| shared.device_info.lock().unwrap().clone());
      let serial_number = shared.device_serial.lock().unwrap().clone();
      let mut sdr_settings = shared.sdr_settings.lock().unwrap().clone();
      if let Some(center_frequency) = message.center_frequency {
        sdr_settings.center_frequency = center_frequency as u32;
      }
      if let Some(sample_rate) = message.sample_rate {
        sdr_settings.sample_rate = sample_rate;
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

      let tx_signal = message
        .tx_signal
        .clone()
        .unwrap_or_else(|| "apt".to_string());
      let hop_active = tx_signal == "hop";
      shared
        .tx_hop_enabled
        .store(hop_active, std::sync::atomic::Ordering::Relaxed);
      crate::safety::TX_HOP_ENABLED
        .store(hop_active, std::sync::atomic::Ordering::Relaxed);

      // Enforce safety clamps on VGA gain and AMP enabled
      if safety_enabled {
        let max_dist = if safety_limit == "person" { 1.0 } else { 3.0 };
        let freq = sdr_settings.center_frequency as f64;
        let limit_dbm =
          crate::safety::calculate_room_power_limit(freq, max_dist);
        let safe_gains = crate::safety::get_max_safe_vga_and_amp(limit_dbm);

        if let Some(vga) = sdr_settings.gain.hackrf_vga_gain {
          sdr_settings.gain.hackrf_vga_gain = Some(vga.min(safe_gains.vga));
        } else {
          sdr_settings.gain.hackrf_vga_gain = Some(0.0f64.min(safe_gains.vga));
        }
        if !safe_gains.amp {
          sdr_settings.gain.hackrf_amp_enable = Some(false);
        }
      }

      *shared.sdr_settings.lock().unwrap() = sdr_settings.clone();

      let tx_power = crate::safety::get_approx_output_power(
        sdr_settings.gain.hackrf_vga_gain.unwrap_or(0.0),
        sdr_settings.gain.hackrf_amp_enable.unwrap_or(false),
      );
      *crate::safety::TX_POWER_DBM.lock().unwrap() = tx_power;
      crate::safety::TX_TRANSMITTING
        .store(enabled, std::sync::atomic::Ordering::Relaxed);

      let entry = if enabled {
        TxLogEntry::start(
          device.clone(),
          serial_number,
          Some(sdr_settings.center_frequency as u64),
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
          Some(sdr_settings.center_frequency as u64),
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
      if device == "mock-tx"
        || device == "mock_tx"
        || device.to_lowercase().contains("mock")
        || shared.device_profile.lock().unwrap().kind == "mock_tx"
      {
        shared
          .mock_tx_transmitting
          .store(enabled, std::sync::atomic::Ordering::Relaxed);
        if shared.device_profile.lock().unwrap().kind == "mock_tx" {
          shared.set_device_state(
            if enabled { "transmitting" } else { "connected" },
            None,
          );
        }
        super::websocket_server::broadcast_device_status(shared, broadcast_tx);
      }
    }
    "restart_device" => {
      info!("Client requested device restart");
      let _ = cmd_tx.send(super::types::SdrCommand::RestartDevice);
    }
    "select_source" => {
      if let Some(source_id) = message.source_id.clone() {
        info!("Client requested source switch: {}", source_id);
        let _ =
          cmd_tx.send(super::types::SdrCommand::SetActiveSource { source_id });
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
    handle_message, live_tune_is_out_of_bounds, resolve_live_center_frequency,
  };
  use crate::server::shared_state::SharedState;
  use crate::server::types::{SdrCommand, WebSocketMessage};
  use serial_test::serial;
  use std::sync::mpsc;
  use std::sync::Arc;
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
  }

  #[test]
  #[serial]
  fn mock_tx_mode_updates_source_status_for_iq_preview() {
    let shared = test_shared_state();
    shared.update_device_status(
      true,
      "Mock TX Device".to_string(),
      crate::server::websocket_server::build_device_profile("mock_tx"),
    );
    shared.update_device_usb_strings(
      "mock-tx".to_string(),
      "N-APT".to_string(),
      "Mock TX Device".to_string(),
    );
    let (cmd_tx, _cmd_rx, broadcast_tx) = test_channels();
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
        "txMode":true,
        "txDevice":"Mock TX Device",
        "centerFrequencyHz":1600000,
        "sampleRateHz":3200000,
        "vgaGainDb":12
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, enable);

    let payload = next_source_info();
    assert_eq!(payload["active_source"], "mock-tx");
    assert_eq!(payload["sources"][0]["status"], "transmitting");

    let disable: WebSocketMessage = serde_json::from_str(
      r#"{
        "type":"tx_mode",
        "txMode":false,
        "txDevice":"Mock TX Device"
      }"#,
    )
    .unwrap();

    handle_message(&cmd_tx, &shared, &broadcast_tx, disable);

    let payload = next_source_info();
    assert_eq!(payload["sources"][0]["status"], "connected");
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
}
