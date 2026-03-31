import { useCallback, useRef, useEffect, useState } from "react";
import { FFT_COMPUTE_SHADER } from "@n-apt/shaders";

export interface UnifiedFFTWaterfallOptions {
  device: GPUDevice | null;
  fftSize: number;
  waterfallHeight: number;
  windowType?: 'rectangular' | 'hanning' | 'hamming' | 'blackman' | 'nuttall';
  enableAveraging?: boolean;
  enableSmoothing?: boolean;
  normalizationFactor?: number;
}

export interface UnifiedProcessOptions {
  inputMode?: "real" | "complex_iq";
  powerMode?: "db" | "dbm";
  minDb?: number;
  maxDb?: number;
  hardwareSampleRateHz?: number;
  centerFrequencyHz?: number;
  tunerGainDb?: number;
  calibrationMode?: "generic" | "rtl_sdr";
  baseCalibrationDb?: number;
  chainLossDb?: number;
}

export interface UnifiedBuffers {
  // FFT processing buffers
  rawIqBuffer: GPUBuffer;
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
  const rtlIqWindowPipelineRef = useRef<GPUComputePipeline | null>(null);
  const fftPipelineRef = useRef<GPUComputePipeline | null>(null);
  const powerSpectrumPipelineRef = useRef<GPUComputePipeline | null>(null);
  const dbmSpectrumPipelineRef = useRef<GPUComputePipeline | null>(null);
  const waterfallDirectPipelineRef = useRef<GPUComputePipeline | null>(null);
  const averagingPipelineRef = useRef<GPUComputePipeline | null>(null);
  const smoothingPipelineRef = useRef<GPUComputePipeline | null>(null);
  
  // Buffer references
  const buffersRef = useRef<UnifiedBuffers | null>(null);
  const bindGroupsRef = useRef<{
    fftWindow: GPUBindGroup | null;
    rtlIqWindow: GPUBindGroup | null;
    fft: GPUBindGroup | null;
    powerSpectrum: GPUBindGroup | null;
    dbmSpectrum: GPUBindGroup | null;
    waterfall: GPUBindGroup | null;
    averaging: GPUBindGroup | null;
    smoothing: GPUBindGroup | null;
  }>({ fftWindow: null, rtlIqWindow: null, fft: null, powerSpectrum: null, dbmSpectrum: null, waterfall: null, averaging: null, smoothing: null });
  
  // State management
  const [isInitialized, setIsInitialized] = useState(!!device);
  const isProcessingRef = useRef(false);
  const lastResultRef = useRef<UnifiedProcessingResult | null>(null);
  const frameCountRef = useRef(0);
  
  // Window type mapping
  const windowTypeMap = {
    rectangular: 0,
    hanning: 1,
    hamming: 2,
    blackman: 3,
    nuttall: 4
  };
  
  const calibrationModeMap = {
    generic: 0,
    rtl_sdr: 1,
  } as const;
  
