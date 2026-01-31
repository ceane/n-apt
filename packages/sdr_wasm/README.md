# SDR WASM Spectrum Stitcher

WebAssembly module for stitching multiple IQ captures into a continuous spectrum display in the browser.

## Features

- **Fast FFT processing** using `rustfft`
- **Spectrum stitching** from multiple .c64 IQ files
- **Browser-native** - no server processing needed
- **Compatible** with Python rtl_sdr_capture.py output

## Building

```bash
# Install wasm-pack if you haven't already
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Build the WASM module
wasm-pack build --target web
```

This generates files in `pkg/`:
- `sdr_wasm_bg.wasm` - The compiled WebAssembly
- `sdr_wasm.js` - JavaScript bindings
- `sdr_wasm.d.ts` - TypeScript definitions

## Usage

### Basic Example

```javascript
import init, { SpectrumStitcher } from './pkg/sdr_wasm.js';

async function main() {
    await init();
    
    const stitcher = new SpectrumStitcher(262144, 3.2e6);
    
    // Load IQ files and add to stitcher
    const response = await fetch('iq_0.50MHz.c64');
    const buffer = await response.arrayBuffer();
    const iqData = new Float32Array(buffer);
    
    stitcher.add_capture(iqData, 500000);
    
    // Get results
    const frequencies = stitcher.get_frequencies();
    const powerDb = stitcher.get_power_db();
}
```

### API

#### `SpectrumStitcher`

**Constructor:**
```javascript
new SpectrumStitcher(fftSize: number, sampleRate: number)
```
- `fftSize`: FFT size (e.g., 262144)
- `sampleRate`: Sample rate in Hz (e.g., 3.2e6)

**Methods:**

- `add_capture(iqData: Float32Array, centerFreq: number)` - Add a capture
  - `iqData`: Interleaved I/Q samples (I0, Q0, I1, Q1, ...)
  - `centerFreq`: Center frequency in Hz

- `get_frequencies()` - Returns `Float64Array` of frequencies in Hz
- `get_power_db()` - Returns `Float32Array` of power values in dB
- `get_complex()` - Returns `Float32Array` of complex values (re, im, re, im, ...)
- `get_spectrum()` - Returns interleaved `[freq, power, freq, power, ...]`
- `get_frequency_range()` - Returns `[minFreq, maxFreq]` in Hz
- `len()` - Returns number of frequency points
- `clear()` - Clear all captures

### Working with .c64 Files

The `.c64` format is complex64 data: pairs of 32-bit floats (I, Q, I, Q, ...).

```javascript
// From file upload
const file = event.target.files[0];
const buffer = await file.arrayBuffer();
const iqData = new Float32Array(buffer);

// From fetch
const response = await fetch('iq_file.c64');
const buffer = await response.arrayBuffer();
const iqData = new Float32Array(buffer);
```

### Visualizing with Canvas

See `example_stitcher.js` for a complete example with canvas rendering.

```javascript
function plotSpectrum(frequencies, powerDb) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Scale and draw your spectrum
    // ...
}
```

## Comparison with Python

The WASM stitcher matches the Python implementation:

**Python (rtl_sdr_capture.py):**
```python
fft = np.fft.fftshift(np.fft.fft(iq[:fft_size]))
freqs_fft = np.fft.fftshift(np.fft.fftfreq(fft_size, 1/sample_rate))
for fi, val in zip(freqs_fft, fft):
    abs_f = f + fi
    spectrum[abs_f] = val
```

**WASM (Rust):**
```rust
fft.process(&mut buffer);
for (i, &fft_val) in buffer.iter().enumerate() {
    let freq_offset = fft_freqs[i];
    let abs_freq = center_freq + freq_offset;
    spectrum.insert(freq_key, fft_val);
}
```

## Performance

- FFT is computed once per capture
- BTreeMap ensures sorted frequency ordering
- Typical stitching time: ~10-50ms per capture (depends on FFT size)
- Can process 10+ captures in <500ms

## Example HTML

```html
<!DOCTYPE html>
<html>
<head>
    <title>SDR Spectrum Viewer</title>
</head>
<body>
    <input type="file" id="files" multiple accept=".c64" />
    <button onclick="stitch()">Stitch & Display</button>
    <canvas id="spectrum" width="1200" height="400"></canvas>
    
    <script type="module">
        import init, { SpectrumStitcher } from './pkg/sdr_wasm.js';
        
        window.stitch = async function() {
            await init();
            const stitcher = new SpectrumStitcher(262144, 3.2e6);
            
            const files = document.getElementById('files').files;
            for (const file of files) {
                const buffer = await file.arrayBuffer();
                const iqData = new Float32Array(buffer);
                
                // Parse frequency from filename
                const freq = parseFrequencyFromFilename(file.name);
                stitcher.add_capture(iqData, freq);
            }
            
            const freqs = stitcher.get_frequencies();
            const power = stitcher.get_power_db();
            
            plotSpectrum(freqs, power);
        }
    </script>
</body>
</html>
```

## Development

Run tests:
```bash
cargo test
```

Build for development:
```bash
wasm-pack build --target web --dev
```

Build for production:
```bash
wasm-pack build --target web --release
```
