import { renderHook } from "@testing-library/react";
import { useDraw2DFIFOWaterfall } from "../../src/ts/hooks/useDraw2DFIFOWaterfall";

describe("useDraw2DFIFOWaterfall", () => {
  it("reuses its context and ImageData without measuring layout every frame", () => {
    const createImageData = jest.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }));
    const context = {
      createImageData,
      putImageData: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const getBoundingClientRect = jest.fn(() => ({ width: 80, height: 40 }));
    const canvas = {
      width: 80,
      height: 40,
      clientWidth: 80,
      clientHeight: 40,
      style: { width: "80px", height: "40px" },
      parentElement: {
        clientWidth: 80,
        clientHeight: 40,
        getBoundingClientRect,
      },
      getContext: jest.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const waterfallBuffer = new Uint8ClampedArray(80 * 40 * 4);
    const fftFrame = new Float32Array(80).fill(-50);
    const { result } = renderHook(() => useDraw2DFIFOWaterfall());
    const options = {
      canvas,
      waterfallBuffer,
      fftFrame,
      frequencyRange: { min: 0, max: 1 },
    };

    result.current.draw2DFIFOWaterfall(options);
    result.current.draw2DFIFOWaterfall(options);

    expect(canvas.getContext).toHaveBeenCalledTimes(1);
    expect(createImageData).toHaveBeenCalledTimes(1);
    expect(getBoundingClientRect).not.toHaveBeenCalled();
  });
});
