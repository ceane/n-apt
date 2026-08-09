//! Reusable signal-processing primitives independent of application transport.

pub mod fft {
  pub use crate::s::fft::*;
}

pub mod ifft {
  pub mod complex_baseband;
  pub use crate::s::ifft::*;
}

pub mod simd {
  pub use crate::simd::*;
}
