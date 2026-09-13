import { createFifoWaterfall2DRenderer } from "@n-apt/spectrum/utils/rendering/fifoWaterfall2d";

const createContext = () => {
  const createImageData = jest.fn((width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }));
  return {
    context: {
      createImageData,
      putImageData: jest.fn(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D,
    createImageData,
  };
};

describe("createFifoWaterfall2DRenderer", () => {
  it("reuses ImageData for one renderer without sharing it across instances", () => {
    const first = createContext();
    const second = createContext();
    const firstRenderer = createFifoWaterfall2DRenderer();
    const secondRenderer = createFifoWaterfall2DRenderer();
    const pixels = new Uint8ClampedArray(8 * 4 * 4);

    firstRenderer.draw(first.context, 8, 4, pixels);
    secondRenderer.draw(second.context, 8, 4, pixels);
    firstRenderer.draw(first.context, 8, 4, pixels);
    secondRenderer.draw(second.context, 8, 4, pixels);

    expect(first.createImageData).toHaveBeenCalledTimes(1);
    expect(second.createImageData).toHaveBeenCalledTimes(1);
  });

  it("disables interpolation while scaling a zoomed history window", () => {
    const { context } = createContext();
    const sourceCanvas = {
      width: 8,
      height: 4,
      getContext: jest.fn(() => ({
        putImageData: jest.fn(),
        imageSmoothingEnabled: true,
      })),
    };
    const ownerDocument = {
      createElement: jest.fn(() => sourceCanvas),
    };
    Object.defineProperty(context, "canvas", {
      value: { ownerDocument },
    });
    const renderer = createFifoWaterfall2DRenderer();

    renderer.draw(
      context,
      8,
      4,
      new Uint8ClampedArray(8 * 4 * 4),
      0,
      0,
      8,
      0,
    );

    expect((context as any).imageSmoothingEnabled).toBe(false);
    const firstContextResult = sourceCanvas.getContext.mock.results[0];
    expect(
      firstContextResult && (firstContextResult.value as any).imageSmoothingEnabled,
    ).toBe(false);
  });
});
