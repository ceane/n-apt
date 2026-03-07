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

export interface WasmSimdMathHandle {
  // WASM SIMD operations
  resampleSpectrum: (input: Float32Array, output: Float32Array) => void;
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
              const { RenderingProcessor } = await import("n_apt_canvas");
              renderingProcessorRef.current = new RenderingProcessor();
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
        
        output[x] = maxVal !== -Infinity ? maxVal : (input[Math.min(start, srcLen - 1)] ?? -120);
      }
    }
  }, [isSimdAvailable]);
  
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
        const paddedWaveform = new Float32Array(visibleBins).fill(-120);
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
    shiftWaterfallBuffer,
    applyColorMapping,
    
    // Mathematical preprocessing
    getZoomedData,
    transformToScreenCoords,
    calculateFrequencyDrag,
    resampleSpectrumEnhanced,
    
    // State
    isSimdAvailable,
    isWasmLoaded,
  };
}
