//! # Mock SDR Device Implementation
//!
//! Provides a simulated SDR device that generates realistic signals for testing and demonstration.
//! Reads configuration from signals.yaml to shape signals including noise floor and signal characteristics.
//! Can generate APT-like signals with Gaussian curves and suspension bridge shapes.

use anyhow::Result;
use crate::fft::types::RawSamples;
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

use super::SdrDevice;

/// Mock signal configuration loaded from signals.yaml
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockSignalConfig {
    pub center_frequency_mhz: f64,
    pub bandwidth_mhz: f64,
    pub strength_db: f64,
    pub signal_shape: SignalShape,
    pub noise_floor_db: f64,
    pub drift_rate: f64,
    pub modulation_rate: f64,
}

/// Signal shape definitions for realistic signal generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SignalShape {
    /// Gaussian bell curve (classic signal shape)
    Gaussian { sigma: f64 },
    /// Suspension bridge shape (flat top with curved sides - like APT signals)
    SuspensionBridge { flat_width_ratio: f64, curve_sharpness: f64 },
    /// Sharp spike (narrowband signal)
    Spike,
    /// Flat top (wideband signal)
    FlatTop { edge_smoothness: f64 },
    /// Custom shape defined by amplitude points
    Custom { amplitudes: Vec<f64> },
}

/// Mock SDR device implementation
pub struct MockDevice {
    center_freq: u32,
    sample_rate: u32,
    gain: f64,
    ppm: i32,
    tuner_agc: bool,
    rtl_agc: bool,
    frame_counter: u64,
    signals: Vec<MockSignal>,
    config: MockDeviceConfig,
    rng: StdRng,
}

/// Mock device configuration
#[derive(Debug, Clone)]
pub struct MockDeviceConfig {
    pub noise_floor_base: f32,
    pub noise_floor_variation: f32,
    pub signal_drift_rate: f32,
    pub signal_modulation_rate: f32,
    pub signal_appearance_chance: f32,
    pub signal_disappearance_chance: f32,
    pub signal_strength_variation: f32,
    pub signals_per_area: usize,
}

/// Individual mock signal state
#[derive(Debug, Clone)]
struct MockSignal {
    config: MockSignalConfig,
    center_bin: f32,
    drift_offset: f32,
    modulation_phase: f32,
    active: bool,
    current_strength: f32,
}

impl MockDevice {
    /// Create a new mock SDR device
    pub fn new() -> Self {
        let config = Self::load_config();
        let signals = Self::create_signals(&config);
        
        Self {
            center_freq: 1_600_000, // 1.6 MHz default
            sample_rate: 3_200_000, // 3.2 MSPS default
            gain: 49.6, // Default gain from signals.yaml
            ppm: 1,
            tuner_agc: false,
            rtl_agc: false,
            frame_counter: 0,
            signals,
            config,
            rng: StdRng::from_entropy(),
        }
    }
    
    /// Load configuration from signals.yaml
    fn load_config() -> MockDeviceConfig {
        // This would load from signals.yaml in a real implementation
        // For now, using defaults that match the current signals.yaml
        MockDeviceConfig {
            noise_floor_base: -100.0,
            noise_floor_variation: 0.0,
            signal_drift_rate: 0.9,
            signal_modulation_rate: 0.05,
            signal_appearance_chance: 0.02,
            signal_disappearance_chance: 0.01,
            signal_strength_variation: 2.0,
            signals_per_area: 11,
        }
    }
    
