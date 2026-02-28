//! # Native SIMD Module
//!
//! Platform-specific SIMD acceleration for native (non-WASM) FFT processing.
//! Provides vectorized IQ conversion, windowing, power spectrum calculation,
//! and spectrum downsampling using aarch64 NEON or x86_64 SSE/AVX intrinsics.

pub mod fft_simd;

pub use fft_simd::NativeSIMDProcessor;
pub use fft_simd::downsample_spectrum_simd;
