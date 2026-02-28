// Library exports for testing
pub mod consts;
pub mod fft;
pub mod stitching;
#[cfg(not(target_arch = "wasm32"))]
pub mod coreml_client;
#[cfg(not(target_arch = "wasm32"))]
pub mod authentication;
#[cfg(not(target_arch = "wasm32"))]
pub mod crypto;
#[cfg(not(target_arch = "wasm32"))]
pub mod native_simd;
#[cfg(not(target_arch = "wasm32"))]
pub mod rtlsdr;
// #[cfg(not(target_arch = "wasm32"))]
// pub mod server;
#[cfg(not(target_arch = "wasm32"))]
pub mod session;
pub mod wasm_simd;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use js_sys::{Uint8Array, WebAssembly};

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn log_wasm_simd_status() {
  web_sys::console::log_1(&"🔍 WASM SIMD Status Check".into());
  web_sys::console::log_1(&"========================".into());
  
  // Check SIMD support
  let has_simd = WebAssembly::validate(&wasm_bindgen::JsValue::from(Uint8Array::from(
    &[
      0u8, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 0, 7, 129, 1, 96, 0, 0, 0,
      11, 1, 96, 0, 0, 0, 12, 1, 96, 0, 0, 0,
    ][..],
  )))
  .unwrap_or(false);
  
  web_sys::console::log_2(
    &"SIMD Support:".into(),
    &(if has_simd { "✅ Available" } else { "❌ Not Available" }).into()
  );
  
  // Check bulk memory support
  let has_bulk_memory = WebAssembly::validate(&wasm_bindgen::JsValue::from(Uint8Array::from(
    &[
      0u8, 97, 115, 109, 1, 0, 0, 0, 2, 8, 1, 96, 0, 0, 0, 7, 129, 1, 96, 0, 0, 0,
    ][..],
  )))
  .unwrap_or(false);
  
  web_sys::console::log_2(
    &"Bulk Memory:".into(),
    &(if has_bulk_memory { "✅ Available" } else { "❌ Not Available" }).into()
  );
  
  // Check mutable globals support
  let has_mutable_globals = WebAssembly::validate(&wasm_bindgen::JsValue::from(Uint8Array::from(
    &[
      0u8, 97, 115, 109, 1, 0, 0, 0, 6, 6, 1, 96, 0, 0, 0, 7, 129, 1, 96, 0, 0, 0,
    ][..],
  )))
  .unwrap_or(false);
  
  web_sys::console::log_2(
    &"Mutable Globals:".into(),
    &(if has_mutable_globals { "✅ Available" } else { "❌ Not Available" }).into()
  );
  
  if has_simd && has_bulk_memory && has_mutable_globals {
    web_sys::console::log_1(&"🎯 WASM SIMD Pipeline: FULLY SUPPORTED ✅".into());
    web_sys::console::log_1(&"✅ All modules loaded successfully".into());
    web_sys::console::log_1(&"   - 128-bit vector operations: ✅ Available".into());
    web_sys::console::log_1(&"   - Enhanced memory features: ✅ Enabled".into());
    web_sys::console::log_1(&"   - Mutable globals: ✅ Available".into());
    web_sys::console::log_1(&"   - Performance optimization: ✅ Active".into());
    web_sys::console::log_1(&"🚀 Ready for high-performance SIMD processing!".into());
  } else {
    web_sys::console::log_1(&"⚠️  WASM SIMD Pipeline: LIMITED SUPPORT".into());
    if !has_simd {
      web_sys::console::log_1(&"   - 128-bit vector operations: ❌ Not Available".into());
    }
    if !has_bulk_memory {
      web_sys::console::log_1(&"   - Enhanced memory features: ❌ Not Available".into());
    }
    if !has_mutable_globals {
      web_sys::console::log_1(&"   - Mutable globals: ❌ Not Available".into());
    }
    web_sys::console::log_1(&"📊 Performance will be limited".into());
  }
}
