//! # Mock SDR Device Implementation
//!
//! Provides a simulated SDR device that generates realistic signals for testing and demonstration.
//! Uses bin-based frequency modeling for consistent FFT placement and dynamic signal behavior.
//! Reads configuration from signals.yaml for signal parameters and variation settings.

use anyhow::Result;
use crate::fft::types::RawSamples;
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::f32::consts::PI;
use std::f64::consts::PI as PI64;

use super::SdrDevice;

/// Mock signal configuration
#[derive(Debug, Clone)]
struct MockSignalConfig {
    center_frequency_mhz: f64,
    strength_db: f64,
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
    noise_floor_db: f32,
    signal_modulation_rate: f32,
    signal_drift_rate: f32,
    rng: StdRng,
}

/// Individual mock signal state
#[derive(Debug, Clone)]
struct MockSignal {
    config: MockSignalConfig,
    drift_offset: f32,
    drift_velocity: f32,
    modulation_phase: f32,
    active: bool,
    bandwidth_hz: f64,
}

impl MockDevice {
    /// Create a new mock SDR device
    pub fn new() -> Self {
        let signals = Self::create_signals();
        
        let mock_settings = crate::server::utils::load_mock_settings();
        let sdr_settings = crate::server::utils::load_sdr_settings();
        
        Self {
            center_freq: 1_600_000, // 1.6 MHz default
            sample_rate: 3_200_000, // 3.2 MSPS default
            gain: sdr_settings.gain.tuner_gain,
            ppm: 1,
            tuner_agc: false,
            rtl_agc: false,
            frame_counter: 0,
            signals,
            noise_floor_db: mock_settings.global_settings.noise_floor_base as f32,
            signal_modulation_rate: mock_settings.global_settings.signal_modulation_rate as f32,
            signal_drift_rate: mock_settings.global_settings.signal_drift_rate as f32,
            rng: StdRng::from_entropy(),
        }
    }
    
    /// Create initial signals based on configuration
    fn create_signals() -> Vec<MockSignal> {
        let mut signals = Vec::new();
        let mut rng = rand::thread_rng();
        
        // Create signals across the spectrum
        // Area A: 0.1 - 4.5 MHz (covering the first N-APT range)
        for i in 0..10 {
            let freq = 0.1 + (i as f64 * 0.45);
            signals.push(MockSignal {
                config: MockSignalConfig {
                    center_frequency_mhz: freq,
                    strength_db: rng.gen_range(-70.0..-40.0),
                },
                drift_offset: rng.gen_range(-10.0..10.0),
                drift_velocity: 0.0,
                modulation_phase: rng.gen_range(0.0..=2.0 * PI),
                active: true,
                bandwidth_hz: 30000.0, 
            });
        }
        
        // Area B: 24.7 - 30.0 MHz (covering the second N-APT range)
        for i in 0..11 {
            let freq = 24.7 + (i as f64 * 0.5);
            signals.push(MockSignal {
                config: MockSignalConfig {
                    center_frequency_mhz: freq,
                    strength_db: rng.gen_range(-60.0..-30.0),
                },
                drift_offset: rng.gen_range(-50.0..50.0),
                drift_velocity: 0.0,
                modulation_phase: rng.gen_range(0.0..=2.0 * PI),
                active: true,
                bandwidth_hz: 100000.0,
            });
        }
        
        signals
    }
    
    /// Update signal states (drift, modulation)
    fn update_signals(&mut self) {
        for signal in &mut self.signals {
            // Update modulation phase for strength variation
            signal.modulation_phase += self.signal_modulation_rate;
            if signal.modulation_phase > 2.0 * PI {
                signal.modulation_phase -= 2.0 * PI;
            }
            
            // Update drift in Hz (random walk)
            let dr = self.signal_drift_rate * 50.0; // Scale to Hz
            signal.drift_velocity += self.rng.gen_range(-dr..=dr) * 0.05;
            signal.drift_velocity *= 0.98; // Damping
            signal.drift_offset += signal.drift_velocity; 
            signal.drift_offset = signal.drift_offset.clamp(-100000.0, 100000.0);
            
            // No sudden jumps anymore
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
        
        let sample_rate = self.sample_rate as f64;
        let t0 = (self.frame_counter as f64) * (fft_size as f64) / sample_rate;
        let center_freq = self.center_freq as f64;
        
        // Hardware RF & ADC Simulation Pipeline
        // 1. Calculate physical RF noise floor hitting the analog front-end
        let rf_noise_db = self.noise_floor_db as f64;
        let analog_gain = self.gain;
        let frontend_noise_db = rf_noise_db + analog_gain;
        
        // 2. Incorporate the intrinsic 8-bit ADC quantization/thermal noise floor (approx -50 dBFS)
        let adc_intrinsic_noise_db = -50.0;
        let total_adc_noise_power = 10f64.powf(frontend_noise_db / 10.0) + 10f64.powf(adc_intrinsic_noise_db / 10.0);
        let total_adc_noise_db = 10.0 * total_adc_noise_power.log10();
        let noise_level = 10f64.powf(total_adc_noise_db / 20.0);
        
        for i in 0..fft_size {
            let t = t0 + (i as f64 / sample_rate);
            
            let mut i_sample = 0.0f64;
            let mut q_sample = 0.0f64;
            
            if noise_level > 0.0 {
                i_sample += (self.rng.gen::<f64>() - 0.5) * 2.0 * noise_level;
                q_sample += (self.rng.gen::<f64>() - 0.5) * 2.0 * noise_level;
            }
            
            for signal in &self.signals {
                if !signal.active {
                    continue;
                }
                
                let abs_freq_hz = (signal.config.center_frequency_mhz * 1_000_000.0) + (signal.drift_offset as f64);
                let rel_freq = abs_freq_hz - center_freq;
                
                if rel_freq.abs() > (sample_rate / 2.0) {
                    continue;
                }
                
                let modulation = (signal.modulation_phase as f64).sin() * 0.1 + 0.9;
                
                // 3. True RF signal strength + Analog front-end amplification
                let rf_signal_db = signal.config.strength_db as f64 * modulation;
                let adc_signal_db = rf_signal_db + analog_gain;
                let amp = 10f64.powf(adc_signal_db / 20.0);
                
                let phase = 2.0 * PI64 * rel_freq * t;
                i_sample += amp * phase.sin();
                q_sample += amp * phase.cos();
                
                let bw_hz = signal.bandwidth_hz;
                if bw_hz > 500.0 {
                    for offset_hz in [-(bw_hz * 0.3), bw_hz * 0.3] {
                        let phase_side = 2.0 * PI64 * (rel_freq + offset_hz) * t;
                        i_sample += (amp * 0.707) * phase_side.sin();
                        q_sample += (amp * 0.707) * phase_side.cos();
                    }
                }
            }
            
            // Apply soft clipping
            let i_f = i_sample.tanh();
            let q_f = q_sample.tanh();
            
            // Convert back to offset binary 8-bit output
            // Strict quantization (the simulated intrinsic noise provides optimal dither)
            let i_u8 = (i_f * 127.0 + 128.0).round().clamp(0.0, 255.0) as u8;
            let q_u8 = (q_f * 127.0 + 128.0).round().clamp(0.0, 255.0) as u8;
            
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