    /// Create initial signals based on configuration
    fn create_signals(config: &MockDeviceConfig) -> Vec<MockSignal> {
        let mut signals = Vec::new();
        let mut rng = rand::thread_rng();
        
        // Create APT-like signals with suspension bridge shapes
        for i in 0..config.signals_per_area {
            let signal_config = MockSignalConfig {
                center_frequency_mhz: 0.5 + (i as f64 * 2.0), // Spread across spectrum
                bandwidth_mhz: match i % 3 {
                    0 => 0.015, // Narrow
                    1 => 0.045, // Medium  
                    _ => 0.120, // Wide
                },
                strength_db: match i % 3 {
                    0 => rng.gen_range(-80.0..-60.0), // Weak
                    1 => rng.gen_range(-60.0..-40.0), // Medium
                    _ => rng.gen_range(-40.0..-20.0), // Strong
                },
                signal_shape: if i % 4 == 0 {
                    // Some signals with suspension bridge shape (APT-like)
                    SignalShape::SuspensionBridge {
                        flat_width_ratio: 0.6,
                        curve_sharpness: 2.0,
                    }
                } else {
                    // Others with Gaussian shapes
                    SignalShape::Gaussian { sigma: 1.0 }
                },
                noise_floor_db: config.noise_floor_base as f64,
                drift_rate: config.signal_drift_rate as f64,
                modulation_rate: config.signal_modulation_rate as f64,
            };
            
            signals.push(MockSignal {
                config: signal_config,
                center_bin: 100.0 + (i as f32 * 50.0), // Initial bin placement
                drift_offset: 0.0,
                modulation_phase: rng.gen_range(0.0..2.0 * PI),
                active: true,
                current_strength: 0.0,
            });
        }
        
        signals
    }
    
    /// Generate signal amplitude based on shape and distance from center
    fn generate_signal_amplitude(&self, signal: &MockSignal, bin_offset: f32) -> f32 {
        let normalized_offset = (bin_offset / signal.config.bandwidth_mhz as f32).abs();
        
        match &signal.config.signal_shape {
            SignalShape::Gaussian { sigma } => {
                let amplitude = (-0.5 * (normalized_offset / (*sigma as f32)).powi(2)).exp();
                amplitude
            }
            SignalShape::SuspensionBridge { flat_width_ratio, curve_sharpness } => {
                if (normalized_offset as f64) <= *flat_width_ratio {
                    1.0 // Flat top
                } else {
                    // Curved sides - use a smooth falloff
                    let excess = normalized_offset - (*flat_width_ratio as f32);
                    let amplitude = 1.0 / (1.0 + (excess * (*curve_sharpness as f32)).powi(2));
                    amplitude
                }
            }
            SignalShape::Spike => {
                if normalized_offset < 0.1 { 1.0 } else { 0.0 }
            }
            SignalShape::FlatTop { edge_smoothness } => {
                if normalized_offset <= 1.0 {
                    1.0
                } else {
                    let excess = normalized_offset - 1.0;
                    (-excess * (*edge_smoothness as f32)).exp()
                }
            }
            SignalShape::Custom { amplitudes } => {
                let index = (normalized_offset * amplitudes.len() as f32).min(amplitudes.len() as f32 - 1.0) as usize;
                amplitudes[index] as f32
            }
        }
    }
    
    /// Update signal states (appearance, drift, modulation)
    fn update_signals(&mut self) {
        for signal in &mut self.signals {
            // Random appearance/disappearance
            if signal.active && self.rng.gen::<f32>() < self.config.signal_appearance_chance {
                signal.active = false;
            } else if !signal.active && self.rng.gen::<f32>() < self.config.signal_disappearance_chance {
                signal.active = true;
            }
            
            if signal.active {
                // Drift
                signal.drift_offset += self.rng.gen_range(
                    -self.config.signal_drift_rate..self.config.signal_drift_rate
                );
                signal.drift_offset = signal.drift_offset.clamp(-5.0, 5.0);
                
                // Modulation
                signal.modulation_phase += self.config.signal_modulation_rate;
                if signal.modulation_phase > 2.0 * PI {
                    signal.modulation_phase -= 2.0 * PI;
                }
                
                // Strength variation
                let modulation = signal.modulation_phase.sin() * 0.3 + 0.7;
                let variation = self.rng.gen_range(-1.0..1.0) * self.config.signal_strength_variation;
                signal.current_strength = signal.config.strength_db as f32 * modulation + variation;
            }
        }
    }
}

