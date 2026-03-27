// Global type declarations for enhanced canvas mocking

declare global {
  var __WEBGL_CALLS__: Array<{
    name: string;
    args: any[];
  }>;
  
  var __WEBGPU_CALLS__: Array<{
    name: string;
    args: any[];
  }>;
  
  var __CANVAS_CALLS__: Array<{
    name: string;
    args: any[];
  }>;
  
  // Helper functions for testing
  function clearCanvasCalls(): void;
  function expectWebGLCall(callName: string, args?: any[]): any;
  function expectWebGPUCall(callName: string, args?: any[]): any;
  function expectCanvasContext(contextType: string): any;
  function countWebGLCalls(callName: string): number;
  function countWebGPUCalls(callName: string): number;
  function getWebGLCalls(callName: string): any[];
  function getWebGPUCalls(callName: string): any[];
}

// Mock GPU types
interface GPUBufferUsage {
  readonly INDEX: 0x00000001;
  readonly VERTEX: 0x00000002;
  readonly UNIFORM: 0x00000004;
  readonly STORAGE: 0x00000008;
  readonly INDIRECT: 0x00000010;
  readonly QUERY_RESOLVE: 0x00000020;
}

interface GPUTextureUsage {
  readonly COPY_SRC: 0x00000001;
  readonly COPY_DST: 0x00000002;
  readonly TEXTURE_BINDING: 0x00000004;
  readonly STORAGE_BINDING: 0x00000008;
  readonly RENDER_ATTACHMENT: 0x00000010;
}

interface GPUCommandEncoderDescriptor {
  label?: string;
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  clearValue?: GPUColor;
  loadOp: GPULoadOp;
  storeOp: GPUStoreOp;
}

interface GPURenderPassDescriptor {
  colorAttachments: GPURenderPassColorAttachment[];
  depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
}

interface GPUBufferDescriptor {
  label?: string;
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

interface GPUTextureDescriptor {
  label?: string;
  size: { width: number; height: number; depthOrArrayLayers?: number };
  format: GPUTextureFormat;
  usage: number;
  mipLevelCount?: number;
  sampleCount?: number;
}

interface GPUColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

type GPULoadOp = 'load' | 'clear';
type GPUStoreOp = 'store' | 'discard';
type GPUTextureFormat = 'bgra8unorm' | 'rgba8unorm' | 'rgba32float' | string;

// Mock classes
interface MockGPUBuffer {
  mapAsync(mode: number): Promise<void>;
  unmap(): void;
  destroy(): void;
  size: number;
  usage: number;
}

interface MockGPUTexture {
  createView(): GPUTextureView;
  destroy(): void;
  width: number;
  height: number;
  format: GPUTextureFormat;
}

interface MockGPUCommandEncoder {
  finish(): GPUCommandBuffer;
  beginComputePass(): GPUComputePassEncoder;
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  copyBufferToBuffer(src: GPUBuffer, srcOffset: number, dst: GPUBuffer, dstOffset: number, size: number): void;
  copyBufferToTexture(src: any, dst: any, copySize: any): void;
  copyTextureToBuffer(src: any, dst: any, copySize: any): void;
  copyTextureToTexture(src: any, dst: any, copySize: any): void;
}

interface MockGPUDevice {
  createBuffer(descriptor: GPUBufferDescriptor): MockGPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): MockGPUTexture;
  createBindGroup(descriptor: any): any;
  createBindGroupLayout(descriptor: any): any;
  createComputePipeline(descriptor: any): any;
  createRenderPipeline(descriptor: any): any;
  createShaderModule(descriptor: any): any;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): MockGPUCommandEncoder;
  createSampler(descriptor?: any): any;
  createPipelineLayout(descriptor: any): any;
  createQuerySet(descriptor: any): any;
  importExternalTexture(descriptor: any): any;
  destroy(): void;
  lost: Promise<{ reason: string }>;
  queue: GPUQueue;
}

interface MockGPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferView | ArrayBuffer): void;
  onSubmittedWorkDone(): Promise<void>;
}

interface MockGPUAdapter {
  requestDevice(): Promise<MockGPUDevice>;
}

// Extend global navigator
interface Navigator {
  gpu: {
    requestAdapter(): Promise<MockGPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  };
}

export {};
