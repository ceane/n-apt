import {
  drawWaterfall,
  createWaterfallLine,
  FrequencyRange,
} from "@n-apt/waterfall/FIFOWaterfallRenderer";

describe("FIFOWaterfallRenderer", () => {
  const mockCanvas = document.createElement("canvas");
  const mockCtx = mockCanvas.getContext("2d") as CanvasRenderingContext2D;

  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2,
  };

  const mockSpectrum = Array.from({ length: 1024 }, (_, i) => -60 + Math.sin(i * 0.1) * 20);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("drawWaterfall", () => {
    it("should render waterfall with valid inputs", () => {
      const waterfallBuffer = new Uint8ClampedArray(800 * 400 * 4);

      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waterfallBuffer,
        frequencyRange: mockFrequencyRange,
      };

      expect(() => drawWaterfall(options)).not.toThrow();
      expect(mockCtx.putImageData).toHaveBeenCalled();
      expect(mockCtx.fillRect).toHaveBeenCalled(); // Should clear background
    });

    it("should handle empty waterfall data gracefully", () => {
      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waterfallBuffer: new Uint8ClampedArray(800 * 400 * 4),
        frequencyRange: mockFrequencyRange,
      };

      expect(() => drawWaterfall(options)).not.toThrow();
      expect(mockCtx.fillRect).toHaveBeenCalled(); // Should clear background
    });

    it("should use custom dB ranges when provided", () => {
      const waterfallBuffer = new Uint8ClampedArray(800 * 400 * 4);

      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waterfallBuffer,
        frequencyRange: mockFrequencyRange,
        waterfallMin: -100,
        waterfallMax: 10,
      };

      expect(() => drawWaterfall(options)).not.toThrow();
      expect(mockCtx.fillRect).toHaveBeenCalled(); // Should clear background
    });
  });

  describe("createWaterfallLine", () => {
    it("should create waterfall line from spectrum data", () => {
      const result = createWaterfallLine(mockSpectrum, 800, -80, 20);

      expect(result).toBeInstanceOf(ImageData);
      expect(result.width).toBe(800);
      expect(result.height).toBe(1);
      expect(result.data).toHaveLength(800 * 4); // 4 bytes per pixel (RGBA)
    });

    it("should handle spectrum shorter than width", () => {
      const shortSpectrum = Array.from({ length: 100 }, (_, i) => -60 + i * 0.1);
      const result = createWaterfallLine(shortSpectrum, 800, -80, 20);

      expect(result.width).toBe(800);
      expect(result.data).toHaveLength(800 * 4);
    });

    it("should map dB values to colors correctly", () => {
      const testSpectrum = [-80, -40, 0, 20]; // Min, mid, max values
      const result = createWaterfallLine(testSpectrum, 4, -80, 20);

      expect(result.data).toHaveLength(16); // 4 pixels * 4 bytes

      // Check that different dB values produce different colors
      const pixel0 = result.data.slice(0, 4); // -80 dB
      const pixel2 = result.data.slice(8, 12); // 0 dB

      expect(pixel0).not.toEqual(pixel2);
    });

    it("should handle extreme dB values", () => {
      const extremeSpectrum = [-200, 100]; // Outside normal range
      const result = createWaterfallLine(extremeSpectrum, 2, -80, 20);

      expect(result).toBeInstanceOf(ImageData);
      expect(result.data).toHaveLength(8);
    });
  });
});
