use wasm_bindgen_test::wasm_bindgen_test;
use n_apt_backend::fft::anti_aliasing::*;

#[wasm_bindgen_test]
fn test_match_noise_floor_db_wasm_interop() {
    let reference = vec![-80.0, -80.0];
    let target = vec![-70.0, -70.0];
    let result = match_noise_floor_db_wasm(&reference, &target, 2, 0.0);
    assert!((result[0] + 80.0).abs() < 0.001);
}

#[wasm_bindgen_test]
fn test_smooth_waveform_wasm_interop() {
    let input = vec![1.0, 2.0, 3.0, 2.0, 1.0];
    let smoothed = smooth_waveform_wasm(&input, 1);
    assert_eq!(smoothed.len(), 5);
    assert!((smoothed[2] - 2.5).abs() < 0.001);
}

#[wasm_bindgen_test]
fn test_stitch_whole_channel_waveform_wasm_empty() {
    // Testing the WASM-facing JsValue interface
    let segments = serde_wasm_bindgen::to_value(&Vec::<WasmWholeChannelWaveformSegment>::new()).unwrap();
    let options = serde_wasm_bindgen::to_value(&WasmWholeChannelStitchOptions {
        minimum_bins: None,
        seam_bins: None,
        smoothing_radius: None,
        max_positive_floor_shift_db: None,
    }).unwrap();
    
    let result = stitch_whole_channel_waveform_wasm(segments, options).unwrap();
    assert!(result.is_empty());
}
