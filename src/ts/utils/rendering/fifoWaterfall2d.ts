export interface FifoWaterfall2DRenderer {
  draw: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    pixels: Uint8ClampedArray,
    x?: number,
    y?: number,
  ) => boolean;
  reset: () => void;
}

export const createFifoWaterfall2DRenderer = (): FifoWaterfall2DRenderer => {
  let imageData: ImageData | null = null;
  let imageDataWidth = 0;
  let imageDataHeight = 0;

  return {
    draw: (context, width, height, pixels, x = 0, y = 0) => {
      const expectedLength = width * height * 4;
      if (pixels.length < expectedLength) return false;

      if (
        imageData === null ||
        imageDataWidth !== width ||
        imageDataHeight !== height
      ) {
        imageData = context.createImageData(width, height);
        imageDataWidth = width;
        imageDataHeight = height;
      }

      if (pixels.length === expectedLength) {
        imageData.data.set(pixels);
      } else {
        imageData.data.set(pixels.subarray(0, expectedLength));
      }
      context.putImageData(imageData, x, y);
      return true;
    },
    reset: () => {
      imageData = null;
      imageDataWidth = 0;
      imageDataHeight = 0;
    },
  };
};
