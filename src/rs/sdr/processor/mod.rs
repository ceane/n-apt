//! # SDR Processor
//!
//! Main signal processing pipeline that uses the abstract SDR interface.
//! Handles both mock and real SDR devices seamlessly.

use anyhow::Result;
use log::{info, warn};
use std::time::Instant;

use crate::fft::FFTProcessor;
use crate::stitching::SignalStitcher;

use super::{SdrDevice, SdrDeviceFactory};

/// One captured channel's data
#[derive(Debug, Clone)]
pub struct CaptureChannel {
    pub center_freq_hz: f64,
    pub sample_rate_hz: f64,
    pub iq_data: Vec<u8>,
    pub spectrum_data: Vec<f32>,
    pub bins_per_frame: u32,
}

/// Result returned from check_capture_completion
#[derive(Debug)]
pub struct CaptureResult {
    pub job_id: String,
    pub channels: Vec<CaptureChannel>,
    pub file_type: String,
    pub acquisition_mode: String,
    pub encrypted: bool,
    pub fft_size: u32,
    pub duration_s: f64,
    pub actual_frame_count: u32,
    pub fft_window: String,
    pub gain: f64,
    pub ppm: i32,
    pub tuner_agc: bool,
    pub rtl_agc: bool,
    pub source_device: String,
    pub hardware_sample_rate_hz: f64,
    /// Center frequency of the overall requested capture range (not a single hop)
    pub overall_center_frequency_hz: f64,
    /// Total bandwidth of the overall requested capture range
    pub overall_capture_sample_rate_hz: f64,
}

/// SDR processor that works with any SDR device implementation
pub struct SdrProcessor {
    /// The actual SDR device (mock or real hardware)
    device: Box<dyn SdrDevice>,
    /// FFT processor for signal processing
    pub fft_processor: FFTProcessor,
    /// Frame counter for time-based operations
    pub frame_counter: u64,
    /// Exponential moving average buffer for frame averaging
    pub avg_spectrum: Option<Vec<f32>>,
    /// EMA smoothing factor (0.0 = no smoothing, 1.0 = no averaging)
    pub avg_alpha: f32,
    /// Display min/max dB
    pub display_min_db: i32,
    pub display_max_db: i32,
    /// IQ sample accumulator for async reading
    pub iq_accumulator: Vec<u8>,
    /// Current read offset into iq_accumulator
    pub iq_offset: usize,
    /// Reusable IQ frame buffer
    pub iq_frame: Vec<u8>,
    /// Validated frame rate for display
    pub display_frame_rate: u32,
    /// Whether training capture is active
    pub training_active: bool,
    /// Current training label
    pub training_label: Option<String>,
    /// Current training signal area
    pub training_signal_area: Option<String>,
    /// Signal stitcher for accumulating FFT frames during training
    pub training_stitcher: Option<SignalStitcher>,
    /// Accumulated training samples
    pub training_samples: Vec<crate::stitching::TrainingSample>,
    /// Whether capture is active
    pub capture_active: bool,
    /// Current capture job ID
    pub capture_job_id: Option<String>,
    /// Capture start time
    pub capture_start: Option<Instant>,
    /// Capture duration in seconds
    pub capture_duration_s: f64,
    /// Capture file type
    pub capture_file_type: String,
    /// Capture acquisition mode ('stepwise' or 'interleaved')
    pub capture_acquisition_mode: String,
    /// List of fragments to capture (min_mhz, max_mhz)
    pub capture_fragments: Vec<(f64, f64)>,
    /// Index of the currently active capture fragment
    pub capture_current_fragment: usize,
    /// Last time the SDR hopped to a new fragment
    pub capture_last_hop: Option<Instant>,
    /// Whether capture should be encrypted
    pub capture_encrypted: bool,
    /// Whether to trigger playback after capture completion
    pub capture_playback: bool,
    /// Per-channel capture data
    pub capture_channels: Vec<CaptureChannel>,
    /// Actual frame count during capture (tracks drops)
    pub capture_actual_frames: u32,
    /// Snapshot of gain at capture start
    pub capture_gain: f64,
    /// Snapshot of PPM at capture start
    pub capture_ppm: i32,
    /// Snapshot of tuner AGC at capture start
    pub capture_tuner_agc: bool,
    /// Snapshot of RTL AGC at capture start
    pub capture_rtl_agc: bool,
    /// Snapshot of FFT window at capture start
    pub capture_fft_window: String,
    /// Overall center frequency of the requested capture range (Hz)
    pub capture_overall_center_hz: f64,
    /// Overall bandwidth of the requested capture range (Hz)
    pub capture_overall_span_hz: f64,
    /// Last read gain (dB)
    pub current_gain_db: f64,
    /// Last read PPM
    pub current_ppm: i32,
    /// Last applied Tuner AGC
    pub current_tuner_agc: bool,
    /// Last applied RTL AGC
    pub current_rtl_agc: bool,
    /// Last time samples were read (to maintain real-time flow)
    pub last_read_instant: Option<Instant>,
    /// Pending frequency change (applied at start of next read cycle to debounce rapid slider drags)
    pub pending_freq: Option<u32>,
    /// Last time we applied a frequency change (to throttle rapid retunes)
    pub last_retune_at: Option<Instant>,
    /// Short cooldown window after a retune to let the device settle
    pub retune_cooldown_until: Option<Instant>,
    /// Center frequency saved before capture starts, restored after capture ends
    pub capture_pre_center_freq: Option<u32>,
}

