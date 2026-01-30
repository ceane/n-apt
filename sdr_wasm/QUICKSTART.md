# Quick Start Guide

## Test the Demo

1. **Start a local web server** (required for WASM/ES modules):
   ```bash
   # Using Python
   python3 -m http.server 8000
   
   # Or using Node.js
   npx http-server -p 8000
   ```

2. **Open the demo** in your browser:
   ```
   http://localhost:8000/demo.html
   ```

3. **Load your .c64 files**:
   - Click "Choose Files" and select multiple `.c64` files from your captures
   - Files should be named like: `iq_0.50MHz.c64`, `iq_3.70MHz.c64`, etc.
   - Click "Stitch Spectrum" to process and visualize

## Using in Your Own Project

### 1. Copy the WASM package

```bash
cp -r pkg/ /path/to/your/project/
```

### 2. Import in your JavaScript/TypeScript

```javascript
import init, { SpectrumStitcher } from './pkg/sdr_wasm.js';

async function main() {
    // Initialize WASM
    await init();
    
    // Create stitcher (reference_dbm calibrates dBFS to dBm, 0 = dBFS)
    const stitcher = new SpectrumStitcher(262144, 3.2e6, 0.0);
    
    // Add captures
    const response = await fetch('iq_0.50MHz.c64');
    const buffer = await response.arrayBuffer();
    const iqData = new Float32Array(buffer);
    stitcher.add_capture(iqData, 500000);
    
    // Get results
    const frequencies = stitcher.get_frequencies();
    const powerDb = stitcher.get_power_db();
    
    // Visualize with your favorite charting library
    plotSpectrum(frequencies, powerDb);
}
```

### 3. Common Use Cases

#### Loading from File Input
```javascript
async function handleFiles(fileList) {
    await init();
    const stitcher = new SpectrumStitcher(262144, 3.2e6, 0.0);
    
    for (const file of fileList) {
        const buffer = await file.arrayBuffer();
        const iqData = new Float32Array(buffer);
        const centerFreq = parseFreqFromFilename(file.name);
        stitcher.add_capture(iqData, centerFreq);
    }
    
    return stitcher;
}
```

#### Loading from URLs
```javascript
async function loadCapturesFromUrls(captures) {
    await init();
    const stitcher = new SpectrumStitcher(262144, 3.2e6, 0.0);
    
    for (const { url, centerFreq } of captures) {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const iqData = new Float32Array(buffer);
        stitcher.add_capture(iqData, centerFreq);
    }
    
    return stitcher;
}
```

#### Visualize with Chart.js
```javascript
import Chart from 'chart.js/auto';

async function visualizeSpectrum(stitcher) {
    const frequencies = stitcher.get_frequencies();
    const powerDb = stitcher.get_power_db();
    
    new Chart(canvas, {
        type: 'line',
        data: {
            labels: frequencies.map(f => (f / 1e6).toFixed(2)),
            datasets: [{
                label: 'Power Spectrum (dB)',
                data: powerDb,
                borderColor: '#0f0',
                borderWidth: 1
            }]
        }
    });
}
```

## Rebuilding After Changes

If you modify the Rust code:

```bash
# Development build
wasm-pack build --target web --dev

# Production build (optimized)
wasm-pack build --target web --release
```

## Troubleshooting

### "Can't find module" error
Make sure you're running a web server. WASM modules require proper MIME types which file:// protocol doesn't provide.

### CORS errors
If loading .c64 files from a different origin, ensure CORS headers are set properly on the server.

### Out of memory
For very large captures or many files, consider:
- Using a smaller FFT size
- Processing captures in batches
- Clearing the stitcher periodically with `stitcher.clear()`

## Performance Tips

- **FFT Size**: 262144 is a good balance. Larger = more frequency resolution but slower
- **Sample Rate**: Match your RTL-SDR settings (typically 3.2 MHz)
- **Batch Processing**: Process captures sequentially to avoid memory spikes
- **Web Workers**: For large datasets, run stitching in a Web Worker to avoid blocking the UI

## Example: Batch Processing

```javascript
async function processBatch(files, batchSize = 5) {
    await init();
    const stitcher = new SpectrumStitcher(262144, 3.2e6, 0.0);
    
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        for (const file of batch) {
            const buffer = await file.arrayBuffer();
            const iqData = new Float32Array(buffer);
            const freq = parseFreqFromFilename(file.name);
            stitcher.add_capture(iqData, freq);
        }
        
        // Optional: yield to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return stitcher;
}
```
