use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Default endpoint for the Swift/CoreML service
const DEFAULT_COREML_URL: &str = "http://127.0.0.1:8081";

/// Request payload for sending a training sample to the CoreML service
#[derive(Debug, Clone, Serialize)]
pub struct TrainingSampleRequest {
  pub signal_area: String,
  pub label: String,
  pub data: Vec<f32>,
  pub timestamp: i64,
  pub frequency_min: f64,
  pub frequency_max: f64,
  pub sample_rate: u32,
}

/// Response from the CoreML service after receiving a training sample
#[derive(Debug, Clone, Deserialize)]
pub struct TrainingResponse {
  pub success: bool,
  pub sample_id: Option<String>,
  pub total_samples: Option<u64>,
}

/// Request payload for classifying a spectrum
#[derive(Debug, Clone, Serialize)]
pub struct ClassificationRequest {
  pub data: Vec<f32>,
  pub signal_area: String,
  pub frequency_min: f64,
  pub frequency_max: f64,
  pub timestamp: i64,
}

/// Classification result from the CoreML service
#[derive(Debug, Clone, Deserialize)]
pub struct ClassificationResponse {
  pub prediction: String,
  pub confidence: f64,
  pub probabilities: std::collections::HashMap<String, f64>,
  pub processing_time_ms: f64,
}

/// Training status from the CoreML service
#[derive(Debug, Clone, Deserialize)]
pub struct TrainingStatus {
  pub total_samples: u64,
  pub target_samples: u64,
  pub noise_samples: u64,
  pub model_version: Option<String>,
  pub model_accuracy: Option<f64>,
  pub is_training: bool,
}

// MARK: - Signal Decoding Types

/// Request payload for decoding a signal
#[derive(Debug, Clone, Serialize)]
pub struct DecodingRequest {
  pub data: Vec<f32>,
  pub signal_area: String,
  pub frequency_min: f64,
  pub frequency_max: f64,
  pub sample_rate: u32,
  pub timestamp: Option<i64>,
}

/// Response from the CoreML service after signal decoding
#[derive(Debug, Clone, Deserialize)]
pub struct DecodingResponse {
  pub decoded_signal_id: Option<String>,
  pub signal_features_id: Option<String>,
  pub prediction: String,
  pub confidence: f64,
  pub decoded_features: std::collections::HashMap<String, f64>,
  pub processing_time_ms: f64,
}

// MARK: - Heterodyning Detection Types

/// Request payload for heterodyning detection
#[derive(Debug, Clone, Serialize)]
pub struct HeterodyningRequest {
  pub data: Vec<f32>,
  pub signal_area: String,
  pub frequency_min: f64,
  pub frequency_max: f64,
  pub sample_rate: u32,
  pub timestamp: Option<i64>,
}

/// Response from heterodyning detection
#[derive(Debug, Clone, Deserialize)]
pub struct HeterodyningResponse {
  pub heterodyning_result_id: Option<String>,
  pub frequency_features_id: Option<String>,
  pub is_heterodyning_detected: bool,
  pub confidence: f64,
  pub carrier_frequencies: Vec<f64>,
  pub intermediate_frequency: Option<f64>,
  pub modulation_type: Option<String>,
  pub processing_time_ms: f64,
}

/// Status of heterodyning detection
#[derive(Debug, Clone, Deserialize)]
pub struct HeterodyningStatus {
  pub last_detection_time: Option<String>,
  pub is_currently_detected: bool,
  pub recent_detections: Vec<bool>,
  pub average_confidence: f64,
}

// MARK: - Signal Recreation Types

/// Request payload for signal recreation analysis
#[derive(Debug, Clone, Serialize)]
pub struct RecreationAnalysisRequest {
  pub data: Vec<f32>,
  pub signal_area: String,
  pub frequency_min: f64,
  pub frequency_max: f64,
  pub sample_rate: u32,
  pub timestamp: Option<i64>,
}

/// Response from signal recreation analysis
#[derive(Debug, Clone, Deserialize)]
pub struct RecreationAnalysisResponse {
  pub signal_parameters_id: Option<String>,
  pub parameters: std::collections::HashMap<String, f64>,
  pub analysis_confidence: f64,
}

/// Request payload for generating recreated signal
#[derive(Debug, Clone, Serialize)]
pub struct RecreationGenerateRequest {
  pub signal_parameters_id: String,
  pub sample_rate: u32,
  pub duration: f64,
}

/// Response from signal recreation generation
#[derive(Debug, Clone, Deserialize)]
pub struct RecreationGenerateResponse {
  pub recreated_signal_id: Option<String>,
  pub waveform_pattern: Vec<f32>,
  pub recreation_quality_score: f64,
  pub processing_time_ms: f64,
}

