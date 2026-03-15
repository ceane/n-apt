// GPU Memory Management Utilities
// Provides tools for monitoring, optimizing, and managing GPU memory usage

export interface GPUMemoryStats {
  totalAllocated: number;
  bufferCount: number;
  textureCount: number;
  pipelineCount: number;
  bindGroupCount: number;
  fragmentationRatio: number;
  lastCleanup: number;
}

export interface MemoryThresholds {
  warningThreshold: number; // MB
  criticalThreshold: number; // MB
  maxAllocation: number; // MB
}

export class GPUMemoryManager {
  private device: GPUDevice;
  private allocations: Map<string, { size: number; type: 'buffer' | 'texture'; created: number }> = new Map();
  private thresholds: MemoryThresholds;
  private stats: GPUMemoryStats;
  private cleanupCallbacks: Array<() => void> = [];
  
  constructor(device: GPUDevice, thresholds?: Partial<MemoryThresholds>) {
    this.device = device;
    this.thresholds = {
      warningThreshold: thresholds?.warningThreshold ?? 512, // 512MB
      criticalThreshold: thresholds?.criticalThreshold ?? 1024, // 1GB
      maxAllocation: thresholds?.maxAllocation ?? 2048, // 2GB
    };
    
    this.stats = {
      totalAllocated: 0,
      bufferCount: 0,
      textureCount: 0,
      pipelineCount: 0,
      bindGroupCount: 0,
      fragmentationRatio: 0,
      lastCleanup: performance.now()
    };
    
    // Set up memory pressure monitoring
    this.setupMemoryMonitoring();
  }
  
  private setupMemoryMonitoring() {
    // Monitor for context loss
    this.device.lost?.then(() => {
      console.warn('GPU device lost, cleaning up memory');
      this.emergencyCleanup();
    });
    
    // Set up periodic cleanup
    setInterval(() => {
      this.performMaintenance();
    }, 30000); // Every 30 seconds
  }
  
  // Track buffer allocation
  trackBuffer(id: string, buffer: GPUBuffer, _purpose: string = 'unknown') {
    const size = buffer.size;
    this.allocations.set(id, { size, type: 'buffer', created: performance.now() });
    this.updateStats();
    
    // Check thresholds
    this.checkMemoryThresholds();
    
    return buffer;
  }
  
  // Track texture allocation
  trackTexture(id: string, texture: GPUTexture, _purpose: string = 'unknown') {
    const size = this.estimateTextureSize(texture);
    this.allocations.set(id, { size, type: 'texture', created: performance.now() });
    this.updateStats();
    
    this.checkMemoryThresholds();
    
    return texture;
  }
  
  // Release tracked resource
  releaseResource(id: string) {
    const allocation = this.allocations.get(id);
    if (allocation) {
      this.allocations.delete(id);
      this.updateStats();
    }
  }
  
  // Estimate texture size in bytes
  private estimateTextureSize(texture: GPUTexture): number {
    const { width, height, depthOrArrayLayers = 1 } = texture;
    const format = texture.format;
    
    // Get bytes per pixel for format
    let bytesPerPixel = 4; // Default to RGBA8
    switch (format) {
      case 'rgba8unorm':
      case 'rgba8unorm-srgb':
        bytesPerPixel = 4;
        break;
      case 'bgra8unorm':
      case 'bgra8unorm-srgb':
        bytesPerPixel = 4;
        break;
      case 'r32float':
        bytesPerPixel = 4;
        break;
      case 'rg32float':
        bytesPerPixel = 8;
        break;
      case 'rgba32float':
        bytesPerPixel = 16;
        break;
      case 'r16float':
        bytesPerPixel = 2;
        break;
      case 'rg16float':
        bytesPerPixel = 4;
        break;
      case 'rgba16float':
        bytesPerPixel = 8;
        break;
    }
    
    return width * height * depthOrArrayLayers * bytesPerPixel;
  }
  
  // Update memory statistics
  private updateStats() {
    let totalAllocated = 0;
    let bufferCount = 0;
    let textureCount = 0;
    
    this.allocations.forEach(allocation => {
      totalAllocated += allocation.size;
      if (allocation.type === 'buffer') {
        bufferCount++;
      } else {
        textureCount++;
      }
    });
    
    // Calculate fragmentation (simplified)
    const averageAllocationSize = this.allocations.size > 0 ? totalAllocated / this.allocations.size : 0;
    const fragmentationRatio = averageAllocationSize > 0 ? 
      Math.max(0, 1 - (totalAllocated / (this.allocations.size * averageAllocationSize))) : 0;
    
    this.stats = {
      totalAllocated,
      bufferCount,
      textureCount,
      pipelineCount: 0, // Not easily trackable
      bindGroupCount: 0, // Not easily trackable
      fragmentationRatio,
      lastCleanup: this.stats.lastCleanup
    };
  }
  
  // Check if memory thresholds are exceeded
  private checkMemoryThresholds() {
    const allocatedMB = this.stats.totalAllocated / (1024 * 1024);
    
    if (allocatedMB > this.thresholds.criticalThreshold) {
      console.error(`🚨 Critical GPU memory usage: ${allocatedMB.toFixed(1)}MB`);
      this.emergencyCleanup();
    } else if (allocatedMB > this.thresholds.warningThreshold) {
      console.warn(`⚠️ High GPU memory usage: ${allocatedMB.toFixed(1)}MB`);
      this.performCleanup();
    }
  }
  
