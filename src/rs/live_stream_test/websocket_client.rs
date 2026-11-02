//! Client for the source-scoped managed RX stream transport.

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

use super::algorithms::AlgorithmTester;
use super::data_parser::{parse_managed_iq_frame, FrameSequenceGuard};
use super::types::{AuthChallenge, AuthRequest};

const SUBSCRIPTION_ID: &str = "live-stream-test";

/// WebSocket client for n-apt managed live streams.
pub struct WebSocketClient {
  server_url: String,
  passkey: String,
  session_token: Option<String>,
  algorithm_tester: AlgorithmTester,
}

impl WebSocketClient {
  /// Create a client from a server host or HTTP/WebSocket URL.
  pub fn new(server_url: &str, passkey: &str) -> Result<Self> {
    let server_url = normalize_server_url(server_url)?;
    Ok(Self {
      server_url,
      passkey: passkey.to_owned(),
      session_token: None,
      algorithm_tester: AlgorithmTester::new(),
    })
  }

  /// Authenticate and receive managed RX frames until the connection closes.
  pub async fn start_streaming(&mut self) -> Result<()> {
    if self.session_token.is_none() {
      self.authenticate().await?;
    }

    let token = self
      .session_token
      .as_deref()
      .ok_or_else(|| anyhow!("No session token available"))?;
    let source = self.select_rx_source().await?;
    let source_id = required_string(&source, "id")?.to_owned();
    let subscription = build_rx_subscription(&source, &source_id)?;
    let stream_url = tokenized_url(&self.server_url, "/ws/streams", token)?;
    let encryption_key = crate::crypto::derive_key(&self.passkey);

    info!("📡 Subscribing to managed RX stream for source {source_id}");
    let (socket, _) = connect_async(stream_url.as_str())
      .await
      .map_err(|_| anyhow!("Managed stream WebSocket connection failed"))?;
    let (mut write, mut read) = socket.split();
    write
      .send(Message::Text(subscription.to_string().into()))
      .await
      .map_err(|_| anyhow!("Managed stream subscription could not be sent"))?;

    let mut sequence_guard = FrameSequenceGuard::default();
    loop {
      match read.next().await {
        Some(Ok(Message::Text(text))) => {
          self.handle_managed_message(
            text.as_str(),
            &encryption_key,
            &source_id,
            &mut sequence_guard,
          )?;
        }
        Some(Ok(Message::Binary(_))) => {
          bail!("Managed stream sent a non-JSON message");
        }
        Some(Ok(Message::Ping(payload))) => {
          write
            .send(Message::Pong(payload))
            .await
            .map_err(|_| anyhow!("Managed stream heartbeat response failed"))?;
        }
        Some(Ok(Message::Close(_))) => {
          info!("🔌 Managed stream closed by server");
          return Ok(());
        }
        Some(Ok(Message::Pong(_))) => {}
        Some(Ok(Message::Frame(_))) => {}
        Some(Err(error)) => {
          error!("Managed stream WebSocket error: {error}");
          return Err(anyhow!("Managed stream WebSocket failed"));
        }
        None => {
          warn!("Managed stream connection ended");
          return Ok(());
        }
      }
    }
  }

  /// Authenticate with the server and retain its session token in memory.
  async fn authenticate(&mut self) -> Result<()> {
    info!("🔐 Authenticating with server...");
    let client = reqwest::Client::new();
    let challenge_url = http_endpoint(&self.server_url, "/auth/challenge")?;
    let response = client
      .post(challenge_url)
      .json(&json!({}))
      .send()
      .await
      .context("Failed to request authentication challenge")?;
    if !response.status().is_success() {
      bail!("Auth challenge request failed: {}", response.status());
    }

    let challenge: AuthChallenge = response
      .json()
      .await
      .context("Failed to parse authentication challenge")?;
    debug!("Received authentication challenge");

    let nonce = BASE64
      .decode(&challenge.nonce)
      .context("Authentication challenge nonce is malformed")?;
    let auth_key = crate::crypto::derive_auth_key(&self.passkey);
    let proof = crate::crypto::compute_hmac(&auth_key, &nonce);
    let request = AuthRequest {
      challenge_id: challenge.challenge_id,
      hmac: BASE64.encode(proof),
    };

    let verify_url = http_endpoint(&self.server_url, "/auth/verify")?;
    let response = client
      .post(verify_url)
      .json(&request)
      .send()
      .await
      .context("Failed to submit authentication proof")?;
    if !response.status().is_success() {
      bail!("Auth verification failed: {}", response.status());
    }

    let token_response: Value = response
      .json()
      .await
      .context("Failed to parse authentication response")?;
    self.session_token = token_response
      .get("token")
      .and_then(Value::as_str)
      .map(str::to_owned);
    if self.session_token.is_none() {
      bail!("Authentication response did not include a session token");
    }
    info!("✅ Authentication successful");
    Ok(())
  }

