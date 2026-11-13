import { FFT_COMPUTE_SHADER } from "@n-apt/shaders";

export type WebGpuIqSpectrumOptions = {
  fftSize: number;
  offsetDb: number;
  windowType?: string;
  centerFrequencyHz: number;
  sampleRateHz: number;
  ppm: number;
  applyPpmCorrection: boolean;
};

const WINDOW_TYPE: Record<string, number> = {
  rectangular: 0,
  none: 0,
  hann: 1,
  hanning: 1,
  hamming: 2,
  blackman: 3,
  nuttall: 4,
};

const windowValue = (index: number, size: number, kind: number): number => {
  if (kind === 0 || size <= 1) return 1;
  const t = index / (size - 1);
  const phase = 2 * Math.PI * t;
  if (kind === 1) return 0.5 - 0.5 * Math.cos(phase);
  if (kind === 2) return 0.54 - 0.46 * Math.cos(phase);
  if (kind === 3) {
    return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
  }
  return (
    0.355768 -
    0.487396 * Math.cos(phase) +
    0.144232 * Math.cos(2 * phase) -
    0.012604 * Math.cos(3 * phase)
  );
};

type Buffers = {
  byteLength: number;
  raw: GPUBuffer;
  input: GPUBuffer;
  output: GPUBuffer;
  temp: GPUBuffer;
  readback: GPUBuffer;
  uniforms: GPUBuffer[];
  bindGroups: {
    window: GPUBindGroup;
    bitReverse: GPUBindGroup;
    fft: GPUBindGroup[];
    power: GPUBindGroup;
  };
  fftSize: number;
  windowKind: number;
};

const destroyBuffers = (buffers: Buffers | null) => {
  if (!buffers) return;
  buffers.raw.destroy();
  buffers.input.destroy();
  buffers.output.destroy();
  buffers.temp.destroy();
  buffers.readback.destroy();
  buffers.uniforms.forEach((buffer) => buffer.destroy());
};

/**
 * Production WebGPU IQ → power-spectrum processor. It runs the same four
 * entry points covered by fft_power_gpu.integration.spec.ts and keeps reusable
 * GPU buffers for the current FFT size.
 */
export class WebGpuIqSpectrumProcessor {
  private readonly pipelines: {
    window: GPUComputePipeline;
    bitReverse: GPUComputePipeline;
    fft: GPUComputePipeline;
    power: GPUComputePipeline;
  };
  private buffers: Buffers | null = null;
  private disposed = false;

