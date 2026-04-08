use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// WebMCP tool request from agents
#[derive(Debug, Deserialize)]
pub struct WebMCPToolRequest {
  pub name: String,
  pub params: serde_json::Value,
}

/// WebMCP tool response
#[derive(Debug, Serialize)]
pub struct WebMCPToolResponse {
  pub success: bool,
  pub result: Option<serde_json::Value>,
  pub error: Option<String>,
  pub tool: String,
}

/// Power scale mode for spectrum display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PowerScale {
  /// Relative dB scale (current default)
  DB,
  /// Calibrated dBm scale (RTL-SDR specific)
  DBm,
}

/// Content types for APT analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AptContentType {
  #[serde(rename = "audio_hearing")]
  AudioHearing,
  #[serde(rename = "audio_internal")]
  AudioInternal,
  #[serde(rename = "speech")]
  Speech,
  #[serde(rename = "video_vision")]
  VideoVision,
}

/// APT Analysis Configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptAnalysisConfig {
  /// Content type for analysis
  #[serde(rename = "contentType")]
  pub content_type: AptContentType,
  /// Analysis window size in Hz
  #[serde(rename = "windowSizeHz")]
  pub window_size_hz: f64,
  /// Sub-channel frequency range (Hz)
  #[serde(rename = "subChannelRange")]
  pub sub_channel_range: (f64, f64),
  /// Frontend-generated script content (optional)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub script_content: Option<String>,
  /// Frontend-generated media content (base64, optional)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub media_content: Option<String>,
  /// Baseline vector for comparison (optional)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub baseline_vector: Option<Vec<f32>>,
  /// Generated demod processor math (placeholder)
  #[serde(rename = "demodProcessor")]
  pub demod_processor: String,
}

/// Command enum for the dedicated SDR I/O thread
#[derive(Debug, Clone)]
pub enum SdrCommand {
  SetFrequency(u32),
  SetGain(f64),
  SetPpm(i32),
  SetTunerAGC(bool),
  SetRtlAGC(bool),
  SetOffsetTuning(bool),
  SetDirectSampling(u8),
  RestartDevice,
  StartTraining {
    label: String,
    signal_area: String,
  },
  StopTraining,
  StartCapture {
    job_id: String,
    fragments: Vec<(f64, f64)>,
    duration_s: f64,
    file_type: String,
    acquisition_mode: String,
    encrypted: bool,
    fft_size: usize,
    fft_window: String,
    geolocation: Option<GeolocationData>,
    ref_based_demod_baseline: Option<String>,
    is_ephemeral: bool,
  },
  ApplySettings(SdrProcessorSettings),
  SetPowerScale {
    scale: PowerScale,
  },
  ScanForAudio {
    job_id: String,
    frequency_range: (f64, f64),
    window_size_hz: f64,
    step_size_hz: f64,
    audio_threshold: f32,
  },
  DemodulateRegion {
    job_id: String,
    region: FrequencyRegion,
  },
  StartAptAnalysis {
    job_id: String,
    config: AptAnalysisConfig,
  },
}

/// Settings for applying to the SDR processor and hardware
#[derive(Debug, Clone, Default)]
pub struct SdrProcessorSettings {
  pub fft_size: Option<usize>,
  pub fft_window: Option<String>,
  pub frame_rate: Option<u32>,
  pub gain: Option<f64>,
  pub ppm: Option<i32>,
  pub tuner_agc: Option<bool>,
  pub rtl_agc: Option<bool>,
  pub offset_tuning: Option<bool>,
  pub direct_sampling: Option<u8>,
  pub tuner_bandwidth: Option<u32>,
}

/// Struct representing a frequency range
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreqRange {
  #[serde(alias = "minFreq")]
  pub min_freq: f64,
  #[serde(alias = "maxFreq")]
  pub max_freq: f64,
}

/// Geolocation data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeolocationData {
  pub latitude: f64,
  pub longitude: f64,
  pub accuracy: f64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub altitude: Option<f64>,
  pub timestamp: f64, // JavaScript timestamp in milliseconds
}

