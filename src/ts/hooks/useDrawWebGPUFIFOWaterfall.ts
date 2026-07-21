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
    const p = m[1].split(",");
    return [
      Number(p[0]?.trim() ?? 0) / 255,
      Number(p[1]?.trim() ?? 0) / 255,
      Number(p[2]?.trim() ?? 0) / 255,
      Math.max(0, Math.min(1, p.length > 3 ? Number(p[3].trim()) : 1)),
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
const DEFAULT_PLOT_MARGIN = { x: 40, y: 8 } as const;
const DEFAULT_COLORMAP: number[][] = [
  [0, 0, 0],
  [255, 255, 255],
];
const COLORMAP_BYTES_CACHE = new WeakMap<number[][], Uint8Array>();

const getColormapBytes = (colormap: number[][]): Uint8Array => {
  const cached = COLORMAP_BYTES_CACHE.get(colormap);
  if (cached) return cached;
  const width = colormap.length;
  const rgba = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const color = colormap[i];
    const offset = i * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = 255;
  }
  COLORMAP_BYTES_CACHE.set(colormap, rgba);
  return rgba;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type WaterfallState = {
  canvas: HTMLCanvasElement;
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
  clearBuf: ArrayBuffer;
  clearBytes: Uint8Array;
  writeRow: number;
  currentColorMapName?: string;
  defaultBackgroundColor: string;
  backgroundColor: string;
  backgroundR: number;
  backgroundG: number;
  backgroundB: number;
  backgroundA: number;
};

const destroyWaterfallState = (state: WaterfallState | null) => {
  state?.dataTex?.destroy();
  state?.colorTex?.destroy();
  state?.uniformBuf?.destroy();
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
  plotMargin?: { x: number; y: number };
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
  const lastErrorRef = useRef<string | null>(null);

  const createColorTex = useCallback(
    (device: GPUDevice, colormap: number[][]): GPUTexture => {
      const w = colormap.length;
      const rgba = getColormapBytes(colormap);
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
      colormapName?: string,
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
        canvas,
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
        clearBuf: new ArrayBuffer(0),
        clearBytes: new Uint8Array(0),
        writeRow: 0,
        currentColorMapName: colormapName,
        defaultBackgroundColor: readCssColor(
          "--color-fft-background",
          "#0a0a0a",
        ),
        backgroundColor: "",
        backgroundR: 0,
        backgroundG: 0,
        backgroundB: 0,
        backgroundA: 1,
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
        backgroundColor: requestedBackgroundColor,
        plotMargin = DEFAULT_PLOT_MARGIN,
        fftSize,
        sampleRate,
        centerFrequencyHz,
        isPaused = false,
        isFirstFrame = false,
      } = options;

      const existingState = stateRef.current;
      if (
        existingState &&
        (existingState.canvas !== canvas ||
          existingState.device !== device ||
          existingState.format !== format)
      ) {
        destroyWaterfallState(existingState);
        stateRef.current = null;
      }

      const effectiveColormap =
        colormap && colormap.length > 0 ? colormap : DEFAULT_COLORMAP;
      if (!stateRef.current) {
        try {
          stateRef.current = initState(
            canvas,
            device,
            format,
            effectiveColormap,
            colormapName,
          );
        } catch (e) {
          lastErrorRef.current =
            e instanceof Error
              ? e.message
              : "Unknown WebGPU initialization error";
          console.error("WebGPU waterfall init failed:", e);
          return false;
        }
      }
      const s = stateRef.current;
      const backgroundColor =
        requestedBackgroundColor ?? s.defaultBackgroundColor;

      try {
        // Canvas dimensions are already DPR-scaled by FFTCanvas resize handler
        const dpr = window.devicePixelRatio || 1;
        const marginX = Math.round(plotMargin.x * dpr);
        const marginY = Math.round(plotMargin.y * dpr);
        const plotH = Math.max(1, canvas.height - marginY * 2);

        // ALWAYS use 4096 bins internal width to avoid resets during zoom
        const needW = 4096;
        const needH = plotH;

        // -- Resize texture IF PLOT HEIGHT changes OR force reset on source change --
        // (internal width is constant 4096)
        const forceReset =
          restoreTexture &&
          restoreTexture.width > 0 &&
          restoreTexture.height > 0 &&
          (needW !== restoreTexture.width || needH !== restoreTexture.height);

        if (needW !== s.texW || needH !== s.texH || forceReset) {
          const prevTex = s.dataTex;
          const prevW = s.texW;
          const prevH = s.texH;
          const widthChanged = prevW !== needW || forceReset;

          // When forceReset is true, break the circular buffer continuity
          if (forceReset) {
            s.writeRow = 0;
          }

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
          if (s.clearBuf.byteLength !== clearBytes) {
            s.clearBuf = new ArrayBuffer(clearBytes);
            s.clearBytes = new Uint8Array(s.clearBuf);
            new Float32Array(s.clearBuf).fill(-200);
          }
          device.queue.writeTexture(
            { texture: s.dataTex },
            s.clearBytes,
            { bytesPerRow: s.paddedRowBytes, rowsPerImage: s.texH },
            { width: s.texW, height: s.texH },
          );

          if (prevTex && !widthChanged && !forceReset) {
            // Repack the circular buffer by display age so the visible history
            // stays in the same order after a height change (only for real size changes)
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
            // Full reset triggered: start from a clean buffer
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
              let row = s.writeRow - smearIdx;
              if (row < 0) row += s.texH;
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
            const nextWriteRow = s.writeRow + 1;
            s.writeRow = nextWriteRow === s.texH ? 0 : nextWriteRow;
          } else {
            const f32 = s.rowFloats;
            const fftDataLength = fftData.length;
            for (let i = 0; i < s.texW; i++) {
              f32[i] = i < fftDataLength ? fftData[i] : -200;
            }
            for (let smearIdx = 0; smearIdx <= smear; smearIdx++) {
              let row = s.writeRow - smearIdx;
              if (row < 0) row += s.texH;
              device.queue.writeTexture(
                { texture: s.dataTex, origin: { x: 0, y: row } },
                s.rowBytes,
                { bytesPerRow: s.paddedRowBytes },
                { width: s.texW, height: 1 },
              );
            }
            const nextWriteRow = s.writeRow + 1;
            s.writeRow = nextWriteRow === s.texH ? 0 : nextWriteRow;
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
          const rgba = getColormapBytes(colormap);
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

        if (s.backgroundColor !== backgroundColor) {
          const rgba = parseCssColorToRgba(backgroundColor);
          s.backgroundColor = backgroundColor;
          s.backgroundR = rgba[0];
          s.backgroundG = rgba[1];
          s.backgroundB = rgba[2];
          s.backgroundA = rgba[3];
        }
        const bgR = s.backgroundR;
        const bgG = s.backgroundG;
        const bgB = s.backgroundB;
        const bgA = s.backgroundA;
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

        lastErrorRef.current = null;
        return true;
      } catch (error) {
        lastErrorRef.current =
          error instanceof Error
            ? error.message
            : "Unknown WebGPU rendering error";
        console.error("WebGPU waterfall rendering failed:", error);
        return false;
      }
    },
    [initState],
  );

  const cleanup = useCallback(() => {
    destroyWaterfallState(stateRef.current);
    stateRef.current = null;
  }, []);
  const getLastError = useCallback(() => lastErrorRef.current, []);
  return { drawWebGPUFIFOWaterfall, cleanup, getLastError };
}