impl SdrProcessor {
    /// Create a new SDR processor with automatic device selection
    pub fn new() -> Result<Self> {
        let device = SdrDeviceFactory::create_device()?;
        Self::with_device(device)
    }
    
    /// Create a new SDR processor with a specific device
    pub fn with_device(device: Box<dyn SdrDevice>) -> Result<Self> {
        let sample_rate = device.get_sample_rate();
        let _center_freq = device.get_center_frequency();
        
        // Load settings from signals.yaml
        let sdr_settings = crate::server::utils::load_sdr_settings();
        
        let fft_size = sdr_settings.fft.default_size;
        let min_db = sdr_settings.display.min_db;
        let max_db = sdr_settings.display.max_db;
        let default_frame_rate = sdr_settings.fft.default_frame_rate;
        
        let mut fft_processor = FFTProcessor::new_with_defaults(fft_size, sample_rate, min_db, max_db);
        
        // Align initial zoom width and size to config
        let mut cfg = fft_processor.config().clone();
        cfg.zoom_width = fft_size;
        
        // Set initial gain properly so baseline tuner gain maps to 0dB delta
        // If the SDR processes the signal at `gain = 1.0`, it passes through unaltered.
        // We initialize config.gain to 1.0 (which is +0dB over baseline).
        // Initial gain/ppm for the digital processor is identity (Hardware handles it)
        cfg.gain = 1.0;
        cfg.ppm = 0.0;
        
        fft_processor.update_config(cfg);
        
        let processor = Self {
            device,
            fft_processor,
            frame_counter: 0,
            avg_spectrum: None,
            avg_alpha: 0.3,
            display_min_db: min_db,
            display_max_db: max_db,
            iq_accumulator: Vec::new(),
            iq_offset: 0,
            iq_frame: Vec::new(),
            display_frame_rate: default_frame_rate,
            training_active: false,
            training_label: None,
            training_signal_area: None,
            training_stitcher: None,
            training_samples: Vec::new(),
            capture_active: false,
            capture_job_id: None,
            capture_start: None,
            capture_duration_s: 0.0,
            capture_file_type: String::new(),
            capture_acquisition_mode: String::from("stepwise"),
            capture_fragments: Vec::new(),
            capture_current_fragment: 0,
            capture_last_hop: None,
            capture_encrypted: false,
            capture_playback: false,
            capture_channels: Vec::new(),
            capture_actual_frames: 0,
            capture_gain: 0.0,
            capture_ppm: 0,
            capture_tuner_agc: false,
            capture_rtl_agc: false,
            capture_fft_window: String::from("Rectangular"),
            capture_overall_center_hz: 0.0,
            capture_overall_span_hz: 0.0,
            current_gain_db: -999.0, // Force first update
            current_ppm: -999999,      // Force first update
            current_tuner_agc: false,
            current_rtl_agc: false,
            last_read_instant: None,
            pending_freq: None,
            last_retune_at: None,
            retune_cooldown_until: None,
            capture_pre_center_freq: None,
        };

        // Apply initial settings from config immediately to tune the hardware
        let mut processor = processor;
        processor.apply_settings(
            Some(sdr_settings.fft.default_size),
            None,
            Some(sdr_settings.fft.default_frame_rate),
            Some(sdr_settings.gain.tuner_gain),
            Some(sdr_settings.ppm as i32),
            Some(sdr_settings.gain.tuner_agc),
            Some(sdr_settings.gain.rtl_agc),
        )?;

        processor.set_center_frequency(sdr_settings.center_frequency)?;

        info!("SDR processor created and synchronized with device: {}", processor.device.device_type());
        Ok(processor)
    }
    
