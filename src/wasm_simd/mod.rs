//! # WASM SIMD Module
//! 
//! This module provides WebAssembly SIMD-accelerated operations for FFT signal processing
//! and rendering optimization. It leverages 128-bit vector operations to achieve
//! 2-8x performance improvements over scalar implementations.

pub mod simd_processor;
pub mod simd_fft;

pub use simd_processor::*;
pub use simd_fft::*;
