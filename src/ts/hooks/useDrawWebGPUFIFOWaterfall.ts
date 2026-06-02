import { WATERFALL_FIFO_WGSL } from "@n-apt/shaders";
import { useCallback, useRef } from "react";
import { validateSpectrumDataComprehensive } from "@n-apt/validation";

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function parseCssColorToRgba(color: string): [number, number, number, number] {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
        1,
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        1,
      ];
    }
  }
  const m = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return [
      Number(p[0] ?? 0) / 255,
      Number(p[1] ?? 0) / 255,
      Number(p[2] ?? 0) / 255,
      Math.max(0, Math.min(1, p.length > 3 ? Number(p[3]) : 1)),
    ];
  }
  return [0, 0, 0, 1];
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined")
    return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

// ---------------------------------------------------------------------------
// WGSL — bin-resolution circular buffer + colour LUT
//
// Matches the demo's drawWaterfall() logic:
//   isSteps  = (plotWidth / texWidth) >= 3   → floor sampling (squares)
//   wfSmooth = uniforms[2].z > 0.5 && !isSteps → lerp between adjacent bins
//   default  = nearest-neighbour
// ---------------------------------------------------------------------------
const waterfallShader = WATERFALL_FIFO_WGSL;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type WaterfallState = {
  device: GPUDevice;
  format: GPUTextureFormat;
  ctx: GPUCanvasContext;
  pipeline: GPURenderPipeline;
  uniformBuf: GPUBuffer;
  uniforms: Float32Array;
  dataTex: GPUTexture | null;
  colorTex: GPUTexture;
  colorCount: number;
  bindGroup: GPUBindGroup | null;
  texW: number;
  texH: number;
  paddedRowBytes: number;
  rowBuf: ArrayBuffer;
  rowBytes: Uint8Array;
  rowFloats: Float32Array;
  writeRow: number;
  currentColorMapName?: string;
  lastFrameCanvas?: HTMLCanvasElement;
  cacheCanvas?: HTMLCanvasElement;
  cacheCtx?: CanvasRenderingContext2D | null;
};

export interface WebGPUFIFOWaterfallOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  fftData: Float32Array;
  fftDataBuffer?: GPUBuffer;
  fftMin?: number;
  fftMax?: number;
  driftAmount?: number;
  freeze?: boolean;
  wfSmooth?: boolean;
  restoreTexture?: {
    data: Uint8Array;
    width: number;
    height: number;
    writeRow: number;
  };
  colormap?: number[][];
  colormapName?: string;
  backgroundColor?: string;
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  isPaused?: boolean;
  isFirstFrame?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useDrawWebGPUFIFOWaterfall() {
  const stateRef = useRef<WaterfallState | null>(null);

  const createColorTex = useCallback(
    (device: GPUDevice, colormap: number[][]): GPUTexture => {
      const w = colormap.length;
      const rgba = new Uint8Array(w * 4);
      for (let i = 0; i < w; i++) {
        rgba[i * 4] = colormap[i][0];
        rgba[i * 4 + 1] = colormap[i][1];
        rgba[i * 4 + 2] = colormap[i][2];
        rgba[i * 4 + 3] = 255;
      }
      const tex = device.createTexture({
        size: { width: w, height: 1 },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: tex },
        rgba,
        { bytesPerRow: w * 4 },
        { width: w, height: 1 },
      );
      return tex;
    },
    [],
  );

  const initState = useCallback(
    (
      canvas: HTMLCanvasElement,
      device: GPUDevice,
      format: GPUTextureFormat,
      colormap: number[][],
    ): WaterfallState => {
      const ctx = canvas.getContext("webgpu")!;
      ctx.configure({ device, format, alphaMode: "premultiplied" });

      const module = device.createShaderModule({ code: waterfallShader });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });

      const uniforms = new Float32Array(16);
      const uniformBuf = device.createBuffer({
        size: uniforms.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const colorTex = createColorTex(device, colormap);

      return {
        device,
        format,
        ctx,
        pipeline,
        uniformBuf,
        uniforms,
        dataTex: null,
        colorTex,
        colorCount: colormap.length,
        bindGroup: null,
        texW: 0,
        texH: 0,
        paddedRowBytes: 0,
        rowBuf: new ArrayBuffer(0),
        rowBytes: new Uint8Array(0),
        rowFloats: new Float32Array(0),
        writeRow: 0,
      };
    },
    [createColorTex],
  );

  // -------------------------------------------------------------------
  // Main draw — mirrors demo's updateWaterfall() + drawWaterfall()
  // -------------------------------------------------------------------
  const drawWebGPUFIFOWaterfall = useCallback(
    (options: WebGPUFIFOWaterfallOptions) => {
      const {
        canvas,
        device,
        format,
        fftData,
        fftDataBuffer,
        fftMin = -80,
        fftMax = 20,
        driftAmount = 0,
        freeze = false,
        wfSmooth = false,
        restoreTexture,
        colormap,
        colormapName,
        backgroundColor = readCssColor("--color-fft-background", "#0a0a0a"),
        fftSize,
        sampleRate,
        centerFrequencyHz,
        isPaused = false,
        isFirstFrame = false,
      } = options;

      if (!stateRef.current) {
        try {
          stateRef.current = initState(canvas, device, format, colormap || []);
        } catch (e) {
          console.error("WebGPU waterfall init failed:", e);
          return false;
        }
      }
      const s = stateRef.current;

      try {
        // Canvas dimensions are already DPR-scaled by FFTCanvas resize handler
        const dpr = window.devicePixelRatio || 1;
        const marginX = Math.round(40 * dpr);
        const marginY = Math.round(8 * dpr);
        const plotH = Math.max(1, canvas.height - marginY * 2);

        // ALWAYS use 4096 bins internal width to avoid resets during zoom
        const needW = 4096;
        const needH = plotH;

        // -- Resize texture IF PLOT HEIGHT changes --
        // (internal width is constant 4096)
        if (needW !== s.texW || needH !== s.texH) {
          const prevTex = s.dataTex;
          const prevW = s.texW;
          const prevH = s.texH;
          const widthChanged = prevW !== needW;

          s.texW = needW;
          s.texH = needH;
          s.paddedRowBytes = alignTo(s.texW * 4, 256);
          s.rowBuf = new ArrayBuffer(s.paddedRowBytes);
          s.rowBytes = new Uint8Array(s.rowBuf);
          s.rowFloats = new Float32Array(s.rowBuf);

          s.dataTex = device.createTexture({
            size: { width: s.texW, height: s.texH },
            format: "r32float",
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.COPY_SRC,
          });

          // Clear with very-low dB
          const clearBytes = s.paddedRowBytes * s.texH;
          const clearBuf = new ArrayBuffer(clearBytes);
          new Float32Array(clearBuf).fill(-200);
          device.queue.writeTexture(
            { texture: s.dataTex },
            new Uint8Array(clearBuf),
            { bytesPerRow: s.paddedRowBytes, rowsPerImage: s.texH },
            { width: s.texW, height: s.texH },
          );

          if (prevTex && !widthChanged) {
            // Repack the circular buffer by display age so the visible history
            // stays in the same order after a height change.
            const enc = device.createCommandEncoder();
            const prevRenderRow =
              prevH > 0 ? (s.writeRow - 1 + prevH) % prevH : 0;
            const nextRenderRow =
              needH > 0 ? (s.writeRow - 1 + needH) % needH : 0;
            for (let age = 0; age < needH; age++) {
              const srcAge = Math.max(
                0,
                Math.min(prevH - 1, Math.floor((age * prevH) / needH)),
              );
              const srcY =
                prevH > 0 ? (prevRenderRow - srcAge + prevH) % prevH : 0;
              const dstY = (nextRenderRow - age + needH) % needH;
              enc.copyTextureToTexture(
                { texture: prevTex, origin: { x: 0, y: srcY } },
                { texture: s.dataTex, origin: { x: 0, y: dstY } },
                { width: s.texW, height: 1 },
              );
            }
            device.queue.submit([enc.finish()]);
            s.writeRow = Math.min(s.writeRow, s.texH - 1);
          } else {
            s.writeRow = 0;
          }
          prevTex?.destroy();

          s.bindGroup = device.createBindGroup({
            layout: s.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: s.dataTex.createView() },
              { binding: 1, resource: s.colorTex.createView() },
              { binding: 2, resource: { buffer: s.uniformBuf } },
            ],
          });
        }

        // -- Restore snapshot --
        if (restoreTexture && s.dataTex) {
          const { data, width, height, writeRow } = restoreTexture;
          if (width > 0 && height > 0 && data.length >= width * height * 4) {
            if (s.texW !== width || s.texH !== height) {
              s.dataTex.destroy();
              s.texW = width;
              s.texH = height;
              s.paddedRowBytes = alignTo(s.texW * 4, 256);
              s.rowBuf = new ArrayBuffer(s.paddedRowBytes);
              s.rowBytes = new Uint8Array(s.rowBuf);
              s.rowFloats = new Float32Array(s.rowBuf);
              s.dataTex = device.createTexture({
                size: { width: s.texW, height: s.texH },
                format: "r32float",
                usage:
                  GPUTextureUsage.TEXTURE_BINDING |
                  GPUTextureUsage.COPY_DST |
                  GPUTextureUsage.COPY_SRC,
              });
              s.bindGroup = device.createBindGroup({
                layout: s.pipeline.getBindGroupLayout(0),
                entries: [
                  { binding: 0, resource: s.dataTex.createView() },
                  { binding: 1, resource: s.colorTex.createView() },
                  { binding: 2, resource: { buffer: s.uniformBuf } },
                ],
              });
            }
            const rowBytes = width * 4;
            for (let y = 0; y < height; y++) {
              const upload = s.rowBytes;
              upload.fill(0);
              upload.set(
                data.subarray(y * rowBytes, y * rowBytes + rowBytes),
                0,
              );
              device.queue.writeTexture(
                { texture: s.dataTex, origin: { x: 0, y } },
                upload,
                { bytesPerRow: s.paddedRowBytes },
                { width: s.texW, height: 1 },
              );
            }
            s.writeRow = Math.max(0, Math.min(writeRow, height - 1));
          }
        }

        // =========================================================
        // updateWaterfall() — push one row of raw dB into buffer
        // =========================================================
        const enc = device.createCommandEncoder();

        const hasCpuFftRow = fftData.length > 0;
        const useGpuFftRow = !hasCpuFftRow && !!fftDataBuffer;

        if (!freeze && s.dataTex && (hasCpuFftRow || useGpuFftRow)) {
          // Validate FFT data on first frame or when paused
          if (fftData && fftData.length > 0 && (isFirstFrame || isPaused)) {
            const validationResult = validateSpectrumDataComprehensive(
              fftData,
              {
                fftSize,
                sampleRate,
                centerFrequencyHz,
                timestamp: Date.now(),
                isPaused,
                isFirstFrame,
              },
            );

            if (!validationResult.isValid) {
              console.error(
                `WebGPU waterfall FFT validation failed (${isFirstFrame ? "first frame" : "paused"}):`,
                validationResult.errors,
              );
            } else if (validationResult.warnings.length > 0) {
              console.warn(
                `WebGPU waterfall FFT validation warnings (${isFirstFrame ? "first frame" : "paused"}):`,
                validationResult.warnings,
              );
            }

            // Log validation metadata for debugging (only in development)
            if (process.env.NODE_ENV === "development") {
              console.log(
                "WebGPU waterfall FFT validation metadata:",
                validationResult.metadata,
              );
            }
          }

          const smear = Math.max(
            0,
            Math.min(Math.floor(driftAmount || 0), s.texH - 1),
          );

          if (useGpuFftRow) {
            for (let smearIdx = 0; smearIdx <= smear; smearIdx++) {
              const row = (s.writeRow - smearIdx + s.texH) % s.texH;
              enc.copyBufferToTexture(
                {
                  buffer: fftDataBuffer,
                  offset: 0,
                  bytesPerRow: s.paddedRowBytes,
                  rowsPerImage: 1,
                },
                {
                  texture: s.dataTex,
                  origin: { x: 0, y: row },
                },
                { width: s.texW, height: 1 },
              );
            }
            s.writeRow = (s.writeRow + 1) % s.texH;
          } else {
            const f32 = s.rowFloats;
            for (let i = 0; i < s.texW; i++) {
              f32[i] = fftData[i] ?? -200;
            }
            for (let smearIdx = 0; smearIdx <= smear; smearIdx++) {
              const row = (s.writeRow - smearIdx + s.texH) % s.texH;
              device.queue.writeTexture(
                { texture: s.dataTex, origin: { x: 0, y: row } },
                s.rowBytes,
                { bytesPerRow: s.paddedRowBytes },
                { width: s.texW, height: 1 },
              );
            }
            s.writeRow = (s.writeRow + 1) % s.texH;
          }
        }

        // =========================================================
        // drawWaterfall() — render circular buffer to screen
        // =========================================================
        // Update colormap if provided and changed (detect via colormapName OR length)
        const colormapChanged = colormapName
          ? colormapName !== s.currentColorMapName
          : colormap && colormap.length !== s.colorCount;

        if (colormap && colormap.length > 0 && colormapChanged) {
          s.currentColorMapName = colormapName;
          s.colorCount = colormap.length;
          const w = colormap.length;
          const rgba = new Uint8Array(w * 4);
          for (let i = 0; i < w; i++) {
            rgba[i * 4] = colormap[i][0];
            rgba[i * 4 + 1] = colormap[i][1];
            rgba[i * 4 + 2] = colormap[i][2];
            rgba[i * 4 + 3] = 255;
          }
          s.colorTex.destroy();
          s.colorTex = device.createTexture({
            size: { width: w, height: 1 },
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          device.queue.writeTexture(
            { texture: s.colorTex },
            rgba,
            { bytesPerRow: w * 4 },
            { width: w, height: 1 },
          );
          // Rebuild bindGroup
          if (s.dataTex) {
            s.bindGroup = device.createBindGroup({
              layout: s.pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: s.dataTex.createView() },
                { binding: 1, resource: s.colorTex.createView() },
                { binding: 2, resource: { buffer: s.uniformBuf } },
              ],
            });
          }
        }

        const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(backgroundColor);
        const plotW = Math.max(1, canvas.width - marginX * 2);

        // uniforms[0] = (plotW, plotH, marginX, marginY)
        s.uniforms[0] = plotW;
        s.uniforms[1] = plotH;
        s.uniforms[2] = marginX;
        s.uniforms[3] = marginY;

        // uniforms[1] = (renderRow, texW, texH, colorCount)
        const renderRow = s.texH > 0 ? (s.writeRow - 1 + s.texH) % s.texH : 0;
        s.uniforms[4] = renderRow;
        s.uniforms[5] = s.texW;
        s.uniforms[6] = s.texH;
        s.uniforms[7] = s.colorCount;

        // uniforms[2] = (fftMin, fftMax, wfSmooth, 0)
        s.uniforms[8] = fftMin;
        s.uniforms[9] = fftMax;
        s.uniforms[10] = wfSmooth ? 1.0 : 0.0;
        s.uniforms[11] = 0;

        // uniforms[3] = background RGBA
        s.uniforms[12] = bgR;
        s.uniforms[13] = bgG;
        s.uniforms[14] = bgB;
        s.uniforms[15] = bgA;

        device.queue.writeBuffer(
          s.uniformBuf,
          0,
          s.uniforms.buffer as ArrayBuffer,
          s.uniforms.byteOffset,
          s.uniforms.byteLength,
        );

        const pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: s.ctx.getCurrentTexture().createView(),
              clearValue: { r: bgR, g: bgG, b: bgB, a: bgA },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(s.pipeline);
        pass.setBindGroup(0, s.bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);

        if (canvas instanceof HTMLCanvasElement) {
          if (!s.cacheCanvas) {
            s.cacheCanvas = document.createElement("canvas");
            s.cacheCtx = s.cacheCanvas.getContext("2d");
          }
          if (
            s.cacheCanvas.width !== canvas.width ||
            s.cacheCanvas.height !== canvas.height
          ) {
            s.cacheCanvas.width = canvas.width;
            s.cacheCanvas.height = canvas.height;
          }
          if (s.cacheCtx) {
            s.cacheCtx.clearRect(0, 0, canvas.width, canvas.height);
            s.cacheCtx.drawImage(canvas, 0, 0);
          }
          s.lastFrameCanvas = s.cacheCanvas;
          (canvas as any)._lastFrameCanvas = s.cacheCanvas;
        }

        return true;
      } catch (error) {
        console.error("WebGPU waterfall rendering failed:", error);
        return false;
      }
    },
    [initState],
  );

  const cleanup = useCallback(() => {
    const state = stateRef.current;
    state?.dataTex?.destroy();
    state?.colorTex?.destroy();
    state?.uniformBuf?.destroy();
    stateRef.current = null;
  }, []);
  return { drawWebGPUFIFOWaterfall, cleanup };
}
