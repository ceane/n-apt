//! Mock signal generation constants for structured waterfall patterns

pub const MOCK_SPECTRUM_SIZE: usize = 4096;
pub const MOCK_NOISE_FLOOR_BASE: f32 = -75.0;
pub const MOCK_NOISE_FLOOR_VARIATION: f32 = 2.0;

// Structured signal patterns - increased for better coverage
pub const MOCK_PERSISTENT_SIGNALS: usize = 512; // Number of consistent signal patterns
pub const MOCK_NARROW_BAND_WIDTH: usize = 3; // Width in frequency bins for narrow signals
pub const MOCK_WIDE_BAND_WIDTH: usize = 15; // Width in frequency bins for wide signals
pub const MOCK_SIGNAL_DRIFT_RATE: f32 = 0.05; // How much signals drift per frame (reduced)
pub const MOCK_SIGNAL_MODULATION_RATE: f32 = 0.02; // How fast signals modulate (reduced)

// Signal strength ranges (dB above noise floor)
pub const MOCK_STRONG_SIGNAL_MIN: f32 = 40.0;
pub const MOCK_STRONG_SIGNAL_MAX: f32 = 50.0;
pub const MOCK_MEDIUM_SIGNAL_MIN: f32 = 30.0;
pub const MOCK_MEDIUM_SIGNAL_MAX: f32 = 40.0;
pub const MOCK_WEAK_SIGNAL_MIN: f32 = 20.0;
pub const MOCK_WEAK_SIGNAL_MAX: f32 = 30.0;

// Time-varying signal behavior - reduced for stability
pub const MOCK_SIGNAL_APPEARANCE_CHANCE: f32 = 0.0; // No random appearance/disappearance
pub const MOCK_SIGNAL_DISAPPEARANCE_CHANCE: f32 = 0.0; // No random appearance/disappearance
pub const MOCK_SIGNAL_STRENGTH_VARIATION: f32 = 0.2; // dB variation in signal strength (reduced)
