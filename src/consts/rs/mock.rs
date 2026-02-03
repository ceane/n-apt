//! Mock signal generation constants

pub const MOCK_SPECTRUM_SIZE: usize = 1024;
pub const MOCK_NOISE_FLOOR_BASE: f32 = -65.0;
pub const MOCK_NOISE_FLOOR_VARIATION: f32 = 5.0;
pub const MOCK_STRONG_SIGNAL_CHANCE: u32 = 3; // out of 100
pub const MOCK_STRONG_SIGNAL_MIN: f32 = 20.0;
pub const MOCK_STRONG_SIGNAL_MAX: f32 = 50.0;
pub const MOCK_WEAK_SIGNAL_CHANCE: u32 = 10; // out of 100
pub const MOCK_WEAK_SIGNAL_MIN: f32 = 5.0;
pub const MOCK_WEAK_SIGNAL_MAX: f32 = 20.0;
