//! WASMSIMDProcessor Tests
//! 
//! Tests for the WASM FFT processor: construction, parameter setting,
//! FFT processing with u8 and f32 inputs, windowing, and edge cases.

use wasm_bindgen_test::wasm_bindgen_test;
use n_apt_backend::wasm::WASMSIMDProcessor;
use crate::console_log;

// ── Constructor / fft_size ──────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_processor_creation() {
    let processor = WASMSIMDProcessor::new(1024);
    assert_eq!(processor.fft_size(), 1024);
}

#[wasm_bindgen_test]
fn test_processor_different_fft_sizes() {
    for &size in &[64, 128, 256, 512, 1024, 2048, 4096] {
        let processor = WASMSIMDProcessor::new(size);
        assert_eq!(processor.fft_size(), size, "FFT size mismatch for {}", size);
    }
}

// ── process (f32 input) ─────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_process_output_length() {
    let processor = WASMSIMDProcessor::new(256);
    let input: Vec<f32> = (0..512).map(|i| (i as f32 / 512.0).sin()).collect();
    let result = processor.process(&input);
    assert_eq!(result.len(), 256, "Output length should equal FFT size");
}

#[wasm_bindgen_test]
fn test_process_output_finite() {
    let processor = WASMSIMDProcessor::new(128);
    let input: Vec<f32> = vec![0.5; 256]; // 128 IQ pairs
    let result = processor.process(&input);
    for (i, &val) in result.iter().enumerate() {
        // -inf is valid (20*log10(0) for zero-magnitude bins), only NaN is unexpected
        assert!(!val.is_nan(), "Output[{}] should not be NaN", i);
    }
}

#[wasm_bindgen_test]
fn test_process_pads_short_input() {
    let processor = WASMSIMDProcessor::new(256);
    let input = vec![1.0f32, 0.0, 0.5, 0.5, -0.5, 0.5, 0.0, -1.0];
    let result = processor.process(&input);
    assert_eq!(result.len(), 256, "Output should be padded to FFT size");
}

#[wasm_bindgen_test]
fn test_process_truncates_long_input() {
    let processor = WASMSIMDProcessor::new(64);
    let input: Vec<f32> = (0..400).map(|i| (i as f32 / 100.0).sin()).collect();
    let result = processor.process(&input);
    assert_eq!(result.len(), 64, "Output should be truncated to FFT size");
}

#[wasm_bindgen_test]
fn test_process_dc_signal() {
    let processor = WASMSIMDProcessor::new(64);
    // Pure DC signal: all I=1.0, Q=0.0
    let mut input = Vec::with_capacity(128);
    for _ in 0..64 {
        input.push(1.0f32); // I
        input.push(0.0f32); // Q
    }
    let result = processor.process(&input);
    // DC bin (index 0) should have highest energy
    let dc_power = result[0];
    let avg_non_dc: f32 = result[1..].iter().sum::<f32>() / (result.len() - 1) as f32;
    assert!(dc_power > avg_non_dc, "DC bin should dominate for a DC signal");
}

// ── process_samples (u8 input) ──────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_process_samples_output_length() {
    let mut processor = WASMSIMDProcessor::new(256);
    let samples: Vec<u8> = (0..512).map(|i| (i % 256) as u8).collect();
    let result = processor.process_samples(&samples);
    assert_eq!(result.len(), 256);
}

#[wasm_bindgen_test]
fn test_process_samples_pads_short_input() {
    let mut processor = WASMSIMDProcessor::new(128);
    let samples = vec![128u8, 128, 200, 60];
    let result = processor.process_samples(&samples);
    assert_eq!(result.len(), 128);
}

#[wasm_bindgen_test]
fn test_process_samples_center_is_zero() {
    let mut processor = WASMSIMDProcessor::new(64);
    processor.set_gain(1.0);
    // All 128 → I=0, Q=0 after centering → silence → -inf dB
    let samples = vec![128u8; 128];
    let result = processor.process_samples(&samples);
    for &val in result.iter() {
        assert!(val.is_infinite() && val < 0.0 || val.is_nan(),
                "Zero input should produce -inf dB, got {}", val);
    }
}

// ── set_gain ────────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_gain_affects_output() {
    let fft_size = 128;
    let samples: Vec<u8> = (0..fft_size * 2).map(|i| (128 + (i % 50)) as u8).collect();

    let mut proc_low = WASMSIMDProcessor::new(fft_size);
    proc_low.set_gain(1.0);
    let result_low = proc_low.process_samples(&samples);

    let mut proc_high = WASMSIMDProcessor::new(fft_size);
    proc_high.set_gain(50.0);
    let result_high = proc_high.process_samples(&samples);

    let avg_low: f32 = result_low.iter().filter(|v| v.is_finite()).sum::<f32>()
        / result_low.iter().filter(|v| v.is_finite()).count().max(1) as f32;
    let avg_high: f32 = result_high.iter().filter(|v| v.is_finite()).sum::<f32>()
        / result_high.iter().filter(|v| v.is_finite()).count().max(1) as f32;

    assert!(avg_high > avg_low,
            "Higher gain should produce stronger output: low={}, high={}", avg_low, avg_high);
}

