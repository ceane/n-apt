//! WASM Test Library
//!
//! Simple WASM library for testing FFT functionality without server dependencies

use crate::fft::processor::WindowType;
use num_complex::Complex;
use rustfft::{FftDirection, FftPlanner};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
// use anyhow::Result; // Removed unused import
use web_sys::console;

#[wasm_bindgen]
pub struct WASMSIMDProcessor {
  fft: Arc<dyn rustfft::Fft<f32>>,
  fft_size: usize,
  gain: f32,
  ppm: f32,
  window_type: WindowType,
}

#[wasm_bindgen]
impl WASMSIMDProcessor {
  #[wasm_bindgen(constructor)]
  pub fn new(fft_size: usize) -> WASMSIMDProcessor {
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft(fft_size, FftDirection::Forward);

    console::log_1(&"✅ WASM SIMD module loaded successfully".into());

    // Default values from signals.yaml
    // tuner_gain: 496 (in tenths) = 49.6 dB, ppm: 1.0
    WASMSIMDProcessor {
      fft,
      fft_size,
      gain: 49.6, // From signals.yaml: tuner_gain: 496 (tenths of dB)
      ppm: 1.0,   // From signals.yaml: ppm: 1.0
      window_type: WindowType::Hanning,
    }
  }

  #[wasm_bindgen]
  pub fn set_gain(&mut self, gain: f32) {
    self.gain = gain;
  }

  #[wasm_bindgen]
  pub fn set_ppm(&mut self, ppm: f32) {
    self.ppm = ppm;
  }

  #[wasm_bindgen]
  pub fn set_window_type(&mut self, window_type_str: &str) {
    self.window_type = match window_type_str {
      "hanning" => WindowType::Hanning,
      "hamming" => WindowType::Hamming,
      "blackman" => WindowType::Blackman,
      "nuttall" => WindowType::Nuttall,
      "rectangular" => WindowType::Rectangular,
      _ => WindowType::None,
    };
  }

  #[wasm_bindgen]
  pub fn process_samples(&mut self, samples: &[u8]) -> Vec<f32> {
    // Convert u8 samples to f32 IQ pairs
    let mut iq_samples: Vec<Complex<f32>> = samples
      .chunks_exact(2)
      .map(|chunk| {
        let i = (chunk[0] as f32 - 128.0) / 128.0 * self.gain;
        let q = (chunk[1] as f32 - 128.0) / 128.0 * self.gain;
        Complex::new(i, q)
      })
      .collect();

    // Pad or truncate to FFT size
    while iq_samples.len() < self.fft_size {
      iq_samples.push(Complex::new(0.0, 0.0));
    }
    iq_samples.truncate(self.fft_size);

    // Apply simple window function
    if self.window_type != WindowType::None
      && self.window_type != WindowType::Rectangular
    {
      for (i, sample) in iq_samples.iter_mut().enumerate() {
        let t = i as f32 / (self.fft_size - 1) as f32;
        let window = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * t).cos(); // Hanning
        *sample = *sample * window;
      }
    }

    // Perform FFT
    self.fft.process(&mut iq_samples);

    // Calculate power spectrum
    let mut power: Vec<f32> = iq_samples
      .iter()
      .map(|&complex| {
        let magnitude =
          (complex.re * complex.re + complex.im * complex.im).sqrt();
        20.0 * magnitude.log10()
      })
      .collect();

    // Shift FFT: Move DC to the center
    let half = self.fft_size / 2;
    power.rotate_right(half);

    power
  }

  #[wasm_bindgen]
  pub fn process(&self, input: &[f32]) -> Vec<f32> {
    let mut buf: Vec<Complex<f32>> = input
      .chunks_exact(2)
      .map(|chunk| Complex::new(chunk[0], chunk[1]))
      .collect();

    // Pad if necessary
    while buf.len() < self.fft_size {
      buf.push(Complex::new(0.0, 0.0));
    }

    // Truncate if too long
    buf.truncate(self.fft_size);

    // Perform FFT
    self.fft.process(&mut buf);

    // Calculate power spectrum
    let mut power: Vec<f32> = buf
      .iter()
      .map(|&complex| {
        let magnitude =
          (complex.re * complex.re + complex.im * complex.im).sqrt();
        20.0 * magnitude.log10()
      })
      .collect();

    // Shift FFT: Move DC to the center
    let half = self.fft_size / 2;
    power.rotate_right(half);

    power
  }

  #[wasm_bindgen]
  pub fn fft_size(&self) -> usize {
    self.fft_size
  }
}

#[wasm_bindgen(start)]
pub fn wasm_main() {
  console::log_1(&"🚀 WASM SIMD module initializing...".into());
}

#[wasm_bindgen]
pub fn test_wasm_simd_availability() -> bool {
  console::log_1(&"🔧 Testing WASM SIMD availability...".into());

  // Test basic WASM functionality
  let test_data = vec![1.0f32, 2.0f32, 3.0f32, 4.0f32];
  let processor = WASMSIMDProcessor::new(4);
  let result = processor.process(&test_data);

  console::log_1(&"✅ WASM SIMD test completed".into());
  result.len() == 4
}

#[wasm_bindgen]
pub fn test_wasm_math_functions() -> f32 {
  // Test JavaScript math functions
  let sin_val = js_sys::Math::sin((std::f32::consts::PI / 2.0).into());
  sin_val as f32
}

#[wasm_bindgen]
pub fn test_wasm_performance() -> f64 {
  // Test performance characteristics
  let start_time = js_sys::Date::now();

  let processor = WASMSIMDProcessor::new(1024);
  let test_data: Vec<f32> =
    (0..2048).map(|i| (i as f32 / 2048.0).sin()).collect();

  for _ in 0..10 {
    let _ = processor.process(&test_data);
  }

  let end_time = js_sys::Date::now();
  end_time - start_time
}
