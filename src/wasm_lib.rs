//! WASM SIMD Test Library
//! 
//! Simple WASM library for testing SIMD functionality without server dependencies

use wasm_bindgen::prelude::*;
use num_complex::Complex;
use rustfft::{FftPlanner, FftDirection};
use std::sync::Arc;

#[wasm_bindgen]
pub struct WASMSIMDProcessor {
    fft: Arc<dyn rustfft::Fft<f32>>,
    fft_size: usize,
}

#[wasm_bindgen]
impl WASMSIMDProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize) -> WASMSIMDProcessor {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft(fft_size, FftDirection::Forward);
        
        WASMSIMDProcessor {
            fft,
            fft_size,
        }
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
        buf.iter()
            .map(|&complex| {
                let magnitude = (complex.re * complex.re + complex.im * complex.im).sqrt();
                20.0 * magnitude.log10()
            })
            .collect()
    }
    
    #[wasm_bindgen]
    pub fn fft_size(&self) -> usize {
        self.fft_size
    }
}

#[wasm_bindgen]
pub fn test_wasm_simd_availability() -> bool {
    // Test basic WASM functionality
    let test_data = vec![1.0f32, 2.0f32, 3.0f32, 4.0f32];
    let processor = WASMSIMDProcessor::new(4);
    let result = processor.process(&test_data);
    
    result.len() == 4
}

#[wasm_bindgen]
pub fn test_wasm_math_functions() -> f32 {
    // Test JavaScript math functions
    let sin_val = js_sys::Math::sin(std::f32::consts::PI / 2.0);
    sin_val
}

#[wasm_bindgen]
pub fn test_wasm_performance() -> f64 {
    // Test performance characteristics
    let start_time = js_sys::Date::now();
    
    let processor = WASMSIMDProcessor::new(1024);
    let test_data: Vec<f32> = (0..2048).map(|i| (i as f32 / 2048.0).sin()).collect();
    
    for _ in 0..10 {
        let _ = processor.process(&test_data);
    }
    
    let end_time = js_sys::Date::now();
    end_time - start_time
}
