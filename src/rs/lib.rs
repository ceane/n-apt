// Library exports for testing
#[cfg(not(target_arch = "wasm32"))]
pub mod authentication;
pub mod consts;
#[cfg(not(target_arch = "wasm32"))]
pub mod coreml_client;
#[cfg(not(target_arch = "wasm32"))]
pub mod crypto;
pub mod fft;
#[cfg(not(target_arch = "wasm32"))]
pub mod sdr; // New abstract SDR interface
#[cfg(not(target_arch = "wasm32"))]
pub mod server;
#[cfg(all(rs_decrypted, not(target_arch = "wasm32")))]
#[path = "../encrypted-modules/tmp/rs/mod.rs"]
pub mod encrypted_modules;

pub mod simd; // Unified SIMD module
pub mod stitching;
#[cfg(not(target_arch = "wasm32"))]
pub mod live_stream_test; // Live stream test module
#[cfg(target_arch = "wasm32")]
pub mod wasm; // WASM library module

// Re-export the main server function for binary use
#[cfg(not(target_arch = "wasm32"))]
pub use server::main::run_server;
#[cfg(not(target_arch = "wasm32"))]
pub mod session;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use js_sys::{Uint8Array, WebAssembly};

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn log_wasm_simd_status() {
  // Check SIMD support
  let has_simd =
    WebAssembly::validate(&wasm_bindgen::JsValue::from(Uint8Array::from(
      &[
        0u8, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 0, 7, 129, 1, 96, 0,
        0, 0, 11, 1, 96, 0, 0, 0, 12, 1, 96, 0, 0, 0,
      ][..],
    )))
    .unwrap_or(false);

  // Check bulk memory support
  let has_bulk_memory =
    WebAssembly::validate(&wasm_bindgen::JsValue::from(Uint8Array::from(
      &[
        0u8, 97, 115, 109, 1, 0, 0, 0, 2, 8, 1, 96, 0, 0, 0, 7, 129, 1, 96, 0,
        0, 0,
      ][..],
    )))
    .unwrap_or(false);

  // Check mutable globals support
  let has_mutable_globals =
    WebAssembly::validate(&wasm_bindgen::JsValue::from(Uint8Array::from(
      &[
        0u8, 97, 115, 109, 1, 0, 0, 0, 6, 6, 1, 96, 0, 0, 0, 7, 129, 1, 96, 0,
        0, 0,
      ][..],
    )))
    .unwrap_or(false);

  // Functionality remains intact but without console logging
  let _ = (has_simd, has_bulk_memory, has_mutable_globals);
}
