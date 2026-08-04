export interface FifoWaterfall2DRenderer {
  draw: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    pixels: Uint8ClampedArray,
    x?: number,
    y?: number,
    historyZoom?: number,
    historyPan?: number,
  ) => boolean;
  reset: () => void;
}

export const createFifoWaterfall2DRenderer = (): FifoWaterfall2DRenderer => {
  let imageData: ImageData | null = null;
  let imageDataWidth = 0;
  let imageDataHeight = 0;
  let sourceCanvas: HTMLCanvasElement | null = null;
  let sourceContext: CanvasRenderingContext2D | null = null;

  return {
    draw: (
      context,
      width,
      height,
      pixels,
      x = 0,
      y = 0,
      historyZoom = 1,
      historyPan = 0,
    ) => {
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
      const zoom = Math.max(1, historyZoom);
      if (zoom === 1) {
        context.putImageData(imageData, x, y);
        return true;
      }

      if (
        sourceCanvas === null ||
        sourceCanvas.width !== width ||
        sourceCanvas.height !== height
      ) {
        sourceCanvas = context.canvas.ownerDocument.createElement("canvas");
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        sourceContext = sourceCanvas.getContext("2d");
      }
      if (!sourceContext || !sourceCanvas) return false;
      sourceContext.putImageData(imageData, 0, 0);
      const sourceWidth = width / zoom;
      const sourceX = Math.max(
        0,
        Math.min(width - sourceWidth, (width - sourceWidth) / 2 + historyPan * width),
      );
      context.clearRect(x, y, width, height);
      context.drawImage(
        sourceCanvas,
        sourceX,
        0,
        sourceWidth,
        height,
        x,
        y,
        width,
        height,
      );
      return true;
    },
    reset: () => {
      imageData = null;
      imageDataWidth = 0;
      imageDataHeight = 0;
      sourceCanvas = null;
      sourceContext = null;
    },
  };
};
