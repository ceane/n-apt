import { useCallback, useRef, useEffect, useState } from "react";
import { FFT_COMPUTE_SHADER } from "@n-apt/consts/shaders/fft_compute";

export interface UnifiedFFTWaterfallOptions {
  device: GPUDevice | null;
  fftSize: number;
  waterfallHeight: number;
  windowType?: 'rectangular' | 'hanning' | 'hamming' | 'blackman' | 'nuttall';
  enableAveraging?: boolean;
  enableSmoothing?: boolean;
  normalizationFactor?: number;
}

export interface UnifiedBuffers {
  // FFT processing buffers
  fftInputBuffer: GPUBuffer;
  fftOutputBuffer: GPUBuffer;
  fftTempBuffer: GPUBuffer;
  fftParamsBuffer: GPUBuffer;
  
  // Waterfall buffers
  waterfallTexture: GPUTexture;
  waterfallBuffer: GPUBuffer;
  
  // Shared buffer for zero-copy FFT-to-waterfall
  sharedSpectrumBuffer: GPUBuffer;
}

export interface UnifiedProcessingResult {
  spectrumData: Float32Array | null;
  waterfallTexture: GPUTexture;
  processedAt: number;
  frameCount: number;
}

export function useUnifiedFFTWaterfall(options: UnifiedFFTWaterfallOptions) {
  const { 
    device, 
    fftSize, 
    waterfallHeight,
    windowType = 'hanning',
    enableAveraging = false,
    enableSmoothing = false,
    normalizationFactor = 1.0
  } = options;
  
  // Pipeline references
  const fftWindowPipelineRef = useRef<GPUComputePipeline | null>(null);
  const fftPipelineRef = useRef<GPUComputePipeline | null>(null);
  const powerSpectrumPipelineRef = useRef<GPUComputePipeline | null>(null);
  const waterfallDirectPipelineRef = useRef<GPUComputePipeline | null>(null);
  const averagingPipelineRef = useRef<GPUComputePipeline | null>(null);
  const smoothingPipelineRef = useRef<GPUComputePipeline | null>(null);
  
  // Buffer references
  const buffersRef = useRef<UnifiedBuffers | null>(null);
  const bindGroupsRef = useRef<{
    fftWindow: GPUBindGroup | null;
    fft: GPUBindGroup | null;
    powerSpectrum: GPUBindGroup | null;
    waterfall: GPUBindGroup | null;
    averaging: GPUBindGroup | null;
    smoothing: GPUBindGroup | null;
  }>({ fftWindow: null, fft: null, powerSpectrum: null, waterfall: null, averaging: null, smoothing: null });
  
  // State management
  const [isInitialized, setIsInitialized] = useState(!!device);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<UnifiedProcessingResult | null>(null);
  const frameCountRef = useRef(0);
  
  // Window type mapping
  const windowTypeMap = {
    rectangular: 0,
    hanning: 1,
    hamming: 2,
    blackman: 3,
    nuttall: 4
  };
  
  // Initialize unified buffers
  const initializeBuffers = useCallback(() => {
    if (!device) {
      console.warn('GPU device not available for unified buffer initialization');
      return;
    }
    
    const complexSize = fftSize * 8; // Complex number = 2 floats * 4 bytes each
    const paramsSize = 64; // FFTParams struct size
    const waterfallBufferSize = fftSize * waterfallHeight * 4; // RGBA texture
    
    // FFT processing buffers
    const fftInputBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    const fftOutputBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    const fftTempBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    const fftParamsBuffer = device.createBuffer({
      size: paramsSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Shared spectrum buffer for zero-copy FFT-to-waterfall
    // Must be Complex-sized (8 bytes/element) since shaders bind it as array<Complex>
    const sharedSpectrumBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    // Waterfall texture (direct GPU-to-GPU rendering)
    const waterfallTexture = device.createTexture({
      size: [fftSize, waterfallHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    // Waterfall buffer for texture updates
    const waterfallBuffer = device.createBuffer({
      size: waterfallBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    buffersRef.current = {
      fftInputBuffer,
      fftOutputBuffer,
      fftTempBuffer,
      fftParamsBuffer,
      waterfallTexture,
      waterfallBuffer,
      sharedSpectrumBuffer
    };
  }, [device, fftSize, waterfallHeight]);
  
  // Create unified pipelines
  const createPipelines = useCallback(async () => {
    if (!device || !buffersRef.current) return;
    
    try {
      const shaderModule = device.createShaderModule({ code: FFT_COMPUTE_SHADER });

      // Window/preprocess pipeline
      fftWindowPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "fft_window"
        }
      });
      
      // FFT pipeline
      fftPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "fft_compute"
        }
      });
      
      // Power spectrum pipeline
      powerSpectrumPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "fft_power_spectrum"
        }
      });
      
      // Direct waterfall pipeline (zero-copy from FFT)
      waterfallDirectPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "fft_waterfall_direct"
        }
      });
      
      // Optional averaging pipeline
      if (enableAveraging) {
        averagingPipelineRef.current = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: shaderModule,
            entryPoint: "fft_average"
          }
        });
      }
      
      // Optional smoothing pipeline
      if (enableSmoothing) {
        smoothingPipelineRef.current = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: shaderModule,
            entryPoint: "fft_smooth"
          }
        });
      }
      
      // Create bind groups for zero-copy operations
      const buffers = buffersRef.current;

      // Window bind group (fft_window uses bindings 0, 2, 3)
      bindGroupsRef.current.fftWindow = device.createBindGroup({
        layout: fftWindowPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftInputBuffer } },
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } },
          { binding: 3, resource: { buffer: buffers.fftParamsBuffer } }
        ]
      });
      
      // FFT bind group (fft_compute uses bindings 1, 2, 3)
      bindGroupsRef.current.fft = device.createBindGroup({
        layout: fftPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: buffers.fftOutputBuffer } },
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } },
          { binding: 3, resource: { buffer: buffers.fftParamsBuffer } }
        ]
      });
      
      // Power spectrum bind group (fft_power_spectrum uses bindings 0, 1, 3)
      bindGroupsRef.current.powerSpectrum = device.createBindGroup({
        layout: powerSpectrumPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftOutputBuffer } },
          { binding: 1, resource: { buffer: buffers.sharedSpectrumBuffer } },
          { binding: 3, resource: { buffer: buffers.fftParamsBuffer } }
        ]
      });
      
      // Waterfall bind group (fft_waterfall_direct uses bindings 0, 1, 3)
      bindGroupsRef.current.waterfall = device.createBindGroup({
        layout: waterfallDirectPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.sharedSpectrumBuffer } },
          { binding: 1, resource: { buffer: buffers.waterfallBuffer } },
          { binding: 3, resource: { buffer: buffers.fftParamsBuffer } }
        ]
      });
      
      // Averaging bind group (fft_average uses bindings 0, 1, 2, 3)
      if (averagingPipelineRef.current) {
        bindGroupsRef.current.averaging = device.createBindGroup({
          layout: averagingPipelineRef.current.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: buffers.sharedSpectrumBuffer } },
            { binding: 1, resource: { buffer: buffers.fftOutputBuffer } },
            { binding: 2, resource: { buffer: buffers.fftTempBuffer } },
            { binding: 3, resource: { buffer: buffers.fftParamsBuffer } }
          ]
        });
      }
      
      // Smoothing bind group (fft_smooth uses bindings 0, 1, 3)
      if (smoothingPipelineRef.current) {
        bindGroupsRef.current.smoothing = device.createBindGroup({
          layout: smoothingPipelineRef.current.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: buffers.sharedSpectrumBuffer } },
            { binding: 1, resource: { buffer: buffers.fftOutputBuffer } },
            { binding: 3, resource: { buffer: buffers.fftParamsBuffer } }
          ]
        });
      }
      
    } catch (error) {
      console.error("Failed to create unified pipelines:", error);
      throw error;
    }
  }, [device, enableAveraging, enableSmoothing]);
  
  // Update FFT parameters
  const updateParams = useCallback((
    stage: number,
    direction: number = 1,
    windowTypeValue?: number,
    lineIndex: number = 0
  ) => {
    if (!device || !buffersRef.current) return;
    
    const params = new Float32Array([
      stage,                    // stage
      direction,                // direction
      fftSize,                  // input_size
      windowTypeValue ?? windowTypeMap[windowType], // window_type
      normalizationFactor,      // normalization
      lineIndex,                // line_index for waterfall
      0, 0                      // padding
    ]);
    
    device.queue.writeBuffer(
      buffersRef.current.fftParamsBuffer,
      0,
      params.buffer
    );
  }, [device, fftSize, windowType, normalizationFactor, windowTypeMap]);
  
  // Unified FFT and waterfall processing
  const processUnified = useCallback(async (inputData: Float32Array): Promise<UnifiedProcessingResult> => {
    if (!isInitialized || !device || !buffersRef.current) {
      throw new Error("Unified FFT/Waterfall system not initialized");
    }
    
    setIsProcessing(true);
    
    try {
      // Validate input size
      if (inputData.length !== fftSize) {
        throw new Error(`Input size mismatch: expected ${fftSize}, got ${inputData.length}`);
      }
      
      // Convert real input to complex and write to input buffer
      const complexInput = new Float32Array(fftSize * 2);
      for (let i = 0; i < fftSize; i++) {
        complexInput[i * 2] = inputData[i];     // Real part
        complexInput[i * 2 + 1] = 0;            // Imaginary part
      }
      
      device.queue.writeBuffer(
        buffersRef.current.fftInputBuffer,
        0,
        complexInput.buffer
      );
      
      const encoder = device.createCommandEncoder();
      
      // Stage 1: Apply window function
      updateParams(0, 1);
      const windowPass = encoder.beginComputePass();
      if (fftWindowPipelineRef.current && bindGroupsRef.current.fftWindow) {
        windowPass.setPipeline(fftWindowPipelineRef.current);
        windowPass.setBindGroup(0, bindGroupsRef.current.fftWindow);
        windowPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
      }
      windowPass.end();
      
      // Copy to temp buffer for FFT stages
      encoder.copyBufferToBuffer(
        buffersRef.current.fftOutputBuffer,
        0,
        buffersRef.current.fftTempBuffer,
        0,
        fftSize * 8
      );
      
      // Stage 2: Multi-stage FFT computation
      const numStages = Math.log2(fftSize);
      for (let stage = 0; stage < numStages; stage++) {
        updateParams(stage, 1);
        
        const fftPass = encoder.beginComputePass();
        if (fftPipelineRef.current && bindGroupsRef.current.fft) {
          fftPass.setPipeline(fftPipelineRef.current);
          fftPass.setBindGroup(0, bindGroupsRef.current.fft);
          fftPass.dispatchWorkgroups(Math.ceil(fftSize / 512));
        }
        fftPass.end();
        
        // Swap buffers for next stage
        if (stage < numStages - 1) {
          encoder.copyBufferToBuffer(
            buffersRef.current.fftOutputBuffer,
            0,
            buffersRef.current.fftTempBuffer,
            0,
            fftSize * 8
          );
        }
      }
      
      // Stage 3: Power spectrum calculation
      updateParams(0, 1);
      const powerPass = encoder.beginComputePass();
      if (powerSpectrumPipelineRef.current && bindGroupsRef.current.powerSpectrum) {
        powerPass.setPipeline(powerSpectrumPipelineRef.current);
        powerPass.setBindGroup(0, bindGroupsRef.current.powerSpectrum);
        powerPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
      }
      powerPass.end();
      
      // Stage 4: Optional averaging
      // fft_average reads current from input_buffer (sharedSpectrumBuffer),
      // previous from temp_buffer (fftTempBuffer), writes to output_buffer (fftOutputBuffer).
      // After: copy result back to sharedSpectrumBuffer for readback/waterfall,
      //        and to fftTempBuffer so next frame has "previous".
      if (enableAveraging && averagingPipelineRef.current && bindGroupsRef.current.averaging) {
        updateParams(0, 1);
        const avgPass = encoder.beginComputePass();
        avgPass.setPipeline(averagingPipelineRef.current);
        avgPass.setBindGroup(0, bindGroupsRef.current.averaging);
        avgPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        avgPass.end();
        
        // Copy averaged result back to sharedSpectrumBuffer (readback + waterfall source)
        encoder.copyBufferToBuffer(
          buffersRef.current.fftOutputBuffer, 0,
          buffersRef.current.sharedSpectrumBuffer, 0,
          fftSize * 8
        );
        // Persist averaged result to fftTempBuffer for next frame's "previous"
        encoder.copyBufferToBuffer(
          buffersRef.current.fftOutputBuffer, 0,
          buffersRef.current.fftTempBuffer, 0,
          fftSize * 8
        );
      }
      
      // Stage 5: Optional smoothing
      // fft_smooth reads from input_buffer (sharedSpectrumBuffer),
      // writes to output_buffer (fftOutputBuffer).
      // After: copy result back to sharedSpectrumBuffer for readback/waterfall.
      if (enableSmoothing && smoothingPipelineRef.current && bindGroupsRef.current.smoothing) {
        updateParams(0, 1);
        const smoothPass = encoder.beginComputePass();
        smoothPass.setPipeline(smoothingPipelineRef.current);
        smoothPass.setBindGroup(0, bindGroupsRef.current.smoothing);
        smoothPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        smoothPass.end();
        
        // Copy smoothed result back to sharedSpectrumBuffer
        encoder.copyBufferToBuffer(
          buffersRef.current.fftOutputBuffer, 0,
          buffersRef.current.sharedSpectrumBuffer, 0,
          fftSize * 8
        );
      }
      
      // Stage 6: Direct waterfall update (zero-copy from FFT)
      const currentLine = frameCountRef.current % waterfallHeight;
      updateParams(0, 1, undefined, currentLine);
      
      const waterfallPass = encoder.beginComputePass();
      if (waterfallDirectPipelineRef.current && bindGroupsRef.current.waterfall) {
        waterfallPass.setPipeline(waterfallDirectPipelineRef.current);
        waterfallPass.setBindGroup(0, bindGroupsRef.current.waterfall);
        waterfallPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
      }
      waterfallPass.end();
      
      // Copy waterfall buffer to texture
      encoder.copyBufferToTexture(
        {
          buffer: buffersRef.current.waterfallBuffer,
          bytesPerRow: fftSize * 4,
          rowsPerImage: 1
        },
        {
          texture: buffersRef.current.waterfallTexture,
          origin: [0, currentLine, 0]
        },
        [fftSize, 1, 1]
      );
      
      device.queue.submit([encoder.finish()]);
      
      // Read back spectrum data — sharedSpectrumBuffer is Complex-sized (8 bytes/element)
      // We need to read the full Complex buffer and extract the .real components
      const complexReadSize = fftSize * 8;
      const resultBuffer = device.createBuffer({
        size: complexReadSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      
      const readEncoder = device.createCommandEncoder();
      readEncoder.copyBufferToBuffer(
        buffersRef.current.sharedSpectrumBuffer,
        0,
        resultBuffer,
        0,
        complexReadSize
      );
      device.queue.submit([readEncoder.finish()]);
      
      // Map and read results, extracting only .real from each Complex
      await resultBuffer.mapAsync(GPUMapMode.READ, 0, complexReadSize);
      const arrayBuffer = resultBuffer.getMappedRange(0, complexReadSize);
      const complexData = new Float32Array(arrayBuffer.slice(0));
      resultBuffer.unmap();
      resultBuffer.destroy();
      
      // Extract .real component from Complex pairs (stride 2)
      const spectrumData = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        spectrumData[i] = complexData[i * 2]; // .real
      }
      
      frameCountRef.current++;
      
      const result: UnifiedProcessingResult = {
        spectrumData,
        waterfallTexture: buffersRef.current.waterfallTexture,
        processedAt: performance.now(),
        frameCount: frameCountRef.current
      };
      
      setLastResult(result);
      return result;
      
    } finally {
      setIsProcessing(false);
    }
  }, [isInitialized, device, fftSize, waterfallHeight, windowType, enableAveraging, enableSmoothing, normalizationFactor, updateParams]);
  
  // Initialize buffers once when device becomes available
  useEffect(() => {
    if (!device) return;
    try {
      initializeBuffers();
    } catch (error) {
      console.error("Failed to initialize unified buffers:", error);
    }
  }, [device, initializeBuffers]);
  
  // Create/recreate pipelines when device or toggle flags change (without destroying buffers)
  useEffect(() => {
    const init = async () => {
      if (!device || !buffersRef.current) return;
      
      try {
        await createPipelines();
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to create unified pipelines:", error);
        setIsInitialized(false);
      }
    };
    
    init();
  }, [device, createPipelines]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (buffersRef.current) {
        buffersRef.current.fftInputBuffer.destroy();
        buffersRef.current.fftOutputBuffer.destroy();
        buffersRef.current.fftTempBuffer.destroy();
        buffersRef.current.fftParamsBuffer.destroy();
        buffersRef.current.waterfallBuffer.destroy();
        buffersRef.current.sharedSpectrumBuffer.destroy();
        buffersRef.current.waterfallTexture.destroy();
      }
      
      // Clean up pipelines
      [fftWindowPipelineRef.current, fftPipelineRef.current, powerSpectrumPipelineRef.current, 
       waterfallDirectPipelineRef.current, averagingPipelineRef.current, smoothingPipelineRef.current].forEach(pipeline => {
        if (pipeline && 'destroy' in pipeline) {
          (pipeline as any).destroy();
        }
      });
    };
  }, []);
  
  return {
    isInitialized,
    isProcessing,
    lastResult,
    processUnified,
    getWaterfallTexture: useCallback(() => buffersRef.current?.waterfallTexture || null, []),
    getBuffers: useCallback(() => buffersRef.current, []),
    getProcessingStats: useCallback(() => ({
      fftSize,
      waterfallHeight,
      windowType,
      enableAveraging,
      enableSmoothing,
      frameCount: frameCountRef.current,
      lastProcessedAt: lastResult?.processedAt || null
    }), [fftSize, waterfallHeight, windowType, enableAveraging, enableSmoothing, lastResult])
  };
}
