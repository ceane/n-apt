import { useCallback, useRef, useEffect, useState } from "react";

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  renderTime: number;
  gpuProcessingTime: number;
  memoryUsage: number;
  droppedFrames: number;
  averageFrameTime: number;
  timestamp: number;
}

export interface PerformanceThresholds {
  targetFPS: number;
  maxFrameTime: number;
  maxMemoryUsage: number;
  warningThreshold: number;
}

export function usePerformanceMonitor(options: Partial<PerformanceThresholds> = {}) {
  const {
    targetFPS = 60,
    maxFrameTime = 16.67, // ms for 60fps
    maxMemoryUsage = 512, // MB
    warningThreshold = 0.8
  } = options;

  // State
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    frameTime: 0,
    renderTime: 0,
    gpuProcessingTime: 0,
    memoryUsage: 0,
    droppedFrames: 0,
    averageFrameTime: 0,
    timestamp: performance.now()
  });

  const [isPerformant, setIsPerformant] = useState(true);
  const [performanceGrade, setPerformanceGrade] = useState<'A' | 'B' | 'C' | 'D' | 'F'>('A');

  // Refs for tracking
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const frameTimeHistoryRef = useRef<number[]>([]);
  const droppedFramesRef = useRef(0);
  const renderStartRef = useRef(0);
  const gpuProcessingStartRef = useRef(0);

  // Start performance measurement for a frame
  const startFrameMeasurement = useCallback(() => {
    renderStartRef.current = performance.now();
  }, []);

  // Mark GPU processing start
  const startGPUProcessing = useCallback(() => {
    gpuProcessingStartRef.current = performance.now();
  }, []);

  // Mark GPU processing end
  const endGPUProcessing = useCallback(() => {
    const gpuTime = performance.now() - gpuProcessingStartRef.current;
    setMetrics(prev => ({ ...prev, gpuProcessingTime: gpuTime }));
  }, []);

  // End performance measurement for a frame
  const endFrameMeasurement = useCallback(() => {
    const now = performance.now();
    const frameTime = now - renderStartRef.current;
    const renderTime = now - renderStartRef.current; // Same as frameTime for now

    // Track frame times
    frameTimeHistoryRef.current.push(frameTime);
    if (frameTimeHistoryRef.current.length > 60) {
      frameTimeHistoryRef.current.shift();
    }

    // Calculate FPS
    const fps = 1000 / frameTime;
    frameCountRef.current++;

    // Check for dropped frames
    if (frameTime > maxFrameTime * (1 + warningThreshold)) {
      droppedFramesRef.current++;
    }

    // Calculate average frame time
    const averageFrameTime = frameTimeHistoryRef.current.reduce((sum, time) => sum + time, 0) / frameTimeHistoryRef.current.length;

    // Get memory usage if available
    const memoryUsage = (performance as any).memory ? 
      (performance as any).memory.usedJSHeapSize / (1024 * 1024) : 0;

    // Update metrics
    const newMetrics: PerformanceMetrics = {
      fps,
      frameTime,
      renderTime,
      gpuProcessingTime: metrics.gpuProcessingTime,
      memoryUsage,
      droppedFrames: droppedFramesRef.current,
      averageFrameTime,
      timestamp: now
    };

    setMetrics(newMetrics);

    // Determine performance grade
    let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'A';
    if (fps < targetFPS * 0.5 || frameTime > maxFrameTime * 2) {
      grade = 'F';
    } else if (fps < targetFPS * 0.7 || frameTime > maxFrameTime * 1.5) {
      grade = 'D';
    } else if (fps < targetFPS * 0.85 || frameTime > maxFrameTime * 1.2) {
      grade = 'C';
    } else if (fps < targetFPS * 0.95 || frameTime > maxFrameTime * 1.1) {
      grade = 'B';
    }

    setPerformanceGrade(grade);
    setIsPerformant(fps >= targetFPS * 0.85 && frameTime <= maxFrameTime * 1.2);

    lastFrameTimeRef.current = now;
  }, [maxFrameTime, warningThreshold, targetFPS, metrics.gpuProcessingTime]);

  // Get performance report
  const getPerformanceReport = useCallback(() => {
    const report = {
      current: metrics,
      grade: performanceGrade,
      isPerformant,
      summary: {
        averageFPS: frameCountRef.current > 0 ? 
          (frameCountRef.current / ((performance.now() - lastFrameTimeRef.current) / 1000)) : 0,
        totalFrames: frameCountRef.current,
        droppedFrameRate: frameCountRef.current > 0 ? 
          (droppedFramesRef.current / frameCountRef.current) * 100 : 0,
        memoryEfficiency: maxMemoryUsage > 0 ? 
          (1 - metrics.memoryUsage / maxMemoryUsage) * 100 : 100
      },
      recommendations: [] as string[]
    };

    // Generate recommendations
    if (metrics.fps < targetFPS * 0.85) {
      report.recommendations.push('Consider reducing rendering complexity or enabling GPU optimizations');
    }

    if (metrics.averageFrameTime > maxFrameTime * 1.2) {
      report.recommendations.push('Frame time is high - check for CPU bottlenecks');
    }

    if (metrics.memoryUsage > maxMemoryUsage * warningThreshold) {
      report.recommendations.push('Memory usage is high - consider buffer pooling or cleanup');
    }

    if (metrics.gpuProcessingTime > 5) {
      report.recommendations.push('GPU processing time is high - consider shader optimization');
    }

    if (droppedFramesRef.current > frameCountRef.current * 0.1) {
      report.recommendations.push('High dropped frame rate - consider reducing workload');
    }

    return report;
  }, [metrics, performanceGrade, isPerformant, targetFPS, maxFrameTime, maxMemoryUsage, warningThreshold]);

  // Reset performance counters
  const resetCounters = useCallback(() => {
    frameCountRef.current = 0;
    droppedFramesRef.current = 0;
    frameTimeHistoryRef.current = [];
    lastFrameTimeRef.current = performance.now();
  }, []);

  // Auto-reset counters periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (frameCountRef.current > 1000) {
        resetCounters();
      }
    }, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [resetCounters]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetCounters();
    };
  }, [resetCounters]);

  return {
    metrics,
    isPerformant,
    performanceGrade,
    startFrameMeasurement,
    endFrameMeasurement,
    startGPUProcessing,
    endGPUProcessing,
    getPerformanceReport,
    resetCounters
  };
}

