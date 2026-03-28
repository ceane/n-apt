import { configureWebGPUCanvas, parseCssColorToRgba } from '../../src/ts/utils/webgpu';

// Declare global helper functions from jest.canvasSetup.cjs
declare global {
  function clearCanvasCalls(): void;
  function expectCanvasContext(contextType: string): any;
  function expectWebGPUCall(callName: string, args?: any[] | null): any;
}

describe('WebGPU Utilities', () => {
  beforeEach(() => {
    // Clear call logs before each test
    if (global.clearCanvasCalls) {
      global.clearCanvasCalls();
    }
  });

  describe('configureWebGPUCanvas', () => {
    test('should configure WebGPU context with correct parameters', () => {
      const canvas = document.createElement('canvas');
      const mockDevice = {
        // Mock device properties
      };

      const context = configureWebGPUCanvas(
        canvas,
        mockDevice as GPUDevice,
        'bgra8unorm' as GPUTextureFormat,
        'premultiplied' as GPUCanvasAlphaMode
      );

      // Verify canvas context was requested
      expectCanvasContext('webgpu');

      // Verify configure was called with correct parameters
      expectWebGPUCall('configure', [
        {
          device: mockDevice,
          format: 'bgra8unorm',
          alphaMode: 'premultiplied'
        }
      ]);

      expect(context).toBeDefined();
    });

    test('should use default alpha mode when not specified', () => {
      const canvas = document.createElement('canvas');
      const mockDevice = {};

      configureWebGPUCanvas(
        canvas,
        mockDevice as GPUDevice,
        'rgba8unorm' as GPUTextureFormat
      );

      // Verify configure was called with default alpha mode
      expectWebGPUCall('configure', [
        {
          device: mockDevice,
          format: 'rgba8unorm',
          alphaMode: 'premultiplied'
        }
      ]);
    });

    test('should throw error when WebGPU context is not available', () => {
      // Mock getContext to return null for webgpu
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = jest.fn(() => null);

      const canvas = document.createElement('canvas');
      const mockDevice = {};

      expect(() => {
        configureWebGPUCanvas(
          canvas,
          mockDevice as GPUDevice,
          'rgba8unorm' as GPUTextureFormat
        );
      }).toThrow('WebGPU context not available');

      // Restore original getContext
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    });
  });

  describe('parseCssColorToRgba', () => {
    test('should parse 3-digit hex colors', () => {
      const result = parseCssColorToRgba('#f00');
      expect(result).toEqual([1, 0, 0, 1]);
    });

    test('should parse 6-digit hex colors', () => {
      const result = parseCssColorToRgba('#ff0000');
      expect(result).toEqual([1, 0, 0, 1]);
    });

    test('should parse 8-digit hex colors with alpha', () => {
      const result = parseCssColorToRgba('#ff000080');
      expect(result).toEqual([1, 0, 0, 0.5019607843137255]); // 0x80 / 255
    });

    test('should handle whitespace in color strings', () => {
      const result = parseCssColorToRgba('  #ff0000  ');
      expect(result).toEqual([1, 0, 0, 1]);
    });

    test('should handle various hex color formats', () => {
      expect(parseCssColorToRgba('#0f0')).toEqual([0, 1, 0, 1]);
      expect(parseCssColorToRgba('#00ff00')).toEqual([0, 1, 0, 1]);
      expect(parseCssColorToRgba('#00ff0040')).toEqual([0, 1, 0, 0.25098039215686274]); // 0x40 / 255
    });
  });
});
