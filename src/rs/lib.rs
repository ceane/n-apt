// Library exports for testing
#[cfg(not(target_arch = "wasm32"))]
pub mod authentication;
pub mod consts;
#[cfg(not(target_arch = "wasm32"))]
pub mod crypto;
#[cfg(all(rs_decrypted, not(target_arch = "wasm32")))]
#[path = "../encrypted-modules/tmp/rs/mod.rs"]
pub mod encrypted_modules;
pub mod fft;
#[cfg(not(target_arch = "wasm32"))]
pub mod sdr; // New abstract SDR interface
#[cfg(not(target_arch = "wasm32"))]
pub mod server;

#[cfg(not(target_arch = "wasm32"))]
pub mod live_stream_test; // Live stream test module
pub mod simd; // SIMD module (native only)
pub mod stitching;

// Re-export the main server function for binary use
#[cfg(not(target_arch = "wasm32"))]
pub use server::main::run_server;
#[cfg(not(target_arch = "wasm32"))]
pub mod session;
