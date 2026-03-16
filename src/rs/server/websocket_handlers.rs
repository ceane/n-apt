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

use crate::crypto;

use super::shared_state::SharedState;
use super::types::{WebSocketMessage, WsQueryParams};
use super::utils::reconcile_device_state;

/// Calculate optimal FFT sizes based on screen width (in physical pixels, i.e. CSS width × DPR).
/// Returns (available_sizes, recommended_size).
fn calculate_auto_fft_sizes(screen_width: u32) -> (Vec<usize>, usize) {
  let sizes = vec![2048, 4096];
  // Hi-DPI / Retina screens send width * dpr, typically >= 3000 physical pixels.
  let recommended = if screen_width >= 3000 { 4096 } else { 2048 };
  (sizes, recommended)
}

/// GET /ws?token=<session_token> — upgrade to WebSocket after validating session.
pub async fn ws_upgrade_handler(
  ws: WebSocketUpgrade,
  Query(params): Query<WsQueryParams>,
  State(state): State<Arc<super::AppState>>,
) -> impl IntoResponse {
  // Validate session token
  let session = match state.session_store.validate(&params.token) {
    Some(s) => s,
    None => {
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token")
        .into_response();
    }
  };

  info!("WebSocket upgrade: valid session, starting encrypted stream");

  let shared = state.shared.clone();
  let broadcast_tx = state.broadcast_tx.clone();
  let spectrum_tx = state.spectrum_tx.clone();
  let cmd_tx = state.cmd_tx.clone();
  let enc_key = session.encryption_key;

  ws.on_upgrade(move |socket| {
    handle_ws_connection(
      socket,
      shared,
      broadcast_tx,
      spectrum_tx,
      cmd_tx,
      enc_key,
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
) {
  let (mut ws_sender, mut ws_receiver) = socket.split();
  let mut broadcast_rx = broadcast_tx.subscribe();
  let mut spectrum_rx = spectrum_tx.subscribe();

  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);

  // Send initial status
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_loading = *shared.device_loading.lock().unwrap();
  let device_loading_reason =
    shared.device_loading_reason.lock().unwrap().clone();
  let device_state = reconcile_device_state(
    device_connected,
    &shared.device_state.lock().unwrap().clone(),
  );
  let paused = shared.is_paused.load(Ordering::Relaxed);
  let channels = {
    let mut guard = shared.channels.lock().unwrap();
    if guard.is_empty() {
      let loaded = super::utils::load_channels();
      if !loaded.is_empty() {
        *guard = loaded;
      }
    }
    guard.clone()
  };
  let sdr_settings = { shared.sdr_settings.lock().unwrap().clone() };

  let max_sample_rate = if device_connected {
    device_info
      .split("Rate: ")
      .nth(1)
      .and_then(|s| s.split(" Hz").next())
      .and_then(|s| s.parse::<u32>().ok())
      .unwrap_or(64_000_000)
  } else {
    64_000_000
  };

  let normalize_rtl_device_name = |raw_name: &str| {
    let short_name = raw_name.split(" - ").next().unwrap_or("RTL-SDR").trim();
    let lower = short_name.to_ascii_lowercase();

    if let Some(version) = short_name.split_whitespace().find_map(|token| {
      let cleaned = token
        .trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .to_ascii_lowercase();
      let version = cleaned.strip_prefix('v')?;
      if !version.is_empty() && version.chars().all(|c| c.is_ascii_digit()) {
        Some(version.to_string())
      } else {
        None
      }
    }) {
      return format!("RTL-SDR {}", format!("v{}", version));
    }

    if lower.contains("rtl-sdr blog") || lower.contains("rtl2832") || lower.contains("rtl-sdr") {
      return "RTL-SDR".to_string();
    }

    short_name.to_string()
  };

  // Extract short device name from device_info
  let device_name = if device_connected {
    normalize_rtl_device_name(&device_info)
  } else {
    "Mock APT SDR".to_string()
  };

  let initial_status = super::types::StatusMessage {
    message_type: "status".to_string(),
    device_connected,
    device_info,
    device_name,
    device_loading,
    device_loading_reason,
    device_state,
    paused,
    max_sample_rate,
    channels: channels
      .into_iter()
      .map(|c| super::types::SpectrumFrameMessage {
        id: c.id,
        label: c.label,
        min_mhz: c.min_mhz,
        max_mhz: c.max_mhz,
        description: c.description,
      })
      .collect(),
    sdr_settings,
    device: (if device_connected {
      "rtl-sdr"
    } else {
      "mock_apt"
    })
    .to_string(),
    device_profile: shared.device_profile.lock().unwrap().clone(),
  };

  if let Ok(status_json) = serde_json::to_string(&initial_status) {
    if ws_sender.send(Message::Text(status_json)).await.is_err() {
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
            if plaintext_json.contains("\"type\":\"status\"") || plaintext_json.contains("\"type\":\"capture_status\"") {
              if ws_sender.send(Message::Text(plaintext_json)).await.is_err() {
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
            let timestamp: u64 = spectrum_data.timestamp as u64; // i64 to u64
            let center_frequency: u64 = spectrum_data.center_frequency_hz.unwrap_or(0) as u64;
            
            // Determine data type and payload
            let data_type_str = spectrum_data.data_type.as_deref();
            let is_iq_data = data_type_str == Some("iq_raw");
            
            let (data_type, frame_bytes) = if is_iq_data {
              let data_type = 1u32;
              let sample_rate = spectrum_data.sample_rate.unwrap_or(0) as u32;
              let iq_bytes = &spectrum_data.iq_data;
              
              // Construct header: [timestamp: 8][center_freq: 8][data_type: 4][sample_rate: 4]
              let mut binary_payload = Vec::with_capacity(24 + iq_bytes.len());
              binary_payload.extend_from_slice(&timestamp.to_le_bytes());
              binary_payload.extend_from_slice(&center_frequency.to_le_bytes());
              binary_payload.extend_from_slice(&data_type.to_le_bytes());
              binary_payload.extend_from_slice(&sample_rate.to_le_bytes());
              
              // Encrypt actual I/Q data
              match crypto::encrypt_payload_binary(&enc_key, iq_bytes) {
                Ok(encrypted_iq) => {
                  binary_payload.extend_from_slice(&encrypted_iq);
                  (data_type, binary_payload)
                }
                Err(_) => {
                  error!("I/Q data encryption failed");
                  continue;
                }
              }
            } else {
              // Spectrum data: normal processing
              let frame = &spectrum_data.waveform;
              let frame_bytes_slice: &[u8] = bytemuck::cast_slice(frame);
              let data_type = 0u32;
              let sample_rate = spectrum_data.sample_rate.unwrap_or(0) as u32;
              
              // Construct payload: [timestamp: 8][center_freq: 8][data_type: 4][sample_rate: 4][spectrum: N]
              let mut binary_payload = Vec::with_capacity(24 + frame_bytes_slice.len());
              binary_payload.extend_from_slice(&timestamp.to_le_bytes());
              binary_payload.extend_from_slice(&center_frequency.to_le_bytes());
              binary_payload.extend_from_slice(&data_type.to_le_bytes());
              binary_payload.extend_from_slice(&sample_rate.to_le_bytes());
              
              match crypto::encrypt_payload_binary(&enc_key, frame_bytes_slice) {
                Ok(encrypted_frame) => {
                  binary_payload.extend_from_slice(&encrypted_frame);
                  (data_type, binary_payload)
                }
                Err(_) => {
                  error!("Spectrum data encryption failed");
                  continue;
                }
              }
            };

            // Send the binary message
            if ws_sender.send(Message::Binary(frame_bytes)).await.is_err() {
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
              // Handle auto FFT options directly in the connection loop
              if message.message_type == "get_auto_fft_options" {
                if let Some(screen_width) = message.screen_width {
                  info!("Client requested auto FFT options for screen width: {}", screen_width);
                  let (auto_sizes, recommended) = calculate_auto_fft_sizes(screen_width);

                  let response = super::types::AutoFftOptionsResponse {
                    message_type: "auto_fft_options".to_string(),
                    auto_sizes,
                    recommended,
                  };

                  if let Ok(response_json) = serde_json::to_string(&response) {
                    if ws_sender.send(Message::Text(response_json)).await.is_err() {
                      break;
                    }
                  }
                }
              } else {
                handle_message(&cmd_tx, &shared, message);
              }
            }
          }
          Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
          _ => {}
        }
      }
    }
  }

  shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
  shared.client_count.fetch_sub(1, Ordering::Relaxed);
}

/// Handle incoming WebSocket messages from clients.
/// Sends commands to the dedicated I/O thread via mpsc channel — never blocks.
pub fn handle_message(
  cmd_tx: &std::sync::mpsc::Sender<super::types::SdrCommand>,
  shared: &Arc<SharedState>,
  message: WebSocketMessage,
) {
  match message.message_type.as_str() {
    "frequency_range" | "set_frequency_range" => {
      if let (Some(min_freq), Some(_max_freq)) =
        (message.min_freq, message.max_freq)
      {
        // Calculate center frequency based on the start of the range plus half the sample rate
        // This ensures the SDR tunes to exactly the right center frequency to capture the requested range
        let sdr_settings_guard = shared.sdr_settings.lock().unwrap();
        let sample_rate = sdr_settings_guard.sample_rate as f64;

        let center_freq = ((min_freq * 1000000.0) + (sample_rate / 2.0)) as u32;

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
    "pause" => {
      if let Some(paused) = message.paused {
        shared.is_paused.store(paused, Ordering::Relaxed);
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

      let gain = message.gain.and_then(|g| {
        if g.is_finite() && g >= 0.0 {
          Some(g)
        } else {
          warn!("Ignoring invalid gain from client: {}", g);
          None
        }
      });

      let ppm = message.ppm.and_then(|p| {
        // i32 cannot be NaN, but we still guard against extreme values
        const MAX_ABS_PPM: i32 = 200;
        if (-MAX_ABS_PPM..=MAX_ABS_PPM).contains(&p) {
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
        && ppm.is_none()
        && message.tuner_agc.is_none()
        && message.rtl_agc.is_none()
      {
        debug!("Dropping settings message with no valid fields");
        return;
      }

      let _ = cmd_tx.send(super::types::SdrCommand::ApplySettings(super::types::SdrProcessorSettings {
        fft_size,
        fft_window: message.fft_window,
        frame_rate,
        gain,
        ppm,
        tuner_agc: message.tuner_agc,
        rtl_agc: message.rtl_agc,
        offset_tuning: message.offset_tuning,
        direct_sampling: message.direct_sampling,
        tuner_bandwidth: message.tuner_bandwidth,
      }));

      // Update the shared settings so that future status broadcasts
      // reflect the new settings requested by the client.
      let mut sdr_settings = shared.sdr_settings.lock().unwrap();
      if let Some(size) = fft_size {
        sdr_settings.fft.default_size = size;
      }
      if let Some(fr) = frame_rate {
        sdr_settings.fft.default_frame_rate = fr;
      }
      if let Some(g) = gain {
        sdr_settings.gain.tuner_gain = g;
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
    }
    "restart_device" => {
      info!("Client requested device restart");
      let _ = cmd_tx.send(super::types::SdrCommand::RestartDevice);
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
      let capture_cmd = super::types::SdrCommand::StartCapture {
        job_id: message.job_id.clone().unwrap_or_else(|| {
          format!(
            "cap_{}",
            std::time::SystemTime::now()
              .duration_since(std::time::UNIX_EPOCH)
              .unwrap()
              .as_secs()
          )
        }),
        fragments: message
          .fragments
          .clone()
          .unwrap_or_else(|| {
            if let (Some(min_freq), Some(max_freq)) =
              (message.min_freq, message.max_freq)
            {
              vec![super::types::FreqRange { min_freq, max_freq }]
            } else {
              vec![]
            }
          })
          .into_iter()
          .map(|f| (f.min_freq, f.max_freq))
          .collect(),
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
        fft_size: message.fft_size.unwrap_or(2048),
        fft_window: message
          .fft_window
          .clone()
          .unwrap_or_else(|| "hann".to_string()),
        geolocation: message.geolocation,
        ref_based_demod_baseline: message.ref_based_demod_baseline,
        is_ephemeral: message.live_mode.unwrap_or(false),
      };
      log::info!("Client requested capture: {:?}", capture_cmd);
      let _ = cmd_tx.send(capture_cmd);
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