  async fn select_rx_source(&self) -> Result<Value> {
    let status_url = http_endpoint(&self.server_url, "/status")?;
    let response = reqwest::get(status_url)
      .await
      .context("Failed to read source status")?;
    if !response.status().is_success() {
      bail!("Source status request failed: {}", response.status());
    }
    let response: Value = response
      .json()
      .await
      .context("Failed to parse source status")?;
    let snapshot = response.get("status").ok_or_else(|| {
      anyhow!("Source status response is missing its snapshot")
    })?;
    let active_source_id = snapshot
      .get("active_source")
      .and_then(Value::as_str)
      .unwrap_or_default();
    let sources = snapshot
      .get("sources")
      .and_then(Value::as_array)
      .ok_or_else(|| {
        anyhow!("Source status response is missing its sources")
      })?;

    let active_source = sources.iter().find(|source| {
      source.get("id").and_then(Value::as_str) == Some(active_source_id)
        && source_supports_rx_iq(source)
    });
    active_source
      .or_else(|| sources.iter().find(|source| source_supports_rx_iq(source)))
      .cloned()
      .ok_or_else(|| anyhow!("No source with RX I/Q support is available"))
  }

  fn handle_managed_message(
    &mut self,
    text: &str,
    encryption_key: &[u8; 32],
    source_id: &str,
    sequence_guard: &mut FrameSequenceGuard,
  ) -> Result<()> {
    let message: Value = serde_json::from_str(text)
      .context("Managed stream sent malformed JSON")?;
    match message.get("type").and_then(Value::as_str) {
      Some("stream_frame") => {
        let frame =
          parse_managed_iq_frame(encryption_key, text.as_bytes(), source_id)?;
        if sequence_guard.accept(&frame) {
          self.algorithm_tester.process_data(frame);
        } else {
          warn!("Dropped stale or duplicate managed RX frame");
        }
      }
      Some("stream_subscribed") => {
        info!("✅ Managed RX subscription acknowledged");
      }
      Some("stream_state") => {
        debug!(
          "Managed RX stream state: {}",
          message
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
        );
      }
      Some("stream_options_applied") => {
        debug!("Managed RX stream options applied");
      }
      Some("stream_error") => {
        let code = message
          .get("code")
          .and_then(Value::as_str)
          .unwrap_or("unknown");
        let detail = message
          .get("message")
          .and_then(Value::as_str)
          .unwrap_or("unspecified stream error");
        bail!("Managed RX stream error ({code}): {detail}");
      }
      Some(other) => debug!("Ignoring managed stream event: {other}"),
      None => warn!("Ignoring managed stream message without a type"),
    }
    Ok(())
  }

  /// Run built-in example algorithms.
  pub fn run_example_algorithms(&mut self) {
    self.algorithm_tester.run_example_algorithms();
  }
}

fn normalize_server_url(server_url: &str) -> Result<String> {
  let trimmed = server_url.trim().trim_end_matches('/');
  let websocket_url = if let Some(rest) = trimmed.strip_prefix("https://") {
    format!("wss://{rest}")
  } else if let Some(rest) = trimmed.strip_prefix("http://") {
    format!("ws://{rest}")
  } else if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
    trimmed.to_owned()
  } else {
    format!("ws://{trimmed}")
  };
  let parsed =
    Url::parse(&websocket_url).context("Invalid WebSocket server URL")?;
  if parsed.host_str().is_none() {
    bail!("WebSocket server URL must include a host");
  }
  Ok(websocket_url)
}

fn http_endpoint(server_url: &str, path: &str) -> Result<Url> {
  let http_base = if let Some(rest) = server_url.strip_prefix("wss://") {
    format!("https://{rest}")
  } else if let Some(rest) = server_url.strip_prefix("ws://") {
    format!("http://{rest}")
  } else {
    bail!("WebSocket server URL has an unsupported scheme");
  };
  Url::parse(&format!("{}{path}", http_base.trim_end_matches('/')))
    .context("Invalid HTTP endpoint URL")
}

fn tokenized_url(server_url: &str, path: &str, token: &str) -> Result<Url> {
  let mut url =
    Url::parse(&format!("{}{path}", server_url.trim_end_matches('/')))
      .context("Invalid managed stream URL")?;
  url.query_pairs_mut().append_pair("token", token);
  Ok(url)
}

fn source_supports_rx_iq(source: &Value) -> bool {
  source
    .get("capabilities")
    .and_then(|capabilities| capabilities.get("can_receive"))
    .and_then(Value::as_bool)
    == Some(true)
    && source.get("iq_format").is_some_and(Value::is_object)
}