/// WebSocket message structure for client-server communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketMessage {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub fragments: Option<Vec<FreqRange>>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "acquisitionMode")]
  pub acquisition_mode: Option<String>,
  #[serde(
    skip_serializing_if = "Option::is_none",
    alias = "minFreq",
    alias = "min_mhz"
  )]
  pub min_freq: Option<f64>,
  #[serde(
    skip_serializing_if = "Option::is_none",
    alias = "maxFreq",
    alias = "max_mhz"
  )]
  pub max_freq: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub paused: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub gain: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub ppm: Option<i32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "tunerAGC")]
  pub tuner_agc: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "rtlAGC")]
  pub rtl_agc: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "offsetTuning")]
  pub offset_tuning: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "directSampling")]
  pub direct_sampling: Option<u8>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "tunerBandwidth")]
  pub tuner_bandwidth: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftSize")]
  pub fft_size: Option<usize>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fftWindow")]
  pub fft_window: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "frameRate")]
  pub frame_rate: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "liveRetune")]
  pub live_retune: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub label: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "signalArea")]
  pub signal_area: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub action: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "jobId")]
  pub job_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "durationS")]
  pub duration_s: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "fileType")]
  pub file_type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub encrypted: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "screenWidth")]
  pub screen_width: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub geolocation: Option<GeolocationData>,
  #[serde(
    skip_serializing_if = "Option::is_none",
    alias = "refBasedDemodBaseline"
  )]
  pub ref_based_demod_baseline: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "powerScale")]
  pub power_scale: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none", alias = "liveMode")]
  pub live_mode: Option<bool>,
  /// Hardware frequency range info (get_hardware_info)
  #[serde(skip_serializing_if = "Option::is_none", alias = "hardwareFreqRange")]
  pub hardware_freq_range: Option<HardwareFreqRange>,
}

/// Hardware frequency range info response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareFreqRange {
  pub min: f64,
  pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfoResponse {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(rename = "hardwareFreqRange")]
  pub hardware_freq_range: HardwareFreqRange,
  #[serde(rename = "sampleRate")]
  pub sample_rate: u32,
}

/// Auto FFT size options response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoFftOptionsResponse {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(rename = "autoSizes")]
  pub auto_sizes: Vec<usize>,
  pub recommended: usize,
}

/// Frequency region detected during scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrequencyRegion {
  #[serde(rename = "startFreq")]
  pub start_freq: f64,
  #[serde(rename = "endFreq")]
  pub end_freq: f64,
  #[serde(rename = "centerFreq")]
  pub center_freq: f64,
  #[serde(rename = "audioScore")]
  pub audio_score: f32,
  #[serde(rename = "signalStrength")]
  pub signal_strength: f32,
  pub snr: f32,
}

/// Result of a frequency scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResultResponse {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(rename = "jobId")]
  pub job_id: String,
  pub regions: Vec<FrequencyRegion>,
}

/// Result of a region demodulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemodResultResponse {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(rename = "jobId")]
  pub job_id: String,
  pub region: FrequencyRegion,
  #[serde(rename = "audioBuffer")]
  pub audio_buffer: Vec<f32>,
  #[serde(rename = "sampleRate")]
  pub sample_rate: u32,
}

/// APT Analysis Result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptAnalysisResult {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(rename = "jobId")]
  pub job_id: String,
  /// Channel metadata
  #[serde(rename = "channelMetadata")]
  pub channel_metadata: AptChannelMetadata,
  /// Analysis progress (0.0 to 1.0)
  pub progress: f32,
  /// Current processing stage
  #[serde(rename = "processingStage")]
  pub processing_stage: AptProcessingStage,
  /// Analysis results (populated when complete)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub analysis_data: Option<AptAnalysisData>,
}

/// Channel metadata for APT analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptChannelMetadata {
  /// Analysis window size in Hz
  #[serde(rename = "windowSizeHz")]
  pub window_size_hz: f64,
  /// Content type being analyzed
  #[serde(rename = "contentType")]
  pub content_type: AptContentType,
  /// Sub-channel frequency range
  #[serde(rename = "subChannelRange")]
  pub sub_channel_range: (f64, f64),
  /// Center frequency in Hz
  #[serde(rename = "centerFreqHz")]
  pub center_freq_hz: u32,
  /// Signal strength in dB
  #[serde(rename = "signalStrengthDb")]
  pub signal_strength_db: f32,
  /// Signal-to-noise ratio
  #[serde(rename = "snr")]
  pub snr: f32,
  /// Demod processor description
  #[serde(rename = "demodProcessor")]
  pub demod_processor: String,
}