impl SdrDevice for MockDevice {
    fn device_type(&self) -> &'static str {
        "mock"
    }
    
    fn initialize(&mut self) -> Result<()> {
        log::info!("Initializing mock SDR device");
        self.frame_counter = 0;
        Ok(())
    }
    
    fn is_ready(&self) -> bool {
        true // Mock is always ready
    }
    
    fn read_samples(&mut self, fft_size: usize) -> Result<RawSamples> {
        self.frame_counter = self.frame_counter.wrapping_add(1);
        self.update_signals();
        
        let mut frame = Vec::with_capacity(fft_size * 2);
        let noise_level = ((self.config.noise_floor_variation / 200.0).clamp(0.001, 0.5)) as f32;
        let t0 = (self.frame_counter as f32) * (fft_size as f32) / (self.sample_rate as f32);
        
        for i in 0..fft_size {
            let t = t0 + (i as f32 / self.sample_rate as f32);
            let mut i_sample = (self.rng.gen::<f32>() - 0.5) * 2.0 * noise_level;
            let mut q_sample = (self.rng.gen::<f32>() - 0.5) * 2.0 * noise_level;
            
            // Add signal contributions
            for signal in &self.signals {
                if !signal.active {
                    continue;
                }
                
                let current_bin = signal.center_bin + signal.drift_offset;
                let bin_offset = i as f32 - current_bin;
                let amplitude = self.generate_signal_amplitude(signal, bin_offset);
                
                if amplitude > 0.01 { // Skip if contribution is negligible
                    let strength_linear = 10f32.powf(signal.current_strength / 20.0) * 0.05;
                    let signal_amp = (amplitude * strength_linear).clamp(0.0, 0.9);
                    
                    // Generate carrier at the signal's frequency
                    let freq_hz = (signal.config.center_frequency_mhz * 1e6) as f32;
                    let phase = 2.0 * PI * freq_hz * t;
                    
                    i_sample += signal_amp * phase.sin();
                    q_sample += signal_amp * phase.cos();
                }
            }
            
            // Convert to u8 range
            let i_u8 = ((i_sample * 127.0) + 128.0).round().clamp(0.0, 255.0) as u8;
            let q_u8 = ((q_sample * 127.0) + 128.0).round().clamp(0.0, 255.0) as u8;
            
            frame.push(i_u8);
            frame.push(q_u8);
        }
        
        Ok(RawSamples {
            data: frame,
            sample_rate: self.sample_rate,
        })
    }
    
    fn set_center_frequency(&mut self, freq: u32) -> Result<()> {
        self.center_freq = freq;
        log::debug!("Mock device center frequency set to {} Hz", freq);
        Ok(())
    }
    
    fn set_gain(&mut self, gain: f64) -> Result<()> {
        self.gain = gain;
        log::debug!("Mock device gain set to {} dB", gain);
        Ok(())
    }
    
    fn set_ppm(&mut self, ppm: i32) -> Result<()> {
        self.ppm = ppm;
        log::debug!("Mock device PPM set to {}", ppm);
        Ok(())
    }
    
    fn set_tuner_agc(&mut self, enabled: bool) -> Result<()> {
        self.tuner_agc = enabled;
        log::debug!("Mock device tuner AGC set to {}", enabled);
        Ok(())
    }
    
    fn set_rtl_agc(&mut self, enabled: bool) -> Result<()> {
        self.rtl_agc = enabled;
        log::debug!("Mock device RTL AGC set to {}", enabled);
        Ok(())
    }
    
    fn get_center_frequency(&self) -> u32 {
        self.center_freq
    }
    
    fn get_sample_rate(&self) -> u32 {
        self.sample_rate
    }
    
    fn reset_buffer(&mut self) -> Result<()> {
        log::debug!("Mock device buffer reset");
        Ok(())
    }
    
    fn cleanup(&mut self) -> Result<()> {
        log::info!("Mock device cleanup completed");
        Ok(())
    }
}
