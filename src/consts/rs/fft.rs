/// FFT display constants

pub const FFT_MIN_DB: i32 = -120;
pub const FFT_MAX_DB: i32 = 0;

/// FFT processing constants
pub const SAMPLE_RATE: u32 = 3_200_000; // 3.2 MHz
pub const CENTER_FREQ: u32 = 1_600_000; // 1.6 MHz
pub const NUM_SAMPLES: usize = 1024; // Reduced from 32768 for better performance
pub const FFT_FRAME_RATE: u32 = 30; // Target frame rate