/// APT processing stages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AptProcessingStage {
  #[serde(rename = "initializing")]
  Initializing,
  #[serde(rename = "fm_demodulation")]
  FmDemodulation,
  #[serde(rename = "subcarrier_isolation")]
  SubcarrierIsolation,
  #[serde(rename = "envelope_detection")]
  EnvelopeDetection,
  #[serde(rename = "baseband_recovery")]
  BasebandRecovery,
  #[serde(rename = "content_analysis")]
  ContentAnalysis,
  #[serde(rename = "completed")]
  Completed,
  #[serde(rename = "error")]
  Error(String),
}

/// APT analysis data results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptAnalysisData {
  /// Match confidence score (0.0 to 1.0)
  #[serde(rename = "confidence")]
  pub confidence: f32,
  /// Extracted content patterns
  #[serde(rename = "contentPatterns")]
  pub content_patterns: Vec<String>,
  /// Comparison results against baseline
  #[serde(rename = "baselineComparison")]
  pub baseline_comparison: Option<AptBaselineComparison>,
  /// Processing time in milliseconds
  #[serde(rename = "processingTimeMs")]
  pub processing_time_ms: u64,
}

/// Baseline comparison results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptBaselineComparison {
  /// Similarity score (0.0 to 1.0)
  #[serde(rename = "similarity")]
  pub similarity: f32,
  /// Matched features
  #[serde(rename = "matchedFeatures")]
  pub matched_features: Vec<String>,
  /// Feature differences
  #[serde(rename = "featureDifferences")]
  pub feature_differences: Vec<String>,
}

/// Progress update for scanning
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgressResponse {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(rename = "jobId")]
  pub job_id: String,
  pub progress: f32,
  #[serde(rename = "currentFreq")]
  pub current_freq: f64,
  #[serde(rename = "regionsLength")]
  pub regions_length: usize,
}

/// Spectrum data message sent to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumData {
  #[serde(rename = "type")]
  pub message_type: String,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub waveform: Vec<f32>,
  pub is_mock_apt: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub center_frequency_hz: Option<u32>,
  /// Actual span of the waveform in MHz (for live multi-hop captures)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub waveform_span_mhz: Option<f64>,
  pub timestamp: i64,
  /// Data type: "spectrum_db" for FFT power data, "iq_raw" for raw I/Q samples
  #[serde(skip_serializing_if = "Option::is_none")]
  pub data_type: Option<String>,
  /// Sample rate in Hz (required for I/Q data processing)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub sample_rate: Option<u32>,
  /// Power scale mode (dB or dBm)
  #[serde(skip_serializing_if = "Option::is_none")]
  pub power_scale: Option<PowerScale>,
  /// Raw I/Q data bytes (for dBm mode when data_type is "iq_raw")
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub iq_data: Vec<u8>,
}

/// Structured signal pattern for consistent waterfall visualization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceProfile {
  pub kind: String,
  pub is_rtl_sdr: bool,
  pub supports_approx_dbm: bool,
  pub supports_raw_iq_stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusMessage {
  #[serde(rename = "type")]
  pub message_type: String,
  pub device_connected: bool,
  pub device_info: String,
  pub device_name: String,
  pub device_loading: bool,
  pub device_loading_reason: Option<String>,
  pub device_state: String,
  pub paused: bool,
  pub max_sample_rate: u32,
  pub channels: Vec<SpectrumFrameMessage>,
  pub sdr_settings: SdrConfig,
  pub device: String,
  pub device_profile: DeviceProfile,
}

/// Structured signal pattern for consistent waterfall visualization
#[derive(Debug, Clone)]
pub struct MockAptSignal {
  pub center_bin: f32,
  pub drift_offset: f32,
  pub bandwidth: usize,
  pub base_strength: f32,
  pub modulation_phase: f32,
  pub active: bool,
  /// Type of signal (for future classification features)
  #[allow(dead_code)]
  pub signal_type: SignalType,
}

#[derive(Debug, Clone)]
pub enum SignalType {
  Narrow,
  Medium,
  Wide,
}

