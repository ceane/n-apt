import { createFifoWaterfall2DRenderer } from "../../src/ts/utils/rendering/fifoWaterfall2d";

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
});
