import { useCallback, useRef, useEffect, useState } from "react";

// Types for shader cache management
export interface ShaderVariant {
  vertexCode: string;
  fragmentCode?: string;
  computeCode?: string;
  uniforms: Record<string, any>;
  workgroupSize?: [number, number, number];
}

export interface CachedPipeline {
  pipeline: GPURenderPipeline | GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
  variantKey: string;
  compiledAt: number;
}

export interface AsyncShaderCacheOptions {
  device: GPUDevice | null;
  format?: GPUTextureFormat | null;
  maxCacheSize?: number;
  enableHotReload?: boolean;
}

interface ShaderCompilationTask {
  variantKey: string;
  variant: ShaderVariant;
  resolve: (pipeline: CachedPipeline) => void;
  reject: (error: Error) => void;
  priority: 'high' | 'normal' | 'low';
}

export function useAsyncShaderCache(options: AsyncShaderCacheOptions) {
  const { device, format, maxCacheSize = 50, enableHotReload = false } = options;
  
  // Cache management
  const pipelineCacheRef = useRef<Map<string, CachedPipeline>>(new Map());
  const compilationQueueRef = useRef<ShaderCompilationTask[]>([]);
  const isCompilingRef = useRef(false);
  
  // State management
  const [isInitialized, setIsInitialized] = useState(!!device);
  const [cacheStats, setCacheStats] = useState({ hitCount: 0, missCount: 0, compileCount: 0 });
  
  // Generate variant key from shader parameters
  const generateVariantKey = useCallback((variant: ShaderVariant): string => {
    const params = new URLSearchParams();
    params.set('vertexHash', btoa(variant.vertexCode.slice(0, 100)));
    if (variant.fragmentCode) {
      params.set('fragmentHash', btoa(variant.fragmentCode.slice(0, 100)));
    }
    if (variant.computeCode) {
      params.set('computeHash', btoa(variant.computeCode.slice(0, 100)));
    }
    if (variant.workgroupSize) {
      params.set('workgroup', variant.workgroupSize.join(','));
    }
    // Include relevant uniform parameters that affect shader compilation
    Object.entries(variant.uniforms).forEach(([key, value]) => {
      if (typeof value === 'number' || typeof value === 'boolean') {
        params.set(`uniform_${key}`, String(value));
      }
    });
    return params.toString();
  }, []);
  
  // Create render pipeline with error handling
  const createRenderPipeline = useCallback(async (
    variant: ShaderVariant,
    variantKey: string
  ): Promise<CachedPipeline> => {
    if (!device) {
      throw new Error('GPU device not available for pipeline creation');
    }
    
    try {
      // Create shader module
      const shaderModule = device.createShaderModule({
        code: variant.computeCode || variant.vertexCode,
        label: `Shader-${variantKey.slice(0, 20)}`
      });
      
      // Push error scope for validation
      device.pushErrorScope("validation");
      
      let pipeline: GPURenderPipeline | GPUComputePipeline;
      let bindGroupLayout: GPUBindGroupLayout;
      
      if (variant.computeCode) {
        // Compute pipeline
        pipeline = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: shaderModule,
            entryPoint: "main",
          }
        });
        bindGroupLayout = pipeline.getBindGroupLayout(0);
      } else {
        // Check if this is a compute shader (contains @compute)
        const isComputeShader = variant.vertexCode.includes('@compute');
        
        if (isComputeShader) {
          // Create compute pipeline
          pipeline = device.createComputePipeline({
            layout: "auto",
            compute: {
              module: shaderModule,
              entryPoint: variant.vertexCode.includes('main') ? "main" : 
                         variant.vertexCode.includes('compute_main') ? "compute_main" :
                         variant.vertexCode.includes('fft_compute') ? "fft_compute" : "main",
            }
          });
          bindGroupLayout = pipeline.getBindGroupLayout(0);
        } else {
          // Render pipeline
          const vertexState = {
            module: shaderModule,
            entryPoint: variant.vertexCode.includes("vs_main") ? "vs_main" : "vs",
          };
          
          const fragmentState = variant.fragmentCode ? {
            module: shaderModule,
            entryPoint: variant.fragmentCode.includes("fs_main") ? "fs_main" : "fs",
            targets: format ? [{ format }] : [],
          } : undefined;
          
          pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: vertexState,
            fragment: fragmentState,
            primitive: {
              topology: "triangle-strip",
            },
          });
          bindGroupLayout = pipeline.getBindGroupLayout(0);
        }
      }
      
      // Check for validation errors
      const error = await device.popErrorScope();
      if (error) {
        throw new Error(`Shader validation failed: ${error.message}`);
      }
      
      const cachedPipeline: CachedPipeline = {
        pipeline,
        bindGroupLayout,
        variantKey,
        compiledAt: performance.now()
      };
      
      return cachedPipeline;
    } catch (error) {
      throw new Error(`Failed to create pipeline for ${variantKey}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [device, format]);
  
  // Process compilation queue
  const processCompilationQueue = useCallback(async () => {
    if (isCompilingRef.current || compilationQueueRef.current.length === 0) {
      return;
    }
    
    isCompilingRef.current = true;
    
    try {
      // Sort by priority
      compilationQueueRef.current.sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
      
      // Process tasks in batches
      const batchSize = 3;
      const batch = compilationQueueRef.current.splice(0, batchSize);
      
      await Promise.allSettled(
        batch.map(async (task) => {
          try {
            const pipeline = await createRenderPipeline(task.variant, task.variantKey);
            
            // Add to cache
            pipelineCacheRef.current.set(task.variantKey, pipeline);
            
            // Manage cache size
            if (pipelineCacheRef.current.size > maxCacheSize) {
              const oldestKey = Array.from(pipelineCacheRef.current.keys())
                .sort((a, b) => {
                  const timeA = pipelineCacheRef.current.get(a)?.compiledAt || 0;
                  const timeB = pipelineCacheRef.current.get(b)?.compiledAt || 0;
                  return timeA - timeB;
                })[0];
              
              if (oldestKey) {
                const oldPipeline = pipelineCacheRef.current.get(oldestKey);
                if (oldPipeline) {
                  // Clean up old pipeline
                  if ('destroy' in oldPipeline.pipeline && typeof oldPipeline.pipeline.destroy === 'function') {
                    (oldPipeline.pipeline as any).destroy();
                  }
                }
                pipelineCacheRef.current.delete(oldestKey);
              }
            }
            
            task.resolve(pipeline);
            setCacheStats(prev => ({ ...prev, compileCount: prev.compileCount + 1 }));
          } catch (error) {
            task.reject(error instanceof Error ? error : new Error('Unknown compilation error'));
          }
        })
      );
    } finally {
      isCompilingRef.current = false;
      
      // Process next batch if queue has items
      if (compilationQueueRef.current.length > 0) {
        setTimeout(processCompilationQueue, 0);
      }
    }
  }, [createRenderPipeline, maxCacheSize]);
  
  // Get or create shader pipeline
  const getPipeline = useCallback((
    variant: ShaderVariant,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<CachedPipeline> => {
    const variantKey = generateVariantKey(variant);
    
    // Check cache first
    const cached = pipelineCacheRef.current.get(variantKey);
    if (cached) {
      setCacheStats(prev => ({ ...prev, hitCount: prev.hitCount + 1 }));
      return Promise.resolve(cached);
    }
    
    setCacheStats(prev => ({ ...prev, missCount: prev.missCount + 1 }));
    
    // Check if already being compiled
    const existingTask = compilationQueueRef.current.find(task => task.variantKey === variantKey);
    if (existingTask) {
      // Upgrade priority if needed
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      if (priorityOrder[priority] < priorityOrder[existingTask.priority]) {
        existingTask.priority = priority;
      }
      
      return new Promise((resolve, reject) => {
        existingTask.resolve = resolve;
        existingTask.reject = reject;
      });
    }
    
    // Add to compilation queue
    return new Promise((resolve, reject) => {
      compilationQueueRef.current.push({
        variantKey,
        variant,
        resolve,
        reject,
        priority
      });
      
      // Start processing if not already running
      processCompilationQueue();
    });
  }, [generateVariantKey, processCompilationQueue]);
  
  // Preload shader variants
  const preloadShaders = useCallback(async (variants: ShaderVariant[]) => {
    const promises = variants.map(variant => 
      getPipeline(variant, 'low').catch(error => {
        console.warn('Failed to preload shader:', error);
        return null;
      })
    );
    
    await Promise.allSettled(promises);
  }, [getPipeline]);
  
  // Hot reload support
  useEffect(() => {
    if (!enableHotReload) return;
    
    const handleHotReload = () => {
      // Clear cache on hot reload
      pipelineCacheRef.current.clear();
      compilationQueueRef.current = [];
      console.log('🔄 Shader cache cleared for hot reload');
    };
    
    // Listen for hot reload events (development only)
    if (import.meta.hot) {
      import.meta.hot.accept(handleHotReload);
    }
    
    return () => {
      if (import.meta.hot) {
        import.meta.hot.dispose(handleHotReload);
      }
    };
  }, [enableHotReload]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up all cached pipelines
      pipelineCacheRef.current.forEach(cached => {
        if ('destroy' in cached.pipeline && typeof cached.pipeline.destroy === 'function') {
          (cached.pipeline as any).destroy();
        }
      });
      pipelineCacheRef.current.clear();
      compilationQueueRef.current = [];
    };
  }, []);
  
  // Initialize cache
  useEffect(() => {
    setIsInitialized(true);
  }, []);
  
  return {
    isInitialized,
    cacheStats,
    getPipeline,
    preloadShaders,
    clearCache: useCallback(() => {
      pipelineCacheRef.current.clear();
      compilationQueueRef.current = [];
      setCacheStats({ hitCount: 0, missCount: 0, compileCount: 0 });
    }, []),
    getCacheSize: useCallback(() => pipelineCacheRef.current.size, []),
  };
}
