import { useRef, useEffect, useCallback, useState } from "react";
import { FFTWebGPU } from "@n-apt/gpu/FFTWebGPU";
import { OverlayTextureRenderer } from "@n-apt/gpu/OverlayTextureRenderer";
import { WaterfallWebGPU } from "@n-apt/gpu/WaterfallWebGPU";
import { getPreferredCanvasFormat, getWebGPUDevice, isWebGPUSupported } from "@n-apt/gpu/webgpu";

export interface WebGPUInitOptions {
  force2D: boolean;
  spectrumGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  waterfallGpuCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  resampleWgsl: string;
  resampleComputePipelineRef: React.MutableRefObject<GPUComputePipeline | null>;
  resampleParamsBufferRef: React.MutableRefObject<GPUBuffer | null>;
  gpuBufferPoolRef: React.MutableRefObject<GPUBuffer[]>;
}

export function useWebGPUInit({
  force2D,
  spectrumGpuCanvasRef,
  waterfallGpuCanvasRef,
  resampleWgsl,
  resampleComputePipelineRef,
  resampleParamsBufferRef,
  gpuBufferPoolRef,
}: WebGPUInitOptions) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [webgpuReady, setWebgpuReady] = useState(false);
  const [webgpuEnabled, setWebgpuEnabled] = useState(false);

  const webgpuDeviceRef = useRef<GPUDevice | null>(null);
  const webgpuFormatRef = useRef<GPUTextureFormat | null>(null);
  const webgpuContextLostRef = useRef(false);
  const webgpuRetryCountRef = useRef(0);
  const maxWebgpuRetries = 3;

  const spectrumRendererRef = useRef<FFTWebGPU | null>(null);
  const gridOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const markersOverlayRendererRef = useRef<OverlayTextureRenderer | null>(null);
  const waterfallRendererRef = useRef<WaterfallWebGPU | null>(null);

  const overlayDirtyRef = useRef({ grid: true, markers: true });
  const overlayLastUploadMsRef = useRef({ grid: 0, markers: 0 });

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
        console.error("Failed to initialize WebGPU resampling pipeline:", error);
      }
    },
    [resampleWgsl, resampleComputePipelineRef, resampleParamsBufferRef],
  );

  const initializeWebGPU = useCallback(async () => {
    if (webgpuReady || force2D) return;

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
  }, [webgpuReady, force2D, initializeResamplePipeline, gpuBufferPoolRef]);

  useEffect(() => {
    if (!isInitialized && !force2D) {
      setIsInitialized(true);
      initializeWebGPU();
    }
  }, [isInitialized, initializeWebGPU, force2D]);

  useEffect(() => {
    if (!isWebGPUSupported()) return;
    if (force2D) return;

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
      } catch {
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);

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
  }, [force2D]);

  useEffect(() => {
    if (!webgpuEnabled || webgpuContextLostRef.current) return;
    const device = webgpuDeviceRef.current;
    const format = webgpuFormatRef.current;
    if (!device || !format) return;

    if (spectrumGpuCanvasRef.current && !spectrumRendererRef.current) {
      try {
        spectrumRendererRef.current = new FFTWebGPU(spectrumGpuCanvasRef.current, device, format);
        gridOverlayRendererRef.current = new OverlayTextureRenderer(device, format);
        markersOverlayRendererRef.current = new OverlayTextureRenderer(device, format);
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
      } catch (error) {
        console.error("Failed to create spectrum renderer:", error);
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);
        return;
      }
    }

    if (waterfallGpuCanvasRef.current && !waterfallRendererRef.current) {
      try {
        waterfallRendererRef.current = new WaterfallWebGPU(
          waterfallGpuCanvasRef.current,
          device,
          format,
        );
      } catch (error) {
        console.error("Failed to create waterfall renderer:", error);
        webgpuContextLostRef.current = true;
        setWebgpuEnabled(false);
        return;
      }
    }
  }, [webgpuEnabled, spectrumGpuCanvasRef, waterfallGpuCanvasRef]);

  return {
    webgpuEnabled,
    webgpuDeviceRef,
    spectrumRendererRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    waterfallRendererRef,
    overlayDirtyRef,
    overlayLastUploadMsRef,
  };
}
