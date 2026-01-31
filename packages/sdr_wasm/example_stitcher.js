// Example usage of the SpectrumStitcher WASM module
import init, { SpectrumStitcher } from './pkg/sdr_wasm.js';

async function stitchSpectrumExample() {
    // Initialize WASM
    await init();

    // Create a stitcher
    const fftSize = 262144;  // Match Python's fft_size
    const sampleRate = 3.2e6;  // 3.2 MHz
    const stitcher = new SpectrumStitcher(fftSize, sampleRate);

    // Example: Read multiple .c64 files
    const captures = [
        { file: 'iq_0.50MHz.c64', centerFreq: 500000 },
        { file: 'iq_3.70MHz.c64', centerFreq: 3700000 },
        { file: 'iq_6.90MHz.c64', centerFreq: 6900000 },
        // ... more captures
    ];

    for (const capture of captures) {
        try {
            // Fetch the .c64 file
            const response = await fetch(capture.file);
            const arrayBuffer = await response.arrayBuffer();
            
            // .c64 format is complex64 (pairs of float32: I, Q, I, Q, ...)
            const iqData = new Float32Array(arrayBuffer);
            
            console.log(`Processing ${capture.file} at ${capture.centerFreq / 1e6} MHz`);
            
            // Add this capture to the stitcher
            stitcher.add_capture(iqData, capture.centerFreq);
        } catch (error) {
            console.error(`Error loading ${capture.file}:`, error);
        }
    }

    console.log(`Stitched ${stitcher.len()} frequency points`);

    // Get the results
    const frequencies = stitcher.get_frequencies();
    const powerDb = stitcher.get_power_db();

    const [minFreq, maxFreq] = stitcher.get_frequency_range();
    console.log(`Frequency range: ${minFreq / 1e6} - ${maxFreq / 1e6} MHz`);

    // Now you can visualize with Canvas, D3, etc.
    plotSpectrum(frequencies, powerDb);

    return { frequencies, powerDb };
}

// Example: Plot spectrum using Canvas
function plotSpectrum(frequencies, powerDb) {
    const canvas = document.getElementById('spectrum-canvas');
    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    if (frequencies.length === 0) return;

    // Find min/max for scaling
    const freqMin = Math.min(...frequencies);
    const freqMax = Math.max(...frequencies);
    const powerMin = Math.min(...powerDb);
    const powerMax = Math.max(...powerDb);

    // Draw spectrum
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < frequencies.length; i++) {
        const x = ((frequencies[i] - freqMin) / (freqMax - freqMin)) * width;
        const y = height - ((powerDb[i] - powerMin) / (powerMax - powerMin)) * height;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();

    // Draw frequency labels
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(`${(freqMin / 1e6).toFixed(2)} MHz`, 10, height - 10);
    ctx.fillText(`${(freqMax / 1e6).toFixed(2)} MHz`, width - 100, height - 10);
}

// Example: Load captures from a directory structure
async function loadCaptureDirectory(baseUrl) {
    // This assumes your server can list files or you have a manifest
    // For example, if you have a captures.json with file listings:
    const response = await fetch(`${baseUrl}/captures.json`);
    const manifest = await response.json();
    
    return manifest.captures.map(c => ({
        file: `${baseUrl}/${c.filename}`,
        centerFreq: c.center_freq
    }));
}

// Example with File API (for local file uploads)
async function stitchFromFileInput(fileInputElement) {
    await init();
    
    const fftSize = 262144;
    const sampleRate = 3.2e6;
    const stitcher = new SpectrumStitcher(fftSize, sampleRate);
    
    const files = Array.from(fileInputElement.files);
    
    for (const file of files) {
        // Extract center frequency from filename (e.g., "iq_3.70MHz.c64")
        const match = file.name.match(/iq_(\d+\.?\d*)([kM]Hz)/);
        if (!match) {
            console.warn(`Skipping ${file.name} - couldn't parse frequency`);
            continue;
        }
        
        const freqValue = parseFloat(match[1]);
        const unit = match[2];
        const centerFreq = unit === 'MHz' ? freqValue * 1e6 : freqValue * 1e3;
        
        const arrayBuffer = await file.arrayBuffer();
        const iqData = new Float32Array(arrayBuffer);
        
        stitcher.add_capture(iqData, centerFreq);
        console.log(`Added ${file.name} at ${centerFreq / 1e6} MHz`);
    }
    
    return stitcher;
}

// Example HTML usage:
/*
<!DOCTYPE html>
<html>
<head>
    <title>SDR Spectrum Stitcher</title>
    <style>
        body { background: #222; color: #fff; font-family: monospace; }
        canvas { border: 1px solid #555; margin: 20px; }
    </style>
</head>
<body>
    <h1>SDR Spectrum Stitcher</h1>
    <input type="file" id="file-input" multiple accept=".c64" />
    <button id="stitch-btn">Stitch & Display</button>
    <br>
    <canvas id="spectrum-canvas" width="1200" height="400"></canvas>
    
    <script type="module">
        import init, { SpectrumStitcher } from './pkg/sdr_wasm.js';
        
        document.getElementById('stitch-btn').addEventListener('click', async () => {
            const fileInput = document.getElementById('file-input');
            await init();
            
            const stitcher = await stitchFromFileInput(fileInput);
            const frequencies = stitcher.get_frequencies();
            const powerDb = stitcher.get_power_db();
            
            plotSpectrum(frequencies, powerDb);
        });
    </script>
</body>
</html>
*/

export { stitchSpectrumExample, plotSpectrum, loadCaptureDirectory, stitchFromFileInput };
