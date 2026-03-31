/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";

declare global {
  // eslint-disable-next-line no-var
  var expectCanvasCall: (callName: string, args?: any[] | null) => unknown;
  // eslint-disable-next-line no-var
  var expectCanvasContext: (contextType: string) => unknown;
  // eslint-disable-next-line no-var
  var expectWebGLCall: (callName: string, args?: any[] | null) => unknown;
  // eslint-disable-next-line no-var
  var expectWebGPUCall: (callName: string, args?: any[] | null) => unknown;
  // eslint-disable-next-line no-var
  var countCanvasCalls: (callName: string) => number;
  // eslint-disable-next-line no-var
  var getWebGPUCalls: (callName: string) => Array<{ name: string; args: any[] }>;
}

describe("canvas API integration", () => {
  it("tracks WebGL draw calls", () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;

    expect(gl).not.toBeNull();

    gl!.clearColor(1, 0, 0, 1);
    gl!.drawArrays(0, 0, 3);

    global.expectCanvasContext("webgl2");
    global.expectWebGLCall("drawArrays", [0, 0, 3]);
  });

  it("tracks WebGPU device creation", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();

    device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST });

    global.expectWebGPUCall("requestAdapter");
    global.expectWebGPUCall("requestDevice");
    global.expectWebGPUCall("createBuffer");
  });

  it("tracks WebGPU waterfall rendering through the shared canvas mocks", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 300;

    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    await act(async () => {
      const success = await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData: new Float32Array(4096).fill(-55),
        fftMin: -120,
        fftMax: 0,
        colormap: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      });

      expect(success).toBe(true);
    });

    global.expectCanvasContext("webgpu");
    global.expectWebGPUCall("configure");
    global.expectWebGPUCall("createRenderPipeline");
    global.expectWebGPUCall("writeTexture");
    global.expectWebGPUCall("draw");
    global.expectWebGPUCall("submit");
    expect(global.countCanvasCalls("getContext")).toBeGreaterThanOrEqual(1);
  });

  it("tracks WebGPU waterfall restore and freeze behavior", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 180;

    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());
    const fftData = new Float32Array(4096).fill(-60);

    await act(async () => {
      await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData,
        restoreTexture: {
          data: new Uint8Array(4 * 4 * 4).fill(64),
          width: 4,
          height: 4,
          writeRow: 2,
        },
        colormap: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      });
    });

    const countRowWrites = () =>
      global
        .getWebGPUCalls("writeTexture")
        .filter((call) => call.args[0]?.origin?.y !== undefined).length;

    const rowWritesAfterRestore = countRowWrites();

    await act(async () => {
      await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData,
        freeze: true,
        colormap: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      });
    });

    const rowWritesAfterFreeze = countRowWrites();

    expect(rowWritesAfterRestore).toBeGreaterThan(0);
    expect(rowWritesAfterFreeze).toBe(rowWritesAfterRestore);
  });

  it("tracks repeated WebGPU waterfall renders after canvas size changes", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 180;

    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    await act(async () => {
      await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData: new Float32Array(4096).fill(-45),
        colormap: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      });
    });

    const encodersBeforeResize = global.getWebGPUCalls("createCommandEncoder").length;
    const submitsBeforeResize = global.getWebGPUCalls("submit").length;

    canvas.height = 220;

    await act(async () => {
      await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData: new Float32Array(4096).fill(-45),
        colormap: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      });
    });

    expect(global.getWebGPUCalls("createCommandEncoder").length).toBeGreaterThan(
      encodersBeforeResize,
    );
    expect(global.getWebGPUCalls("submit").length).toBeGreaterThan(
      submitsBeforeResize,
    );
  });

  it("tracks WebGPU waterfall colormap swaps", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 180;

    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    await act(async () => {
      await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData: new Float32Array(4096).fill(-50),
        colormapName: "gray",
        colormap: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      });
    });

    const textureCreatesBeforeSwap = global.getWebGPUCalls("createTexture").length;

    await act(async () => {
      await result.current.drawWebGPUFIFOWaterfall({
        canvas,
        device: device as unknown as GPUDevice,
        format: navigator.gpu.getPreferredCanvasFormat(),
        fftData: new Float32Array(4096).fill(-50),
        colormapName: "heat",
        colormap: [
          [0, 0, 0],
          [255, 0, 0],
          [255, 255, 0],
        ],
      });
    });

    expect(global.getWebGPUCalls("createTexture").length).toBeGreaterThan(
      textureCreatesBeforeSwap,
    );
  });
});
