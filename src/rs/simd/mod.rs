//! # Unified SIMD Module
//!
//! High-performance SIMD-accelerated signal processing for native targets.
//! WASM SIMD processing is handled by the unified UnifiedProcessor type.

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

/// Unified SIMD processor that works on both WASM and native targets
#[cfg(target_arch = "wasm32")]
pub type UnifiedProcessor = crate::wasm::WASMSIMDProcessor;

#[cfg(not(target_arch = "wasm32"))]
pub type UnifiedProcessor = NativeProcessor;

/// Re-export for backward compatibility
pub use UnifiedProcessor as FFTProcessor;