    /// Force mock APT mode
    pub fn new_mock_apt() -> Result<Self> {
        let device = SdrDeviceFactory::create_mock_device();
        Self::with_device(device)
    }
    
    /// Force RTL-SDR mode (will error if no device available)
    pub fn new_rtlsdr() -> Result<Self> {
        let device = SdrDeviceFactory::create_rtlsdr_device()?;
        Self::with_device(device)
    }
    
    /// Initialize the SDR processor and device
    pub fn initialize(&mut self) -> Result<()> {
        self.device.initialize()?;
        info!("SDR processor initialized with {}", self.device.device_type());
        Ok(())
    }
    
    /// Swap out the fundamental SDR device during execution (e.g. mock -> real)
    pub fn swap_device(&mut self, mut device: Box<dyn SdrDevice>) -> Result<()> {
        device.initialize()?;
        self.device = device;

        // Reset tracked state to force re-application to new hardware
        self.current_gain_db = -1.0;
        self.current_ppm = -999;
        
        // Push current config to the new hardware
        let settings = crate::server::utils::load_sdr_settings();
        self.apply_settings(
            None,
            None,
            None,
            Some(settings.gain.tuner_gain),
            Some(settings.ppm as i32),
            Some(settings.gain.tuner_agc),
            Some(settings.gain.rtl_agc),
        )?;
        self.set_center_frequency(settings.center_frequency)?;

        info!("SDR processor swapped and synchronized to {}", self.device.device_type());
        Ok(())
    }

    /// Check if the current device is a mock device
    pub fn is_mock(&self) -> bool {
        self.device.device_type().contains("Mock")
    }

    /// Check if the underlying device is still healthy
    pub fn is_healthy(&self) -> bool {
        self.device.is_healthy()
    }

    /// Get detailed device info from the underlying hardware
    pub fn get_device_info(&self) -> String {
        self.device.get_device_info()
    }
    
    /// Check if the device is ready for reading
    pub fn is_ready(&self) -> bool {
        self.device.is_ready()
    }
    
