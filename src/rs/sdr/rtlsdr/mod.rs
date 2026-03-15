//! RTL-SDR device bindings and safe wrapper
//!
//! Provides direct FFI bindings to librtlsdr and a safe Rust wrapper
//! for RTL-SDR device access. Falls back gracefully when no device is present.

#[cfg(not(target_arch = "wasm32"))]
pub mod device;
#[cfg(not(target_arch = "wasm32"))]
pub mod ffi;

#[cfg(not(target_arch = "wasm32"))]
pub use device::RtlSdrDevice;
