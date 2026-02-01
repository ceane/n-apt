use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};
use std::collections::BTreeMap;

#[wasm_bindgen]
pub struct SpectrumStitcher {
    fft_size: usize,
    sample_rate: f64,
    reference_dbm: f32,
    spectrum: BTreeMap<i64, Complex<f32>>,
}

#[wasm_bindgen]
impl SpectrumStitcher {
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize, sample_rate: f64, reference_dbm: f32) -> SpectrumStitcher {
        SpectrumStitcher {
            fft_size,
            sample_rate,
            reference_dbm,
            spectrum: BTreeMap::new(),
        }
    }

    /// Add a capture to the stitched spectrum
    /// iq_data: Float32Array of interleaved I/Q samples (I0, Q0, I1, Q1, ...)
    /// center_freq: center frequency in Hz
    pub fn add_capture(&mut self, iq_data: &[f32], center_freq: f64) {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(self.fft_size);

        // Convert interleaved IQ to complex
        let mut buffer: Vec<Complex<f32>> = Vec::with_capacity(self.fft_size);
        for i in 0..self.fft_size {
            let idx = i * 2;
            if idx + 1 < iq_data.len() {
                buffer.push(Complex::new(iq_data[idx], iq_data[idx + 1]));
            } else {
                buffer.push(Complex::new(0.0, 0.0));
            }
        }

        // Perform FFT
        fft.process(&mut buffer);

        // Compute FFT frequencies
        let fft_freqs: Vec<f64> = (0..self.fft_size)
            .map(|i| {
                let k = if i < self.fft_size / 2 {
                    i as f64
                } else {
                    i as f64 - self.fft_size as f64
                };
                k * self.sample_rate / self.fft_size as f64
            })
            .collect();

        // Map to absolute frequencies and store in spectrum
        for (i, &fft_val) in buffer.iter().enumerate() {
            let freq_offset = fft_freqs[i];
            let abs_freq = center_freq + freq_offset;
            
            // Use integer key for BTreeMap (convert to Hz as i64)
            let freq_key = abs_freq.round() as i64;
            
            // Store FFT value (overwrites if frequency already exists)
            self.spectrum.insert(freq_key, fft_val);
        }
    }

    /// Get the stitched spectrum as two arrays: frequencies and power values
    /// Returns [freqs_array, power_array] where each is a Float64Array
    pub fn get_spectrum(&self) -> Vec<f64> {
        let mut result = Vec::with_capacity(self.spectrum.len() * 2);
        
        for (&freq, &val) in self.spectrum.iter() {
            result.push(freq as f64);
            let power = 10.0 * (val.norm_sqr().log10().max(-120.0));
            result.push(power as f64);
        }
        
        result
    }

    /// Get frequencies array
    pub fn get_frequencies(&self) -> Vec<f64> {
        self.spectrum.keys().map(|&k| k as f64).collect()
    }

    /// Get power spectrum array (in dBm)
    pub fn get_power_db(&self) -> Vec<f32> {
        self.spectrum
            .values()
            .map(|val| 10.0 * val.norm_sqr().log10().max(-120.0) + self.reference_dbm)
            .collect()
    }

    /// Get complex spectrum (interleaved real, imag)
    pub fn get_complex(&self) -> Vec<f32> {
        let mut result = Vec::with_capacity(self.spectrum.len() * 2);
        for val in self.spectrum.values() {
            result.push(val.re);
            result.push(val.im);
        }
        result
    }

    /// Clear the spectrum
    pub fn clear(&mut self) {
        self.spectrum.clear();
    }

    /// Get the number of frequency points
    pub fn len(&self) -> usize {
        self.spectrum.len()
    }

    /// Get frequency range (min, max) in Hz
    pub fn get_frequency_range(&self) -> Vec<f64> {
        if self.spectrum.is_empty() {
            vec![0.0, 0.0]
        } else {
            vec![
                *self.spectrum.keys().next().unwrap() as f64,
                *self.spectrum.keys().next_back().unwrap() as f64,
            ]
        }
    }
}

/// Standalone function to stitch multiple captures at once
/// captures: array of [iq_data, center_freq] pairs
#[wasm_bindgen]
pub fn stitch_captures(
    _captures: Vec<JsValue>,
    fft_size: usize,
    sample_rate: f64,
) -> SpectrumStitcher {
    let stitcher = SpectrumStitcher::new(fft_size, sample_rate, 0.0);
    
    // TODO: Implement proper JS interop for batch stitching
    // In practice, you'd call add_capture multiple times from JS
    
    stitcher
}