    /// Read and process one frame from the device
    pub fn read_and_process_frame(&mut self) -> Result<Vec<f32>> {
        let fft_size = self.fft_processor.config().fft_size;
        let sample_rate = self.get_sample_rate();

        // If we're in a retune cooldown window, avoid touching the device
        if let Some(until) = self.retune_cooldown_until {
            if Instant::now() < until {
                if let Some(ref avg) = self.avg_spectrum {
                    return Ok(avg.clone());
                }
                return Ok(vec![-120.0; fft_size]);
            }
            self.retune_cooldown_until = None;
        }

        // Apply any pending frequency change (debounced from rapid slider drags)
        if let Some(freq) = self.pending_freq.take() {
            if freq == self.get_center_frequency() {
                // No change needed
            } else {
                let can_retune = self.last_retune_at
                    .map(|last| last.elapsed() >= std::time::Duration::from_millis(150))
                    .unwrap_or(true);

                if can_retune {
                    if let Err(e) = self.set_center_frequency(freq) {
                        warn!("Failed to apply pending frequency: {}", e);
                    }
                    self.last_retune_at = Some(Instant::now());
                    self.retune_cooldown_until = Some(Instant::now() + std::time::Duration::from_millis(50));
                } else {
                    // Keep latest request queued until the debounce interval passes
                    self.pending_freq = Some(freq);
                }
            }
        }

        // 0. Handle capture fragment hopping (TDMS is per-channel, not cross-channel)
        // Each fragment is its own channel; stepwise = sequential time slicing,
        // interleaved = rapid hopping within each channel's allocated time.
        if self.capture_active && self.capture_fragments.len() > 1 {
            let elapsed = self.capture_start.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
            
            let expected_channel = if self.capture_acquisition_mode == "interleaved" {
                // TDMS mode: Slice across channels with enough dwell for hardware retune+settle
                let num_channels = self.capture_fragments.len();
                let slice_duration = 0.14; // 140ms
                let current_slice = (elapsed / slice_duration) as usize;
                current_slice % num_channels
            } else {
                // Stepwise Naive mode: Divide total time sequentially
                let time_per_channel = self.capture_duration_s / (self.capture_fragments.len() as f64);
                ((elapsed / time_per_channel) as usize).min(self.capture_fragments.len() - 1)
            };

            if expected_channel != self.capture_current_fragment {
                // Moving to the next channel — flush current IQ/spectrum to the channel entry
                // then tune to the new fragment
                self.capture_current_fragment = expected_channel;
                let &(min_freq, _max_freq) = &self.capture_fragments[expected_channel];

                let new_center_freq = ((min_freq * 1000000.0) + (sample_rate as f64 / 2.0)) as u32;
                if let Err(e) = self.set_center_frequency(new_center_freq) {
                    warn!("Failed to hop capture frequency: {}", e);
                }
                // Do NOT reset the hardware buffer on every hop.
                // Frequent reset_buffer calls during fast interleaved hopping can
                // starve async reads and trigger persistent timeout loops.
                self.capture_last_hop = Some(Instant::now());
                
                // We do NOT return an immediate spectrum result here anymore.
                // It must fall through to the zero-padding logic below to keep time aligned.
            }
        }
        
        // Skip processing if we just hopped and haven't reached settling time
        if let Some(last_hop) = self.capture_last_hop {
            // Use 35ms settling for real hardware, but 0ms for instantaneous mock SDR
            let device_type_str = self.device.device_type().to_lowercase();
            let settling_time = if device_type_str.contains("mock") { 0 } else { 35 };
            
            if last_hop.elapsed().as_millis() < settling_time {
                 // Keep the read timer fresh so we don't try to bulk-read a massive backlog
                 // when the settling period ends.
                 self.last_read_instant = Some(Instant::now());
                 
                 // ZERO-ORDER HOLD: Retrieve the last valid spectrum frame from the current channel
                 let mut held_spectrum = vec![-120.0; fft_size];
                 let ch_idx = self.capture_current_fragment;
                 
                 if ch_idx < self.capture_channels.len() {
                     let channel = &self.capture_channels[ch_idx];
                     let len = channel.spectrum_data.len();
                     if len >= fft_size {
                         let start = len - fft_size;
                         held_spectrum.copy_from_slice(&channel.spectrum_data[start..]);
                     }
                 }
                 
                 // Keep held frames for live visualization continuity only.
                // Do NOT write synthetic hold/zero-padding samples into capture output,
                // as that creates artificial -120dB dips and malformed captures.
                 
                return Ok(held_spectrum);
            }
        }

        // 1. Read ONE fresh block of FFT size directly from the async layer
        // The async layer handles discarding backlog and returning only the newest contiguous slice.
        let samples = self.device.read_samples(fft_size)?;
        
        if samples.data.is_empty() {
             return Ok(vec![-120.0; fft_size]); // fallback or handle error gracefully
        }

        // If we are capturing, append IQ data to the current channel
        if self.capture_active {
            let ch_idx = self.capture_current_fragment;
            if ch_idx < self.capture_channels.len() {
                self.capture_channels[ch_idx].iq_data.extend_from_slice(&samples.data);
            }
        }
        
        let display_samples_data = samples.data;

        let display_samples = crate::fft::types::RawSamples {
            data: display_samples_data.clone(),
            sample_rate,
        };
        
        // Process the samples through FFT
        let result = self.fft_processor.process_samples(&display_samples)?;
        let mut spectrum = result.power_spectrum;
        
        // DC spike suppression
        let len = spectrum.len();
        if len > 6 {
            let center = len / 2;
            let left = spectrum[center - 3];
            let right = spectrum[center + 3];
            for i in 0..5 {
                let t = (i + 1) as f32 / 6.0;
                spectrum[center - 2 + i] = left * (1.0 - t) + right * t;
            }
        }
        
        // Frame averaging (exponential moving average)
        let alpha = self.avg_alpha;
        let final_spectrum = if let Some(ref mut avg) = self.avg_spectrum {
            if avg.len() == spectrum.len() {
                for (i, val) in spectrum.iter().enumerate() {
                    avg[i] = alpha * val + (1.0 - alpha) * avg[i];
                }
                avg.clone()
            } else {
                self.avg_spectrum = Some(spectrum.clone());
                spectrum.clone()
            }
        } else {
            self.avg_spectrum = Some(spectrum.clone());
            spectrum.clone()
        };

        if self.capture_active {
            // Append the latest RAW spectrum frame to current channel (no visual EMA smoothing)
            let ch_idx = self.capture_current_fragment;
            if ch_idx < self.capture_channels.len() {
                self.capture_channels[ch_idx].spectrum_data.extend_from_slice(&spectrum);
            }
            self.capture_actual_frames += 1;
        }

        Ok(final_spectrum)
    }
    