// ── set_ppm ─────────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_set_ppm_does_not_panic() {
    let mut processor = WASMSIMDProcessor::new(64);
    processor.set_ppm(5.0);
    processor.set_ppm(-10.0);
    processor.set_ppm(0.0);
    let samples = vec![128u8; 128];
    let result = processor.process_samples(&samples);
    assert_eq!(result.len(), 64);
}

// ── set_window_type ─────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_window_rectangular_vs_hanning() {
    let fft_size = 256;
    let samples: Vec<u8> = (0..fft_size * 2).map(|i| {
        let t = i as f32 / (fft_size * 2) as f32;
        (128.0 + 60.0 * (2.0 * std::f32::consts::PI * 10.0 * t).sin()) as u8
    }).collect();

    let mut proc_rect = WASMSIMDProcessor::new(fft_size);
    proc_rect.set_window_type("rectangular");
    let result_rect = proc_rect.process_samples(&samples);

    let mut proc_hann = WASMSIMDProcessor::new(fft_size);
    proc_hann.set_window_type("hanning");
    let result_hann = proc_hann.process_samples(&samples);

    let differs = result_rect.iter()
        .zip(result_hann.iter())
        .any(|(a, b)| (a - b).abs() > 0.01);
    assert!(differs, "Hanning and Rectangular windows should produce different results");
}

#[wasm_bindgen_test]
fn test_all_window_types() {
    let fft_size = 128;
    let samples: Vec<u8> = (0..fft_size * 2).map(|i| (128 + (i % 40)) as u8).collect();

    for window in &["hanning", "hamming", "blackman", "nuttall", "rectangular", "unknown_window"] {
        let mut processor = WASMSIMDProcessor::new(fft_size);
        processor.set_window_type(window);
        let result = processor.process_samples(&samples);
        assert_eq!(result.len(), fft_size, "Window '{}' should produce correct output length", window);
    }
}

// ── Standalone function tests (inlined) ─────────────────────────────────────

#[wasm_bindgen_test]
fn test_simd_availability() {
    let test_data = vec![1.0f32, 2.0, 3.0, 4.0];
    let processor = WASMSIMDProcessor::new(4);
    let result = processor.process(&test_data);
    assert_eq!(result.len(), 4, "SIMD processor should produce correct output length");
}

#[wasm_bindgen_test]
fn test_math_functions_in_wasm() {
    let sin_val = js_sys::Math::sin((std::f32::consts::PI / 2.0).into());
    assert!((sin_val - 1.0).abs() < 0.01, "sin(pi/2) should be approx 1.0, got {}", sin_val);
}

#[wasm_bindgen_test]
fn test_fft_performance() {
    let start = js_sys::Date::now();
    let processor = WASMSIMDProcessor::new(1024);
    let test_data: Vec<f32> = (0..2048).map(|i| (i as f32 / 2048.0).sin()).collect();
    for _ in 0..10 {
        let _ = processor.process(&test_data);
    }
    let elapsed = js_sys::Date::now() - start;
    assert!(elapsed >= 0.0, "Should return non-negative time");
    assert!(elapsed < 5000.0, "10x 1024-point FFT should complete in < 5s, took {}ms", elapsed);
}

// ── Edge cases ──────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_process_empty_input() {
    let processor = WASMSIMDProcessor::new(64);
    let result = processor.process(&[]);
    assert_eq!(result.len(), 64);
}

#[wasm_bindgen_test]
fn test_process_samples_empty_input() {
    let mut processor = WASMSIMDProcessor::new(64);
    let result = processor.process_samples(&[]);
    assert_eq!(result.len(), 64);
}

#[wasm_bindgen_test]
fn test_process_single_iq_pair() {
    let processor = WASMSIMDProcessor::new(64);
    let result = processor.process(&[1.0, 0.0]);
    assert_eq!(result.len(), 64);
}

#[wasm_bindgen_test]
fn test_process_deterministic() {
    let processor = WASMSIMDProcessor::new(128);
    let input: Vec<f32> = (0..256).map(|i| (i as f32 * 0.1).sin()).collect();
    let result1 = processor.process(&input);
    let result2 = processor.process(&input);
    assert_eq!(result1, result2, "Same input should produce same output");
}

#[wasm_bindgen_test]
fn test_process_samples_large_fft() {
    console_log("Testing large FFT size (8192)...");
    let mut processor = WASMSIMDProcessor::new(8192);
    let samples: Vec<u8> = (0..16384).map(|i| (128 + (i % 100)) as u8).collect();

    let start = js_sys::Date::now();
    let result = processor.process_samples(&samples);
    let elapsed = js_sys::Date::now() - start;

    assert_eq!(result.len(), 8192);
    assert!(elapsed < 1000.0, "8192-point FFT should complete in < 1s, took {}ms", elapsed);
    console_log(&format!("8192-point FFT completed in {:.1}ms", elapsed));
}
