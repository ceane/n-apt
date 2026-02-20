use std::sync::Arc;
use std::sync::atomic::Ordering;
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::extract::ws::{Message, WebSocket};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info};
use serde_json;
use tokio::sync::broadcast;

use n_apt_backend::crypto;

use super::shared_state::SharedState;
use super::types::{WsQueryParams, WebSocketMessage};
use super::utils::reconcile_device_state;

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
      return (StatusCode::UNAUTHORIZED, "Invalid or expired session token").into_response();
    }
  };

  info!("WebSocket upgrade: valid session, starting encrypted stream");

  let shared = state.shared.clone();
  let broadcast_tx = state.broadcast_tx.clone();
  let cmd_tx = state.cmd_tx.clone();
  let enc_key = session.encryption_key;

  ws.on_upgrade(move |socket| handle_ws_connection(socket, shared, broadcast_tx, cmd_tx, enc_key))
}

/// Handle an authenticated WebSocket connection (streaming only, no auth).
pub async fn handle_ws_connection(
  socket: WebSocket,
  shared: Arc<SharedState>,
  broadcast_tx: broadcast::Sender<String>,
  cmd_tx: std::sync::mpsc::Sender<super::types::SdrCommand>,
  enc_key: [u8; 32],
) {
  let (mut ws_sender, mut ws_receiver) = socket.split();
  let mut broadcast_rx = broadcast_tx.subscribe();

  shared.client_count.fetch_add(1, Ordering::Relaxed);
  shared.authenticated_count.fetch_add(1, Ordering::Relaxed);

  // Send initial status
  let device_connected = shared.device_connected.load(Ordering::Relaxed);
  let device_info = shared.device_info.lock().unwrap().clone();
  let device_loading = *shared.device_loading.lock().unwrap();
  let device_loading_reason = shared.device_loading_reason.lock().unwrap().clone();
  let device_state = reconcile_device_state(
    device_connected,
    &shared.device_state.lock().unwrap().clone(),
  );
  let paused = shared.is_paused.load(Ordering::Relaxed);

  let max_sample_rate = if device_connected {
    device_info
      .split("max: ")
      .nth(1)
      .and_then(|s| s.split(" Hz").next())
      .and_then(|s| s.parse::<u32>().ok())
      .unwrap_or(3_200_000)
  } else {
    device_info
      .split("Sample Rate: ")
      .nth(1)
      .and_then(|s| s.split(" Hz").next())
      .and_then(|s| s.parse::<u32>().ok())
      .unwrap_or(3_200_000)
  };

  let initial_status = serde_json::json!({
    "message_type": "status",
    "device_connected": device_connected,
    "device_info": device_info,
    "device_loading": device_loading,
    "device_loading_reason": device_loading_reason,
    "device_state": device_state,
    "paused": paused,
    "max_sample_rate": max_sample_rate,
    "spectrum_frames": shared.spectrum_frames.lock().unwrap().clone(),
    "backend": if device_connected { "rtl-sdr" } else { "mock" }
  });

  if ws_sender.send(Message::Text(initial_status.to_string())).await.is_err() {
    shared.authenticated_count.fetch_sub(1, Ordering::Relaxed);
    shared.client_count.fetch_sub(1, Ordering::Relaxed);
    return;
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
            if plaintext_json.contains("\"message_type\":\"status\"") || plaintext_json.contains("\"message_type\":\"capture_status\"") {
              if ws_sender.send(Message::Text(plaintext_json)).await.is_err() {
                break;
              }
              continue;
            }
            
            // Only process spectrum messages for the binary fast-path
            if plaintext_json.contains("\"message_type\":\"spectrum\"") {
              // Parse the JSON once to extract the float array and metadata
              if let Ok(spectrum_data) = serde_json::from_str::<super::types::SpectrumData>(&plaintext_json) {
                let frame = spectrum_data.waveform;
                let timestamp: u64 = spectrum_data.timestamp as u64; // i64 to u64
                let center_frequency: u64 = spectrum_data.center_frequency_hz.unwrap_or(0) as u64;
                
                // 1. Convert f32 array to bytes
                let frame_bytes: &[u8] = bytemuck::cast_slice(&frame);
                
                // 2. Encrypt the raw frame bytes
                match crypto::encrypt_payload_binary(&enc_key, frame_bytes) {
                  Ok(encrypted_frame) => {
                    // 3. Construct the binary payload: [timestamp: 8 bytes][center_frequency: 8 bytes][encrypted_frame: N bytes]
                    let mut binary_payload = Vec::with_capacity(8 + 8 + encrypted_frame.len());
                    binary_payload.extend_from_slice(&timestamp.to_le_bytes());
                    binary_payload.extend_from_slice(&center_frequency.to_le_bytes());
                    binary_payload.extend_from_slice(&encrypted_frame);
                    
                    // 4. Send the binary message
                    if ws_sender.send(Message::Binary(binary_payload)).await.is_err() {
                      break;
                    }
                  }
                  Err(e) => {
                    error!("Binary encryption failed: {}", e);
                  }
                }
              }
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
            if let Ok(message) = serde_json::from_str::<WebSocketMessage>(&text) {
              handle_message(&cmd_tx, &shared, message);
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
      if let (Some(min_freq), Some(max_freq)) = (message.min_freq, message.max_freq) {
        let center_freq = ((min_freq + max_freq) * 500000.0) as u32;
        shared.pending_center_freq.store(center_freq, Ordering::Relaxed);
        shared
          .pending_center_freq_dirty
          .store(true, Ordering::Relaxed);
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
      let _ = cmd_tx.send(super::types::SdrCommand::ApplySettings {
        fft_size: message.fft_size,
        fft_window: message.fft_window,
        frame_rate: message.frame_rate,
        gain: message.gain,
        ppm: message.ppm,
        tuner_agc: message.tuner_agc,
        rtl_agc: message.rtl_agc,
      });
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
            let signal_area = message.signal_area.unwrap_or_else(|| "A".to_string());
            info!("Client requested training start: label={}, area={}", label, signal_area);
            let _ = cmd_tx.send(super::types::SdrCommand::StartTraining { label, signal_area });
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
      if let Some(action) = message.action.as_deref() {
        if action == "start" {
          if let (Some(job_id), Some(min_freq), Some(max_freq), Some(duration_s), Some(file_type)) = 
            (message.job_id, message.min_freq, message.max_freq, message.duration_s, message.file_type) {
            let encrypted = message.encrypted.unwrap_or(false);
            let fft_size = message.fft_size.unwrap_or(n_apt_backend::consts::rs::fft::NUM_SAMPLES);
            let fft_window = message.fft_window.unwrap_or_else(|| "hann".to_string());
            
            info!("Client requested capture: job_id={}, range={}-{} MHz, duration={}s, type={}, encrypted={}",
              job_id, min_freq, max_freq, duration_s, file_type, encrypted);
            
            let _ = cmd_tx.send(super::types::SdrCommand::StartCapture {
              job_id,
              min_freq,
              max_freq,
              duration_s,
              file_type,
              encrypted,
              fft_size,
              fft_window,
            });
          }
        }
      }
    }
    _ => {
      debug!("Unknown message type: {}", message.message_type);
    }
  }
}
