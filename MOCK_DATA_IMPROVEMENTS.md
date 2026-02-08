# Improved Mock Data for Waterfall Visualization

## Overview
The mock data generation has been completely redesigned to create structured, consistent signal patterns that produce clear, readable lines in your waterfall display.

## Key Improvements

### 1. Structured Signal Patterns
- **Before**: Completely random noise with occasional spikes
- **After**: 8 persistent signals distributed across the spectrum

### 2. Signal Types
- **Narrow signals** (3 bins wide): Sharp, clear lines - perfect for CW carriers
- **Medium signals** (9 bins wide): Moderate bandwidth - good for digital modes
- **Wide signals** (15 bins wide): Broad signals - simulates broadcast stations

### 3. Realistic Signal Behavior
- **Frequency drift**: Signals slowly drift over time (±5 bins max)
- **Amplitude modulation**: Signals vary in strength with sine wave modulation
- **Random appearance/disappearance**: Signals can appear and disappear to simulate real radio activity
- **Gaussian signal profiles**: Realistic signal shapes instead of rectangular blocks

### 4. Improved Noise Floor
- Lower base noise floor (-75dB) for better signal contrast
- Reduced noise variation (±2dB) for cleaner background
- Better signal-to-noise ratio

## Technical Details

### Signal Generation Constants
```rust
// 8 persistent signals across the spectrum
MOCK_PERSISTENT_SIGNALS = 8

// Different bandwidths for variety
MOCK_NARROW_BAND_WIDTH = 3   // Sharp lines
MOCK_WIDE_BAND_WIDTH = 15    // Broad signals

// Realistic signal behavior
MOCK_SIGNAL_DRIFT_RATE = 0.1        // Slow frequency drift
MOCK_SIGNAL_MODULATION_RATE = 0.05  // Amplitude variation
```

### Signal Strength Ranges
- **Weak signals**: 5-15dB above noise floor (narrow signals)
- **Medium signals**: 20-35dB above noise floor (medium signals)  
- **Strong signals**: 40-60dB above noise floor (wide signals)

## Expected Waterfall Appearance

With these improvements, your waterfall should now show:

1. **Clear horizontal lines** that persist across multiple time frames
2. **Different line thicknesses** representing various signal types
3. **Slowly drifting signals** that move horizontally over time
4. **Varying brightness** as signals modulate in strength
5. **Occasional signal appearance/disappearance** for dynamic behavior
6. **Clean, dark background** with consistent noise floor

## Benefits

- **Easier signal identification**: Clear patterns make it simple to spot and track signals
- **Realistic simulation**: Behaves more like actual radio signals
- **Better testing**: Provides consistent patterns for testing waterfall functionality
- **Visual clarity**: Reduced noise and structured signals improve readability

## Usage

The new mock data is automatically active when you run the server. Simply connect your client and observe the improved waterfall visualization. The signals will be immediately apparent as clear, persistent horizontal lines with realistic behavior.

## Fine-tuning

You can adjust the constants in `src/consts/rs/mock.rs` to customize the signal behavior:
- Increase `MOCK_PERSISTENT_SIGNALS` for more signals
- Adjust `MOCK_SIGNAL_DRIFT_RATE` for faster/slower drift
- Modify signal strength ranges for different contrast levels
