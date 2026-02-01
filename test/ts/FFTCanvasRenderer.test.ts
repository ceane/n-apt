import { drawSpectrum, zoomFFT, FrequencyRange } from '../../src/fft/FFTCanvasRenderer';

describe('FFTCanvasRenderer', () => {
  const mockCanvas = document.createElement('canvas');
  const mockCtx = mockCanvas.getContext('2d') as CanvasRenderingContext2D;
  
  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2
  };

  const mockWaveform = Array.from({ length: 1024 }, (_, i) => 
    -60 + Math.sin(i * 0.1) * 20
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('drawSpectrum', () => {
    it('should render spectrum with valid inputs', () => {
      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waveform: mockWaveform,
        frequencyRange: mockFrequencyRange
      };

      expect(() => drawSpectrum(options)).not.toThrow();
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    it('should handle empty waveform gracefully', () => {
      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waveform: [],
        frequencyRange: mockFrequencyRange
      };

      expect(() => drawSpectrum(options)).not.toThrow();
    });

    it('should handle null waveform gracefully', () => {
      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waveform: null as any,
        frequencyRange: mockFrequencyRange
      };

      expect(() => drawSpectrum(options)).not.toThrow();
    });

    it('should use custom dB ranges when provided', () => {
      const options = {
        ctx: mockCtx,
        width: 800,
        height: 400,
        waveform: mockWaveform,
        frequencyRange: mockFrequencyRange,
        fftMin: -100,
        fftMax: 10
      };

      expect(() => drawSpectrum(options)).not.toThrow();
    });
  });

  describe('zoomFFT', () => {
    it('should zoom FFT data correctly', () => {
      const input = Array.from({ length: 1024 }, (_, i) => i * 0.1);
      const result = zoomFFT(input, 100, 200, 100);

      expect(result).toHaveLength(100);
      expect(result[0]).toBeGreaterThan(0);
    });

    it('should handle offset out of bounds', () => {
      const input = Array.from({ length: 100 }, (_, i) => i * 0.1);
      const result = zoomFFT(input, 200, 50, 25);

      expect(result).toHaveLength(25);
      // When offset is out of bounds, result should contain -Infinity (default maxVal)
      expect(result.every(val => val === -Infinity)).toBe(true);
    });

    it('should limit width to maximum', () => {
      const input = Array.from({ length: 1000 }, (_, i) => i * 0.1);
      const result = zoomFFT(input, 0, 600000, 100); // Width > 524288

      expect(result).toHaveLength(100);
    });

    it('should handle zero width', () => {
      const input = Array.from({ length: 100 }, (_, i) => i * 0.1);
      const result = zoomFFT(input, 0, 0, 25);

      expect(result).toHaveLength(25);
      // When width is 0, result should contain -Infinity (default maxVal)
      expect(result.every(val => val === -Infinity)).toBe(true);
    });
  });
});