    /// Apply settings to both the device and FFT processor
    pub fn apply_settings(&mut self, fft_size: Option<usize>, fft_window: Option<String>, 
                         frame_rate: Option<u32>, gain: Option<f64>, ppm: Option<i32>, 
                         tuner_agc: Option<bool>, rtl_agc: Option<bool>) -> Result<()> {
        let mut config = self.fft_processor.config().clone();
        let mut config_changed = false;
        
        // Always ensure the FFT processor sample rate matches the device
        let device_sample_rate = self.device.get_sample_rate();
        if config.sample_rate != device_sample_rate {
            config.sample_rate = device_sample_rate;
            if let Some(ref mut simd) = self.fft_processor.simd_processor_mut() {
                simd.set_sample_rate(device_sample_rate);
            }
            config_changed = true;
            info!("Updated FFT processor sample rate to {} Hz", device_sample_rate);
        }
        
        // FFT size
        if let Some(size) = fft_size {
            if size > 0 && (size & (size - 1)) == 0 {
                if config.fft_size != size {
                    config.fft_size = size;
                    config.zoom_width = size;
                    config_changed = true;
                    info!("FFT size changed to {}", size);
                }
            } else {
                warn!("Invalid FFT size {} (must be power of 2), ignoring", size);
            }
        }
        
        // FFT window
        if let Some(ref window_name) = fft_window {
            let window_type = match window_name.to_lowercase().as_str() {
                "rectangular" | "none" => crate::fft::WindowType::Rectangular,
                "hanning" | "hann" => crate::fft::WindowType::Hanning,
                "hamming" => crate::fft::WindowType::Hamming,
                "blackman" => crate::fft::WindowType::Blackman,
                "nuttall" => crate::fft::WindowType::Nuttall,
                _ => {
                    warn!("Unknown window type '{}', using Rectangular", window_name);
                    crate::fft::WindowType::Rectangular
                }
            };
            if config.window_type != window_type {
                config.window_type = window_type;
                config_changed = true;
                info!("FFT window changed to {:?}", window_type);
            }
        }
        
        // Frame rate
        if let Some(requested_rate) = frame_rate {
            let max_rate = self.calculate_max_frame_rate(config.fft_size);
            let clamped_rate = requested_rate.clamp(1, max_rate);
            if clamped_rate != requested_rate {
                warn!("Requested frame rate {} fps exceeds maximum {} fps, clamping to {}", 
                      requested_rate, max_rate, clamped_rate);
            }
            self.display_frame_rate = clamped_rate;
            info!("Frame rate set to {} fps", clamped_rate);
        }
        
        // Device settings
        if let Some(g_db) = gain {
            if (self.current_gain_db - g_db).abs() > 0.01 {
                if let Err(e) = self.device.set_gain(g_db) {
                    warn!("Failed to set hardware gain: {}", e);
                }
                self.current_gain_db = g_db;
            }
            
            if self.is_mock() {
                // For mock, we can use the digital gain multiplier if the device doesn't handle it
                // but MockAptDevice DOES handle it. However, if we want to allow digital delta:
                let baseline_db = crate::server::utils::load_sdr_settings().gain.tuner_gain;
                let delta_db = g_db - baseline_db;
                config.gain = 10f32.powf(delta_db as f32 / 20.0);
            } else {
                // For real hardware, we rely ONLY on the tuner gain.
                // Digital gain should remain 1.0 (baseline) to avoid double-scaling.
                config.gain = 1.0;
            }
            config_changed = true;
        }
        
        if let Some(p) = ppm {
            if self.current_ppm != p {
                if let Err(e) = self.device.set_ppm(p) {
                    warn!("Failed to set hardware PPM: {}", e);
                }
                self.current_ppm = p;
            }
            
            if self.is_mock() {
                // Mock device doesn't shift clock, so we use digital rotation
                config.ppm = p as f32;
            } else {
                // Hardware shifts clock, so digital rotation would double-correct
                config.ppm = 0.0;
            }
            config_changed = true;
        }
        
        if let Some(tuner_agc) = tuner_agc {
            if self.current_tuner_agc != tuner_agc {
                self.device.set_tuner_agc(tuner_agc)?;
                self.current_tuner_agc = tuner_agc;
            }
        }
        
        if let Some(rtl_agc) = rtl_agc {
            if self.current_rtl_agc != rtl_agc {
                self.device.set_rtl_agc(rtl_agc)?;
                self.current_rtl_agc = rtl_agc;
            }
        }
        
        if config_changed {
            self.fft_processor.update_config(config);
        }
        
        Ok(())
    }
    
