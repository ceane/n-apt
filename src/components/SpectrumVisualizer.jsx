import { useRef, useEffect, useCallback } from 'react';
import styled from 'styled-components';

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

const SpectrumSection = styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`;

const WaterfallSection = styled.div`
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


const SpectrumVisualizer = ({ data, frequencyRange, activeSignalArea, isPaused }) => {
  const spectrumCanvasRef = useRef(null);
  const waterfallCanvasRef = useRef(null);
  const animationRef = useRef(null);
  const dataRef = useRef(data);
  const waterfallDataRef = useRef([]);
  const maxWaterfallRows = 200;
  const spectrumCtxRef = useRef(null);
  const waterfallCtxRef = useRef(null);
  const lastDrawTimeRef = useRef(0);
  const targetFPS = 30; // Limit to 30 FPS for better performance
  const frequencyRangeRef = useRef(frequencyRange);
  const activeSignalAreaRef = useRef(activeSignalArea);
  const isPausedRef = useRef(isPaused);

  // Keep refs updated with latest prop values
  useEffect(() => {
    frequencyRangeRef.current = frequencyRange;
  }, [frequencyRange]);

  useEffect(() => {
    activeSignalAreaRef.current = activeSignalArea;
  }, [activeSignalArea]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Use a ref to track the latest frequencyRange for the drawFrame callback
  const latestFreqRangeRef = useRef(frequencyRange);
  useEffect(() => {
    latestFreqRangeRef.current = frequencyRange;
  }, [frequencyRange]);

  const drawFrame = useCallback(() => {
    if (!spectrumCtxRef.current || !waterfallCtxRef.current) return;

    // Always get the latest values directly from refs to ensure we have current data
    const currentFreqRange = frequencyRangeRef.current;
    const currentData = dataRef.current;

    const spectrumCanvas = spectrumCanvasRef.current;
    const waterfallCanvas = waterfallCanvasRef.current;
    const spectrumCtx = spectrumCtxRef.current;
    const waterfallCtx = waterfallCtxRef.current;

    // Draw spectrum
    const spectrumWidth = spectrumCanvas.width;
    const spectrumHeight = spectrumCanvas.height;

    // Clear spectrum canvas
    spectrumCtx.fillStyle = '#0a0a0a';
    spectrumCtx.fillRect(0, 0, spectrumWidth, spectrumHeight);

    const waveform = currentData?.waveform;

    if (waveform && Array.isArray(waveform) && waveform.length > 0) {

      // SDR++ style colors
      const gridColor = 'rgba(100, 200, 255, 0.1)';
      const lineColor = '#00d4ff';

      // dB range for display
      // Noise floor typically around -50 to -60 dB, signals peak around 0 to +10 dB
      const minDb = -80;
      const maxDb = 20;

      // Helper to convert dB value to Y coordinate
      const dbToY = (db) => {
        const normalized = (db - minDb) / (maxDb - minDb);
        return spectrumHeight - 40 - Math.max(0, Math.min(1, normalized)) * (spectrumHeight - 60);
      };

      // Draw horizontal grid lines
      spectrumCtx.strokeStyle = gridColor;
      spectrumCtx.lineWidth = 1;

      // dB markers (every 20 dB for cleaner display)
      const dbMarkers = [-80, -60, -40, -20, 0, 20];
      // Draw grid lines for all markers
      const dbGridLines = [-80, -60, -40, -20, 0, 20];
      dbGridLines.forEach(db => {
        const y = dbToY(db);
        spectrumCtx.beginPath();
        spectrumCtx.moveTo(40, y);
        spectrumCtx.lineTo(spectrumWidth - 40, y);
        spectrumCtx.stroke();
      });

      // Draw vertical grid lines
      for (let i = 0; i <= 10; i++) {
        const x = 40 + i * (spectrumWidth - 80) / 10;
        spectrumCtx.beginPath();
        spectrumCtx.moveTo(x, 20);
        spectrumCtx.lineTo(x, spectrumHeight - 40);
        spectrumCtx.stroke();
      }

      // Draw spectrum (SDR++ style)
      const len = waveform.length;
      const plotWidth = spectrumWidth - 80;
      const binStep = plotWidth / len;

      // Draw filled area from signal line down to bottom (SDR++ style)
      spectrumCtx.beginPath();
      spectrumCtx.moveTo(40, spectrumHeight - 40);

      for (let i = 0; i < len; i++) {
        const x = 40 + i * binStep;
        const y = dbToY(waveform[i]);
        spectrumCtx.lineTo(x, y);
      }

      spectrumCtx.lineTo(40 + plotWidth, spectrumHeight - 40);
      spectrumCtx.closePath();

      // SDR++ style translucent blue fill
      spectrumCtx.fillStyle = 'rgba(0, 100, 255, 0.3)';
      spectrumCtx.fill();

      // Draw thin line on top (SDR++ style peak line)
      spectrumCtx.beginPath();
      spectrumCtx.strokeStyle = lineColor;
      spectrumCtx.lineWidth = 1.5;
      spectrumCtx.lineJoin = 'round';
      spectrumCtx.lineCap = 'round';

      for (let i = 0; i < len; i++) {
        const x = 40 + i * binStep;
        const y = dbToY(waveform[i]);
        if (i === 0) {
          spectrumCtx.moveTo(x, y);
        } else {
          spectrumCtx.lineTo(x, y);
        }
      }
      spectrumCtx.stroke();

      // Draw dB scale labels (Y-axis)
      spectrumCtx.fillStyle = '#666';
      spectrumCtx.font = '16px JetBrains Mono';
      spectrumCtx.textAlign = 'right';

      dbMarkers.forEach(db => {
        const y = dbToY(db);
        spectrumCtx.fillText(`${db}`, 35, y + 3);
      });

      // Draw frequency labels at bottom (X-axis)
      spectrumCtx.fillStyle = '#666';
      spectrumCtx.font = '16px JetBrains Mono';
      spectrumCtx.textAlign = 'center';

      // Format frequency for display
      const formatFreq = (freq) => {
        if (freq < 1) {
          return `${(freq * 1000).toFixed(0)}kHz`;
        }
        return `${freq.toFixed(2)}MHz`;
      };

      // Use frequencyRange if provided, otherwise default to 0-3.2MHz
      const minFreq = currentFreqRange?.min ?? 0;
      const maxFreq = currentFreqRange?.max ?? 3.2;
      const midFreq = (minFreq + maxFreq) / 2;

      // Draw min and max frequency labels with fade effect (white at 90% brightness)
      spectrumCtx.fillStyle = '#e6e6e6';
      spectrumCtx.font = '16px JetBrains Mono';
      spectrumCtx.textAlign = 'left';
      spectrumCtx.fillText(formatFreq(minFreq), 40, spectrumHeight - 15);

      spectrumCtx.textAlign = 'right';
      spectrumCtx.fillText(formatFreq(maxFreq), spectrumWidth - 40, spectrumHeight - 15);
      
      // Draw center frequency in white (larger font)
      spectrumCtx.fillStyle = '#ffffff';
      spectrumCtx.font = 'bold 28px JetBrains Mono';
      spectrumCtx.textAlign = 'center';
      spectrumCtx.fillText(formatFreq(midFreq), spectrumWidth / 2, spectrumHeight - 8);

      // (No text at the top - removed as requested)
    }

    // Draw waterfall
    const waterfallWidth = waterfallCanvas.width;
    const waterfallHeight = waterfallCanvas.height;

    const waterfallRow = currentData?.waterfall;

    if (waterfallRow && Array.isArray(waterfallRow) && waterfallRow.length > 0 && !isPausedRef.current) {
      // Add new row to the beginning (only when not paused)
      waterfallDataRef.current.unshift(waterfallRow);
      // Keep only max rows
      if (waterfallDataRef.current.length > maxWaterfallRows) {
        waterfallDataRef.current.pop();
      }

      // Create ImageData for faster rendering
      const imgData = waterfallCtx.createImageData(waterfallWidth, waterfallHeight);
      const imgDataArray = imgData.data;

      const rows = waterfallDataRef.current;
      const rowHeight = waterfallHeight / maxWaterfallRows;

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const y = Math.floor(r * rowHeight);
        const nextY = Math.floor((r + 1) * rowHeight);

        for (let yPixel = y; yPixel < nextY && yPixel < waterfallHeight; yPixel++) {
          for (let i = 0; i < row.length; i++) {
            const x = Math.floor((i / row.length) * waterfallWidth);
            const intensity = row[i] / 255;

            // SDR++ style gradient (blue to green to yellow to red)
            let rVal, gVal, bVal;
            if (intensity < 0.33) {
              const t = intensity * 3;
              rVal = 0;
              gVal = Math.floor(t * 255);
              bVal = Math.floor(255 - t * 255);
            } else if (intensity < 0.66) {
              const t = (intensity - 0.33) * 3;
              rVal = Math.floor(t * 255);
              gVal = 255;
              bVal = 0;
            } else {
              const t = (intensity - 0.66) * 3;
              rVal = 255;
              gVal = Math.floor(255 - t * 255);
              bVal = 0;
            }

            // Fill pixels for this column
            for (let xPixel = x; xPixel < x + Math.ceil(waterfallWidth / row.length) && xPixel < waterfallWidth; xPixel++) {
              const index = (yPixel * waterfallWidth + xPixel) * 4;
              imgDataArray[index] = rVal;
              imgDataArray[index + 1] = gVal;
              imgDataArray[index + 2] = bVal;
              imgDataArray[index + 3] = 255;
            }
          }
        }
      }

      waterfallCtx.putImageData(imgData, 0, 0);
    }

  }, []); // No dependencies - we use refs to access latest values

  const startAnimation = useCallback(() => {
    if (animationRef.current) {
      // Already animating, just trigger a redraw to update frequency labels
      drawFrame();
      return;
    }

    const animate = () => {
      // Frame rate limiting
      const now = performance.now();
      const timeSinceLastDraw = now - lastDrawTimeRef.current;
      const targetFrameTime = 1000 / targetFPS;

      if (timeSinceLastDraw >= targetFrameTime) {
        lastDrawTimeRef.current = now;
        drawFrame();
      } else {
        // Still schedule next frame even if we skip drawing
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const currentData = dataRef.current;
      if (currentData && (currentData.waveform || currentData.waterfall)) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [drawFrame, targetFPS]);

  useEffect(() => {
    // Update ref whenever data changes
    dataRef.current = data;

    // Trigger animation when new data arrives
    if (data && (data.waveform || data.waterfall)) {
      startAnimation();
    }
  }, [data, startAnimation]);

  // Separate effect to redraw when frequency range changes
  useEffect(() => {
    // Update the ref first so drawFrame can access the latest value
    latestFreqRangeRef.current = frequencyRange;
    // Redraw the frame to update frequency labels when range changes
    if (spectrumCtxRef.current && waterfallCtxRef.current) {
      drawFrame();
    }
  }, [frequencyRange, drawFrame]);

  useEffect(() => {
    const spectrumCanvas = spectrumCanvasRef.current;
    const waterfallCanvas = waterfallCanvasRef.current;
    if (!spectrumCanvas || !waterfallCanvas) return;

    const spectrumCtx = spectrumCanvas.getContext('2d');
    const waterfallCtx = waterfallCanvas.getContext('2d');
    spectrumCtxRef.current = spectrumCtx;
    waterfallCtxRef.current = waterfallCtx;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvases = () => {
      const spectrumWrapper = spectrumCanvas.parentElement;
      const waterfallWrapper = waterfallCanvas.parentElement;

      spectrumCanvas.width = spectrumWrapper.clientWidth * dpr;
      spectrumCanvas.height = spectrumWrapper.clientHeight * dpr;
      waterfallCanvas.width = waterfallWrapper.clientWidth * dpr;
      waterfallCanvas.height = waterfallWrapper.clientHeight * dpr;
    };

    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    return () => {
      window.removeEventListener('resize', resizeCanvases);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  return (
    <VisualizerContainer>
      <SpectrumSection>
        <SectionTitle>Spectrum</SectionTitle>
        <CanvasWrapper>
          <Canvas ref={spectrumCanvasRef} />
        </CanvasWrapper>
      </SpectrumSection>
      
      <WaterfallSection>
        <SectionTitle>Waterfall</SectionTitle>
        <CanvasWrapper>
          <Canvas ref={waterfallCanvasRef} />
        </CanvasWrapper>
      </WaterfallSection>
    </VisualizerContainer>
  );
};

export default SpectrumVisualizer;
