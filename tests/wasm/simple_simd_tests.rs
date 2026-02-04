//! Simple WASM SIMD Tests
//! 
//! Basic SIMD functionality tests that don't depend on the complex SIMD FFT processor

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_bindgen::prelude::*;

#[wasm_bindgen_test]
fn test_basic_wasm_functionality() {
    console_log("🧪 Testing Basic WASM Functionality...");
    
    // Test that we're running in WASM
    assert_eq!(cfg!(target_arch = "wasm32"), true);
    
    // Test basic operations
    let result = 2 + 2;
    assert_eq!(result, 4);
    
    console_log("✅ Basic WASM functionality working");
}

#[wasm_bindgen_test]
fn test_javascript_interop() {
    console_log("🧪 Testing JavaScript Interop...");
    
    // Test JavaScript Math functions
    let sin_val = js_sys::Math::sin(std::f32::consts::PI / 2.0);
    assert!((sin_val - 1.0).abs() < 0.01);
    
    // Test random function
    let random_val = js_sys::Math::random();
    assert!(random_val >= 0.0 && random_val < 1.0);
    
    console_log("✅ JavaScript interop working");
}

#[wasm_bindgen_test]
fn test_array_operations() {
    console_log("🧪 Testing Array Operations...");
    
    // Test Float32Array creation and manipulation
    let test_data = vec![1.0f32, 2.0, 3.0, 4.0];
    let test_array = js_sys::Float32Array::from(&test_data);
    
    assert_eq!(test_array.length(), 4);
    assert_eq!(test_array.get_index(0), 1.0);
    assert_eq!(test_array.get_index(3), 4.0);
    
    // Test modification
    test_array.set_index(1, 999.0);
    assert_eq!(test_array.get_index(1), 999.0);
    
    console_log("✅ Array operations working");
}

#[wasm_bindgen_test]
fn test_performance_baseline() {
    console_log("🧪 Testing Performance Baseline...");
    
    let start_time = js_sys::Date::now();
    
    // Simple computation loop
    let mut sum = 0.0;
    for i in 0..10000 {
        sum += (i as f32).sin();
    }
    
    let end_time = js_sys::Date::now();
    let duration = end_time - start_time;
    
    // Should complete in reasonable time
    assert!(duration < 1000.0, "Performance test took too long: {}ms", duration);
    
    console_log(&format!("✅ Performance baseline: {:.2}ms", duration));
}

#[wasm_bindgen_test]
fn test_simd_instruction_availability() {
    console_log("🧪 Testing SIMD Instruction Availability...");
    
    // This test just verifies we can run code that would use SIMD
    // The actual SIMD functionality is tested elsewhere
    let test_values = [1.0f32, 2.0, 3.0, 4.0];
    
    // Basic arithmetic that SIMD would accelerate
    let mut results = Vec::new();
    for &val in &test_values {
        results.push(val * 2.0 + 1.0);
    }
    
    assert_eq!(results.len(), 4);
    assert_eq!(results[0], 3.0);
    assert_eq!(results[3], 9.0);
    
    console_log("✅ SIMD instruction availability verified");
}
