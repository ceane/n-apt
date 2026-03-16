import { useCallback, useRef, useEffect, useState } from "react";

// Types for mathematical operations
export interface SpectrumMathOptions {
  fftSize: number;
  enableSimd: boolean;
  fallbackToScalar: boolean;
}

export interface ZoomMathParams {
  fullWaveform: Float32Array;
  fullRange: { min: number; max: number };
  zoom: number;
  panOffset: number;
}

export interface CoordinateTransformParams {
  spectrumData: number[];
  canvasWidth: number;
  canvasHeight: number;
  fftArea: { x: number; y: number };
  dbRange: { min: number; max: number };
}

export interface DragMathParams {
  deltaX: number;
  canvasWidth: number;
  fullRange: { min: number; max: number };
  zoom: number;
  dragStartFreq: number;
  dragStartPan: number;
}

export interface SpikeDetectionParams {
  spectrumData: Float32Array;
  dbMin: number;
  dbMax: number;
  maxMarkers?: number;
  frequencyRange?: { min: number; max: number };
  temporalPersistence?: Float32Array;
}

export interface SpectrumSpikeMarker {
  index: number;
  value: number;
  prominence: number;
  radius: number;
}

export interface WasmSimdMathHandle {
  // WASM SIMD operations
  resampleSpectrum: (input: Float32Array, output: Float32Array) => void;
  processIqToDbmSpectrum: (input: Uint8Array, offsetDb: number, fftSize?: number) => Float32Array;
  shiftWaterfallBuffer: (buffer: Uint8ClampedArray, width: number, height: number) => void;
  applyColorMapping: (amplitudes: Float32Array, output: Uint8ClampedArray, intensity: number) => void;
  
  // Mathematical preprocessing
  getZoomedData: (params: ZoomMathParams) => { 
    slicedWaveform: Float32Array; 
    visualRange: { min: number; max: number }; 
    clampedPan: number; 
  };
  
  transformToScreenCoords: (params: CoordinateTransformParams) => Array<{x: number, y: number}>;
  
  calculateFrequencyDrag: (params: DragMathParams) => { 
    freqChange: number; 
    newPan?: number; 
    newRange?: { min: number; max: number }; 
  };
  detectProminentSpikes: (params: SpikeDetectionParams) => SpectrumSpikeMarker[];
  
  // Enhanced resampling
  resampleSpectrumEnhanced: (input: Float32Array, output: Float32Array, algorithm?: 'max' | 'avg' | 'min') => void;
  
  // Performance and availability
  isSimdAvailable: boolean;
  isWasmLoaded: boolean;
};

