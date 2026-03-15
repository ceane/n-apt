import { useCallback, useRef, useEffect, useState } from "react";
import { FFT_COMPUTE_SHADER } from "@n-apt/consts/shaders/fft_compute";

export interface ComputeFFTOptions {
  device: GPUDevice | null;
  fftSize: number;
  windowType?: 'rectangular' | 'hanning' | 'hamming' | 'blackman' | 'nuttall';
  enableAveraging?: boolean;
  enableFiltering?: boolean;
  normalizationFactor?: number;
}

export interface FFTBuffers {
  inputBuffer: GPUBuffer;
  outputBuffer: GPUBuffer;
  tempBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
}

export interface ComputeFFTResult {
  magnitudeBuffer: GPUBuffer;
  frequencyData: Float32Array | null;
  processedAt: number;
}

export function useComputeFFT(options: ComputeFFTOptions) {
  const { 
    device, 
    fftSize, 
    windowType = 'hanning',
    enableAveraging = false,
    enableFiltering = false,
    normalizationFactor = 1.0
  } = options;
  
  // Pipeline and buffer references
  const fftPipelineRef = useRef<GPUComputePipeline | null>(null);
  const windowPipelineRef = useRef<GPUComputePipeline | null>(null);
  const powerPipelineRef = useRef<GPUComputePipeline | null>(null);
  const averagePipelineRef = useRef<GPUComputePipeline | null>(null);
  const filterPipelineRef = useRef<GPUComputePipeline | null>(null);
  const waterfallPipelineRef = useRef<GPUComputePipeline | null>(null);
  
  const buffersRef = useRef<FFTBuffers | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  
  // State management
  const [isInitialized, setIsInitialized] = useState(!!device);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<ComputeFFTResult | null>(null);
  
  // Window type mapping
  const windowTypeMap = {
    rectangular: 0,
    hanning: 1,
    hamming: 2,
    blackman: 3,
    nuttall: 4
  };
  
  // Initialize FFT buffers
  const initializeBuffers = useCallback(() => {
    if (!device) {
      console.warn('GPU device not available for FFT buffer initialization');
      return;
    }
    
    const complexSize = fftSize * 8; // Complex number = 2 floats * 4 bytes each
    const paramsSize = 64; // FFTParams struct size
    
    const inputBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    const outputBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    const tempBuffer = device.createBuffer({
      size: complexSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    
    const paramsBuffer = device.createBuffer({
      size: paramsSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    buffersRef.current = {
      inputBuffer,
      outputBuffer,
      tempBuffer,
      paramsBuffer
    };
  }, [device, fftSize]);
  
  // Create compute pipelines
  const createPipelines = useCallback(async () => {
    if (!device || !buffersRef.current) return;
    
    try {
      // FFT pipeline
      const fftModule = device.createShaderModule({ code: FFT_COMPUTE_SHADER });
      fftPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: fftModule,
          entryPoint: "fft_compute"
        }
      });
      
      // Windowing pipeline
      windowPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: fftModule,
          entryPoint: "fft_window"
        }
      });
      
      // Power spectrum pipeline
      powerPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: fftModule,
          entryPoint: "fft_power_spectrum"
        }
      });
      
      // Optional pipelines
      if (enableAveraging) {
        averagePipelineRef.current = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: fftModule,
            entryPoint: "fft_average"
          }
        });
      }
      
      if (enableFiltering) {
        filterPipelineRef.current = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: fftModule,
            entryPoint: "fft_filter"
          }
        });
      }
      
      // Waterfall color mapping
      waterfallPipelineRef.current = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: fftModule,
          entryPoint: "fft_waterfall_direct"
        }
      });
      
      // Create bind group
      const bindGroupLayout = fftPipelineRef.current.getBindGroupLayout(0);
      bindGroupRef.current = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: buffersRef.current.inputBuffer } },
          { binding: 1, resource: { buffer: buffersRef.current.outputBuffer } },
          { binding: 2, resource: { buffer: buffersRef.current.tempBuffer } },
          { binding: 3, resource: { buffer: buffersRef.current.paramsBuffer } }
        ]
      });
      
    } catch (error) {
      console.error("Failed to create FFT pipelines:", error);
      throw error;
    }
  }, [device, enableAveraging, enableFiltering]);
  
  // Update FFT parameters
  const updateParams = useCallback((
    stage: number,
    direction: number = 1,
    windowTypeValue?: number
  ) => {
    if (!buffersRef.current) return;
    
    const params = new Float32Array([
      stage,                    // stage
      direction,                // direction
      fftSize,                  // input_size
      windowTypeValue ?? windowTypeMap[windowType], // window_type
      normalizationFactor,      // normalization
      0, 0, 0                  // padding
    ]);
    
    device.queue.writeBuffer(
      buffersRef.current.paramsBuffer,
      0,
      params.buffer
    );
  }, [device, fftSize, windowType, normalizationFactor, windowTypeMap]);
  
  // Perform multi-stage FFT computation
  const performFFT = useCallback(async (inputData: Float32Array): Promise<ComputeFFTResult> => {
    if (!isInitialized || !buffersRef.current || !bindGroupRef.current) {
      throw new Error("Compute FFT not initialized");
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
        buffersRef.current.inputBuffer,
        0,
        complexInput.buffer
      );
      
      const encoder = device.createCommandEncoder();
      
      // Stage 1: Apply window function
      if (windowPipelineRef.current) {
        updateParams(0, 1, windowTypeMap[windowType]);
        const pass = encoder.beginComputePass();
        pass.setPipeline(windowPipelineRef.current);
        pass.setBindGroup(0, bindGroupRef.current);
        pass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        pass.end();
        
        // Copy output to temp for FFT stages
        encoder.copyBufferToBuffer(
          buffersRef.current.outputBuffer,
          0,
          buffersRef.current.tempBuffer,
          0,
          fftSize * 8
        );
      }
      
      // Stage 2: Multi-stage FFT computation
      const numStages = Math.log2(fftSize);
      for (let stage = 0; stage < numStages; stage++) {
        updateParams(stage, 1);
        
        const pass = encoder.beginComputePass();
        if (fftPipelineRef.current) {
          pass.setPipeline(fftPipelineRef.current);
          pass.setBindGroup(0, bindGroupRef.current);
          pass.dispatchWorkgroups(Math.ceil(fftSize / 512));
        }
        pass.end();
        
        // Swap buffers for next stage
        if (stage < numStages - 1) {
          encoder.copyBufferToBuffer(
            buffersRef.current.outputBuffer,
            0,
            buffersRef.current.tempBuffer,
            0,
            fftSize * 8
          );
        }
      }
      
      // Stage 3: Power spectrum calculation
      if (powerPipelineRef.current) {
        updateParams(0, 1);
        const pass = encoder.beginComputePass();
        pass.setPipeline(powerPipelineRef.current);
        pass.setBindGroup(0, bindGroupRef.current);
        pass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        pass.end();
      }
      
      // Stage 4: Optional averaging
      if (enableAveraging && averagePipelineRef.current) {
        updateParams(0, 1);
        const pass = encoder.beginComputePass();
        pass.setPipeline(averagePipelineRef.current);
        pass.setBindGroup(0, bindGroupRef.current);
        pass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        pass.end();
      }
      
      // Stage 5: Optional filtering
      if (enableFiltering && filterPipelineRef.current) {
        updateParams(0, 1);
        const pass = encoder.beginComputePass();
        pass.setPipeline(filterPipelineRef.current);
        pass.setBindGroup(0, bindGroupRef.current);
        pass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        pass.end();
      }
      
      device.queue.submit([encoder.finish()]);
      
      // Read back results
      const resultBuffer = device.createBuffer({
        size: fftSize * 4, // Only real part (magnitude)
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      
      // Copy magnitude data
      const readEncoder = device.createCommandEncoder();
      readEncoder.copyBufferToBuffer(
        buffersRef.current.outputBuffer,
        0,
        resultBuffer,
        0,
        fftSize * 4
      );
      device.queue.submit([readEncoder.finish()]);
      
      // Map and read results
      await resultBuffer.mapAsync(GPUMapMode.READ, 0, fftSize * 4);
      const arrayBuffer = resultBuffer.getMappedRange(0, fftSize * 4);
      const magnitudeData = new Float32Array(arrayBuffer.slice(0));
      resultBuffer.unmap();
      resultBuffer.destroy();
      
      const result: ComputeFFTResult = {
        magnitudeBuffer: buffersRef.current.outputBuffer,
        frequencyData: magnitudeData,
        processedAt: performance.now()
      };
      
      setLastResult(result);
      return result;
      
    } finally {
      setIsProcessing(false);
    }
  }, [
    isInitialized, 
    fftSize, 
    windowType, 
    windowTypeMap, 
    updateParams, 
    enableAveraging, 
    enableFiltering,
    device
  ]);
  
  // Generate waterfall colors
  const generateWaterfallColors = useCallback(async (): Promise<GPUBuffer | null> => {
    if (!isInitialized || !buffersRef.current || !bindGroupRef.current || !waterfallPipelineRef.current) {
      return null;
    }
    
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(waterfallPipelineRef.current);
    pass.setBindGroup(0, bindGroupRef.current);
    pass.dispatchWorkgroups(Math.ceil(fftSize / 256));
    pass.end();
    
    device.queue.submit([encoder.finish()]);
    
    return buffersRef.current.outputBuffer;
  }, [isInitialized, device, fftSize]);
  
  // Initialize on mount and when device becomes available
  useEffect(() => {
    const init = async () => {
      if (!device) return;
      
      try {
        initializeBuffers();
        await createPipelines();
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize compute FFT:", error);
        setIsInitialized(false);
      }
    };
    
    init();
  }, [device, initializeBuffers, createPipelines]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (buffersRef.current) {
        buffersRef.current.inputBuffer.destroy();
        buffersRef.current.outputBuffer.destroy();
        buffersRef.current.tempBuffer.destroy();
        buffersRef.current.paramsBuffer.destroy();
      }
      
      // Clean up pipelines
      [fftPipelineRef.current, windowPipelineRef.current, powerPipelineRef.current, 
       averagePipelineRef.current, filterPipelineRef.current, waterfallPipelineRef.current].forEach(pipeline => {
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
    performFFT,
    generateWaterfallColors,
    updateWindowType: useCallback((_newWindowType: typeof windowType) => {
      // This would require re-initialization with new window type
      console.log('Window type change requires re-initialization');
    }, []),
    getBuffers: useCallback(() => buffersRef.current, []),
    getProcessingStats: useCallback(() => ({
      fftSize,
      windowType,
      enableAveraging,
      enableFiltering,
      lastProcessedAt: lastResult?.processedAt || null
    }), [fftSize, windowType, enableAveraging, enableFiltering, lastResult])
  };
}
