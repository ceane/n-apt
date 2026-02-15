//! WASM Tests
//! 
//! Headless WASM unit tests for verifying WASM module functionality

pub mod simple_wasm_tests;

#[cfg(test)]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

#[cfg(test)]
pub fn console_log(msg: &str) {
    web_sys::console::log_1(&msg.into());
}
