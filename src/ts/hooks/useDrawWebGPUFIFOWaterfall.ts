/**
 * useDrawWebGPUFIFOWaterfall.ts
 *
 * Faithful translation of simple-fft-waterfall-demo.html's
 * updateWaterfall() / drawWaterfall() to WebGPU.
 *
 * Data pipeline:
 * - Raw dB Float32 values stored at FFT BIN resolution (not pixel-resampled)
 * - Shader maps display pixels → texture bins via ratio mapping
 * - When zoomed in (isSteps): floor() sampling → each bin fills multiple pixels (squares)
 * - When smooth enabled + !isSteps: linear interpolation between adjacent bins
 * - dB normalisation + colour LUT mapping done entirely in the shader
 */
import { useCallback, useRef } from "react";
import { WATERFALL_CANVAS_BG, DEFAULT_COLOR_MAP } from "@n-apt/consts";

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

// ---------------------------------------------------------------------------
// WGSL — bin-resolution circular buffer + colour LUT
//
// Matches the demo's drawWaterfall() logic:
//   isSteps  = (plotWidth / texWidth) >= 3   → floor sampling (squares)
//   wfSmooth = uniforms[2].z > 0.5 && !isSteps → lerp between adjacent bins
//   default  = nearest-neighbour
// ---------------------------------------------------------------------------
const waterfallShader = /* wgsl */ `
@group(0) @binding(0) var dataTex: texture_2d<f32>;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: array<vec4<f32>, 4>;

struct VertexOut { @builtin(position) position: vec4<f32> }

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return VertexOut(vec4<f32>(pos[vi], 0.0, 1.0));
}

// Helper: look up a raw dB value from the circular buffer
fn sampleDb(col: i32, displayRow: i32, renderRow: i32, texH: i32) -> f32 {
  var texRow = renderRow - displayRow;
  if (texRow < 0) { texRow = texRow + texH; }
  return textureLoad(dataTex, vec2<i32>(col, texRow), 0).r;
}

// Helper: normalise dB → [0,1] then map through colour LUT
fn dbToColor(rawDb: f32, dbMin: f32, dbMax: f32, colorCount: f32) -> vec4<f32> {
  let normalized = clamp((rawDb - dbMin) / max(dbMax - dbMin, 0.001), 0.0, 1.0);
  var ci = i32(round(normalized * (colorCount - 1.0)));
  ci = clamp(ci, 0, i32(colorCount) - 1);
  return textureLoad(colorTex, vec2<i32>(ci, 0), 0);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let px = position.xy;

  // uniforms[0] = (plotW, plotH, marginX, marginY) — physical pixels
  let plotW  = uniforms[0].x;
  let plotH  = uniforms[0].y;
  let margX  = uniforms[0].z;
  let margY  = uniforms[0].w;

  let xIn = px.x - margX;
  let yIn = px.y - margY;
  let inBounds = xIn >= 0.0 && yIn >= 0.0 && xIn < plotW && yIn < plotH;

  // uniforms[1] = (renderRow, texW, texH, colorCount)
  let renderRow  = i32(uniforms[1].x);
  let texW       = i32(uniforms[1].y);
  let texH       = i32(uniforms[1].z);
  let colorCount = max(1.0, uniforms[1].w);
  let fTexW      = f32(texW);

  // uniforms[2] = (dbMin, dbMax, wfSmooth, 0)
  let dbMin    = uniforms[2].x;
  let dbMax    = uniforms[2].y;
  let wfSmooth = uniforms[2].z > 0.5;

  // uniforms[3] = background RGBA
  let bg = uniforms[3];

  if (!inBounds) {
    return bg;
  }

  // y: 1:1 mapping (texH == plotH by construction)
  let displayRow = clamp(i32(floor(yIn)), 0, texH - 1);

  // Map display x → bin index
  // Use center-aligned sampling (px + 0.5) to avoid sub-pixel flickering
  let xCenter = xIn + 0.5;
  let exactBin = xCenter * fTexW / max(plotW, 1.0);

  var finalColor: vec4<f32>;

  if (wfSmooth) {
    // SMOOTH MODE: linear interpolation between adjacent bins
    let lenMinusOne = max(fTexW - 1.0, 1.0);
    // Scale xCenter to [0, lenMinusOne] range for interpolation
    let exactIdx = xIn * lenMinusOne / max(plotW - 1.0, 1.0);
    let idxFloor = i32(floor(exactIdx));
    let idxCeil  = min(idxFloor + 1, texW - 1);
    let frac     = exactIdx - f32(idxFloor);

    let dbFloor = sampleDb(max(idxFloor, 0), displayRow, renderRow, texH);
    let dbCeil  = sampleDb(idxCeil, displayRow, renderRow, texH);
    let rawDb   = mix(dbFloor, dbCeil, clamp(frac, 0.0, 1.0));
    finalColor = dbToColor(rawDb, dbMin, dbMax, colorCount);
  } else {
    // DEFAULT: nearest-neighbour
    let col = clamp(i32(floor(exactBin)), 0, texW - 1);
    let rawDb = sampleDb(col, displayRow, renderRow, texH);
    finalColor = dbToColor(rawDb, dbMin, dbMax, colorCount);
  }

  return finalColor;
}
`;

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
  writeRow: number;
};

export interface WebGPUFIFOWaterfallOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  /** Raw dB Float32Array — MUST be a fixed width (e.g. 4096) to avoid resets */
  fftData: Float32Array;
  frequencyRange: { min: number; max: number };
  dbMin?: number;
  dbMax?: number;
  driftAmount?: number;
  driftDirection?: number;
  freeze?: boolean;
  wfSmooth?: boolean;
  restoreTexture?: {
    data: Uint8Array;
    width: number;
    height: number;
    writeRow: number;
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useDrawWebGPUFIFOWaterfall() {
  const stateRef = useRef<WaterfallState | null>(null);

  const createColorTex = useCallback((device: GPUDevice): GPUTexture => {
    const colors = DEFAULT_COLOR_MAP;
    const w = colors.length;
    const rgba = new Uint8Array(w * 4);
    for (let i = 0; i < w; i++) {
      rgba[i * 4] = colors[i][0];
      rgba[i * 4 + 1] = colors[i][1];
      rgba[i * 4 + 2] = colors[i][2];
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
  }, []);

  const initState = useCallback(
    (
      canvas: HTMLCanvasElement,
      device: GPUDevice,
      format: GPUTextureFormat,
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

      return {
        device,
        format,
        ctx,
        pipeline,
        uniformBuf,
        uniforms,
        dataTex: null,
        colorTex: createColorTex(device),
        colorCount: DEFAULT_COLOR_MAP.length,
        bindGroup: null,
        texW: 0,
        texH: 0,
        paddedRowBytes: 0,
        rowBuf: new ArrayBuffer(0),
        writeRow: 0,
      };
    },
    [createColorTex],
  );

  // -------------------------------------------------------------------
  // Main draw — mirrors demo's updateWaterfall() + drawWaterfall()
  // -------------------------------------------------------------------
  const drawWebGPUFIFOWaterfall = useCallback(
    async (options: WebGPUFIFOWaterfallOptions) => {
      const {
        canvas,
        device,
        format,
        fftData,
        dbMin = -80,
        dbMax = 20,
        driftAmount = 0,
        freeze = false,
        wfSmooth = false,
        restoreTexture,
      } = options;

      if (!stateRef.current) {
        try {
          stateRef.current = initState(canvas, device, format);
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
            // Re-map history to new vertical size if possible
            const enc = device.createCommandEncoder();
            enc.copyTextureToTexture(
              { texture: prevTex },
              { texture: s.dataTex },
              { width: s.texW, height: Math.min(prevH, needH) },
            );
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
              const upload = new Uint8Array(s.rowBuf);
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
        if (!freeze && s.dataTex && fftData.length > 0) {
          const smear = Math.max(
            0,
            Math.min(Math.floor(driftAmount || 0), s.texH - 1),
          );

          for (let smearIdx = 0; smearIdx <= smear; smearIdx++) {
            const f32 = new Float32Array(s.rowBuf);
            for (let i = 0; i < s.texW; i++) {
              f32[i] = fftData[i] ?? -200;
            }
            const row = (s.writeRow - smearIdx + s.texH) % s.texH;
            device.queue.writeTexture(
              { texture: s.dataTex, origin: { x: 0, y: row } },
              new Uint8Array(s.rowBuf),
              { bytesPerRow: s.paddedRowBytes },
              { width: s.texW, height: 1 },
            );
          }
          s.writeRow = (s.writeRow + 1) % s.texH;
        }

        // =========================================================
        // drawWaterfall() — render circular buffer to screen
        // =========================================================
        if (!s.bindGroup || !s.dataTex) return true;

        const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(WATERFALL_CANVAS_BG);
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

        // uniforms[2] = (dbMin, dbMax, wfSmooth, 0)
        s.uniforms[8] = dbMin;
        s.uniforms[9] = dbMax;
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
          s.uniforms.buffer.slice(
            s.uniforms.byteOffset,
            s.uniforms.byteOffset + s.uniforms.byteLength,
          ) as ArrayBuffer,
        );

        const enc = device.createCommandEncoder();
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

        return true;
      } catch (error) {
        console.error("WebGPU waterfall rendering failed:", error);
        return false;
      }
    },
    [initState],
  );

  const cleanup = useCallback(() => {
    stateRef.current = null;
  }, []);
  return { drawWebGPUFIFOWaterfall, cleanup };
}
