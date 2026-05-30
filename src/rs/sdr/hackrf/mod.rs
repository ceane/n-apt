//! HackRF One device bindings and safe wrapper.

#[cfg(not(target_arch = "wasm32"))]
pub mod device;
#[cfg(not(target_arch = "wasm32"))]
pub mod ffi;

#[cfg(not(target_arch = "wasm32"))]
pub use device::HackRfDevice;