fn build_rx_subscription(source: &Value, source_id: &str) -> Result<Value> {
  let settings = source
    .get("sdr")
    .and_then(|sdr| sdr.get("settings"))
    .ok_or_else(|| anyhow!("Selected source is missing RX settings"))?;

  let center_frequency_hz = required_integer_hz(settings, "center_frequency")?;
  let sample_rate_hz = required_u64(settings, "sample_rate")?;
  let fft_size = required_u64(settings, "fft_size")?;
  let options = json!({
    "mode": "rx",
    "centerFrequencyHz": center_frequency_hz,
    "sampleRateHz": sample_rate_hz,
    "fftSize": fft_size,
    "fftWindow": settings.get("fft_window").and_then(Value::as_str).unwrap_or("Rectangular"),
    "frameRate": settings.get("frame_rate").and_then(Value::as_u64),
    "gain": settings.get("gain").and_then(Value::as_f64),
    "hackrfLnaGain": settings.get("hackrf_lna_gain").and_then(Value::as_f64),
    "hackrfVgaGain": settings.get("hackrf_vga_gain").and_then(Value::as_f64),
    "hackrfAmpEnable": settings.get("hackrf_amp_enable").and_then(Value::as_bool),
    "ppm": settings.get("ppm").and_then(Value::as_u64),
    "tunerAgc": settings.get("tuner_agc").and_then(Value::as_bool),
    "rtlAgc": settings.get("rtl_agc").and_then(Value::as_bool),
    "tunerBandwidth": settings.get("tuner_bandwidth").and_then(Value::as_u64),
  });

  Ok(json!({
    "type": "stream_subscribe",
    "scope": "subscriber",
    "subscriptionId": SUBSCRIPTION_ID,
    "stream": { "sourceId": source_id, "mode": "rx" },
    "options": options,
    "deliveryPolicy": "latest",
  }))
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
  value
    .get(key)
    .and_then(Value::as_str)
    .ok_or_else(|| anyhow!("Source status is missing {key}"))
}

fn required_u64(value: &Value, key: &str) -> Result<u64> {
  value
    .get(key)
    .and_then(Value::as_u64)
    .ok_or_else(|| anyhow!("Source RX settings are missing {key}"))
}

fn required_integer_hz(value: &Value, key: &str) -> Result<u64> {
  if let Some(hz) = value.get(key).and_then(Value::as_u64) {
    return Ok(hz);
  }
  let hz = value
    .get(key)
    .and_then(Value::as_f64)
    .ok_or_else(|| anyhow!("Source RX settings are missing {key}"))?;
  if !hz.is_finite() || hz < 0.0 || hz > u64::MAX as f64 {
    bail!("Source RX setting {key} is outside the supported range");
  }
  Ok(hz.round() as u64)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn source() -> Value {
    json!({
      "id": "mock-apt",
      "capabilities": { "can_receive": true },
      "iq_format": { "format": "u8_iq_interleaved" },
      "sdr": { "settings": {
        "center_frequency": 137100000,
        "sample_rate": 3200000,
        "fft_size": 2048,
        "fft_window": "Rectangular",
        "frame_rate": 15,
        "gain": 32.0
      }}
    })
  }

  #[test]
  fn server_urls_normalize_http_and_websocket_schemes() {
    assert_eq!(
      normalize_server_url("localhost:8765").unwrap(),
      "ws://localhost:8765"
    );
    assert_eq!(
      normalize_server_url("https://localhost:8765").unwrap(),
      "wss://localhost:8765"
    );
    assert_eq!(
      normalize_server_url("ws://localhost:8765/").unwrap(),
      "ws://localhost:8765"
    );
  }

  #[test]
  fn managed_subscription_uses_source_scoped_rx_options() {
    let subscription = build_rx_subscription(&source(), "mock-apt").unwrap();
    assert_eq!(subscription["type"], "stream_subscribe");
    assert_eq!(subscription["scope"], "subscriber");
    assert_eq!(subscription["stream"]["sourceId"], "mock-apt");
    assert_eq!(subscription["stream"]["mode"], "rx");
    assert_eq!(subscription["options"]["centerFrequencyHz"], 137_100_000);
    assert_eq!(subscription["options"]["sampleRateHz"], 3_200_000);
    assert_eq!(subscription["deliveryPolicy"], "latest");
  }

  #[test]
  fn managed_subscription_rounds_fractional_frequency_settings_to_hz() {
    let mut source = source();
    source["sdr"]["settings"]["center_frequency"] = json!(137_100_000.4);
    let subscription = build_rx_subscription(&source, "mock-apt").unwrap();
    assert_eq!(subscription["options"]["centerFrequencyHz"], 137_100_000);
  }

  #[test]
  fn source_selection_requires_rx_capability_and_iq_format() {
    let mut tx_source = source();
    tx_source["capabilities"]["can_receive"] = Value::Bool(false);
    assert!(!source_supports_rx_iq(&tx_source));

    let mut no_iq_source = source();
    no_iq_source.as_object_mut().unwrap().remove("iq_format");
    assert!(!source_supports_rx_iq(&no_iq_source));
  }

  #[test]
  fn session_token_is_encoded_as_a_query_parameter() {
    let url =
      tokenized_url("wss://localhost:8765", "/ws/streams", "a+b/c").unwrap();
    assert_eq!(url.path(), "/ws/streams");
    assert_eq!(
      url.query_pairs().find(|(key, _)| key == "token").unwrap().1,
      "a+b/c"
    );
  }
}
