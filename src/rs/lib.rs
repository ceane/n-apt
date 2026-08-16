// Library exports for testing
#[cfg(not(target_arch = "wasm32"))]
pub mod authentication;
#[cfg(not(target_arch = "wasm32"))]
pub mod app;
#[cfg(not(target_arch = "wasm32"))]
pub mod auth;
#[cfg(not(target_arch = "wasm32"))]
pub mod acquisition;
#[cfg(not(target_arch = "wasm32"))]
pub mod capture;
pub mod consts;
#[cfg(not(target_arch = "wasm32"))]
pub mod devices;
pub mod dsp;
#[cfg(not(target_arch = "wasm32"))]
pub mod geo;
#[cfg(not(target_arch = "wasm32"))]
pub mod crypto;
#[cfg(all(rs_decrypted, not(target_arch = "wasm32")))]
#[path = "../encrypted-modules/tmp/rs/mod.rs"]
#[rustfmt::skip]
pub mod encrypted_modules;
pub mod s;
#[cfg(not(target_arch = "wasm32"))]
pub mod sdr; // New abstract SDR interface
#[cfg(not(target_arch = "wasm32"))]
pub mod server;

pub mod simd; // SIMD module (native only)
#[cfg(not(target_arch = "wasm32"))]
pub mod state;
pub mod stitching;
#[cfg(not(target_arch = "wasm32"))]
pub mod streaming;
#[cfg(not(target_arch = "wasm32"))]
pub mod tx;
#[cfg(not(target_arch = "wasm32"))]
pub mod infrastructure;
#[cfg(not(target_arch = "wasm32"))]
pub mod protocol;
#[cfg(not(target_arch = "wasm32"))]
pub mod performance;

// Re-export the main server function for binary use
#[cfg(not(target_arch = "wasm32"))]
pub use server::main::run_server;
#[cfg(not(target_arch = "wasm32"))]
pub mod session;

pub mod safety;