    /// Calculate maximum frame rate for given FFT size
    fn calculate_max_frame_rate(&self, fft_size: usize) -> u32 {
        // Simplified calculation - base on FFT size
        match fft_size {
            0..=8192 => 60,
            8193..=16384 => 60,
            16385..=32768 => 60,
            32769..=65536 => 48,
            65537..=131072 => 24,
            _ => 12,
        }
    }
    
    /// Set center frequency
    pub fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
        self.device.set_center_frequency(freq)?;
        // Synchronize with SIMD processor for digital PPM correction
        if let Some(ref mut simd) = self.fft_processor.simd_processor_mut() {
            simd.set_center_frequency(freq);
        }
        // Clear averaging when frequency changes
        self.avg_spectrum = None;
        Ok(())
    }
    
    /// Get device type information
    pub fn device_type(&self) -> &'static str {
        self.device.device_type()
    }
    
    /// Get current center frequency
    pub fn get_center_frequency(&self) -> u32 {
        self.device.get_center_frequency()
    }
    
    /// Get current sample rate
    pub fn get_sample_rate(&self) -> u32 {
        self.device.get_sample_rate()
    }
    
    /// Reset device buffers
    pub fn reset_buffer(&mut self) -> Result<()> {
        self.device.reset_buffer()?;
        self.iq_accumulator.clear();
        self.iq_offset = 0;
        self.avg_spectrum = None;
        Ok(())
    }
    
    /// Cleanup resources
    pub fn cleanup(&mut self) -> Result<()> {
        self.device.cleanup()?;
        info!("SDR processor cleanup completed");
        Ok(())
    }
    
    /// Check capture completion and return multi-channel result
    pub fn check_capture_completion(&mut self) -> Option<CaptureResult> {
        if !self.capture_active {
            return None;
        }

        if let Some(start) = self.capture_start {
            let elapsed = start.elapsed().as_secs_f64();
            if elapsed >= self.capture_duration_s {
                self.capture_active = false;
                let job_id = self.capture_job_id.take().unwrap_or_else(|| "unknown".to_string());

                // Restore pre-capture center frequency so the live stream
                // resumes at the correct tuning instead of the last hop.
                if let Some(pre_freq) = self.capture_pre_center_freq.take() {
                    if let Err(e) = self.set_center_frequency(pre_freq) {
                        warn!("Failed to restore pre-capture center frequency: {}", e);
                    }
                }

                // Reset stale capture fields to prevent post-capture glitches
                self.capture_last_hop = None;
                self.capture_fragments.clear();
                self.capture_current_fragment = 0;
                self.capture_start = None;
                
                // Take the raw captured channels
                let mut channels = std::mem::take(&mut self.capture_channels);
                
                // Diagnostic logging for TDMS debugging
                info!("[CAPTURE COMPLETE] job={}, mode={}, num_channels={}", job_id, self.capture_acquisition_mode, channels.len());
                let fft_size_dbg = self.fft_processor.config().fft_size;
                for (idx, ch) in channels.iter().enumerate() {
                    let num_frames = if fft_size_dbg > 0 { ch.spectrum_data.len() / fft_size_dbg } else { 0 };
                    info!("  ch[{}]: center={:.3}MHz, sr={:.3}MHz, spectrum_frames={}, iq_bytes={}", 
                        idx, ch.center_freq_hz / 1e6, ch.sample_rate_hz / 1e6, num_frames, ch.iq_data.len());
                    
                    // Per-frame anomaly detection: flag frames with average power drop > 15dB
                    if fft_size_dbg > 0 && num_frames > 1 {
                        let mut prev_avg: f32 = 0.0;
                        for f in 0..num_frames {
                            let start = f * fft_size_dbg;
                            let end = start + fft_size_dbg;
                            let frame_data = &ch.spectrum_data[start..end];
                            let avg: f32 = frame_data.iter().sum::<f32>() / fft_size_dbg as f32;
                            let min_val: f32 = frame_data.iter().cloned().fold(f32::INFINITY, f32::min);
                            let max_val: f32 = frame_data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
                            
                            if f > 0 && (prev_avg - avg).abs() > 15.0 {
                                warn!("  [ANOMALY] ch[{}] frame {}/{}: avg={:.1}dB (prev={:.1}dB, delta={:.1}dB) min={:.1} max={:.1}",
                                    idx, f, num_frames, avg, prev_avg, avg - prev_avg, min_val, max_val);
                            }
                            prev_avg = avg;
                        }
                    }
                }
                
                // NOTE: capture spectra are already fftshifted by fft_processor.
                // Re-shifting here would split the spectrum into non-contiguous halves
                // and produce malformed stitched playback artifacts.
                
                // Trim overlapping IQ data and spectrum from adjacent channels
                // so each channel contains only its unique non-overlapping portion.
                if channels.len() > 1 {
                    for i in 1..channels.len() {
                        let prev_max = channels[i - 1].center_freq_hz + channels[i - 1].sample_rate_hz / 2.0;
                        let curr_min = channels[i].center_freq_hz - channels[i].sample_rate_hz / 2.0;
                        let overlap_hz = prev_max - curr_min;
                        
                        let fft_size = self.fft_processor.config().fft_size;
                        let mut trim_bins = 0;

                        if overlap_hz > 0.0 {
                            let overlap_fraction = overlap_hz / channels[i].sample_rate_hz;
                            
                             // Note: Do NOT trim IQ data here. Trimming the IQ vector removes time duration,
                            // which causes misalignment with other channels during stitching.
                            // Frequency overlap is handled via spectrum bin trimming for visualization.
                             
                            // Trim spectrum frames: remove first N bins from each frame
                            if !channels[i].spectrum_data.is_empty() {
                                trim_bins = (fft_size as f64 * overlap_fraction).round() as usize;
                                
                                if trim_bins > 0 && trim_bins < fft_size {
                                    let num_frames = channels[i].spectrum_data.len() / fft_size;
                                    let mut new_spectrum = Vec::with_capacity(num_frames * (fft_size - trim_bins));
                                    
                                    for f in 0..num_frames {
                                        let start = f * fft_size + trim_bins;
                                        let end = (f + 1) * fft_size;
                                        new_spectrum.extend_from_slice(&channels[i].spectrum_data[start..end]);
                                    }
                                    channels[i].spectrum_data = new_spectrum;
                                } else {
                                    trim_bins = 0;
                                }
                            }
                            
                            // Update channel metadata to reflect the trimmed range
                            let new_min = curr_min + overlap_hz;
                            let new_sr = channels[i].sample_rate_hz - overlap_hz;
                            channels[i].center_freq_hz = new_min + new_sr / 2.0;
                            channels[i].sample_rate_hz = new_sr;
                            channels[i].bins_per_frame = (fft_size - trim_bins) as u32;
                        } else {
                            // No trimming
                            channels[i].bins_per_frame = fft_size as u32;
                        }
                    }
                }
                
                // Ensure first channel also has bins_per_frame set
                if !channels.is_empty() {
                    if channels[0].bins_per_frame == 0 {
                         channels[0].bins_per_frame = self.fft_processor.config().fft_size as u32;
                    }
                }

                return Some(CaptureResult {
                    job_id,
                    channels,
                    file_type: self.capture_file_type.clone(),
                    acquisition_mode: self.capture_acquisition_mode.clone(),
                    encrypted: self.capture_encrypted,
                    fft_size: self.fft_processor.config().fft_size as u32,
                    duration_s: self.capture_duration_s,
                    actual_frame_count: self.capture_actual_frames,
                    fft_window: self.capture_fft_window.clone(),
                    gain: self.capture_gain,
                    ppm: self.capture_ppm,
                    tuner_agc: self.capture_tuner_agc,
                    rtl_agc: self.capture_rtl_agc,
                    source_device: self.device_type().to_string(),
                    hardware_sample_rate_hz: self.get_sample_rate() as f64,
                    overall_center_frequency_hz: self.capture_overall_center_hz,
                    overall_capture_sample_rate_hz: self.capture_overall_span_hz,
                });
            }
        }
        None
    }
}
