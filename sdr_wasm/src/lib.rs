use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};
use js_sys::Float32Array;

mod stitcher;
pub use stitcher::*;

#[wasm_bindgen]
pub struct SDRProcessor {
    fft_size: usize,
    gain: f32,
    ppm: f32,
    fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
}

#[wasm_bindgen]
impl SDRProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize) -> SDRProcessor {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(fft_size);
        SDRProcessor {
            fft_size,
            gain: 1.0,
            ppm: 0.0,
            fft,
        }
    }

    pub fn set_gain(&mut self, gain: f32) {
        self.gain = gain;
    }

    pub fn set_ppm(&mut self, ppm: f32) {
        self.ppm = ppm;
    }

    /// Input: interleaved IQ Float32Array
    /// Output: power spectrum (log scaled)
    pub fn process(&self, iq: &Float32Array) -> Float32Array {
        let iq = iq.to_vec();

        let mut buf: Vec<Complex<f32>> = Vec::with_capacity(self.fft_size);

        for n in 0..self.fft_size {
            let i = iq.get(n * 2).copied().unwrap_or(0.0) * self.gain;
            let q = iq.get(n * 2 + 1).copied().unwrap_or(0.0) * self.gain;

            // SDR++-style PPM correction = frequency shift
            let phase = 2.0 * std::f32::consts::PI * self.ppm * n as f32 / self.fft_size as f32;
            let rot = Complex::from_polar(1.0, phase);

            buf.push(Complex::new(i, q) * rot);
        }

        self.fft.process(&mut buf);

        let mut power = Vec::with_capacity(self.fft_size);
        for c in buf {
            let mag = c.norm_sqr();
            power.push(10.0 * mag.log10().max(-120.0));
        }

        Float32Array::from(&power[..])
    }
}