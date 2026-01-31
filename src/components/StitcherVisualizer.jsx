import { useRef, useEffect, useCallback, useState } from 'react';
import styled from 'styled-components';

// Processing constants (matching backend.py)
const TARGET_BINS = 2048;  // Target number of bins for display
const SMOOTHING_WINDOW = 5;  // Moving average window size

const VisualizerContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0a0a0a;
  position: relative;
  overflow: hidden;
  padding: 20px;
  gap: 20px;
`;

const StitcherSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: '/';
    color: #444;
  }
`;

const CanvasWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
  overflow: hidden;
`;

const Canvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
`;

const ResultsInfo = styled.div`
  background: #1a1a1a;
  padding: 15px;
  border-radius: 4px;
  margin-top: 10px;
  font-size: 14px;
  font-family: 'JetBrains Mono', monospace;
  color: #666;
`;

const StitcherVisualizer = ({ selectedFiles, onStitch }) => {
  const stitchFilesRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const processedDataRef = useRef(null); // Store processed spectrum data for redraw on resize
  const redrawTriggerRef = useRef(0); // Trigger for redrawing after stitching
  const handlerRegisteredRef = useRef(false); // Track if handler has been registered

  const [status, setStatus] = useState('Select files to begin stitching');
  const [processingTime, setProcessingTime] = useState(0);
  const [numPoints, setNumPoints] = useState(0);
  const [freqRange, setFreqRange] = useState('0 - 0 MHz');
  const [showResults, setShowResults] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Register stitch handler with parent
  useEffect(() => {
    if (!onStitch || handlerRegisteredRef.current) {
      console.log('onStitch is not defined or handler already registered, skipping registration');
      return;
    }
    console.log('Registering stitch handler with parent');
    const handler = () => {
      console.log('Stitch callback invoked');
      if (stitchFilesRef.current) {
        stitchFilesRef.current();
      } else {
        console.error('stitchFilesRef.current is null!');
      }
    };
    console.log('Calling onStitch with handler:', typeof handler);
    onStitch(handler);
    console.log('onStitch called successfully');
    handlerRegisteredRef.current = true;
  }, [onStitch]);

  // Initialize WASM module
  useEffect(() => {
    const initWasm = async () => {
      console.log('Starting WASM initialization...');
      try {
        const { default: init } = await import('../sdr_wasm/sdr_wasm.js');
        console.log('WASM module imported successfully');
        await init();
        console.log('WASM initialized successfully');
        setIsInitialized(true);
        setStatus('WASM initialized. Select .c64 files.');
      } catch (error) {
        console.error('WASM initialization error:', error);
        setStatus(`Error initializing WASM: ${error.message}`);
      }
    };

    initWasm();
  }, []);

  // Initialize canvas context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      const wrapper = canvas.parentElement;
      canvas.width = wrapper.clientWidth * dpr;
      canvas.height = wrapper.clientHeight * dpr;
      ctx.scale(dpr, dpr);

      // Redraw the spectrum if we have processed data
      if (processedDataRef.current) {
        redrawTriggerRef.current += 1;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  // Watch for redraw triggers and plot spectrum when data is ready
  useEffect(() => {
    if (processedDataRef.current && ctxRef.current) {
      // Define plotSpectrum function locally (same as in canvas useEffect)
      const plotSpectrum = (frequencies, powerDb) => {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas || frequencies.length === 0) return;

        // Use CSS dimensions since ctx is already scaled by devicePixelRatio
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        // Clear canvas with SDR++ style background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        // Get frequency range for plotting
        let freqMin = frequencies[0];
        let freqMax = frequencies[0];
        for (let i = 1; i < frequencies.length; i++) {
          if (frequencies[i] < freqMin) freqMin = frequencies[i];
          if (frequencies[i] > freqMax) freqMax = frequencies[i];
        }

        // Get power range from actual data
        let dataMinDb = powerDb[0];
        let dataMaxDb = powerDb[0];
        for (let i = 1; i < powerDb.length; i++) {
          if (powerDb[i] < dataMinDb) dataMinDb = powerDb[i];
          if (powerDb[i] > dataMaxDb) dataMaxDb = powerDb[i];
        }

        // Use fixed dB range with floor at -120 dB
        const minDb = -120;
        const maxDb = 20;

        // SDR++ style colors
        const gridColor = 'rgba(100, 200, 255, 0.1)';
        const lineColor = '#00d4ff';

        // Helper to convert dB value to Y coordinate
        const dbToY = (db) => {
          const normalized = (db - minDb) / (maxDb - minDb);
          return height - 40 - Math.max(0, Math.min(1, normalized)) * (height - 60);
        };

        // Draw horizontal grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        // dB markers (every 20 dB from -120 to 20)
        const dbMarkers = [-120, -100, -80, -60, -40, -20, 0, 20];

        dbMarkers.forEach(db => {
          const y = dbToY(db);
          ctx.beginPath();
          ctx.moveTo(40, y);
          ctx.lineTo(width - 40, y);
          ctx.stroke();
        });

        // Draw vertical grid lines
        for (let i = 0; i <= 10; i++) {
          const x = 40 + i * (width - 80) / 10;
          ctx.beginPath();
          ctx.moveTo(x, 20);
          ctx.lineTo(x, height - 40);
          ctx.stroke();
        }

        // Draw spectrum (SDR++ style)
        const len = frequencies.length;
        const plotWidth = width - 80;

        // Draw filled area from signal line down to bottom of canvas (SDR++ style)
        ctx.beginPath();
        ctx.moveTo(40, height); // Start at actual bottom of canvas

        for (let i = 0; i < len; i++) {
          const x = 40 + ((frequencies[i] - freqMin) / (freqMax - freqMin)) * plotWidth;
          const y = dbToY(powerDb[i]);
          ctx.lineTo(x, y);
        }

        ctx.lineTo(40 + plotWidth, height); // End at actual bottom of canvas
        ctx.closePath();

        // SDR++ style translucent blue fill
        ctx.fillStyle = 'rgba(0, 100, 255, 0.3)';
        ctx.fill();

        // Draw thin line on top (SDR++ style peak line)
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (let i = 0; i < len; i++) {
          const x = 40 + ((frequencies[i] - freqMin) / (freqMax - freqMin)) * plotWidth;
          const y = dbToY(powerDb[i]);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        // Draw dB scale labels (Y-axis)
        ctx.fillStyle = '#666';
        ctx.font = '16px JetBrains Mono';
        ctx.textAlign = 'right';

        dbMarkers.forEach(db => {
          const y = dbToY(db);
          ctx.fillText(`${db}`, 35, y + 3);
        });

        // Draw frequency labels at bottom (X-axis)
        // Format frequency for display
        const formatFreq = (freq) => {
          const freqMHz = freq / 1e6;
          // Use kHz for frequencies less than 1 MHz (absolute value)
          if (Math.abs(freqMHz) < 1) {
            return `${(freqMHz * 1000).toFixed(0)}kHz`;
          }
          return `${freqMHz.toFixed(2)}MHz`;
        };

        const midFreq = (freqMin + freqMax) / 2;

        // Draw min and max frequency labels
        ctx.fillStyle = '#e6e6e6';
        ctx.font = '16px JetBrains Mono';
        ctx.textAlign = 'left';
        ctx.fillText(formatFreq(freqMin), 40, height - 15);

        ctx.textAlign = 'right';
        ctx.fillText(formatFreq(freqMax), width - 40, height - 15);

        // Draw center frequency in white (larger font)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(formatFreq(midFreq), width / 2, height - 8);
      };

      plotSpectrum(processedDataRef.current.frequencies, processedDataRef.current.powerDb);
    }
  }, [redrawTriggerRef.current]); // Watch for changes to trigger value

  // Parse frequency from filename (e.g., "iq_3.70MHz.c64" or "iq_500kHz.c64")
  const parseFrequency = useCallback((filename) => {
    const match = filename.match(/iq_(\d+\.?\d*)([kM]Hz)/);
    if (!match) return null;
    
    const value = parseFloat(match[1]);
    const unit = match[2];
    
    return unit === 'MHz' ? value * 1e6 : value * 1e3;
  }, []);

  // Bin/decimate data to target number of bins (like backend resampling)
  const binData = useCallback((frequencies, powerDb, targetBins) => {
    const len = frequencies.length;
    if (len <= targetBins) {
      return { frequencies, powerDb };
    }

    const binSize = Math.ceil(len / targetBins);
    const binnedFreqs = new Float64Array(targetBins);
    const binnedPower = new Float32Array(targetBins);

    for (let i = 0; i < targetBins; i++) {
      const startIdx = i * binSize;
      const endIdx = Math.min(startIdx + binSize, len);
      
      // Average frequencies and power within each bin
      let freqSum = 0;
      let powerSum = 0;
      let count = 0;
      
      for (let j = startIdx; j < endIdx; j++) {
        freqSum += frequencies[j];
        // Convert from dB to linear for proper averaging, then back to dB
        powerSum += Math.pow(10, powerDb[j] / 10);
        count++;
      }
      
      binnedFreqs[i] = freqSum / count;
      binnedPower[i] = 10 * Math.log10(powerSum / count);
    }

    return { frequencies: binnedFreqs, powerDb: binnedPower };
  }, []);

  // Apply moving average smoothing (reduces noise like FFT averaging)
  const smoothData = useCallback((powerDb, windowSize) => {
    const len = powerDb.length;
    const smoothed = new Float32Array(len);
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 0; i < len; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - halfWindow); j <= Math.min(len - 1, i + halfWindow); j++) {
        // Use linear power for averaging
        sum += Math.pow(10, powerDb[j] / 10);
        count++;
      }
      
      smoothed[i] = 10 * Math.log10(sum / count);
    }

    return smoothed;
  }, []);

  // Process spectrum data (binning + smoothing)
  const processSpectrum = useCallback((frequencies, powerDb) => {
    // Step 1: Bin/decimate to target number of bins
    const binned = binData(frequencies, powerDb, TARGET_BINS);
    
    // Step 2: Apply smoothing
    const smoothedPower = smoothData(binned.powerDb, SMOOTHING_WINDOW);
    
    return { frequencies: binned.frequencies, powerDb: smoothedPower };
  }, [binData, smoothData]);

  // Plot spectrum (SDR++ style matching SpectrumVisualizer)
  const _plotSpectrum = useCallback((frequencies, powerDb) => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || frequencies.length === 0) return;

    // Use CSS dimensions since ctx is already scaled by devicePixelRatio
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Clear canvas with SDR++ style background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Get frequency range for plotting
    let freqMin = frequencies[0];
    let freqMax = frequencies[0];
    for (let i = 1; i < frequencies.length; i++) {
      if (frequencies[i] < freqMin) freqMin = frequencies[i];
      if (frequencies[i] > freqMax) freqMax = frequencies[i];
    }

    // Get power range from actual data
    let dataMinDb = powerDb[0];
    let dataMaxDb = powerDb[0];
    for (let i = 1; i < powerDb.length; i++) {
      if (powerDb[i] < dataMinDb) dataMinDb = powerDb[i];
      if (powerDb[i] > dataMaxDb) dataMaxDb = powerDb[i];
    }

    // Use fixed dB range with floor at -120 dB
    const minDb = -120;
    const maxDb = 20;

    // SDR++ style colors
    const gridColor = 'rgba(100, 200, 255, 0.1)';
    const lineColor = '#00d4ff';

    // Helper to convert dB value to Y coordinate
    const dbToY = (db) => {
      const normalized = (db - minDb) / (maxDb - minDb);
      return height - 40 - Math.max(0, Math.min(1, normalized)) * (height - 60);
    };

    // Draw horizontal grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    // dB markers (every 20 dB from -120 to 20)
    const dbMarkers = [-120, -100, -80, -60, -40, -20, 0, 20];

    dbMarkers.forEach(db => {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(width - 40, y);
      ctx.stroke();
    });

    // Draw vertical grid lines
    for (let i = 0; i <= 10; i++) {
      const x = 40 + i * (width - 80) / 10;
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, height - 40);
      ctx.stroke();
    }

    // Draw spectrum (SDR++ style)
    const len = frequencies.length;
    const plotWidth = width - 80;

    // Draw filled area from signal line down to bottom of canvas (SDR++ style)
    ctx.beginPath();
    ctx.moveTo(40, height); // Start at actual bottom of canvas

    for (let i = 0; i < len; i++) {
      const x = 40 + ((frequencies[i] - freqMin) / (freqMax - freqMin)) * plotWidth;
      const y = dbToY(powerDb[i]);
      ctx.lineTo(x, y);
    }

    ctx.lineTo(40 + plotWidth, height); // End at actual bottom of canvas
    ctx.closePath();

    // SDR++ style translucent blue fill
    ctx.fillStyle = 'rgba(0, 100, 255, 0.3)';
    ctx.fill();

    // Draw thin line on top (SDR++ style peak line)
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < len; i++) {
      const x = 40 + ((frequencies[i] - freqMin) / (freqMax - freqMin)) * plotWidth;
      const y = dbToY(powerDb[i]);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw dB scale labels (Y-axis)
    ctx.fillStyle = '#666';
    ctx.font = '16px JetBrains Mono';
    ctx.textAlign = 'right';

    dbMarkers.forEach(db => {
      const y = dbToY(db);
      ctx.fillText(`${db}`, 35, y + 3);
    });

    // Draw frequency labels at bottom (X-axis)
    // Format frequency for display
    const formatFreq = (freq) => {
      const freqMHz = freq / 1e6;
      // Use kHz for frequencies less than 1 MHz (absolute value)
      if (Math.abs(freqMHz) < 1) {
        return `${(freqMHz * 1000).toFixed(0)}kHz`;
      }
      return `${freqMHz.toFixed(2)}MHz`;
    };

    const midFreq = (freqMin + freqMax) / 2;

    // Draw min and max frequency labels
    ctx.fillStyle = '#e6e6e6';
    ctx.font = '16px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText(formatFreq(freqMin), 40, height - 15);

    ctx.textAlign = 'right';
    ctx.fillText(formatFreq(freqMax), width - 40, height - 15);
    
    // Draw center frequency in white (larger font)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(formatFreq(midFreq), width / 2, height - 8);
  }, []);

  // Stitch files
  const _stitchFiles = useCallback(async () => {
    console.log('Stitch files called with selectedFiles:', selectedFiles);
    console.log('Number of selected files:', selectedFiles.length);
    
    if (!isInitialized) {
      console.log('WASM not initialized yet');
      setStatus('WASM not initialized yet...');
      return;
    }

    if (selectedFiles.length === 0) {
      console.log('No files selected');
      setStatus('No files selected');
      return;
    }

    // Check if we have valid file objects
    const validFiles = selectedFiles.filter(file => file && file.name);
    if (validFiles.length === 0) {
      console.log('No valid files selected');
      setStatus('No valid files selected');
      return;
    }

    console.log('Valid files to process:', validFiles.map(f => f.name));

    setStatus('Processing...');
    const startTime = performance.now();

    try {
      const { SpectrumStitcher } = await import('../sdr_wasm/sdr_wasm.js');
      const newStitcher = new SpectrumStitcher(262144, 3.2e6, -100);
      
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const centerFreq = parseFrequency(file.name);
        
        if (!centerFreq) {
          console.warn(`Skipping ${file.name} - couldn't parse frequency`);
          continue;
        }

        setStatus(`Processing ${i + 1}/${selectedFiles.length}: ${file.name}...`);
        
        const arrayBuffer = await file.arrayBuffer();
        console.log('File arrayBuffer length:', arrayBuffer.byteLength);
        
        // Ensure data length is a multiple of 4 (Float32)
        const validLength = Math.floor(arrayBuffer.byteLength / 4) * 4;
        const validData = arrayBuffer.slice(0, validLength);
        
        if (validData.byteLength !== arrayBuffer.byteLength) {
          console.warn('Truncating file data - original length not a multiple of 4');
        }
        
        const iqData = new Float32Array(validData);
        
        newStitcher.add_capture(iqData, centerFreq);
      }

      const elapsedTime = (performance.now() - startTime).toFixed(2);

      // Get raw results from WASM
      const rawFrequencies = newStitcher.get_frequencies();
      const rawPowerDb = newStitcher.get_power_db();
      const [minFreq, maxFreq] = newStitcher.get_frequency_range();

      console.log(`Raw data: ${rawFrequencies.length} points`);

      // Process the spectrum (binning + smoothing) like the backend does
      const processed = processSpectrum(rawFrequencies, rawPowerDb);
      
      console.log(`Processed data: ${processed.frequencies.length} points`);

      // Store processed data for redraw on resize
      processedDataRef.current = processed;

      // Update info
      setNumPoints(processed.frequencies.length);
      setFreqRange(`${(minFreq / 1e6).toFixed(2)} - ${(maxFreq / 1e6).toFixed(2)} MHz`);
      setProcessingTime(elapsedTime);
      setShowResults(true);

      // Trigger a redraw of the spectrum
      redrawTriggerRef.current += 1;

      setStatus(`✓ Stitching complete! Processed ${selectedFiles.length} captures in ${elapsedTime} ms`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      console.error('Stitching error:', error);
    }
  }, [selectedFiles, isInitialized, parseFrequency, processSpectrum]);

  // Store stitchFiles in ref immediately after definition
  stitchFilesRef.current = _stitchFiles;

  return (
    <VisualizerContainer data-stitcher-visualizer>
      <StitcherSection>
        <SectionTitle>Stitcher Visualizer</SectionTitle>
        <CanvasWrapper style={{ position: 'relative' }}>
          <div style={{ 
            position: 'absolute', 
            top: '10px', 
            right: '20px', 
            color: isInitialized ? '#0f0' : '#f00',
            fontFamily: 'JetBrains Mono',
            fontSize: '12px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: '8px 12px',
            borderRadius: '4px',
            zIndex: 10
          }}>
            {status}
          </div>
          <Canvas ref={canvasRef} />
        </CanvasWrapper>
        <ResultsInfo style={{ display: showResults ? 'block' : 'none' }}>
          <div>Frequency Points: {numPoints.toLocaleString()}</div>
          <div>Frequency Range: {freqRange}</div>
          <div>Processing Time: {processingTime} ms</div>
        </ResultsInfo>
      </StitcherSection>
    </VisualizerContainer>
  );
};

export default StitcherVisualizer;
