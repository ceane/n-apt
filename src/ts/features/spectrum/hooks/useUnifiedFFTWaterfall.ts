import { useCallback, useRef, useEffect, useState } from "react";
import { FFT_COMPUTE_SHADER } from "@n-apt/shaders";

export interface UnifiedFFTWaterfallOptions {
  device: GPUDevice | null;
  fftSize: number;
  waterfallHeight: number;
  windowType?: "rectangular" | "hanning" | "hamming" | "blackman" | "nuttall";
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
  calibrationMode?: "generic" | "rtl_sdr" | "hackrf_one";
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

// Global maximums to prevent re-allocations
const MAX_FFT_SIZE = 262144;
const MAX_WATERFALL_WIDTH = 16384; // Hardware limit

const shaderWindowPowerNormalization = (
  fftSize: number,
  windowType: UnifiedFFTWaterfallOptions["windowType"],
) => {
  const size = Math.max(1, fftSize);
  let energy = 0;

  for (let index = 0; index < size; index++) {
    const t = size <= 1 ? 0 : index / (size - 1);
    let coefficient = 1;
    switch (windowType) {
      case "hanning":
        coefficient = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
        break;
      case "hamming":
        coefficient = 0.54 - 0.46 * Math.cos(2 * Math.PI * t);
        break;
      case "blackman":
        coefficient =
          0.42 -
          0.5 * Math.cos(2 * Math.PI * t) +
          0.08 * Math.cos(4 * Math.PI * t);
        break;
      case "nuttall":
        coefficient =
          0.355768 -
          0.487396 * Math.cos(2 * Math.PI * t) +
          0.144232 * Math.cos(4 * Math.PI * t) -
          0.012604 * Math.cos(6 * Math.PI * t);
        break;
      default:
        break;
    }
    energy += coefficient * coefficient;
  }

  return Math.max(size * energy, 1e-20);
};

export function useUnifiedFFTWaterfall(options: UnifiedFFTWaterfallOptions) {
  const {
    device,
    fftSize,
    waterfallHeight,
    windowType = "hanning",
    enableAveraging = false,
    enableSmoothing = false,
    normalizationFactor = 1.0,
  } = options;

  // Pipeline references
  const fftWindowPipelineRef = useRef<GPUComputePipeline | null>(null);
  const bitReversalPipelineRef = useRef<GPUComputePipeline | null>(null);
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
    bitReversal: GPUBindGroup | null;
    rtlIqWindow: GPUBindGroup | null;
    fft_AB: GPUBindGroup | null;
    fft_BA: GPUBindGroup | null;
    powerSpectrum: GPUBindGroup | null;
    dbmSpectrum: GPUBindGroup | null;
    waterfall: GPUBindGroup | null;
    averaging: GPUBindGroup | null;
    smoothing: GPUBindGroup | null;
  }>({
    fftWindow: null,
    bitReversal: null,
    rtlIqWindow: null,
    fft_AB: null,
    fft_BA: null,
    powerSpectrum: null,
    dbmSpectrum: null,
    waterfall: null,
    averaging: null,
    smoothing: null,
  });

  // State management
  const [isInitialized, setIsInitialized] = useState(false);
  const isProcessingRef = useRef(false);
  const lastResultRef = useRef<UnifiedProcessingResult | null>(null);
  const frameCountRef = useRef(0);

  // Window type mapping
  const windowTypeMap = {
    rectangular: 0,
    hanning: 1,
    hamming: 2,
    blackman: 3,
    nuttall: 4,
  };

  const calibrationModeMap = {
    generic: 0,
    rtl_sdr: 1,
    hackrf_one: 2,
  } as const;

