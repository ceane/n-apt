import { useRef, useEffect, useCallback, useState } from "react";
import { useAsyncShaderCache } from "@n-apt/hooks/useAsyncShaderCache";
import { useSharedBufferManager } from "@n-apt/hooks/useSharedBufferManager";
import { resampleShader } from "@n-apt/shaders";

// Inlined OverlayTextureRenderer shader
const overlayShader = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  // Fullscreen triangle-strip quad: 0→BL, 1→TL, 2→BR, 3→TR
  let x = select(-1.0, 1.0, (vi & 1u) != 0u);
  let y = select(-1.0, 1.0, (vi & 2u) != 0u);
  let u = (x + 1.0) * 0.5;
  let v = (1.0 - y) * 0.5;  // flip Y for texture coords
  return VertexOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(u, v));
}

@group(0) @binding(0) var overlayTex: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(overlayTex, overlaySampler, uv);
}
`;

// Inlined OverlayTextureRenderer class as type
export class OverlayTextureRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private bindGroupLayout: GPUBindGroupLayout;
  private texture: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private offscreen: OffscreenCanvas;
  private offscreenCtx: OffscreenCanvasRenderingContext2D;
  private texWidth = 0;
  private texHeight = 0;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;

    this.offscreen = new OffscreenCanvas(1, 1);
    this.offscreenCtx = this.offscreen.getContext("2d")!;

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });

    const module = device.createShaderModule({ code: overlayShader });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  beginDraw(
    width: number,
    height: number,
    dpr: number,
  ): OffscreenCanvasRenderingContext2D {
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));

    if (this.offscreen.width !== pw || this.offscreen.height !== ph) {
      this.offscreen.width = pw;
      this.offscreen.height = ph;
      this.offscreenCtx = this.offscreen.getContext("2d")!;
    }

    this.offscreenCtx.clearRect(0, 0, pw, ph);
    this.offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return this.offscreenCtx;
  }

  endDraw(): void {
    const pw = this.offscreen.width;
    const ph = this.offscreen.height;

    if (!this.texture || this.texWidth !== pw || this.texHeight !== ph) {
      if (this.texture) this.texture.destroy();
      this.texture = this.device.createTexture({
        size: [pw, ph],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.texWidth = pw;
      this.texHeight = ph;

      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: this.texture.createView() },
          { binding: 1, resource: this.sampler },
        ],
      });
    }

    this.device.queue.copyExternalImageToTexture(
      { source: this.offscreen },
      { texture: this.texture },
      [pw, ph],
    );
  }

  renderInPass(pass: GPURenderPassEncoder): void {
    if (!this.bindGroup) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4);
  }

  destroy(): void {
    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }
  }
}

// Inlined from gpu/webgpu.ts
let devicePromise: Promise<GPUDevice | null> | null = null;

function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function getWebGPUDevice(): Promise<GPUDevice | null> {
  if (!isWebGPUSupported()) {
    return null;
  }
  if (!devicePromise) {
    devicePromise = (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          return null;
        }

        // Request higher texture dimension limits to support larger canvases
        const device = await adapter.requestDevice({
          requiredLimits: {
            maxTextureDimension2D: Math.min(
              adapter.limits.maxTextureDimension2D,
              16384,
            ),
          },
        });
        return device;
      } catch (error) {
        console.error("Failed to request WebGPU device:", error);
        return null;
      }
    })();
  }
  return devicePromise;
}

function getPreferredCanvasFormat(): GPUTextureFormat {
  return navigator.gpu.getPreferredCanvasFormat();
}

export interface WebGPUInitOptions {
  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  waterfallGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  resampleWgsl: string;
  resampleComputePipelineRef: React.MutableRefObject<GPUComputePipeline | null>;
  resampleParamsBufferRef: React.MutableRefObject<GPUBuffer | null>;
  gpuBufferPoolRef: React.MutableRefObject<GPUBuffer[]>;
}

export function useWebGPUInit({
  spectrumGpuCanvasRef: _spectrumGpuCanvasRef,
  waterfallGpuCanvasRef: _waterfallGpuCanvasRef,
  resampleWgsl,
  resampleComputePipelineRef,
  resampleParamsBufferRef,
  gpuBufferPoolRef,
}: WebGPUInitOptions) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [webgpuReady, setWebgpuReady] = useState(false);
  const [webgpuEnabled, setWebgpuEnabled] = useState(false);
  const [isInitializingWebGPU, setIsInitializingWebGPU] = useState(isWebGPUSupported());

  const webgpuDeviceRef = useRef<GPUDevice | null>(null);
  const webgpuFormatRef = useRef<GPUTextureFormat | null>(null);
  const webgpuContextLostRef = useRef(false);
  const webgpuRetryCountRef = useRef(0);
  const maxWebgpuRetries = 3;

  // Initialize async shader cache and shared buffer manager (only when device is ready)
  const shaderCache = useAsyncShaderCache({
    device: webgpuDeviceRef.current,
    format: webgpuFormatRef.current,
    maxCacheSize: 50,
    enableHotReload: process.env.NODE_ENV === 'development'
  });

  const bufferManager = useSharedBufferManager({
    device: webgpuDeviceRef.current,
    initialPoolSize: 10,
    maxPoolSize: 50,
    bufferSize: 1024 * 1024,
    enableGarbageCollection: true,
    gcInterval: 30000
  });
  
  // Preload essential shaders when device becomes available
  useEffect(() => {
    if (webgpuDeviceRef.current && webgpuFormatRef.current && shaderCache.isInitialized) {
      const preloadShaders = async () => {
        try {
          // Preload compute shaders (vertexCode is used for compute shader detection)
          // Note: fft_compute.wgsl has multiple entry points (fft_compute, fft_window, etc.)
          // spectrum.wgsl has entry points (vs_line, vs_fill) not matching default "vs"
          // waterfall3d shaders have entry point "main" not matching default "vs"
          // These will be compiled on-demand with correct entry points.
          await shaderCache.preloadShaders([
            {
              vertexCode: resampleShader,
              computeCode: resampleShader,
              uniforms: {},
              workgroupSize: [256, 1, 1],
            },
          ]);

          console.log('Shader preloading completed successfully');
        } catch (error) {
          console.warn('Failed to preload shaders:', error);
        }
      };

      preloadShaders();
    }
  }, [webgpuDeviceRef.current, webgpuFormatRef.current, shaderCache.isInitialized]);

  // Overlay texture renderers are still provided by this hook
  const gridOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const markersOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const spikesOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const overlayDirtyRef = useRef({ grid: true, markers: true, spikes: true });
  const overlayLastUploadMsRef = useRef({ grid: 0, markers: 0, spikes: 0 });

  const initializeResamplePipeline = useCallback(
    async (device: GPUDevice) => {
      try {
        const shaderModule = device.createShaderModule({
          code: resampleWgsl,
        });

        const computePipeline = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: shaderModule,
            entryPoint: "main",
          },
        });

        resampleComputePipelineRef.current = computePipeline;

        const paramsBuffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        resampleParamsBufferRef.current = paramsBuffer;
      } catch (error) {
        console.error(
          "Failed to initialize WebGPU resampling pipeline:",
          error,
        );
      }
    },
    [resampleWgsl, resampleComputePipelineRef, resampleParamsBufferRef],
  );

  const initializeWebGPU = useCallback(async () => {
    if (webgpuReady) return;

    try {
      const device = await getWebGPUDevice();
      if (!device) return;

      webgpuDeviceRef.current = device;
      setWebgpuReady(true);

      await initializeResamplePipeline(device);

      for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
          size: 1024 * 1024,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        gpuBufferPoolRef.current.push(buffer);
      }
    } catch (error) {
      console.error("WebGPU initialization failed:", error);
      setWebgpuReady(false);
    }
  }, [webgpuReady, initializeResamplePipeline, gpuBufferPoolRef]);

  useEffect(() => {
    if (!isInitialized) {
      setIsInitialized(true);
      initializeWebGPU();
    }
  }, [isInitialized, initializeWebGPU]);

  useEffect(() => {
    if (!isWebGPUSupported()) return;

    let cancelled = false;
    const doInit = async (retryCount = 0) => {
      try {
        const device = await getWebGPUDevice();
        if (!device || cancelled) {
          throw new Error("Failed to get WebGPU device");
        }

        webgpuDeviceRef.current = device;
        webgpuFormatRef.current = getPreferredCanvasFormat();
        webgpuContextLostRef.current = false;
        webgpuRetryCountRef.current = 0;

        device.onuncapturederror = () => {
          webgpuContextLostRef.current = true;
          setWebgpuEnabled(false);
          setIsInitializingWebGPU(false);

          if (webgpuRetryCountRef.current < maxWebgpuRetries) {
            webgpuRetryCountRef.current++;
            setTimeout(() => {
              if (!cancelled) {
                doInit(webgpuRetryCountRef.current);
              }
            }, 1000 * webgpuRetryCountRef.current);
          }
        };

        device.lost?.then(() => {
          webgpuContextLostRef.current = true;
          setWebgpuEnabled(false);
          setIsInitializingWebGPU(false);

          if (webgpuRetryCountRef.current < maxWebgpuRetries) {
            webgpuRetryCountRef.current++;
            setTimeout(() => {
              if (!cancelled) {
                doInit(webgpuRetryCountRef.current);
              }
            }, 1000 * webgpuRetryCountRef.current);
          }
        });

        setWebgpuEnabled(true);
        setIsInitializingWebGPU(false);
      } catch {
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);
        setIsInitializingWebGPU(false);

        if (retryCount < maxWebgpuRetries) {
          setTimeout(
            () => {
              if (!cancelled) {
                doInit(retryCount + 1);
              }
            },
            1000 * (retryCount + 1),
          );
        }
      }
    };

    doInit();

    return () => {
      cancelled = true;
    };
  }, []);

  // Create overlay renderers once device/format are ready
  useEffect(() => {
    if (!webgpuEnabled || webgpuContextLostRef.current) return;
    const device = webgpuDeviceRef.current;
    const format = webgpuFormatRef.current;
    if (!device || !format) return;

    if (!gridOverlayRendererRef.current) {
      gridOverlayRendererRef.current = new OverlayTextureRenderer(
        device,
        format,
      );
      overlayDirtyRef.current.grid = true;
    }
    if (!markersOverlayRendererRef.current) {
      markersOverlayRendererRef.current = new OverlayTextureRenderer(
        device,
        format,
      );
      overlayDirtyRef.current.markers = true;
    }
    if (!spikesOverlayRendererRef.current) {
      spikesOverlayRendererRef.current = new OverlayTextureRenderer(
        device,
        format,
      );
      overlayDirtyRef.current.spikes = true;
    }
  }, [webgpuEnabled]);

  return {
    isInitialized,
    isInitializingWebGPU,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    spikesOverlayRendererRef,
    overlayDirtyRef,
    overlayLastUploadMsRef,
    // New optimization systems
    shaderCache,
    bufferManager,
  };
}
