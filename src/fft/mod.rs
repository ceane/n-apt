pub mod processor;
pub mod types;
pub mod types_rust;

pub use processor::*;
pub use types::*;
pub use types_rust::SAMPLE_RATE;

/// Get current timestamp in milliseconds since Unix epoch
/// This function works on both WASM and native builds
pub fn now_millis() -> i64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as i64
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        chrono::Utc::now().timestamp_millis() as i64
    }
}
