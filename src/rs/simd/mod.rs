//! # SIMD Module
//!
//! High-performance SIMD-accelerated signal processing for native targets.
//! FFT processing uses GPU compute shaders instead of WASM SIMD.

pub mod arm_optimized_common;
pub mod common;
pub mod downsampler;
pub mod fast_math;
pub mod mock_generator;
pub mod native_processor;
pub mod rendering_processor;

// Encrypted demodulation kernels (only available when decrypted)
#[cfg(rs_decrypted)]
#[path = "../../encrypted-modules/tmp/rs/simd/demod_kernels.rs"]
pub mod demod_kernels;

// Re-export main processors
pub use mock_generator::MockSignalGenerator;
pub use native_processor::NativeProcessor;
pub use rendering_processor::RenderingProcessor;

// Re-export common utilities
pub use common::{IQConverter, PowerSpectrum, SIMDProcessor, WindowFunctions};
pub use downsampler::{downsample_spectrum_simd, SpectrumDownsampler};

/// Native SIMD processor for signal processing
/// Note: FFT processing uses GPU compute shaders instead of WASM SIMD
pub type UnifiedProcessor = NativeProcessor;
