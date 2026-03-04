//! # Unified SIMD Module
//!
//! High-performance SIMD-accelerated signal processing for native targets.
//! WASM SIMD processing is handled by the unified UnifiedProcessor type.
//!
//! ## Architecture
//!
//! - **Native Processor**: NEON/SSE intrinsics for server/desktop deployment  
//! - **Rendering Processor**: Spectrum visualization and waterfall rendering
//! - **Mock Generator**: SIMD-accelerated test signal generation
//! - **Common Utilities**: Shared SIMD operations and mathematical functions
//!
//! ## Performance
//!
//! - IQ conversion: 2-4x speedup
//! - Power spectrum: 2-3x speedup  
//! - Window functions: 2-3x speedup
//! - Mock generation: 3-5x speedup
//! - Rendering: 4-8x speedup

pub mod native_processor;
pub mod rendering_processor;
pub mod mock_generator;
pub mod common;
pub mod downsampler;
pub mod arm_optimized_common;

// Re-export main processors for easy access
pub use native_processor::NativeProcessor;
pub use rendering_processor::RenderingProcessor;
pub use mock_generator::MockSignalGenerator;

// Re-export common utilities
pub use common::{SIMDProcessor, WindowFunctions, PowerSpectrum, IQConverter};
pub use downsampler::{SpectrumDownsampler, downsample_spectrum_simd};

/// Unified SIMD processor that works on both WASM and native targets
#[cfg(target_arch = "wasm32")]
pub type UnifiedProcessor = crate::wasm::WASMSIMDProcessor;

#[cfg(not(target_arch = "wasm32"))]
pub type UnifiedProcessor = NativeProcessor;

/// Re-export for backward compatibility
pub use UnifiedProcessor as FFTProcessor;
pub mod fast_math;