  private constructor(private readonly device: GPUDevice) {
    const module = device.createShaderModule({ code: FFT_COMPUTE_SHADER });
    this.pipelines = {
      window: device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "rtl_sdr_iq_to_dbm" },
      }),
      bitReverse: device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "fft_bit_reversal" },
      }),
      fft: device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "fft_compute" },
      }),
      power: device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "rtl_sdr_power_spectrum_dbm" },
      }),
    };
  }

  static async create(): Promise<WebGpuIqSpectrumProcessor | null> {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      return new WebGpuIqSpectrumProcessor(device);
    } catch {
      return null;
    }
  }

  private ensureBuffers(fftSize: number, windowKind: number): Buffers {
    if (
      this.buffers?.fftSize === fftSize &&
      this.buffers.windowKind === windowKind
    ) {
      return this.buffers;
    }

    destroyBuffers(this.buffers);
    const byteLength = fftSize * 8;
    const storageUsage =
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const raw = this.device.createBuffer({
      size: fftSize * 2,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const input = this.device.createBuffer({ size: byteLength, usage: storageUsage });
    const output = this.device.createBuffer({ size: byteLength, usage: storageUsage });
    const temp = this.device.createBuffer({ size: byteLength, usage: storageUsage });
    const readback = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Use a separate uniform buffer per dispatch so all FFT stages can be
    // encoded into one command submission without racing writeBuffer updates.
    const stageCount = Math.log2(fftSize);
    const uniforms = Array.from({ length: stageCount + 3 }, () =>
      this.device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    );
    const bind = (
      pipeline: GPUComputePipeline,
      entries: Array<{ binding: number; resource: { buffer: GPUBuffer } }>,
    ) => this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries,
    });

    const window = bind(this.pipelines.window, [
      { binding: 1, resource: { buffer: output } },
      { binding: 3, resource: { buffer: uniforms[0] } },
      { binding: 4, resource: { buffer: raw } },
    ]);
    const bitReverse = bind(this.pipelines.bitReverse, [
      { binding: 1, resource: { buffer: output } },
      { binding: 2, resource: { buffer: temp } },
      { binding: 3, resource: { buffer: uniforms[1] } },
    ]);
    const fft = Array.from({ length: stageCount }, (_, stage) =>
      bind(this.pipelines.fft, [
        { binding: 1, resource: { buffer: output } },
        { binding: 2, resource: { buffer: temp } },
        { binding: 3, resource: { buffer: uniforms[stage + 2] } },
      ]),
    );
    const power = bind(this.pipelines.power, [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: output } },
      { binding: 3, resource: { buffer: uniforms[stageCount + 2] } },
    ]);

    this.buffers = {
      byteLength,
      raw,
      input,
      output,
      temp,
      readback,
      uniforms,
      bindGroups: { window, bitReverse, fft, power },
      fftSize,
      windowKind,
    };
    return this.buffers;
  }

  private writeParams(
    buffer: GPUBuffer,
    options: WebGpuIqSpectrumOptions,
    windowKind: number,
    normalization: number,
    stage: number,
  ) {
    const params = new ArrayBuffer(80);
    const view = new DataView(params);
    view.setUint32(0, stage, true);
    view.setInt32(4, 1, true);
    view.setUint32(8, options.fftSize, true);
    view.setUint32(12, windowKind, true);
    view.setFloat32(16, normalization, true);
    view.setFloat32(20, -120, true);
    view.setFloat32(24, 0, true);
    view.setUint32(28, options.fftSize, true);
    view.setFloat32(32, options.centerFrequencyHz, true);
    view.setFloat32(36, options.sampleRateHz, true);
    view.setFloat32(40, 0, true);
    view.setFloat32(44, options.offsetDb, true);
    view.setFloat32(48, 0, true);
    view.setUint32(52, 0, true);
    view.setFloat32(56, 0, true);
    view.setUint32(60, 0, true);
    const correctionHz = options.applyPpmCorrection
      ? (options.centerFrequencyHz * options.ppm) / 1_000_000
      : 0;
    view.setFloat32(64, correctionHz, true);
    view.setUint32(68, options.applyPpmCorrection && correctionHz !== 0 ? 1 : 0, true);
    view.setUint32(72, 0, true);
    view.setUint32(76, 0, true);
    this.device.queue.writeBuffer(buffer, 0, params);
  }

  async process(
    iq: Uint8Array,
    options: WebGpuIqSpectrumOptions,
  ): Promise<Float32Array> {
    if (this.disposed) throw new Error("WebGPU IQ processor is disposed");
    const { fftSize } = options;
    if (
      fftSize < 2 ||
      (fftSize & (fftSize - 1)) !== 0 ||
      iq.byteLength < fftSize * 2 ||
      !Number.isFinite(options.sampleRateHz) ||
      options.sampleRateHz <= 0
    ) {
      throw new RangeError("Invalid IQ data or WebGPU FFT parameters");
    }

    const windowKind = WINDOW_TYPE[(options.windowType ?? "hanning").toLowerCase()] ?? 1;
    const buffers = this.ensureBuffers(fftSize, windowKind);
    const rawIq = iq.byteLength === fftSize * 2
      ? iq
      : iq.subarray(iq.byteLength - fftSize * 2);
    this.device.queue.writeBuffer(buffers.raw, 0, rawIq);

    let windowEnergy = 0;
    for (let index = 0; index < fftSize; index++) {
      const value = windowValue(index, fftSize, windowKind);
      windowEnergy += value * value;
    }
    const normalization = fftSize * windowEnergy;
    const stageCount = Math.log2(fftSize);
    this.writeParams(buffers.uniforms[0], options, windowKind, normalization, 0);
    this.writeParams(buffers.uniforms[1], options, windowKind, normalization, stageCount);
    for (let stage = 0; stage < stageCount; stage++) {
      this.writeParams(
        buffers.uniforms[stage + 2],
        options,
        windowKind,
        normalization,
        stage,
      );
    }
    this.writeParams(
      buffers.uniforms[stageCount + 2],
      options,
      windowKind,
      normalization,
      0,
    );

    const encoder = this.device.createCommandEncoder();
    const dispatch = (
      pipeline: GPUComputePipeline,
      bindGroup: GPUBindGroup,
      workgroups: number,
    ) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    };

    dispatch(this.pipelines.window, buffers.bindGroups.window, Math.ceil(fftSize / 256));
    encoder.copyBufferToBuffer(buffers.output, 0, buffers.temp, 0, buffers.byteLength);
    dispatch(this.pipelines.bitReverse, buffers.bindGroups.bitReverse, Math.ceil(fftSize / 256));
    encoder.copyBufferToBuffer(buffers.output, 0, buffers.temp, 0, buffers.byteLength);
    for (let stage = 0; stage < stageCount; stage++) {
      dispatch(this.pipelines.fft, buffers.bindGroups.fft[stage], Math.ceil(fftSize / 2 / 256));
      encoder.copyBufferToBuffer(buffers.output, 0, buffers.temp, 0, buffers.byteLength);
    }
    encoder.copyBufferToBuffer(buffers.output, 0, buffers.input, 0, buffers.byteLength);
    dispatch(this.pipelines.power, buffers.bindGroups.power, Math.ceil(fftSize / 256));
    encoder.copyBufferToBuffer(buffers.output, 0, buffers.readback, 0, buffers.byteLength);
    this.device.queue.submit([encoder.finish()]);

    await buffers.readback.mapAsync(GPUMapMode.READ);
    const interleaved = new Float32Array(buffers.readback.getMappedRange().slice(0));
    buffers.readback.unmap();
    const spectrum = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index++) {
      spectrum[index] = interleaved[index * 2];
    }
    return spectrum;
  }

  dispose() {
    this.disposed = true;
    destroyBuffers(this.buffers);
    this.buffers = null;
    this.device.destroy();
  }
}
