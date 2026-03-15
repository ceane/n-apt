//! WASM Library Module
//!
//! Simple WASM bindings for testing and basic FFT functionality.
//! This is separate from the main SIMD processing pipeline.

pub mod lib;

// Re-export main WASM processor
pub use lib::WASMSIMDProcessor;