  // Initialize unified buffers with pooling logic
  const initializeBuffers = useCallback(() => {
    if (!device) return;

    // Check if we can reuse existing buffers (must be large enough)
    const existing = buffersRef.current;
    const requiredComplexSize = MAX_FFT_SIZE * 8;
    const requiredWaterfallWidth = Math.min(MAX_FFT_SIZE, MAX_WATERFALL_WIDTH);

    if (existing && existing.fftInputBuffer.size >= requiredComplexSize) {
      // Re-initialize texture if height or width actually changed (rare)
      if (existing.waterfallTexture.height !== waterfallHeight) {
        existing.waterfallTexture.destroy();
        existing.waterfallTexture = device.createTexture({
          size: [requiredWaterfallWidth, waterfallHeight],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      return;
    }

    // Clean up if we must re-allocate
    if (existing) {
      Object.values(existing).forEach((res) => {
        if (res && typeof res.destroy === "function") res.destroy();
      });
    }

    const rawIqSize = Math.ceil((MAX_FFT_SIZE * 2) / 4) * 4;
    const complexSize = MAX_FFT_SIZE * 8;
    // Paged params buffer to avoid race conditions: 32 slots * 256 byte alignment
    const paramsAlignment =
      device.limits.minUniformBufferOffsetAlignment || 256;
    const paramsSize = 32 * paramsAlignment;
    const waterfallBufferSize = requiredWaterfallWidth * 8;

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
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const fftTempBuffer = device.createBuffer({
      size: complexSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const fftParamsBuffer = device.createBuffer({
      size: paramsSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sharedSpectrumBuffer = device.createBuffer({
      size: complexSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const waterfallTexture = device.createTexture({
      size: [requiredWaterfallWidth, waterfallHeight],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const waterfallBuffer = device.createBuffer({
      size: waterfallBufferSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    buffersRef.current = {
      rawIqBuffer,
      fftInputBuffer,
      fftOutputBuffer,
      fftTempBuffer,
      fftParamsBuffer,
      waterfallTexture,
      waterfallBuffer,
      sharedSpectrumBuffer,
    };
  }, [device, waterfallHeight]);

  // Create unified pipelines
  const createPipelines = useCallback(async () => {
    if (!device || !buffersRef.current) return;

    try {
      const shaderModule = device.createShaderModule({
        code: FFT_COMPUTE_SHADER,
      });

      // Explicit layouts to support dynamic offsets for parameter paging
      const paramsLayoutEntry = {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "uniform" as const,
          hasDynamicOffset: true,
          minBindingSize: 64,
        },
      };

      const genericLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" as const },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" as const },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" as const },
          },
          paramsLayoutEntry,
          {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" as const },
          },
        ],
      });

      const unpackLayout = genericLayout;
      const fftLayout = genericLayout;
      const spectrumLayout = genericLayout;

      // Preprocess pipeline
      fftWindowPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [genericLayout],
        }),
        compute: { module: shaderModule, entryPoint: "fft_window" },
      });

      bitReversalPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [genericLayout],
        }),
        compute: { module: shaderModule, entryPoint: "fft_bit_reversal" },
      });

      rtlIqWindowPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [unpackLayout],
        }),
        compute: { module: shaderModule, entryPoint: "rtl_sdr_iq_to_dbm" },
      });

      // FFT pipeline
      fftPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [fftLayout] }),
        compute: { module: shaderModule, entryPoint: "fft_compute" },
      });

      // Power spectrum pipelines
      powerSpectrumPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [spectrumLayout],
        }),
        compute: { module: shaderModule, entryPoint: "fft_power_spectrum" },
      });

      dbmSpectrumPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [spectrumLayout],
        }),
        compute: {
          module: shaderModule,
          entryPoint: "rtl_sdr_power_spectrum_dbm",
        },
      });

      // Direct waterfall pipeline
      waterfallDirectPipelineRef.current = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [spectrumLayout],
        }),
        compute: {
          module: shaderModule,
          entryPoint: "waterfall_buffer_update",
        },
      });

      if (enableAveraging) {
        averagingPipelineRef.current = device.createComputePipeline({
          layout: device.createPipelineLayout({
            bindGroupLayouts: [genericLayout],
          }),
          compute: { module: shaderModule, entryPoint: "fft_average" },
        });
      }

      if (enableSmoothing) {
        smoothingPipelineRef.current = device.createComputePipeline({
          layout: device.createPipelineLayout({
            bindGroupLayouts: [spectrumLayout],
          }),
          compute: { module: shaderModule, entryPoint: "fft_smooth" },
        });
      }

      const buffers = buffersRef.current;

      // Bind Group: Preprocessing
      bindGroupsRef.current.fftWindow = device.createBindGroup({
        layout: fftWindowPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftInputBuffer } },
          { binding: 1, resource: { buffer: buffers.fftOutputBuffer } }, // Dummy
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } },
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      bindGroupsRef.current.bitReversal = device.createBindGroup({
        layout: bitReversalPipelineRef.current!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftInputBuffer } }, // Dummy
          { binding: 1, resource: { buffer: buffers.fftOutputBuffer } },
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } },
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      bindGroupsRef.current.rtlIqWindow = device.createBindGroup({
        layout: rtlIqWindowPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftInputBuffer } }, // Dummy
          { binding: 1, resource: { buffer: buffers.fftTempBuffer } },
          { binding: 2, resource: { buffer: buffers.fftOutputBuffer } }, // Dummy
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } },
        ],
      });

      // FFT Ping-Pong Bind Groups with Dynamic Offsets
      bindGroupsRef.current.fft_AB = device.createBindGroup({
        layout: fftPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftInputBuffer } }, // Dummy
          { binding: 1, resource: { buffer: buffers.fftTempBuffer } }, // Output
          { binding: 2, resource: { buffer: buffers.fftOutputBuffer } }, // Input
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      bindGroupsRef.current.fft_BA = device.createBindGroup({
        layout: fftPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftInputBuffer } }, // Dummy
          { binding: 1, resource: { buffer: buffers.fftOutputBuffer } }, // Output
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } }, // Input
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      // Spectrum Readback Bind Groups
      bindGroupsRef.current.powerSpectrum = device.createBindGroup({
        layout: powerSpectrumPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftOutputBuffer } },
          { binding: 1, resource: { buffer: buffers.sharedSpectrumBuffer } },
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } }, // Dummy
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      bindGroupsRef.current.dbmSpectrum = device.createBindGroup({
        layout: dbmSpectrumPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.fftOutputBuffer } },
          { binding: 1, resource: { buffer: buffers.sharedSpectrumBuffer } },
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } }, // Dummy
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      bindGroupsRef.current.waterfall = device.createBindGroup({
        layout: waterfallDirectPipelineRef.current.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.sharedSpectrumBuffer } },
          { binding: 1, resource: { buffer: buffers.waterfallBuffer } },
          { binding: 2, resource: { buffer: buffers.fftTempBuffer } }, // Dummy
          {
            binding: 3,
            resource: { buffer: buffers.fftParamsBuffer, offset: 0, size: 64 },
          },
          { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
        ],
      });

      if (averagingPipelineRef.current) {
        bindGroupsRef.current.averaging = device.createBindGroup({
          layout: averagingPipelineRef.current.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: buffers.sharedSpectrumBuffer } },
            { binding: 1, resource: { buffer: buffers.fftOutputBuffer } },
            { binding: 2, resource: { buffer: buffers.fftTempBuffer } },
            {
              binding: 3,
              resource: {
                buffer: buffers.fftParamsBuffer,
                offset: 0,
                size: 64,
              },
            },
            { binding: 4, resource: { buffer: buffers.rawIqBuffer } }, // Dummy
          ],
        });
      }
    } catch (error) {
      console.error("Failed to create unified pipelines:", error);
    }
  }, [device, enableAveraging, enableSmoothing]);

  // Update FFT parameters with paging to avoid race conditions
  const updateParams = useCallback(
    (
      slot: number,
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
        calibrationMode?: "generic" | "rtl_sdr" | "hackrf_one";
      },
    ) => {
      if (!device || !buffersRef.current) return;

      const waterfallWidth = Math.min(fftSize, MAX_WATERFALL_WIDTH);
      const paramsBuffer = new ArrayBuffer(64);
      const floatView = new Float32Array(paramsBuffer);
      const uintView = new Uint32Array(paramsBuffer);

      uintView[0] = stage;
      new Int32Array(paramsBuffer)[1] = direction;
      uintView[2] = fftSize;
      uintView[3] =
        windowTypeValue ??
        windowTypeMap[windowType as keyof typeof windowTypeMap];
      floatView[4] = normalizationOverride ?? normalizationFactor;
      floatView[5] = minDbValue ?? -120.0;
      floatView[6] = maxDbValue ?? 0.0;
      uintView[7] = waterfallWidth;
      floatView[8] = calibrationOptions?.centerFrequencyHz ?? 0.0;
      floatView[9] = calibrationOptions?.sampleRateHz ?? 0.0;
      floatView[10] = calibrationOptions?.tunerGainDb ?? 0.0;
      floatView[11] = calibrationOptions?.baseCalibrationDb ?? 0.0;
      floatView[12] = calibrationOptions?.chainLossDb ?? 0.0;
      uintView[13] =
        calibrationModeMap[calibrationOptions?.calibrationMode ?? "generic"];

      const alignment = device.limits.minUniformBufferOffsetAlignment || 256;
      device.queue.writeBuffer(
        buffersRef.current.fftParamsBuffer,
        slot * alignment,
        paramsBuffer,
      );
    },
    [device, fftSize, windowType, normalizationFactor, windowTypeMap],
  );

  // Optimized processUnified with Bit-Reversal and Ping-Ponging
  const processUnified = useCallback(
    async (
      inputData: Float32Array | Uint8Array,
      processOptions?: UnifiedProcessOptions,
    ): Promise<UnifiedProcessingResult> => {
      if (!isInitialized || !device || !buffersRef.current) {
        throw new Error("Unified FFT system not initialized");
      }

      isProcessingRef.current = true;
      const inputMode = processOptions?.inputMode ?? "real";
      const powerMode = processOptions?.powerMode ?? "db";
      const minDb = processOptions?.minDb ?? -120.0;
      const maxDb = processOptions?.maxDb ?? 0.0;
      const waterfallWidth = Math.min(fftSize, MAX_WATERFALL_WIDTH);

      // All pipelines are power-referenced (10·log10(mag²/N·Σw²)) so the GPU
      // path matches the backend SIMD spectra and summing linear bins
      // recovers complex RMS power regardless of mode.
      const activeNormalization = shaderWindowPowerNormalization(
        fftSize,
        windowType,
      );

      const calibrationOptions = {
        centerFrequencyHz: processOptions?.centerFrequencyHz ?? 0,
        sampleRateHz: processOptions?.hardwareSampleRateHz ?? 0,
        tunerGainDb: processOptions?.tunerGainDb ?? 0,
        baseCalibrationDb: processOptions?.baseCalibrationDb ?? 15.0,
        chainLossDb: processOptions?.chainLossDb ?? 2.5,
        calibrationMode: processOptions?.calibrationMode ?? "generic",
      };

      const alignment = device.limits.minUniformBufferOffsetAlignment || 256;

      try {
        // Step 1: Upload Data
        if (inputMode === "complex_iq") {
          device.queue.writeBuffer(
            buffersRef.current.rawIqBuffer,
            0,
            inputData.buffer,
            inputData.byteOffset,
            inputData.byteLength,
          );
        } else {
          const complexInput = new Float32Array(fftSize * 2);
          for (let i = 0; i < fftSize; i++) complexInput[i * 2] = inputData[i];
          device.queue.writeBuffer(
            buffersRef.current.fftInputBuffer,
            0,
            complexInput.buffer,
          );
        }

        const encoder = device.createCommandEncoder();

        // Step 2: Windowing (Slot 0)
        updateParams(
          0,
          0,
          1,
          undefined,
          minDb,
          maxDb,
          activeNormalization,
          calibrationOptions,
        );
        const windowPass = encoder.beginComputePass();
        if (inputMode === "complex_iq" && rtlIqWindowPipelineRef.current) {
          windowPass.setPipeline(rtlIqWindowPipelineRef.current);
          windowPass.setBindGroup(0, bindGroupsRef.current.rtlIqWindow!, [0]);
        } else if (fftWindowPipelineRef.current) {
          windowPass.setPipeline(fftWindowPipelineRef.current);
          windowPass.setBindGroup(0, bindGroupsRef.current.fftWindow!, [0]);
        }
        windowPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        windowPass.end();

        // Step 3: Bit-Reversal (Slot 1)
        updateParams(1, Math.log2(fftSize), 1);
        const brPass = encoder.beginComputePass();
        brPass.setPipeline(bitReversalPipelineRef.current!);
        brPass.setBindGroup(0, bindGroupsRef.current.bitReversal!, [
          1 * alignment,
        ]);
        brPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        brPass.end();

        // Step 4: Multi-stage Ping-Pong FFT (Slots 2-19)
        const numStages = Math.log2(fftSize);
        for (let stage = 0; stage < numStages; stage++) {
          const slot = 2 + stage;
          updateParams(slot, stage, 1);
          const fftPass = encoder.beginComputePass();
          fftPass.setPipeline(fftPipelineRef.current!);
          // Toggle bind groups to swap input/output roles
          const bindGroup =
            stage % 2 === 0
              ? bindGroupsRef.current.fft_AB!
              : bindGroupsRef.current.fft_BA!;
          fftPass.setBindGroup(0, bindGroup, [slot * alignment]);
          fftPass.dispatchWorkgroups(Math.ceil(fftSize / 512));
          fftPass.end();
        }

        // If even number of stages, final result is in fftOutputBuffer.
        if (numStages % 2 !== 0) {
          encoder.copyBufferToBuffer(
            buffersRef.current.fftTempBuffer,
            0,
            buffersRef.current.fftOutputBuffer,
            0,
            fftSize * 8,
          );
        }

        // Step 5: Power Spectrum (includes FFT Shift) (Slot 20)
        updateParams(
          20,
          0,
          1,
          undefined,
          minDb,
          maxDb,
          activeNormalization,
          calibrationOptions,
        );
        const powerPass = encoder.beginComputePass();
        const spectrumPipeline =
          powerMode === "dbm" && dbmSpectrumPipelineRef.current
            ? dbmSpectrumPipelineRef.current
            : powerSpectrumPipelineRef.current!;
        const spectrumBG =
          powerMode === "dbm" && bindGroupsRef.current.dbmSpectrum
            ? bindGroupsRef.current.dbmSpectrum
            : bindGroupsRef.current.powerSpectrum!;
        powerPass.setPipeline(spectrumPipeline);
        powerPass.setBindGroup(0, spectrumBG, [20 * alignment]);
        powerPass.dispatchWorkgroups(Math.ceil(fftSize / 256));
        powerPass.end();

        // Step 6: Waterfall Decimation (Max-Pooling) (Slot 21)
        updateParams(
          21,
          0,
          1,
          undefined,
          minDb,
          maxDb,
          activeNormalization,
          calibrationOptions,
        );
        const waterfallPass = encoder.beginComputePass();
        waterfallPass.setPipeline(waterfallDirectPipelineRef.current!);
        waterfallPass.setBindGroup(0, bindGroupsRef.current.waterfall!, [
          21 * alignment,
        ]);
        waterfallPass.dispatchWorkgroups(Math.ceil(waterfallWidth / 256));
        waterfallPass.end();

        // Copy to Texture
        encoder.copyBufferToTexture(
          {
            buffer: buffersRef.current.waterfallBuffer,
            bytesPerRow: waterfallWidth * 4,
            rowsPerImage: 1,
          },
          {
            texture: buffersRef.current.waterfallTexture,
            origin: [0, frameCountRef.current % waterfallHeight, 0],
          },
          [waterfallWidth, 1, 1],
        );

        device.queue.submit([encoder.finish()]);

        // Step 7: Readback (Extract .real)
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
          complexReadSize,
        );
        device.queue.submit([readEncoder.finish()]);

        await resultBuffer.mapAsync(GPUMapMode.READ);
        const complexData = new Float32Array(
          resultBuffer.getMappedRange().slice(0),
        );
        resultBuffer.unmap();
        resultBuffer.destroy();

        const spectrumData = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) spectrumData[i] = complexData[i * 2];

        frameCountRef.current++;
        const result = {
          spectrumData,
          waterfallTexture: buffersRef.current.waterfallTexture,
          processedAt: performance.now(),
          frameCount: frameCountRef.current,
        };
        lastResultRef.current = result;
        return result;
      } finally {
        isProcessingRef.current = false;
      }
    },
    [
      isInitialized,
      device,
      fftSize,
      waterfallHeight,
      windowType,
      normalizationFactor,
      updateParams,
    ],
  );

  useEffect(() => {
    if (!device) return;
    initializeBuffers();
    createPipelines().then(() => setIsInitialized(true));
  }, [device, initializeBuffers, createPipelines]);

  useEffect(() => {
    return () => {
      if (buffersRef.current) {
        Object.values(buffersRef.current).forEach((res) => {
          if (res && typeof res.destroy === "function") res.destroy();
        });
      }
    };
  }, []);

  return {
    isInitialized,
    isProcessing: isProcessingRef.current,
    lastResult: lastResultRef.current,
    processUnified,
    getWaterfallTexture: useCallback(
      () => buffersRef.current?.waterfallTexture || null,
      [],
    ),
    getBuffers: useCallback(() => buffersRef.current, []),
    getProcessingStats: useCallback(
      () => ({
        fftSize,
        waterfallHeight,
        windowType,
        enableAveraging,
        enableSmoothing,
        frameCount: frameCountRef.current,
        lastProcessedAt: lastResultRef.current?.processedAt || null,
      }),
      [fftSize, waterfallHeight, windowType, enableAveraging, enableSmoothing],
    ),
  };
}
