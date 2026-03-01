//! # SIMD Mock Signal Generator
//!
//! High-performance SIMD-accelerated mock signal generation for testing and demos.
//! Generates realistic SDR signals with multiple carriers, noise, and modulation.

use crate::fft::types::RawSamples;
use anyhow::Result;
use rand::Rng;

/// Mock signal structure for testing
#[derive(Debug, Clone)]
pub struct MockSignal {
  pub center_bin: f32,
  pub base_strength: f32,
  pub bandwidth: u32,
  pub active: bool,
  pub drift_offset: f32,
  pub modulation_phase: f32,
}

/// Mock signals configuration
#[derive(Debug, Clone, Default)]
pub struct MockSignalsConfig {
  pub global_settings: GlobalMockSettings,
}

#[derive(Debug, Clone, Default)]
pub struct GlobalMockSettings {
  pub signal_appearance_chance: u32,
  pub signal_disappearance_chance: u32,
  pub signal_drift_rate: u32,
  pub signal_modulation_rate: f32,
  pub signal_strength_variation: u32,
  pub noise_floor_variation: u32,
}

/// SIMD-accelerated mock signal generator
pub struct MockSignalGenerator {
  frame_counter: u32,
  rng: rand::rngs::ThreadRng,
}

impl MockSignalGenerator {
  /// Creates a new mock signal generator
  pub fn new() -> Self {
    Self {
      frame_counter: 0,
      rng: rand::thread_rng(),
    }
  }

  /// Generate mock IQ samples with SIMD acceleration
  pub fn generate_frame(
    &mut self,
    fft_size: usize,
    sample_rate: u32,
    signals: &mut [MockSignal],
    config: &MockSignalsConfig,
  ) -> Result<RawSamples> {
    let mut frame = Vec::with_capacity(fft_size * 2);
    self.frame_counter = self.frame_counter.wrapping_add(1);

    // Update signal state
    self.update_signal_state(signals, config);

    // Generate samples using SIMD where possible
    let noise_level = self.calculate_noise_level(fft_size, config);
    let t0 = (self.frame_counter as f32) * (fft_size as f32) / (sample_rate as f32);

    for i in 0..fft_size {
      let t = t0 + (i as f32 / sample_rate as f32);
      let (i_sample, q_sample) = self.generate_sample(i, t, signals, noise_level);

      // Convert to u8 range
      let i_u8 = ((i_sample * 127.0) + 128.0).round().clamp(0.0, 255.0) as u8;
      let q_u8 = ((q_sample * 127.0) + 128.0).round().clamp(0.0, 255.0) as u8;
      
      frame.push(i_u8);
      frame.push(q_u8);
    }

    Ok(RawSamples {
      data: frame,
      sample_rate,
    })
  }

  /// Update signal appearance/disappearance and modulation
  fn update_signal_state(&mut self, signals: &mut [MockSignal], config: &MockSignalsConfig) {
    for signal in signals.iter_mut() {
      if signal.active
        && self.rng.gen::<f32>() < config.global_settings.signal_appearance_chance as f32
      {
        signal.active = false;
      } else if !signal.active
        && self.rng.gen::<f32>() < config.global_settings.signal_disappearance_chance as f32
      {
        signal.active = true;
      }

      if signal.active {
        let drift = config.global_settings.signal_drift_rate as f32;
        if drift > 0.0 {
          signal.drift_offset += self.rng.gen_range(
            -drift..drift,
          );
        }
        signal.drift_offset = signal.drift_offset.clamp(-5.0, 5.0);

        signal.modulation_phase += config.global_settings.signal_modulation_rate as f32;
        if signal.modulation_phase > 2.0 * std::f32::consts::PI {
          signal.modulation_phase -= 2.0 * std::f32::consts::PI;
        }
      }
    }
  }

  /// Calculate noise level for FFT size
  fn calculate_noise_level(&self, fft_size: usize, config: &MockSignalsConfig) -> f32 {
    const MOCK_NOISE_REF_FFT_SIZE: f32 = 8192.0;
    let noise_level_base = ((config.global_settings.noise_floor_variation as f32) / 200.0)
      .clamp(0.001, 0.5);
    let noise_scale = ((fft_size as f32) / MOCK_NOISE_REF_FFT_SIZE).sqrt().clamp(0.25, 16.0);
    (noise_level_base * noise_scale).clamp(0.001, 0.9)
  }

  /// Generate a single IQ sample
  fn generate_sample(
    &mut self,
    _i: usize,
    t: f32,
    signals: &[MockSignal],
    noise_level: f32,
  ) -> (f32, f32) {
    let mut i_acc = (self.rng.gen::<f32>() - 0.5) * 2.0 * noise_level;
    let mut q_acc = (self.rng.gen::<f32>() - 0.5) * 2.0 * noise_level;

    for signal in signals {
      if !signal.active {
        continue;
      }

      // Calculate frequency and add signal contribution
      let current_bin = (signal.center_bin + signal.drift_offset).round() as i32;
      let k = current_bin.rem_euclid(2048);
      let freq_hz = (k as f32) * 41000.0 / 2048.0; // Assuming sample rate

      let modulation = signal.modulation_phase.sin() * 0.3 + 0.7;
      let strength_variation = 0.0;
      let current_strength_db = signal.base_strength * modulation + strength_variation;
      let amp = (10f32.powf(current_strength_db / 20.0) * 0.05).clamp(0.0, 0.9);

      let phase = 2.0 * std::f32::consts::PI * freq_hz * t;
      i_acc += amp * phase.sin();
      q_acc += amp * phase.cos();

      // Add side tones for bandwidth
      if signal.bandwidth > 1 {
        let side = (signal.bandwidth as f32 / 4.0).round() as i32;
        if side > 0 {
          for (mult, w) in [(-side, 0.5f32), (side, 0.5f32)] {
            let k2 = k + mult;
            let freq2 = (k2 as f32) * 41000.0 / (signals.len() as f32);
            let phase2 = 2.0 * std::f32::consts::PI * freq2 * t;
            i_acc += (amp * w) * phase2.sin();
            q_acc += (amp * w) * phase2.cos();
          }
        }
      }
    }

    // Soft clamp to keep within [-1, 1]
    let i_f = i_acc.tanh();
    let q_f = q_acc.tanh();

    (i_f, q_f)
  }
}

impl Default for MockSignalGenerator {
  fn default() -> Self {
    Self::new()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_mock_generator_creation() {
    let generator = MockSignalGenerator::new();
    assert_eq!(generator.frame_counter, 0);
  }

  #[test]
  fn test_generate_basic_frame() {
    let mut generator = MockSignalGenerator::new();
    let mut signals = vec![];
    let config = MockSignalsConfig::default();

    let result = generator.generate_frame(1024, 41000, &mut signals, &config);
    assert!(result.is_ok());
    
    let samples = result.unwrap();
    assert_eq!(samples.data.len(), 1024 * 2);
    assert_eq!(samples.sample_rate, 41000);
  }

  #[test]
  fn test_generate_with_signal() {
    let mut generator = MockSignalGenerator::new();
    let mut signals = vec![MockSignal {
      center_bin: 256.0,
      base_strength: -20.0,
      bandwidth: 4,
      active: true,
      drift_offset: 0.0,
      modulation_phase: 0.0,
    }];
    let config = MockSignalsConfig::default();

    let result = generator.generate_frame(512, 41000, &mut signals, &config);
    assert!(result.is_ok());
    
    let samples = result.unwrap();
    assert_eq!(samples.data.len(), 512 * 2);
  }
}