// Performance monitoring hook specifically for WebGPU operations
export function useWebGPUPerformanceMonitor(device?: GPUDevice) {
  const [gpuInfo, setGpuInfo] = useState<{
    adapter: string | null;
    vendor: string | null;
    architecture: string | null;
    device: string | null;
    description: string | null;
  }>({
    adapter: null,
    vendor: null,
    architecture: null,
    device: null,
    description: null
  });

  const [gpuLimits, setGpuLimits] = useState<{
    maxTextureDimension2D: number;
    maxBufferSize: number;
    maxComputeWorkgroupSizeX: number;
    maxComputeInvocationsPerWorkgroup: number;
  }>({
    maxTextureDimension2D: 0,
    maxBufferSize: 0,
    maxComputeWorkgroupSizeX: 0,
    maxComputeInvocationsPerWorkgroup: 0
  });

  // Get GPU information when device becomes available
  useEffect(() => {
    if (!device) return;

    const getGPUInfo = async () => {
      try {
        const adapter = await (navigator.gpu as any).requestAdapter();
        if (adapter) {
          const info = await adapter.requestAdapterInfo();
          setGpuInfo({
            adapter: info.architecture || 'Unknown',
            vendor: info.vendor || 'Unknown',
            architecture: info.architecture || 'Unknown',
            device: info.device || 'Unknown',
            description: info.description || 'Unknown'
          });
        }

        // Get device limits
        setGpuLimits({
          maxTextureDimension2D: device.limits.maxTextureDimension2D,
          maxBufferSize: device.limits.maxBufferSize,
          maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
          maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup
        });
      } catch (error) {
        console.warn('Failed to get GPU info:', error);
      }
    };

    getGPUInfo();
  }, [device]);

  return {
    gpuInfo,
    gpuLimits,
    isWebGPUSupported: typeof navigator !== 'undefined' && 'gpu' in navigator
  };
}
