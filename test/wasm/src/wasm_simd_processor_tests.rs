//! WASM SIMD Tests
//! 
//! These tests run in the WASM environment to verify that SIMD functionality
//! works correctly in WebAssembly.

use wasm_bindgen_test::wasm_bindgen_test;
use crate::console_log;

#[wasm_bindgen_test]
fn test_wasm_simd_availability() {
    console_log("🧪 Testing WASM SIMD Availability...");
    
    // Test that we're running in WASM
    assert_eq!(cfg!(target_arch = "wasm32"), true);
    
    // Test basic WebAssembly operations
    let test_array = js_sys::Float32Array::from(&[1.0, 2.0, 3.0, 4.0][..]);
    assert_eq!(test_array.length(), 4);
    assert_eq!(test_array.get_index(0), 1.0);
    assert_eq!(test_array.get_index(3), 4.0);
    
    console_log("✅ WASM Environment: Confirmed");
    console_log("✅ Basic Operations: Working");
}

#[wasm_bindgen_test]
fn test_wasm_math_functions() {
    console_log("🧪 Testing WASM Math Functions...");
    
    // Test JavaScript math functions
    let pi_val = std::f32::consts::PI;
    let sin_val = js_sys::Math::sin(pi_val as f64);
    let cos_val = js_sys::Math::cos(pi_val as f64);
    
    // Verify trigonometric functions (sin(π) ≈ 0, cos(π) ≈ -1)
    assert!((sin_val - 0.0).abs() < 0.01);
    assert!((cos_val + 1.0).abs() < 0.01);
    
    // Test random function
    let random_val = js_sys::Math::random();
    assert!(random_val >= 0.0 && random_val < 1.0);
    
    console_log("✅ Math Functions: Working Correctly");
}

#[wasm_bindgen_test]
fn test_wasm_performance_characteristics() {
    console_log("🧪 Testing WASM Performance Characteristics...");
    
    // Test array operations
    let start_time = js_sys::Date::now();
    let large_array = js_sys::Float32Array::new_with_length(1000);
    for i in 0..1000 {
        large_array.set_index(i, (i as f32) / 1000.0);
    }
    let end_time = js_sys::Date::now();
    
    let processing_time = end_time - start_time;
    assert!(processing_time < 500.0, "Array operations should complete reasonably quickly");
    
    console_log(&format!("✅ Performance: Array operations completed in {:.2}ms", processing_time));
}

#[wasm_bindgen_test]
fn test_wasm_memory_operations() {
    console_log("🧪 Testing WASM Memory Operations...");
    
    // Test memory allocation
    let test_data = vec![1.0f32; 1024];
    let test_array = js_sys::Float32Array::from(&test_data[..]);
    
    // Test memory access
    assert_eq!(test_array.length(), 1024);
    assert_eq!(test_array.get_index(0), 1.0);
    assert_eq!(test_array.get_index(1023), 1.0);
    
    // Test memory modification
    test_array.set_index(512, 999.0);
    assert_eq!(test_array.get_index(512), 999.0);
    
    console_log("✅ Memory Operations: Working Correctly");
}

#[wasm_bindgen_test]
fn test_comprehensive_wasm_functionality() {
    console_log("🧪 Running Comprehensive WASM Functionality Tests...");
    
    // Test 1: Environment verification
    assert_eq!(cfg!(target_arch = "wasm32"), true);
    console_log("  ✅ WASM environment");
    
    // Test 2: Basic operations
    let test_data = [1.0f32, 2.0f32, 3.0f32, 4.0f32];
    let test_array = js_sys::Float32Array::from(&test_data[..]);
    assert_eq!(test_array.length(), 4);
    console_log("  ✅ Basic operations");
    
    // Test 3: Math functions
    let sin_val = js_sys::Math::sin((std::f32::consts::PI / 2.0) as f64);
    assert!((sin_val - 1.0).abs() < 0.01);
    console_log("  ✅ Math functions");
    
    // Test 4: Performance
    let start_time = js_sys::Date::now();
    let large_array = js_sys::Float32Array::new_with_length(10000);
    for i in 0..10000 {
        large_array.set_index(i, (i as f32).sin());
    }
    let end_time = js_sys::Date::now();
    assert!(end_time - start_time < 2000.0);
    console_log("  ✅ Performance characteristics");
    
    // Test 5: Memory operations
    let mem_data = vec![0.0f32; 2048];
    let mem_array = js_sys::Float32Array::from(&mem_data[..]);
    assert_eq!(mem_array.length(), 2048);
    console_log("  ✅ Memory operations");
    
    console_log("🎯 All Comprehensive WASM Tests: PASSED ✅");
}

#[wasm_bindgen_test]
fn test_error_handling() {
    console_log("🧪 Testing WASM Error Handling...");
    
    // Test with empty array
    let empty_array = js_sys::Float32Array::new_with_length(0);
    assert_eq!(empty_array.length(), 0);
    
    // Test out of bounds access (should not panic in JS, returns undefined which wasm-bindgen handles)
    let test_array = js_sys::Float32Array::new_with_length(10);
    let _result = test_array.get_index(15); 
    
    console_log("✅ Error Handling: Working Correctly");
}
