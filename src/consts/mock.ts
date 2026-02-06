// Mock signal generation constants for structured waterfall patterns
export const MOCK_SPECTRUM_SIZE = 1024
export const MOCK_NOISE_FLOOR_BASE = -75.0
export const MOCK_NOISE_FLOOR_VARIATION = 2.0

// Structured signal patterns
export const MOCK_PERSISTENT_SIGNALS = 8 // Number of consistent signal patterns
export const MOCK_NARROW_BAND_WIDTH = 3 // Width in frequency bins for narrow signals
export const MOCK_WIDE_BAND_WIDTH = 15 // Width in frequency bins for wide signals
export const MOCK_SIGNAL_DRIFT_RATE = 0.1 // How much signals drift per frame
export const MOCK_SIGNAL_MODULATION_RATE = 0.05 // How fast signals modulate

// Signal strength ranges (dB above noise floor)
export const MOCK_STRONG_SIGNAL_MIN = 40.0
export const MOCK_STRONG_SIGNAL_MAX = 60.0
export const MOCK_MEDIUM_SIGNAL_MIN = 20.0
export const MOCK_MEDIUM_SIGNAL_MAX = 35.0
export const MOCK_WEAK_SIGNAL_MIN = 5.0
export const MOCK_WEAK_SIGNAL_MAX = 15.0

// Time-varying signal behavior
export const MOCK_SIGNAL_APPEARANCE_CHANCE = 0.01 // Chance for new signal to appear
export const MOCK_SIGNAL_DISAPPEARANCE_CHANCE = 0.005 // Chance for signal to disappear
export const MOCK_SIGNAL_STRENGTH_VARIATION = 2.0 // dB variation in signal strength