impl SignalType {
  // NOTE: Bandwidth and strength ranges are sourced from signals.yaml.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalsConfig {
  pub signals: SignalsData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalsData {
  #[serde(alias = "mock")]
  pub mock_apt: MockAptSignalsConfig,
  pub n_apt: NaptConfig,
  pub sdr: SdrConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptSignalsConfig {
  pub global_settings: MockAptGlobalSettings,
  pub bandwidths: MockAptBandwidths,
  pub strength_ranges: MockAptStrengthRanges,
  pub signals: Vec<MockAptSignalConfig>,
  pub training_areas: HashMap<String, MockAptTrainingArea>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaptConfig {
  pub channels: IndexMap<String, SpectrumFrameConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdrConfig {
  pub sample_rate: u32,
  pub center_frequency: u32,
  pub gain: SdrGainConfig,
  pub ppm: f64,
  pub fft: SdrFftConfig,
  pub display: SdrDisplayConfig,
  #[serde(default)]
  pub limits: Option<SdrLimitsConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdrGainConfig {
  pub tuner_gain: f64,
  pub rtl_agc: bool,
  pub tuner_agc: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdrFftConfig {
  pub default_size: usize,
  pub default_frame_rate: u32,
  pub max_size: usize,
  pub max_frame_rate: u32,
  pub size_to_frame_rate: std::collections::HashMap<usize, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdrDisplayConfig {
  pub min_db: i32,
  pub max_db: i32,
  pub padding: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdrLimitsConfig {
  pub lower_limit_mhz: Option<f64>,
  pub upper_limit_mhz: Option<f64>,
  pub lower_limit_label: Option<String>,
  pub upper_limit_label: Option<String>,
}

// MockApt signal types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptGlobalSettings {
  pub noise_floor_base: f64,
  pub noise_floor_variation: f64,
  pub signal_drift_rate: f64,
  pub signal_modulation_rate: f64,
  pub signal_appearance_chance: f64,
  pub signal_disappearance_chance: f64,
  pub signal_strength_variation: f64,
  pub dynamic_generation: bool,
  pub signals_per_area: u32,
  pub area_a_density: f64,
  pub area_b_density: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptBandwidths {
  pub narrow: u32,
  pub medium: u32,
  pub wide: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptStrengthRanges {
  pub weak: StrengthRange,
  pub medium: StrengthRange,
  pub strong: StrengthRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrengthRange {
  pub min: f64,
  pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptSignalConfig {
  // This would contain predefined mock signals if any
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptTrainingArea {
  pub freq_range_mhz: Vec<f64>,
  pub description: String,
  pub signal_types: Vec<String>,
  pub base_strength_range: Vec<f64>,
}

// Legacy spectrum frames config for backward compatibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumFramesConfig {
  pub frames: HashMap<String, SpectrumFrameConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumFrameConfig {
  pub label: String,
  #[serde(rename = "freq_range_mhz")]
  pub freq_range_mhz: Vec<f64>,
  pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumFrameMessage {
  pub id: String,
  pub label: String,
  pub min_mhz: f64,
  pub max_mhz: f64,
  pub description: String,
}

#[derive(Debug, Clone)]
pub struct CaptureArtifact {
  pub filename: String,
  pub path: std::path::PathBuf,
  pub file_size: u64,
  pub checksum: String,
}

// REST auth request/response types
#[derive(Deserialize)]
pub struct AuthVerifyRequest {
  pub challenge_id: String,
  pub hmac: String,
}

#[derive(Deserialize)]
pub struct AuthSessionRequest {
  pub token: String,
}

#[derive(Deserialize)]
pub struct WsQueryParams {
  pub token: String,
}

#[derive(Deserialize)]
pub struct PasskeyRegisterFinishRequest {
  pub challenge_id: String,
  pub credential: webauthn_rs::prelude::RegisterPublicKeyCredential,
}

#[derive(Deserialize)]
pub struct PasskeyAuthFinishRequest {
  pub challenge_id: String,
  pub credential: webauthn_rs::prelude::PublicKeyCredential,
}

#[derive(Debug, Deserialize)]
pub struct CaptureDownloadParams {
  pub token: String,
  #[serde(rename = "jobId")]
  pub job_id: String,
}
