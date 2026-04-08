import { GPUMemoryManager, getGlobalMemoryManager, disposeGlobalMemoryManager } from '../../src/ts/utils/gpuMemoryManager';

// Mock WebGPU device
const mockDevice = {
  createBuffer: jest.fn(),
  createTexture: jest.fn(),
  lost: Promise.resolve({ reason: 'destroyed' }),
};

// Mock console methods to avoid noise in tests
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

// Declare global helper functions from jest.canvasSetup.cjs
declare global {
  function clearCanvasCalls(): void;
  function expectWebGPUCall(callName: string, args?: any[] | null): any;
  function countWebGPUCalls(callName: string): number;
}

describe('GPUMemoryManager', () => {
  let memoryManager: GPUMemoryManager;

  beforeEach(() => {
    // Clear call logs before each test
    if (global.clearCanvasCalls) {
      global.clearCanvasCalls();
    }
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create new memory manager instance
    memoryManager = new GPUMemoryManager(mockDevice as any);
  });

  afterEach(() => {
    // Clean up global memory manager
    disposeGlobalMemoryManager();
  });

  describe('Constructor', () => {
    test('should initialize with default thresholds', () => {
      const manager = new GPUMemoryManager(mockDevice as any);
      
      expect(manager).toBeInstanceOf(GPUMemoryManager);
    });

    test('should accept custom thresholds', () => {
      const customThresholds = {
        warningThreshold: 256,
        criticalThreshold: 512,
        maxAllocation: 1024,
      };
      
      const manager = new GPUMemoryManager(mockDevice as any, customThresholds);
      expect(manager).toBeInstanceOf(GPUMemoryManager);
    });
  });

  describe('Memory Tracking', () => {
    test('should track buffer allocations', () => {
      const mockBuffer = {
        size: 1024,
        usage: GPUBufferUsage.VERTEX,
        destroy: jest.fn(),
      };

      mockDevice.createBuffer.mockReturnValue(mockBuffer);

      const buffer = memoryManager.createOptimizedBuffer(1024, GPUBufferUsage.VERTEX, 'test-buffer');
      
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        size: 1024, // Already aligned to 256 bytes
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        label: 'test-buffer'
      });
      expect(buffer).toBe(mockBuffer);
    });

    test('should track texture allocations', () => {
      const textureDescriptor = {
        size: { width: 256, height: 256 },
        format: 'rgba8unorm' as GPUTextureFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      };

      const mockTexture = {
        width: 256,
        height: 256,
        format: 'rgba8unorm',
        createView: jest.fn(),
        destroy: jest.fn(),
      };

      mockDevice.createTexture.mockReturnValue(mockTexture);

      const texture = memoryManager.createOptimizedTexture(textureDescriptor, 'test-texture');
      
      expect(mockDevice.createTexture).toHaveBeenCalledWith({
        ...textureDescriptor,
        label: 'test-texture'
      });
      expect(texture).toBe(mockTexture);
    });

    test('should align buffer sizes to 256 bytes', () => {
      const mockBuffer = {
        size: 256, // Should be aligned from 300
        usage: GPUBufferUsage.VERTEX,
        destroy: jest.fn(),
      };

      mockDevice.createBuffer.mockReturnValue(mockBuffer);

      memoryManager.createOptimizedBuffer(300, GPUBufferUsage.VERTEX, 'test-buffer');
      
      expect(mockDevice.createBuffer).toHaveBeenCalledWith({
        size: 512, // 300 rounded up to next 256-byte boundary
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        label: 'test-buffer'
      });
    });
  });

  describe('Memory Statistics', () => {
    test('should provide memory statistics', () => {
      const stats = memoryManager.getStats();
      
      expect(stats).toHaveProperty('totalAllocated');
      expect(stats).toHaveProperty('bufferCount');
      expect(stats).toHaveProperty('textureCount');
      expect(stats).toHaveProperty('pipelineCount');
      expect(stats).toHaveProperty('bindGroupCount');
      expect(stats).toHaveProperty('fragmentationRatio');
      expect(stats).toHaveProperty('lastCleanup');
    });

    test('should update statistics after allocations', () => {
      const mockBuffer = {
        size: 1024,
        usage: GPUBufferUsage.VERTEX,
        destroy: jest.fn(),
      };

      mockDevice.createBuffer.mockReturnValue(mockBuffer);

      memoryManager.createOptimizedBuffer(1024, GPUBufferUsage.VERTEX, 'test-buffer');

      const stats = memoryManager.getStats();
      expect(stats.bufferCount).toBe(1);
      expect(stats.totalAllocated).toBe(1024);
    });

    test('should calculate memory usage percentage', () => {
      const mockBuffer = {
        size: 1024 * 1024, // 1MB
        usage: GPUBufferUsage.VERTEX,
        destroy: jest.fn(),
      };

      mockDevice.createBuffer.mockReturnValue(mockBuffer);

      memoryManager.createOptimizedBuffer(1024 * 1024, GPUBufferUsage.VERTEX, 'test-buffer');

      const usagePercent = memoryManager.getMemoryUsagePercentage();
      expect(usagePercent).toBeGreaterThan(0);
    });
  });

  describe('Memory Management', () => {
    test('should handle resource release', () => {
      const mockBuffer = {
        size: 1024,
        usage: GPUBufferUsage.VERTEX,
        destroy: jest.fn(),
      };

      mockDevice.createBuffer.mockReturnValue(mockBuffer);

      // Create and track a buffer
      const buffer = memoryManager.createOptimizedBuffer(1024, GPUBufferUsage.VERTEX, 'test-buffer');
      
      // Release the resource
      memoryManager.releaseResource('test-buffer');

      const stats = memoryManager.getStats();
      expect(stats.bufferCount).toBe(0);
      expect(stats.totalAllocated).toBe(0);
    });

    test('should provide efficiency report', () => {
      const report = memoryManager.getEfficiencyReport();
      
      expect(report).toHaveProperty('efficiency');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('status');
      expect(['good', 'warning', 'critical']).toContain(report.status);
    });

    test('should handle cleanup callbacks', () => {
      const callback = jest.fn();
      
      memoryManager.addCleanupCallback(callback);
      memoryManager.performCleanup();
      
      expect(callback).toHaveBeenCalled();
      
      memoryManager.removeCleanupCallback(callback);
      memoryManager.performCleanup();
      
      // Should only be called once
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Global Memory Manager', () => {
    test('should manage global instance', () => {
      const manager1 = getGlobalMemoryManager(mockDevice as any);
      const manager2 = getGlobalMemoryManager();
      
      expect(manager1).toBe(manager2);
    });

    test('should dispose global instance', () => {
      getGlobalMemoryManager(mockDevice as any);
      disposeGlobalMemoryManager();
      
      // Should create new instance after disposal
      const manager = getGlobalMemoryManager(mockDevice as any);
      expect(manager).toBeInstanceOf(GPUMemoryManager);
    });
  });

  describe('Disposal', () => {
    test('should dispose properly', () => {
      const callback = jest.fn();
      memoryManager.addCleanupCallback(callback);
      
      memoryManager.dispose();
      
      expect(callback).toHaveBeenCalled();
      
      const stats = memoryManager.getStats();
      expect(stats.bufferCount).toBe(0);
      expect(stats.totalAllocated).toBe(0);
    });
  });
});
