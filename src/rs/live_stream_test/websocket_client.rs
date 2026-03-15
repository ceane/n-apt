//! WebSocket client for connecting to n-apt server

use anyhow::{anyhow, Result};
use base64::{Engine as _, engine::general_purpose};
use futures_util::StreamExt;
use log::{debug, error, info, warn};
use serde_json;
use tokio_tungstenite::{connect_async, tungstenite::Message, WebSocketStream};

use crate::crypto::derive_key;
use super::data_parser::parse_binary_message;
use super::types::{AuthRequest, AuthChallenge, WsStatusMessage};
use super::algorithms::AlgorithmTester;

/// WebSocket client for n-apt live stream
pub struct WebSocketClient {
    server_url: String,
    passkey: String,
    session_token: Option<String>,
    encryption_key: [u8; 32],
    algorithm_tester: AlgorithmTester,
}

impl WebSocketClient {
    /// Create new WebSocket client
    pub fn new(server_url: &str, passkey: &str) -> Result<Self> {
        let server_url = if server_url.starts_with("ws://") || server_url.starts_with("wss://") {
            server_url.to_string()
        } else {
            format!("ws://{}", server_url)
        };

        let encryption_key = derive_key(passkey);
        let algorithm_tester = AlgorithmTester::new();

        Ok(Self {
            server_url,
            passkey: passkey.to_string(),
            session_token: None,
            encryption_key,
            algorithm_tester,
        })
    }

    /// Authenticate with the server and get session token
    pub async fn authenticate(&mut self) -> Result<()> {
        info!("🔐 Authenticating with server...");
        
        // Step 1: Get authentication challenge
        let challenge_url = format!("{}/auth/challenge", 
            self.server_url.replace("ws://", "http://").replace("wss://", "https://"));
        
        let client = reqwest::Client::new();
        let response = client
            .post(&challenge_url)
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|e| anyhow!("Failed to get auth challenge: {}", e))?;
        
        if !response.status().is_success() {
            return Err(anyhow!("Auth challenge request failed: {}", response.status()));
        }
        
        let challenge: AuthChallenge = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse auth challenge: {}", e))?;
        
        debug!("Got auth challenge: {}", challenge.challenge_id);
        
        // Step 2: Compute HMAC response
        let nonce_bytes = general_purpose::STANDARD
            .decode(&challenge.nonce)
            .map_err(|e| anyhow!("Failed to decode nonce: {}", e))?;
        
        let hmac = crate::crypto::compute_hmac(&self.encryption_key, &nonce_bytes);
        let hmac_b64 = general_purpose::STANDARD.encode(&hmac);
        
        // Step 3: Submit HMAC response
        let auth_request = AuthRequest {
            challenge_id: challenge.challenge_id,
            hmac: hmac_b64,
        };
        
        let verify_url = format!("{}/auth/verify", 
            self.server_url.replace("ws://", "http://").replace("wss://", "https://"));
        
        let response = client
            .post(&verify_url)
            .json(&auth_request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to submit auth response: {}", e))?;
        
        if !response.status().is_success() {
            return Err(anyhow!("Auth verification failed: {}", response.status()));
        }
        
        let token_response: serde_json::Value = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse token response: {}", e))?;
        
        self.session_token = token_response
            .get("token")
            .and_then(|t| t.as_str())
            .map(|t| t.to_string());
        
        match &self.session_token {
            Some(token) => {
                info!("✅ Authentication successful, got session token");
                debug!("Session token: {}...", &token[..std::cmp::min(token.len(), 20)]);
                Ok(())
            }
            None => Err(anyhow!("No token in auth response")),
        }
    }

    /// Connect to WebSocket and start streaming
    pub async fn connect(&mut self) -> Result<()> {
        // First authenticate to get session token
        self.authenticate().await?;
        
        let token = self.session_token.as_ref()
            .ok_or_else(|| anyhow!("No session token available"))?;
        
        // Construct WebSocket URL with token
        let ws_url = format!("{}/ws?token={}", self.server_url, token);
        
        info!("🔌 Connecting to WebSocket: {}", ws_url);
        
        let (ws_stream, response) = connect_async(&ws_url)
            .await
            .map_err(|e| anyhow!("WebSocket connection failed: {}", e))?;
        
        info!("✅ WebSocket connected, response status: {}", response.status());
        
        // Store the stream for later use
        self.start_streaming_internal(ws_stream).await
    }

    /// Start streaming data from WebSocket
    pub async fn start_streaming(&mut self) -> Result<()> {
        info!("📡 Starting data stream...");
        
        let token = self.session_token.as_ref()
            .ok_or_else(|| anyhow!("No session token available"))?;
        
        let ws_url = format!("{}/ws?token={}", self.server_url, token);
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| anyhow!("WebSocket connection failed: {}", e))?;
        
        let passkey = self.passkey.clone();
        
        let (_, mut read) = ws_stream.split();
        
        loop {
            match read.next().await {
                Some(Ok(Message::Text(text))) => {
                    // Handle status messages
                    if let Ok(status_msg) = serde_json::from_str::<WsStatusMessage>(&text) {
                        debug!("📊 Status update: device={}, state={}", 
                            status_msg.device_name, status_msg.device_state);
                    } else {
                        debug!("📝 Text message: {}", text);
                    }
                }
                Some(Ok(Message::Binary(binary_data))) => {
                    // Handle encrypted binary data
                    match parse_binary_message(&passkey, &binary_data) {
                        Ok(live_data) => {
                            self.algorithm_tester.process_data(live_data);
                        }
                        Err(e) => {
                            warn!("Failed to parse binary message: {}", e);
                        }
                    }
                }
                Some(Ok(Message::Close(_))) => {
                    info!("🔌 WebSocket closed by server");
                    break;
                }
                Some(Err(e)) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
                None => {
                    warn!("WebSocket stream ended");
                    break;
                }
                _ => {}
            }
        }
        
        Ok(())
    }

    /// Run built-in example algorithms
    pub fn run_example_algorithms(&mut self) {
        self.algorithm_tester.run_example_algorithms();
    }

    /// Internal streaming implementation
    async fn start_streaming_internal(&mut self, _ws_stream: WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) -> Result<()> {
        // This would be used for more complex connection management
        // For now, the main streaming logic is in start_streaming()
        Ok(())
    }
}
