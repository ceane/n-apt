//! TX-oriented inverse-transform and synthesis helpers.
//!
//! This module is intentionally separate from `crate::s::fft` so that analysis
//! can keep observing folding/aliasing artifacts while transmit-side
//! synthesis is constrained by explicit guards.

pub mod anti_foldover;
pub mod processor;

pub use anti_foldover::*;
pub use processor::*;
pub mod mock_tx_gen;
