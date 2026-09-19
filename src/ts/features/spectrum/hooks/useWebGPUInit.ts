import { useRef, useEffect, useCallback, useState } from "react";
import { useAsyncShaderCache } from "@n-apt/spectrum/hooks/useAsyncShaderCache";
import { useSharedBufferManager } from "@n-apt/spectrum/hooks/useSharedBufferManager";
import { resampleShader } from "@n-apt/shaders";
import { acquireSharedWebGpuDevice } from "@n-apt/app/infrastructure/visualization/webgpuDevicePool";

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

/**
 * Monotonic identity for overlay renderer instances. A rebuilt renderer starts
 * with no texture, so any cache deciding whether the overlay must be redrawn
 * has to treat a new instance as new content — see `useSpectrumRenderer`.
 */
let overlayRendererGeneration = 0;

// Inlined OverlayTextureRenderer class as type
export class OverlayTextureRenderer {
  readonly generation: number;
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
    this.generation = ++overlayRendererGeneration;
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
    // The bind group holds a view of `texture`. A destroyed renderer must never
    // composite: drawing a dead texture view drops the overlay (grid, markers)
    // while the spectrum trace, which uploads fresh resources every frame,
    // keeps painting.
    if (!this.texture || !this.bindGroup) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4);
  }

  destroy(): void {
    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }
    this.bindGroup = null;
  }
}

function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function getWebGPUDevice(): Promise<GPUDevice | null> {
  return isWebGPUSupported() ? acquireSharedWebGpuDevice() : null;
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

export function useWebGPULifecycle({
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
  const [isInitializingWebGPU, setIsInitializingWebGPU] =
    useState(isWebGPUSupported());

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
    enableHotReload: process.env.NODE_ENV === "development",
  });

  const bufferManager = useSharedBufferManager({
    device: webgpuDeviceRef.current,
    initialPoolSize: 10,
    maxPoolSize: 50,
    bufferSize: 1024 * 1024,
    enableGarbageCollection: true,
    gcInterval: 30000,
  });

  // Preload essential shaders when device becomes available
  useEffect(() => {
    if (
      webgpuDeviceRef.current &&
      webgpuFormatRef.current &&
      shaderCache.isInitialized
    ) {
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
        } catch (error) {
          console.warn("Failed to preload shaders:", error);
        }
      };

      preloadShaders();
    }
  }, [
    webgpuDeviceRef.current,
    webgpuFormatRef.current,
    shaderCache.isInitialized,
  ]);

  // Overlay texture renderers are still provided by this hook
  const gridOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const markersOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const spikesOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const overlayDirtyRef = useRef({ grid: true, markers: true, spikes: true });
  const overlayLastUploadMsRef = useRef({ grid: 0, markers: 0, spikes: 0 });

  /**
   * The overlay textures (grid, markers, spikes) are composed in the same pass
   * as the spectrum itself. They must exist before the canvas is allowed to
   * paint: creating them from an effect leaves the first painted frame without
   * a grid, and the axis/label chrome pops in a frame later. A rebuilt renderer
   * starts with no texture, so the dirty flags are re-armed with it.
   */
  const buildOverlayRenderers = useCallback(
    (device: GPUDevice, format: GPUTextureFormat) => {
      const rendererRefs = [
        gridOverlayRendererRef,
        markersOverlayRendererRef,
        spikesOverlayRendererRef,
      ];
      for (const rendererRef of rendererRefs) {
        rendererRef.current?.destroy();
        rendererRef.current = new OverlayTextureRenderer(device, format);
      }
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      overlayDirtyRef.current.spikes = true;
    },
    [],
  );

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
          size: 48,
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

  const initializationAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    initializationAbortRef.current = controller;
    return () => controller.abort();
  }, []);

  const initializeWebGPU = useCallback(async () => {
    const signal = initializationAbortRef.current?.signal;
    if (webgpuReady || !signal || signal.aborted) return;

    try {
      const device = await getWebGPUDevice();
      if (!device || signal.aborted) return;

      webgpuDeviceRef.current = device;
      setWebgpuReady(true);

      await initializeResamplePipeline(device);
      if (signal.aborted) return;

      for (let i = 0; i < 2; i++) {
        const buffer = device.createBuffer({
          size: 1024 * 1024,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        gpuBufferPoolRef.current.push(buffer);
      }

      // Clean up any existing textures to force fresh initialization
      if (shaderCache.isInitialized) {
        shaderCache.clearCache();
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error("WebGPU initialization failed:", error);
      setWebgpuReady(false);
    }
  }, [webgpuReady, initializeResamplePipeline, gpuBufferPoolRef, shaderCache]);

  useEffect(() => {
    if (!isInitialized) {
      setIsInitialized(true);
      initializeWebGPU();
    }
  }, [isInitialized, initializeWebGPU]);

  useEffect(() => {
    if (!isWebGPUSupported()) return;

    let cancelled = false;
    let attempt = 0;
    let retryTimerId: ReturnType<typeof setTimeout> | undefined;
    let detachDeviceListener: (() => void) | undefined;

    const scheduleRetry = (retryCount: number) => {
      if (cancelled || retryTimerId !== undefined || retryCount >= maxWebgpuRetries) return;
      const nextRetry = retryCount + 1;
      webgpuRetryCountRef.current = nextRetry;
      retryTimerId = setTimeout(() => {
        retryTimerId = undefined;
        if (!cancelled) void doInit(nextRetry);
      }, 1000 * nextRetry);
    };

    const doInit = async (retryCount = 0) => {
      if (cancelled) return;
      const currentAttempt = ++attempt;
      detachDeviceListener?.();
      detachDeviceListener = undefined;
      const isCurrent = () => !cancelled && currentAttempt === attempt;
      try {
        const device = await getWebGPUDevice();
        if (!isCurrent()) return;
        if (!device) throw new Error("Failed to get WebGPU device");

        webgpuDeviceRef.current = device;
        const format = getPreferredCanvasFormat();
        webgpuFormatRef.current = format;
        webgpuContextLostRef.current = false;
        webgpuRetryCountRef.current = 0;

        buildOverlayRenderers(device, format);

        const handleDeviceFailure = () => {
          if (!isCurrent()) return;
          webgpuContextLostRef.current = true;
          setWebgpuEnabled(false);
          setIsInitializingWebGPU(false);
          scheduleRetry(webgpuRetryCountRef.current);
        };

        device.addEventListener("uncapturederror", handleDeviceFailure);
        detachDeviceListener = () => device.removeEventListener("uncapturederror", handleDeviceFailure);
        void device.lost?.then(handleDeviceFailure);

        setWebgpuEnabled(true);
        setIsInitializingWebGPU(false);
      } catch {
        if (!isCurrent()) return;
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);
        setIsInitializingWebGPU(false);
        scheduleRetry(retryCount);
      }
    };

    void doInit();

    return () => {
      cancelled = true;
      clearTimeout(retryTimerId);
      detachDeviceListener?.();
    };
  }, [buildOverlayRenderers]);

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

/** @deprecated Use useWebGPULifecycle. */
export const useWebGPUInit = useWebGPULifecycle;