  // Initialize unified buffers
  const initializeBuffers = useCallback(() => {
    if (!device) {
      console.warn('GPU device not available for unified buffer initialization');
      return;
    }

    if (buffersRef.current) {
      buffersRef.current.rawIqBuffer.destroy();
      buffersRef.current.fftInputBuffer.destroy();
      buffersRef.current.fftOutputBuffer.destroy();
      buffersRef.current.fftTempBuffer.destroy();
      buffersRef.current.fftParamsBuffer.destroy();
      buffersRef.current.waterfallBuffer.destroy();
      buffersRef.current.sharedSpectrumBuffer.destroy();
      buffersRef.current.waterfallTexture.destroy();
    }
    
    // Cap waterfall width to hardware limits (e.g. 16384 on many GPUs)
    const maxTextureWidth = device.limits.maxTextureDimension2D || 16384;
    const waterfallWidth = Math.min(fftSize, maxTextureWidth);
    
    const rawIqSize = Math.ceil((fftSize * 2) / 4) * 4;
    const complexSize = fftSize * 8; // Complex number = 2 floats * 4 bytes each
    const paramsSize = 64; // FFTParams struct size
    // Each Complex in output_buffer can hold one packed u32 color in .real
    const waterfallBufferSize = waterfallWidth * 8; 
    
    // FFT processing buffers
    const rawIqBuffer = device.createBuffer({
      size: rawIqSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

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
      size: [waterfallWidth, waterfallHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    // Waterfall buffer for texture updates
    const waterfallBuffer = device.createBuffer({
      size: waterfallBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    buffersRef.current = {
      rawIqBuffer,
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

      rtlIqWindowPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "rtl_sdr_iq_to_dbm"
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

      dbmSpectrumPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "rtl_sdr_power_spectrum_dbm"
        }
      });
      
      // Direct waterfall pipeline (zero-copy from FFT)
      waterfallDirectPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "waterfall_buffer_update"
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

      bindGroupsRef.current.rtlIqWindow = device.createBindGroup({
        layout: rtlIqWindowPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: buffers.fftTempBuffer } },
          { binding: 3, resource: { buffer: buffers.fftParamsBuffer } },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } },
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

      bindGroupsRef.current.dbmSpectrum = device.createBindGroup({
        layout: dbmSpectrumPipelineRef.current.getBindGroupLayout(0),
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
    minDbValue?: number,
    maxDbValue?: number,
    normalizationOverride?: number,
    calibrationOptions?: {
      centerFrequencyHz?: number;
      sampleRateHz?: number;
      tunerGainDb?: number;
      baseCalibrationDb?: number;
      chainLossDb?: number;
      calibrationMode?: "generic" | "rtl_sdr";
    }
  ) => {
    if (!device || !buffersRef.current) return;
    
    const maxTextureWidth = device.limits.maxTextureDimension2D || 16384;
    const waterfallWidth = Math.min(fftSize, maxTextureWidth);

    const paramsBuffer = new ArrayBuffer(64);
    const floatView = new Float32Array(paramsBuffer);
    const uintView = new Uint32Array(paramsBuffer);

    uintView[0] = stage;
    int32View(paramsBuffer)[1] = direction;
    uintView[2] = fftSize;
    uintView[3] = windowTypeValue ?? windowTypeMap[windowType as keyof typeof windowTypeMap];
    floatView[4] = normalizationOverride ?? normalizationFactor;
    floatView[5] = minDbValue ?? -120.0;
    floatView[6] = maxDbValue ?? 0.0;
    uintView[7] = waterfallWidth;
    floatView[8] = calibrationOptions?.centerFrequencyHz ?? 0.0;
    floatView[9] = calibrationOptions?.sampleRateHz ?? 0.0;
    floatView[10] = calibrationOptions?.tunerGainDb ?? 0.0;
    floatView[11] = calibrationOptions?.baseCalibrationDb ?? 0.0;
    floatView[12] = calibrationOptions?.chainLossDb ?? 0.0;
    uintView[13] = calibrationModeMap[calibrationOptions?.calibrationMode ?? "generic"];
    uintView[14] = 0;
    uintView[15] = 0;
    
    device.queue.writeBuffer(
      buffersRef.current.fftParamsBuffer,
      0,
      paramsBuffer
    );
  }, [device, fftSize, windowType, normalizationFactor, windowTypeMap]);

  // Unified FFT and waterfall processing
  const processUnified = useCallback(async (
    inputData: Float32Array | Uint8Array,
    processOptions?: UnifiedProcessOptions,
  ): Promise<UnifiedProcessingResult> => {
    if (!isInitialized || !device || !buffersRef.current) {
      throw new Error("Unified FFT/Waterfall system not initialized");
    }
    
    isProcessingRef.current = true;

    const inputMode = processOptions?.inputMode ?? "real";
    const powerMode = processOptions?.powerMode ?? "db";
    const minDb = processOptions?.minDb ?? -120.0;
    const maxDb = processOptions?.maxDb ?? 0.0;
    
    const maxTextureWidth = device.limits.maxTextureDimension2D || 16384;
    const waterfallWidth = Math.min(fftSize, maxTextureWidth);
    
    // Calculate PSD normalization factor for dBm mode (Ps = P / (Fs * N))
    let activeNormalization = normalizationFactor;
    if (powerMode === "dbm" && inputMode === "complex_iq") {
      const sampleRate = processOptions?.hardwareSampleRateHz || 2400000;
      activeNormalization = sampleRate * fftSize;
    }

    const calibrationMode = processOptions?.calibrationMode ?? "generic";
    const baseCalibrationDb = processOptions?.baseCalibrationDb ?? -30.0;
    const chainLossDb = processOptions?.chainLossDb ?? 2.5;
    const calibrationOptions = {
      centerFrequencyHz: processOptions?.centerFrequencyHz ?? 0,
      sampleRateHz: processOptions?.hardwareSampleRateHz ?? 0,
      tunerGainDb: processOptions?.tunerGainDb ?? 0,
      baseCalibrationDb,
      chainLossDb,
      calibrationMode,
    };

    const updateParamsWithVals = (s: number, d: number = 1, w?: number, l?: number, h?: number) => {
      updateParams(s, d, w, l, h, activeNormalization, calibrationOptions);
    };

    try {

      const expectedInputLength = inputMode === "complex_iq" ? fftSize * 2 : fftSize;

      if (inputData.length !== expectedInputLength) {
        throw new Error(`Input size mismatch: expected ${expectedInputLength}, got ${inputData.length}`);
      }

      if (inputMode === "complex_iq") {
        const rawIqBytes = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData.buffer, inputData.byteOffset, inputData.byteLength);
        device.queue.writeBuffer(
          buffersRef.current.rawIqBuffer,
          0,
          rawIqBytes.buffer,
          rawIqBytes.byteOffset,
          rawIqBytes.byteLength,
        );
      } else {
        const complexInput = new Float32Array(fftSize * 2);
        for (let i = 0; i < fftSize; i++) {
          complexInput[i * 2] = inputData[i];
          complexInput[i * 2 + 1] = 0;
        }
        device.queue.writeBuffer(
          buffersRef.current.fftInputBuffer,
          0,
          complexInput.buffer,
        );
      }
      
      const encoder = device.createCommandEncoder();
      
      // Stage 1: Apply window function
      updateParams(0, 1, undefined, minDb, maxDb, activeNormalization, calibrationOptions);
      const windowPass = encoder.beginComputePass();
      if (inputMode === "complex_iq" && rtlIqWindowPipelineRef.current && bindGroupsRef.current.rtlIqWindow) {
        windowPass.setPipeline(rtlIqWindowPipelineRef.current);
        windowPass.setBindGroup(0, bindGroupsRef.current.rtlIqWindow);
        windowPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
      } else if (fftWindowPipelineRef.current && bindGroupsRef.current.fftWindow) {
        windowPass.setPipeline(fftWindowPipelineRef.current);
        windowPass.setBindGroup(0, bindGroupsRef.current.fftWindow);
        windowPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
      }
      windowPass.end();
      
      // Stage 2: Multi-stage FFT computation
      const numStages = Math.log2(fftSize);
      for (let stage = 0; stage < numStages; stage++) {
        updateParamsWithVals(stage, 1, undefined, minDb, maxDb);
        
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
            buffersRef.current!.fftOutputBuffer,
            0,
            buffersRef.current!.fftTempBuffer,
            0,
            fftSize * 8
          );
        }
      }
      
      // Stage 3: Power spectrum calculation
      updateParamsWithVals(0, 1, undefined, minDb, maxDb);
      const powerPass = encoder.beginComputePass();
      if (powerMode === "dbm" && dbmSpectrumPipelineRef.current && bindGroupsRef.current.dbmSpectrum) {
        powerPass.setPipeline(dbmSpectrumPipelineRef.current);
        powerPass.setBindGroup(0, bindGroupsRef.current.dbmSpectrum);
        powerPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
      } else if (powerSpectrumPipelineRef.current && bindGroupsRef.current.powerSpectrum) {
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
        updateParamsWithVals(0, 1, undefined, minDb, maxDb);
        const avgPass = encoder.beginComputePass();
        avgPass.setPipeline(averagingPipelineRef.current);
        avgPass.setBindGroup(0, bindGroupsRef.current.averaging);
        avgPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        avgPass.end();
        
        // Copy averaged result back to sharedSpectrumBuffer (readback + waterfall source)
        encoder.copyBufferToBuffer(
          buffersRef.current!.fftOutputBuffer, 0,
          buffersRef.current!.sharedSpectrumBuffer, 0,
          fftSize * 8
        );
        // Persist averaged result to fftTempBuffer for next frame's "previous"
        encoder.copyBufferToBuffer(
          buffersRef.current!.fftOutputBuffer, 0,
          buffersRef.current!.fftTempBuffer, 0,
          fftSize * 8
        );
      }
      
      // Stage 5: Optional smoothing
      // fft_smooth reads from input_buffer (sharedSpectrumBuffer),
      // writes to output_buffer (fftOutputBuffer).
      // After: copy result back to sharedSpectrumBuffer for readback/waterfall.
      if (enableSmoothing && smoothingPipelineRef.current && bindGroupsRef.current.smoothing) {
        updateParamsWithVals(0, 1, undefined, minDb, maxDb);
        const smoothPass = encoder.beginComputePass();
        smoothPass.setPipeline(smoothingPipelineRef.current);
        smoothPass.setBindGroup(0, bindGroupsRef.current.smoothing);
        smoothPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        smoothPass.end();
        
        // Copy smoothed result back to sharedSpectrumBuffer
        encoder.copyBufferToBuffer(
          buffersRef.current!.fftOutputBuffer, 0,
          buffersRef.current!.sharedSpectrumBuffer, 0,
          fftSize * 8
        );
      }
      
      // Stage 6: Direct waterfall update (zero-copy from FFT)
      const currentLine = frameCountRef.current % waterfallHeight;
      updateParamsWithVals(0, 1, undefined, minDb, maxDb);

      
      const waterfallPass = encoder.beginComputePass();
      if (waterfallDirectPipelineRef.current && bindGroupsRef.current.waterfall) {
        waterfallPass.setPipeline(waterfallDirectPipelineRef.current);
        waterfallPass.setBindGroup(0, bindGroupsRef.current.waterfall);
        // Dispatch based on waterfallWidth
        waterfallPass.dispatchWorkgroups(Math.ceil(waterfallWidth / 256));
      }
      waterfallPass.end();
      
      // Copy waterfall buffer to texture
      // We packed 2 pixels per Complex (8 bytes), so waterfallWidth pixels
      // take waterfallWidth * 4 bytes in a continuous block.
      encoder.copyBufferToTexture(
        {
          buffer: buffersRef.current.waterfallBuffer,
          bytesPerRow: waterfallWidth * 4, 
          rowsPerImage: 1
        },
        {
          texture: buffersRef.current.waterfallTexture,
          origin: [0, currentLine, 0]
        },
        [waterfallWidth, 1, 1]
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

      if (!spectrumData || spectrumData.length === 0 || !spectrumData.some((v) => Number.isFinite(v))) {
        console.error("Unified FFT produced invalid spectrum data", {
          inputMode,
          powerMode,
          fftSize,
          minDb,
          maxDb,
          frameCount: frameCountRef.current,
        });
      }
      
      lastResultRef.current = result;
      return result;
      
    } finally {
      isProcessingRef.current = false;
    }
  }, [isInitialized, device, fftSize, waterfallHeight, windowType, enableAveraging, enableSmoothing, normalizationFactor, updateParams]);

  // Initialize buffers and pipelines when device or dependencies change
  useEffect(() => {
    if (!device) return;
    try {
      initializeBuffers();
      createPipelines().then(() => {
        setIsInitialized(true);
      }).catch((e) => {
        console.error("Failed to create unified pipelines:", e);
        setIsInitialized(false);
      });
    } catch (error) {
      console.error("Failed to initialize unified buffers:", error);
      setIsInitialized(false);
    }
  }, [device, initializeBuffers, createPipelines]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (buffersRef.current) {
        buffersRef.current.rawIqBuffer.destroy();
        buffersRef.current.fftInputBuffer.destroy();
        buffersRef.current.fftOutputBuffer.destroy();
        buffersRef.current.fftTempBuffer.destroy();
        buffersRef.current.fftParamsBuffer.destroy();
        buffersRef.current.waterfallBuffer.destroy();
        buffersRef.current.sharedSpectrumBuffer.destroy();
        buffersRef.current.waterfallTexture.destroy();
      }
      
      // Clean up pipelines
      [fftWindowPipelineRef.current, rtlIqWindowPipelineRef.current, fftPipelineRef.current, powerSpectrumPipelineRef.current,
       dbmSpectrumPipelineRef.current, waterfallDirectPipelineRef.current, averagingPipelineRef.current, smoothingPipelineRef.current].forEach(pipeline => {
        if (pipeline && 'destroy' in pipeline) {
          (pipeline as any).destroy();
        }
      });
    };
  }, []);

  return {
    isInitialized,
    isProcessing: isProcessingRef.current,
    lastResult: lastResultRef.current,
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
      lastProcessedAt: lastResultRef.current?.processedAt || null
    }), [fftSize, waterfallHeight, windowType, enableAveraging, enableSmoothing])
  };
}

function int32View(buffer: ArrayBuffer) {
  return new Int32Array(buffer);
}