export function useWasmSimdMath(options: SpectrumMathOptions): WasmSimdMathHandle {
  const { fftSize, enableSimd, fallbackToScalar } = options;
  
  // WASM module state
  const [isWasmLoaded, setIsWasmLoaded] = useState(false);
  const [isSimdAvailable, setIsSimdAvailable] = useState(false);
  
  // WASM processor references
  const renderingProcessorRef = useRef<any>(null);
  const simdProcessorRef = useRef<any>(null);
  
  // Initialize WASM SIMD module
  useEffect(() => {
    const initWasm = async () => {
      try {
        const wasmModule = await import("n_apt_canvas");
        const { default: initWasm, test_wasm_simd_availability } = wasmModule;
        
        // Initialize the WASM module
        await initWasm();
        
        // Test SIMD availability
        if (test_wasm_simd_availability && enableSimd) {
          const simdAvailable = test_wasm_simd_availability();
          setIsSimdAvailable(simdAvailable);
          
          if (simdAvailable) {
            // Initialize RenderingProcessor
            try {
              const { RenderingProcessor, WASMSIMDProcessor } = await import("n_apt_canvas");
              renderingProcessorRef.current = new RenderingProcessor();
              simdProcessorRef.current = new WASMSIMDProcessor(fftSize);
            } catch (e) {
              console.warn("RenderingProcessor not available, using fallbacks");
            }
          }
        }
        
        setIsWasmLoaded(true);
      } catch (error) {
        console.error("Failed to load WASM SIMD module:", error);
        if (fallbackToScalar) {
          setIsWasmLoaded(true); // Allow scalar fallback
        }
      }
    };
    
    initWasm();
  }, [fftSize, enableSimd, fallbackToScalar]);
  
  // WASM SIMD operations
  const resampleSpectrum = useCallback((input: Float32Array, output: Float32Array) => {
    if (renderingProcessorRef.current && isSimdAvailable) {
      // Use WASM SIMD for resampling
      renderingProcessorRef.current.resample_spectrum(input, output, output.length);
    } else {
      // Scalar fallback with max-pooling
      const srcLen = input.length;
      const outLen = output.length;
      
      for (let x = 0; x < outLen; x++) {
        const start = Math.floor((x * srcLen) / outLen);
        const end = Math.max(start + 1, Math.floor(((x + 1) * srcLen) / outLen));
        let maxVal = -Infinity;
        
        for (let i = start; i < end && i < srcLen; i++) {
          const v = input[i];
          if (Number.isFinite(v) && v > maxVal) {
            maxVal = v;
          }
        }
        
        output[x] = maxVal !== -Infinity ? maxVal : (input[Math.min(start, srcLen - 1)] ?? -150);
      }
    }
  }, [isSimdAvailable]);

  const processIqToDbmSpectrum = useCallback((input: Uint8Array, offsetDb: number, overrideFftSize?: number) => {
    if (simdProcessorRef.current && isSimdAvailable) {
      if (
        typeof overrideFftSize === "number" &&
        Number.isFinite(overrideFftSize) &&
        simdProcessorRef.current.fft_size &&
        simdProcessorRef.current.fft_size() !== overrideFftSize
      ) {
        try {
          const ctor = simdProcessorRef.current.constructor;
          simdProcessorRef.current = new ctor(overrideFftSize);
        } catch (error) {
          console.warn("Failed to recreate WASM SIMD processor for FFT size:", error);
        }
      }

      try {
        return new Float32Array(simdProcessorRef.current.process_iq_to_dbm_spectrum(input, offsetDb));
      } catch (error) {
        console.warn("WASM SIMD I/Q dBm fallback failed, using scalar path:", error);
      }
    }

    // FFT Fallback with correct normalization
    const numSamples = Math.max(
      1,
      Math.min(overrideFftSize ?? fftSize, Math.floor(input.length / 2)),
    );
    const real = new Float32Array(numSamples);
    const imag = new Float32Array(numSamples);
    let windowSum = 0;

    for (let i = 0; i < numSamples; i++) {
        const t = i / (numSamples - 1);
        const windowVal = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
        real[i] = ((input[i * 2] - 128) / 128) * windowVal;
        imag[i] = ((input[i * 2 + 1] - 128) / 128) * windowVal;
        windowSum += windowVal;
    }

    // Pad to power of 2 for this simple CT implementation to avoid NaN
    const fftLen = Math.pow(2, Math.ceil(Math.log2(numSamples)));
    const paddedReal = new Float32Array(fftLen);
    const paddedImag = new Float32Array(fftLen);
    paddedReal.set(real);
    paddedImag.set(imag);

    const bits = Math.log2(fftLen);
    const bitReverse = (x: number, b: number) => {
        let y = 0;
        for (let i = 0; i < b; i++) {
            y = (y << 1) | (x & 1);
            x >>= 1;
        }
        return y;
    };

    for (let i = 0; i < fftLen; i++) {
        const j = bitReverse(i, bits);
        if (j > i) {
            [paddedReal[i], paddedReal[j]] = [paddedReal[j], paddedReal[i]];
            [paddedImag[i], paddedImag[j]] = [paddedImag[j], paddedImag[i]];
        }
    }

    for (let s = 1; s <= bits; s++) {
        const m = 1 << s;
        const halfM = m >> 1;
        const wAngle = (-2 * Math.PI) / m;
        const wStepReal = Math.cos(wAngle);
        const wStepImag = Math.sin(wAngle);

        for (let k = 0; k < fftLen; k += m) {
            let wReal = 1;
            let wImag = 0;
            for (let j = 0; j < halfM; j++) {
                const uReal = paddedReal[k + j];
                const uImag = paddedImag[k + j];
                const vr = paddedReal[k + j + halfM] * wReal - paddedImag[k + j + halfM] * wImag;
                const vi = paddedReal[k + j + halfM] * wImag + paddedImag[k + j + halfM] * wReal;
                paddedReal[k + j] = uReal + vr;
                paddedImag[k + j] = uImag + vi;
                paddedReal[k + j + halfM] = uReal - vr;
                paddedImag[k + j + halfM] = uImag - vi;
                const nextWReal = wReal * wStepReal - wImag * wStepImag;
                wImag = wReal * wStepImag + wImag * wStepReal;
                wReal = nextWReal;
            }
        }
    }

    const normSq = windowSum * windowSum;
    const output = new Float32Array(fftLen);
    for (let i = 0; i < fftLen; i++) {
        const magSq = (paddedReal[i] * paddedReal[i] + paddedImag[i] * paddedImag[i]) / normSq;
        output[i] = 10 * Math.log10(magSq + 1e-15) + offsetDb;
    }

    const half = fftLen / 2;
    const shifted = new Float32Array(fftLen);
    for (let i = 0; i < fftLen; i++) {
        shifted[(i + half) % fftLen] = output[i];
    }

    return shifted;
  }, [fftSize, isSimdAvailable]);

  const shiftWaterfallBuffer = useCallback((buffer: Uint8ClampedArray, width: number, height: number) => {
    if (renderingProcessorRef.current && isSimdAvailable) {
      // Use WASM SIMD for buffer shifting
      renderingProcessorRef.current.shift_waterfall_buffer(buffer, width, height);
    } else {
      // Scalar fallback
      const rowSize = width * 4; // RGBA
      
      // Shift all rows up by one (copy from bottom to top to avoid overlap)
      for (let y = 0; y < height - 1; y++) {
        const srcOffset = (y + 1) * rowSize;
        const dstOffset = y * rowSize;
        
        for (let x = 0; x < rowSize; x++) {
          buffer[dstOffset + x] = buffer[srcOffset + x];
        }
      }
      
      // Clear the bottom row
      const bottomRowOffset = (height - 1) * rowSize;
      for (let x = 0; x < rowSize; x++) {
        buffer[bottomRowOffset + x] = 0;
      }
    }
  }, [isSimdAvailable]);
  
  const applyColorMapping = useCallback((amplitudes: Float32Array, output: Uint8ClampedArray, intensity: number) => {
    if (renderingProcessorRef.current && isSimdAvailable) {
      // Use WASM SIMD for color mapping
      renderingProcessorRef.current.apply_color_mapping(amplitudes, output, intensity);
    } else {
      // Scalar fallback
      for (let i = 0; i < amplitudes.length; i++) {
        const amp = amplitudes[i];
        const normalized = Math.max(0, Math.min(1, amp));
        
        // Simple color mapping: blue -> green -> red
        let r, g, b;
        if (normalized < 0.5) {
          // Blue to Green
          const t = normalized * 2;
          r = 0;
          g = Math.floor(255 * t);
          b = Math.floor(255 * (1 - t));
        } else {
          // Green to Red
          const t = (normalized - 0.5) * 2;
          r = Math.floor(255 * t);
          g = Math.floor(255 * (1 - t));
          b = 0;
        }
        
        const idx = i * 4;
        output[idx] = r;
        output[idx + 1] = g;
        output[idx + 2] = b;
        output[idx + 3] = 255; // Alpha
      }
    }
  }, [isSimdAvailable]);
  
  // Mathematical preprocessing functions
  const getZoomedData = useCallback((params: ZoomMathParams) => {
    const { fullWaveform, fullRange, zoom, panOffset } = params;
    
    if (renderingProcessorRef.current && isSimdAvailable) {
      const result = renderingProcessorRef.current.get_zoomed_data(
        fullWaveform,
        fullRange.min,
        fullRange.max,
        zoom,
        panOffset,
      );
      
      return {
        slicedWaveform: new Float32Array(result.slicedWaveform),
        visualRange: { 
          min: result.visualRange[0], 
          max: result.visualRange[1] 
        },
        clampedPan: result.clampedPan,
      };
    } else {
      // Scalar fallback implementation
      if (zoom === 1) {
        return {
          slicedWaveform: fullWaveform,
          visualRange: fullRange,
          clampedPan: 0,
        };
      }

      const totalBins = fullWaveform.length;
      const visibleBins = Math.max(1, Math.floor(totalBins / zoom));
      const fullSpan = fullRange.max - fullRange.min;
      const halfSpan = fullSpan / (2 * zoom);
      
      // Calculate max allowed pan
      const maxPan = fullSpan / 2 - halfSpan;
      let clampedPan = panOffset;
      if (maxPan >= 0) {
        clampedPan = Math.max(-maxPan, Math.min(maxPan, panOffset));
      } else {
        const outPan = -maxPan;
        clampedPan = Math.max(-outPan, Math.min(outPan, panOffset));
      }
      
      const centerFreq = (fullRange.min + fullRange.max) / 2;
      const visualCenter = centerFreq + clampedPan;
      const visualCenterBin = Math.round(((visualCenter - fullRange.min) / fullSpan) * totalBins);
      
      let startBin = Math.round(visualCenterBin - visibleBins / 2);
      const visualRange = {
        min: visualCenter - halfSpan,
        max: visualCenter + halfSpan,
      };
      
      if (zoom < 1) {
        const paddedWaveform = new Float32Array(visibleBins).fill(-150);
        const destOffset = Math.max(0, -startBin);
        const dataToCopy = Math.min(totalBins, visibleBins - destOffset);
        const srcOffset = Math.max(0, startBin);
        
        if (dataToCopy > 0) {
          paddedWaveform.set(fullWaveform.subarray(srcOffset, srcOffset + dataToCopy), destOffset);
        }
        return { slicedWaveform: paddedWaveform, visualRange, clampedPan };
      }
      
      // Clamp startBin for zoom > 1
      startBin = Math.max(0, Math.min(totalBins - visibleBins, startBin));
      
      const slicedWaveform = fullWaveform.subarray(startBin, startBin + visibleBins);
      return { slicedWaveform, visualRange, clampedPan };
    }
  }, [isSimdAvailable]);

  const transformToScreenCoords = useCallback((params: CoordinateTransformParams) => {
    const { spectrumData, canvasWidth, canvasHeight, fftArea, dbRange } = params;
    
    if (renderingProcessorRef.current && isSimdAvailable) {
      const coords = renderingProcessorRef.current.transform_to_screen_coords(
        new Float32Array(spectrumData),
        canvasWidth,
        canvasHeight,
        fftArea.x,
        fftArea.y,
        dbRange.min,
        dbRange.max,
      );
      
      // Convert interleaved coordinates to array of {x, y} objects
      const result: Array<{x: number, y: number}> = [];
      for (let i = 0; i < coords.length; i += 2) {
        result.push({ x: coords[i], y: coords[i + 1] });
      }
      return result;
    } else {
      // Scalar fallback
      const dataWidth = spectrumData.length;
      if (dataWidth <= 1) return [];
      
      const fftAreaMax = { x: canvasWidth - 40, y: canvasHeight - 40 };
      const fftHeight = fftAreaMax.y - fftArea.y;
      const plotWidth = fftAreaMax.x - fftArea.x;
      const vertRange = dbRange.max - dbRange.min;
      const scaleFactor = fftHeight / vertRange;
      
      const result: Array<{x: number, y: number}> = [];
      
      for (let i = 0; i < dataWidth; i++) {
        const x = Math.round(fftArea.x + (i / (dataWidth - 1)) * plotWidth);
        const y = Math.round(
          Math.max(
            fftArea.y + 1,
            Math.min(
              fftAreaMax.y,
              fftAreaMax.y - (spectrumData[i] - dbRange.min) * scaleFactor,
            ),
          ),
        );
        result.push({ x, y });
      }
      
      return result;
    }
  }, [isSimdAvailable]);

  const calculateFrequencyDrag = useCallback((params: DragMathParams) => {
    const { deltaX, canvasWidth, fullRange, zoom, dragStartFreq, dragStartPan } = params;
    
    if (renderingProcessorRef.current && isSimdAvailable) {
      // For now, use scalar implementation - can be enhanced later
      const visualRange = fullRange.max - fullRange.min / zoom;
      const freqChange = (deltaX / canvasWidth) * visualRange;
      
      if (zoom > 1) {
        // Visual panning mode
        const maxPan = fullRange.max / 2 - visualRange / 2;
        let newPan = dragStartPan - freqChange;
        newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
        
        return { freqChange, newPan };
      } else {
        // Hardware retune mode
        const newMinFreq = dragStartFreq - freqChange;
        const rangeWidth = fullRange.max - fullRange.min;
        const newMaxFreq = newMinFreq + rangeWidth;
        
        return { 
          freqChange, 
          newRange: { min: newMinFreq, max: newMaxFreq } 
        };
      }
    } else {
      // Scalar fallback
      const visualRange = fullRange.max - fullRange.min / zoom;
      const freqChange = (deltaX / canvasWidth) * visualRange;
      
      if (zoom > 1) {
        const maxPan = fullRange.max / 2 - visualRange / 2;
        let newPan = dragStartPan - freqChange;
        newPan = Math.max(-maxPan, Math.min(maxPan, newPan));
        
        return { freqChange, newPan };
      } else {
        const newMinFreq = dragStartFreq - freqChange;
        const rangeWidth = fullRange.max - fullRange.min;
        const newMaxFreq = newMinFreq + rangeWidth;
        
        return { 
          freqChange, 
          newRange: { min: newMinFreq, max: newMaxFreq } 
        };
      }
    }
  }, [isSimdAvailable]);

  const detectProminentSpikes = useCallback((params: SpikeDetectionParams) => {
    const {
      spectrumData,
      dbMin,
      dbMax,
      maxMarkers = 96,
      frequencyRange,
      temporalPersistence,
    } = params;
    const length = spectrumData.length;
    if (length < 5) return [];

    const dynamicRange = Math.max(1, dbMax - dbMin);

    let w = Math.max(2, Math.floor(length * 0.015));
    if (frequencyRange) {
      const spanMHz = frequencyRange.max - frequencyRange.min;
      if (spanMHz > 0) {
        const binsPerMHz = length / spanMHz;
        const bins45kHz = Math.ceil(binsPerMHz * 0.045);
        w = Math.max(2, Math.min(Math.floor(length / 10), bins45kHz));
      }
    }

    const eroded = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let minVal = Infinity;
      const start = Math.max(0, i - w);
      const end = Math.min(length - 1, i + w);
      for (let j = start; j <= end; j++) {
        if (spectrumData[j] < minVal) minVal = spectrumData[j];
      }
      eroded[i] = minVal;
    }

    const baseline = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let maxVal = -Infinity;
      const start = Math.max(0, i - w);
      const end = Math.min(length - 1, i + w);
      for (let j = start; j <= end; j++) {
        if (eroded[j] > maxVal) maxVal = eroded[j];
      }
      baseline[i] = maxVal;
    }

    const persistence =
      temporalPersistence && temporalPersistence.length === length
        ? temporalPersistence
        : null;
    const decay = 0.9;
    const persistenceSpread = Math.max(1, Math.min(4, Math.floor(length / 1024)));
    const residual = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const prominence = Math.max(0, spectrumData[i] - baseline[i]);
      residual[i] = prominence;
      if (persistence) {
        persistence[i] *= decay;
      }
    }

    if (persistence) {
      for (let i = 0; i < length; i++) {
        const prominence = residual[i];
        if (prominence <= 0) continue;
        for (
          let j = Math.max(0, i - persistenceSpread);
          j <= Math.min(length - 1, i + persistenceSpread);
          j++
        ) {
          const weight = j === i ? 1 : 0.72;
          const boosted = prominence * weight;
          if (boosted > persistence[j]) {
            persistence[j] = boosted;
          }
        }
      }
    }

    const minProminence = Math.max(2.2, dynamicRange * 0.032);
    const candidates: SpectrumSpikeMarker[] = [];

    for (let i = 2; i < length - 2; i++) {
      const center = spectrumData[i];
      if (!Number.isFinite(center)) continue;

      const effectiveProminence = residual[i] + (persistence ? persistence[i] * 0.65 : 0);
      if (effectiveProminence < minProminence) continue;

      if (
        effectiveProminence <= residual[i - 1] + (persistence ? persistence[i - 1] * 0.65 : 0) ||
        effectiveProminence <= residual[i + 1] + (persistence ? persistence[i + 1] * 0.65 : 0)
      ) {
        continue;
      }

      const normalized = Math.max(
        0,
        Math.min(1, effectiveProminence / Math.max(10, dynamicRange * 0.3)),
      );

      candidates.push({
        index: i,
        value: center,
        prominence: effectiveProminence,
        radius: 3.5 + normalized * 7.5,
      });
    }

    candidates.sort((a, b) => b.prominence - a.prominence);

    const filtered: SpectrumSpikeMarker[] = [];
    const minSpacing = Math.max(2, Math.floor(length / 420));
    for (const candidate of candidates) {
      if (filtered.some((marker) => Math.abs(marker.index - candidate.index) < minSpacing)) {
        continue;
      }
      filtered.push(candidate);
      if (filtered.length >= maxMarkers) break;
    }

    filtered.sort((a, b) => a.index - b.index);
    return filtered;
  }, []);

  // Enhanced resampling with algorithm selection
  const resampleSpectrumEnhanced = useCallback((
    input: Float32Array, 
    output: Float32Array, 
    algorithm: 'max' | 'avg' | 'min' = 'max'
  ) => {
    if (renderingProcessorRef.current && isSimdAvailable) {
      renderingProcessorRef.current.resample_spectrum_enhanced(input, output, output.length, algorithm);
    } else {
      // Scalar fallback
      resampleSpectrum(input, output);
    }
  }, [isSimdAvailable, resampleSpectrum]);

  return {
    // WASM SIMD operations
    resampleSpectrum,
    processIqToDbmSpectrum,
    shiftWaterfallBuffer,
    applyColorMapping,
    
    // Mathematical preprocessing
    getZoomedData,
    transformToScreenCoords,
    calculateFrequencyDrag,
    detectProminentSpikes,
    resampleSpectrumEnhanced,
    
    // State
    isSimdAvailable,
    isWasmLoaded,
  };
}