/// HTTP client for communicating with the Swift/CoreML service
pub struct CoreMLClient {
  client: reqwest::Client,
  endpoint: String,
}

impl CoreMLClient {
  /// Create a new CoreML client.
  ///
  /// Reads `COREML_SERVICE_URL` from the environment, falling back to
  /// `http://127.0.0.1:8081`.
  pub fn new() -> Self {
    let endpoint = std::env::var("COREML_SERVICE_URL")
      .unwrap_or_else(|_| DEFAULT_COREML_URL.to_string());

    let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(10))
      .build()
      .expect("Failed to build reqwest client");

    Self { client, endpoint }
  }

  /// Send a training sample to the CoreML service.
  pub async fn send_training_sample(
    &self,
    sample: TrainingSampleRequest,
  ) -> Result<TrainingResponse> {
    let url = format!("{}/api/v1/training/sample", self.endpoint);
    let response = self.client.post(&url).json(&sample).send().await?;
    let result = response.json::<TrainingResponse>().await?;
    Ok(result)
  }

  /// Classify a spectrum using the trained CoreML model.
  pub async fn classify(
    &self,
    request: ClassificationRequest,
  ) -> Result<ClassificationResponse> {
    let url = format!("{}/api/v1/classify", self.endpoint);
    let response = self.client.post(&url).json(&request).send().await?;
    let result = response.json::<ClassificationResponse>().await?;
    Ok(result)
  }

  /// Get the current training status from the CoreML service.
  pub async fn training_status(&self) -> Result<TrainingStatus> {
    let url = format!("{}/api/v1/training/status", self.endpoint);
    let response = self.client.get(&url).send().await?;
    let result = response.json::<TrainingStatus>().await?;
    Ok(result)
  }

  /// Check if the CoreML service is reachable.
  pub async fn health_check(&self) -> bool {
    let url = format!("{}/api/v1/training/status", self.endpoint);
    self.client.get(&url).send().await.is_ok()
  }

  // MARK: - Signal Decoding Methods

  /// Decode a signal using the CoreML service.
  pub async fn decode_signal(
    &self,
    request: DecodingRequest,
  ) -> Result<DecodingResponse> {
    let url = format!("{}/api/v1/decode", self.endpoint);
    let response = self.client.post(&url).json(&request).send().await?;
    let result = response.json::<DecodingResponse>().await?;
    Ok(result)
  }

  /// Get the decoding history from the CoreML service.
  pub async fn get_decoding_history(&self) -> Result<Vec<serde_json::Value>> {
    let url = format!("{}/api/v1/decode/history", self.endpoint);
    let response = self.client.get(&url).send().await?;
    let result = response.json::<Vec<serde_json::Value>>().await?;
    Ok(result)
  }

  // MARK: - Heterodyning Detection Methods

  /// Detect heterodyning in a signal using the CoreML service.
  pub async fn detect_heterodyning(
    &self,
    request: HeterodyningRequest,
  ) -> Result<HeterodyningResponse> {
    let url = format!("{}/api/v1/heterodyning/detect", self.endpoint);
    let response = self.client.post(&url).json(&request).send().await?;
    let result = response.json::<HeterodyningResponse>().await?;
    Ok(result)
  }

  /// Get the heterodyning detection status from the CoreML service.
  pub async fn get_heterodyning_status(&self) -> Result<HeterodyningStatus> {
    let url = format!("{}/api/v1/heterodyning/status", self.endpoint);
    let response = self.client.get(&url).send().await?;
    let result = response.json::<HeterodyningStatus>().await?;
    Ok(result)
  }

  // MARK: - Signal Recreation Methods

  /// Analyze a signal for recreation using the CoreML service.
  pub async fn analyze_signal_for_recreation(
    &self,
    request: RecreationAnalysisRequest,
  ) -> Result<RecreationAnalysisResponse> {
    let url = format!("{}/api/v1/recreation/analyze", self.endpoint);
    let response = self.client.post(&url).json(&request).send().await?;
    let result = response.json::<RecreationAnalysisResponse>().await?;
    Ok(result)
  }

  /// Generate a recreated signal using the CoreML service.
  pub async fn generate_recreated_signal(
    &self,
    request: RecreationGenerateRequest,
  ) -> Result<RecreationGenerateResponse> {
    let url = format!("{}/api/v1/recreation/generate", self.endpoint);
    let response = self.client.post(&url).json(&request).send().await?;
    let result = response.json::<RecreationGenerateResponse>().await?;
    Ok(result)
  }

  /// Get the signal recreation library from the CoreML service.
  pub async fn get_recreation_library(&self) -> Result<Vec<serde_json::Value>> {
    let url = format!("{}/api/v1/recreation/library", self.endpoint);
    let response = self.client.get(&url).send().await?;
    let result = response.json::<Vec<serde_json::Value>>().await?;
    Ok(result)
  }
}