  // Perform routine cleanup
  performCleanup() {
    const now = performance.now();
    const maxAge = 300000; // 5 minutes
    
    let cleanedCount = 0;
    const toDelete: string[] = [];
    
    this.allocations.forEach((allocation, id) => {
      if (now - allocation.created > maxAge) {
        toDelete.push(id);
      }
    });
    
    toDelete.forEach(id => {
      this.allocations.delete(id);
      cleanedCount++;
    });
    
    if (cleanedCount > 0) {
      console.log(`🧹 GPU Memory cleanup: removed ${cleanedCount} old allocations`);
      this.updateStats();
      this.stats.lastCleanup = now;
    }
    
    // Run registered cleanup callbacks
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.warn('Cleanup callback failed:', error);
      }
    });
  }
  
  // Emergency cleanup for critical memory situations
  emergencyCleanup() {
    console.warn('🚨 Emergency GPU memory cleanup initiated');
    
    // Clear all allocations
    this.allocations.clear();
    this.updateStats();
    this.stats.lastCleanup = performance.now();
    
    // Run all cleanup callbacks
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Emergency cleanup callback failed:', error);
      }
    });
  }
  
  // Perform routine maintenance
  performMaintenance() {
    this.updateStats();
    this.performCleanup();
    
    // Log memory stats periodically
    const allocatedMB = this.stats.totalAllocated / (1024 * 1024);
    if (allocatedMB > 100) { // Only log if significant usage
      console.log(`📊 GPU Memory: ${allocatedMB.toFixed(1)}MB (${this.stats.bufferCount} buffers, ${this.stats.textureCount} textures)`);
    }
  }
  
  // Register cleanup callback
  addCleanupCallback(callback: () => void) {
    this.cleanupCallbacks.push(callback);
  }
  
  // Remove cleanup callback
  removeCleanupCallback(callback: () => void) {
    const index = this.cleanupCallbacks.indexOf(callback);
    if (index > -1) {
      this.cleanupCallbacks.splice(index, 1);
    }
  }
  
  // Get current memory statistics
  getStats(): GPUMemoryStats {
    this.updateStats();
    return { ...this.stats };
  }
  
  // Get memory usage as percentage of max allocation
  getMemoryUsagePercentage(): number {
    return (this.stats.totalAllocated / (this.thresholds.maxAllocation * 1024 * 1024)) * 100;
  }
  
  // Get memory efficiency report
  getEfficiencyReport(): {
    efficiency: number;
    recommendations: string[];
    status: 'good' | 'warning' | 'critical';
  } {
    const _usageMB = this.stats.totalAllocated / (1024 * 1024);
    const usagePercent = this.getMemoryUsagePercentage();
    const efficiency = 100 - (this.stats.fragmentationRatio * 100);
    
    const recommendations: string[] = [];
    
    if (this.stats.fragmentationRatio > 0.3) {
      recommendations.push('High memory fragmentation detected - consider buffer pooling');
    }
    
    if (usagePercent > 80) {
      recommendations.push('Memory usage is high - consider reducing texture sizes or implementing LOD');
    }
    
    if (this.stats.bufferCount > 100) {
      recommendations.push('Many small buffers - consider consolidating into larger buffers');
    }
    
    let status: 'good' | 'warning' | 'critical' = 'good';
    if (usagePercent > 80 || this.stats.fragmentationRatio > 0.5) {
      status = 'critical';
    } else if (usagePercent > 60 || this.stats.fragmentationRatio > 0.3) {
      status = 'warning';
    }
    
    return {
      efficiency,
      recommendations,
      status
    };
  }
  
  // Create optimized buffer with tracking
  createOptimizedBuffer(size: number, usage: GPUBufferUsageFlags, id?: string): GPUBuffer {
    const actualId = id || `buffer_${Date.now()}_${Math.random()}`;
    
    // Align size to 256 bytes for optimal GPU performance
    const alignedSize = Math.ceil(size / 256) * 256;
    
    const buffer = this.device.createBuffer({
      size: alignedSize,
      usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: actualId
    });
    
    return this.trackBuffer(actualId, buffer, 'optimized');
  }
  
  // Create texture with memory tracking
  createOptimizedTexture(
    descriptor: GPUTextureDescriptor,
    id?: string
  ): GPUTexture {
    const actualId = id || `texture_${Date.now()}_${Math.random()}`;
    
    const texture = this.device.createTexture({
      ...descriptor,
      label: actualId
    });
    
    return this.trackTexture(actualId, texture, 'optimized');
  }
  
  // Dispose of the memory manager
  dispose() {
    this.emergencyCleanup();
    this.cleanupCallbacks.length = 0;
  }
}

// Global memory manager instance
let globalMemoryManager: GPUMemoryManager | null = null;

export function getGlobalMemoryManager(device?: GPUDevice): GPUMemoryManager {
  if (!globalMemoryManager && device) {
    globalMemoryManager = new GPUMemoryManager(device);
  }
  return globalMemoryManager!;
}

export function disposeGlobalMemoryManager() {
  if (globalMemoryManager) {
    globalMemoryManager.dispose();
    globalMemoryManager = null;
  }
}
