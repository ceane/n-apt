import featureShader from '../../../shaders/native_features.wgsl';
import modelShader from '../../../shaders/native_model.wgsl';
import { extractionParams, validateModel, type NativeFrame, type NativeModel } from './core';

/** One in-flight extraction per owner. Buffers grow with native FFT length, never canvas width. */
export class NativeGpuExtractor {
  private pipeline: GPUComputePipeline;
  private modelPipeline: GPUComputePipeline;
  private buffers: GPUBuffer[] = [];
  private capacity = 0;
  private busy = false;
  private disposed = false;
  private ready: Promise<void>;
  private gpuError?: string;
  constructor(private device: GPUDevice) {
    this.pipeline = null as unknown as GPUComputePipeline;
    this.modelPipeline = null as unknown as GPUComputePipeline;
    this.ready = (async () => {
      const compile = async (code: string, label: string) => {
        const module = device.createShaderModule({ code, label });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(`${label}: ${errors.map(error => error.message).join('; ')}`);
        return device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      };
      [this.pipeline, this.modelPipeline] = await Promise.all([
        compile(featureShader, 'native morphology features'), compile(modelShader, 'native morphology inference'),
      ]);
    })().catch(error => { this.gpuError = error instanceof Error ? error.message : String(error); throw error; });
  }
  dispose() { this.disposed = true; this.buffers.forEach(b => b.destroy()); this.buffers = []; }
  private buffer(size: number, usage: number) { return this.device.createBuffer({ size: Math.max(16, size), usage }); }
  async extract(frame: NativeFrame): Promise<Float32Array> {
    if (this.disposed || this.busy) throw new Error('Native extractor unavailable');
    this.busy = true;
    try {
      await this.ready;
      if (this.disposed) throw new Error(this.gpuError ?? 'Native extractor disposed');
      const params = extractionParams(frame), n = frame.spectrum.length;
      if (n > this.capacity) {
        this.buffers.forEach(b => b.destroy());
        this.capacity = n;
        this.buffers = [this.buffer(n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
          this.buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
          this.buffer(n * 32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
          this.buffer(n * 32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)];
      }
      const [input, uniforms, output, readback] = this.buffers;
      const packed = new ArrayBuffer(16), view = new DataView(packed);
      view.setUint32(0, n, true); view.setUint32(4, params.step, true); view.setUint32(8, params.broad, true); view.setFloat32(12, params.floor, true);
      this.device.queue.writeBuffer(input, 0, frame.spectrum as Float32Array<ArrayBuffer>);
      this.device.queue.writeBuffer(uniforms, 0, packed);
      const bind = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [input, uniforms, output].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, n * 32); this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(readback.getMappedRange().slice(0, n * 32)); readback.unmap();
      return values;
    } finally { this.busy = false; }
  }
  async infer(artifact: NativeModel, features: number[]): Promise<number> {
    const m = validateModel(artifact);
    await this.ready;
    if (this.disposed || features.length !== 18 || features.some(x => !Number.isFinite(x))) throw new Error('Invalid inference input');
    const packed = new Float32Array([m.kind === 'mlp' ? 1 : 0, ...m.mean, ...m.scale, ...m.weights.flat(), ...m.bias, ...(m.outputWeights ?? []), ...(m.kind === 'mlp' ? [m.outputBias!] : [])]);
    const input = this.buffer(features.length * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const weights = this.buffer(packed.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const output = this.buffer(16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const readback = this.buffer(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    try {
      this.device.queue.writeBuffer(input, 0, new Float32Array(features)); this.device.queue.writeBuffer(weights, 0, packed);
      const bind = this.device.createBindGroup({ layout: this.modelPipeline.getBindGroupLayout(0), entries: [input, weights, output].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(this.modelPipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(1); pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, 16); this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ); const score = new Float32Array(readback.getMappedRange())[0]; readback.unmap(); return score;
    } finally { [input, weights, output, readback].forEach(b => b.destroy()); }
  }
}
