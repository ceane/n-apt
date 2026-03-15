import { useCallback, useRef, useEffect, useState } from "react";

// Types for shared buffer management
export interface BufferAllocation {
  buffer: GPUBuffer;
  offset: number;
  size: number;
  usage: GPUBufferUsageFlags;
  owner: string;
  allocatedAt: number;
  lastAccessed: number;
}

export interface RingBuffer {
  buffer: GPUBuffer;
  writeIndex: number;
  readIndex: number;
  capacity: number;
  stride: number;
  owner: string;
}

export interface SharedBufferManagerOptions {
  device: GPUDevice | null;
  initialPoolSize?: number;
  maxPoolSize?: number;
  bufferSize?: number;
  enableGarbageCollection?: boolean;
  gcInterval?: number;
}

export function useSharedBufferManager(options: SharedBufferManagerOptions) {
  const { 
    device, 
    initialPoolSize = 10, 
    maxPoolSize = 50, 
    bufferSize = 1024 * 1024, // 1MB default
    enableGarbageCollection = true,
    gcInterval = 30000 // 30 seconds
  } = options;
  
  // Buffer pools
  const bufferPoolRef = useRef<GPUBuffer[]>([]);
  const allocationsRef = useRef<Map<string, BufferAllocation>>(new Map());
  const ringBuffersRef = useRef<Map<string, RingBuffer>>(new Map());
  
  // State management
  const [memoryStats, setMemoryStats] = useState({
    totalAllocated: 0,
    poolSize: 0,
    activeAllocations: 0,
    ringBuffers: 0
  });
  
  const gcTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Create a new buffer in the pool
  const createBuffer = useCallback((size: number, usage: GPUBufferUsageFlags): GPUBuffer => {
    if (!device) {
      throw new Error('GPU device not available for buffer creation');
    }
    return device.createBuffer({
      size: Math.max(size, 256), // Minimum 256 bytes for alignment
      usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: false
    });
  }, [device]);
  
  // Get buffer from pool or create new one
  const getBufferFromPool = useCallback((size: number, usage: GPUBufferUsageFlags): GPUBuffer => {
    const pool = bufferPoolRef.current;
    
    // Try to find a suitable buffer from pool
    for (let i = 0; i < pool.length; i++) {
      const buffer = pool[i];
      if (buffer.size >= size && (buffer.usage & usage) === usage) {
        pool.splice(i, 1);
        return buffer;
      }
    }
    
    // Create new buffer if none found
    return createBuffer(size, usage);
  }, [createBuffer]);
  
  // Return buffer to pool
  const returnBufferToPool = useCallback((buffer: GPUBuffer) => {
    const pool = bufferPoolRef.current;
    if (pool.length < maxPoolSize) {
      pool.push(buffer);
    } else {
      // Pool is full, destroy the buffer
      buffer.destroy();
    }
    updateMemoryStats();
  }, [maxPoolSize]);
  
  // Allocate shared buffer
  const allocateBuffer = useCallback((
    id: string,
    size: number,
    usage: GPUBufferUsageFlags,
    owner: string
  ): BufferAllocation => {
    // Check if allocation already exists
    const existing = allocationsRef.current.get(id);
    if (existing && existing.size >= size) {
      existing.lastAccessed = performance.now();
      return existing;
    }
    
    // Free existing allocation if it exists
    if (existing) {
      returnBufferToPool(existing.buffer);
      allocationsRef.current.delete(id);
    }
    
    // Get buffer from pool or create new
    const buffer = getBufferFromPool(size, usage);
    const allocation: BufferAllocation = {
      buffer,
      offset: 0,
      size,
      usage,
      owner,
      allocatedAt: performance.now(),
      lastAccessed: performance.now()
    };
    
    allocationsRef.current.set(id, allocation);
    updateMemoryStats();
    
    return allocation;
  }, [getBufferFromPool, returnBufferToPool]);
  
  // Create ring buffer for streaming data
  const createRingBuffer = useCallback((
    id: string,
    capacity: number,
    stride: number,
    usage: GPUBufferUsageFlags,
    owner: string
  ): RingBuffer => {
    // Check if ring buffer already exists
    const existing = ringBuffersRef.current.get(id);
    if (existing && existing.capacity >= capacity) {
      return existing;
    }
    
    // Free existing ring buffer
    if (existing) {
      existing.buffer.destroy();
    }
    
    // Create new ring buffer
    const buffer = createBuffer(capacity * stride, usage);
    const ringBuffer: RingBuffer = {
      buffer,
      writeIndex: 0,
      readIndex: 0,
      capacity,
      stride,
      owner
    };
    
    ringBuffersRef.current.set(id, ringBuffer);
    updateMemoryStats();
    
    return ringBuffer;
  }, [createBuffer]);
  
  // Write data to ring buffer
  const writeToRingBuffer = useCallback((
    ringBufferId: string,
    data: ArrayBuffer
  ): boolean => {
    if (!device) {
      console.warn('GPU device not available for ring buffer write');
      return false;
    }
    
    const ringBuffer = ringBuffersRef.current.get(ringBufferId);
    if (!ringBuffer) return false;
    
    const dataSize = data.byteLength;
    const availableSpace = ringBuffer.capacity - ringBuffer.writeIndex;
    
    // Check if data fits
    if (dataSize > availableSpace) {
      // Wrap around if needed
      if (dataSize <= ringBuffer.capacity) {
        ringBuffer.writeIndex = 0;
      } else {
        console.warn('Data too large for ring buffer:', ringBufferId);
        return false;
      }
    }
    
    // Write data to buffer
    device.queue.writeBuffer(
      ringBuffer.buffer,
      ringBuffer.writeIndex * ringBuffer.stride,
      data,
      0,
      dataSize
    );
    
    ringBuffer.writeIndex = (ringBuffer.writeIndex + Math.ceil(dataSize / ringBuffer.stride)) % ringBuffer.capacity;
    
    return true;
  }, [device]);
  
  // Read data from ring buffer
  const readFromRingBuffer = useCallback((
    ringBufferId: string,
    offset: number,
    size: number
  ): Promise<ArrayBuffer | null> => {
    if (!device) {
      console.warn('GPU device not available for ring buffer read');
      return Promise.resolve(null);
    }
    
    const ringBuffer = ringBuffersRef.current.get(ringBufferId);
    if (!ringBuffer) return Promise.resolve(null);
    
    // Create temporary buffer for reading
    const tempBuffer = createBuffer(size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    
    // Copy from ring buffer to temp buffer
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      ringBuffer.buffer,
      offset * ringBuffer.stride,
      tempBuffer,
      0,
      size
    );
    
    device.queue.submit([encoder.finish()]);
    
    return tempBuffer.mapAsync(GPUMapMode.READ, 0, size).then(() => {
      const arrayBuffer = tempBuffer.getMappedRange(0, size);
      const data = arrayBuffer.slice(0);
      tempBuffer.unmap();
      tempBuffer.destroy();
      return data;
    }).catch(error => {
      console.error('Failed to read from ring buffer:', error);
      tempBuffer.destroy();
      return null;
    }) as Promise<ArrayBuffer>;
  }, [device, createBuffer]);
  
  // Create shared buffer for compute-to-render communication
  const createSharedComputeBuffer = useCallback((
    id: string,
    size: number,
    owner: string
  ): BufferAllocation => {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    return allocateBuffer(id, size, usage, owner);
  }, [allocateBuffer]);
  
  // Zero-copy buffer sharing between compute and render
  const shareBufferWithCompute = useCallback((
    allocation: BufferAllocation,
    computePass: GPUComputePassEncoder,
    binding: number
  ) => {
    if (!device) {
      console.warn('GPU device not available for buffer sharing');
      return;
    }
    
    computePass.setBindGroup(binding, device.createBindGroup({
      layout: device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" }
        }]
      }),
      entries: [{
        binding: 0,
        resource: { buffer: allocation.buffer }
      }]
    }));
  }, [device]);
  
  // Garbage collection
  const performGarbageCollection = useCallback(() => {
    const now = performance.now();
    const maxAge = 60000; // 1 minute
    
    // Clean up old allocations
    const toDelete: string[] = [];
    allocationsRef.current.forEach((allocation, id) => {
      if (now - allocation.lastAccessed > maxAge) {
        toDelete.push(id);
      }
    });
    
    toDelete.forEach(id => {
      const allocation = allocationsRef.current.get(id);
      if (allocation) {
        returnBufferToPool(allocation.buffer);
        allocationsRef.current.delete(id);
      }
    });
    
    // Clean up unused ring buffers
    const ringBuffersToDelete: string[] = [];
    ringBuffersRef.current.forEach((ringBuffer, id) => {
      if (now - ringBuffer.writeIndex > maxAge && now - ringBuffer.readIndex > maxAge) {
        ringBuffersToDelete.push(id);
      }
    });
    
    ringBuffersToDelete.forEach(id => {
      const ringBuffer = ringBuffersRef.current.get(id);
      if (ringBuffer) {
        ringBuffer.buffer.destroy();
        ringBuffersRef.current.delete(id);
      }
    });
    
    if (toDelete.length > 0 || ringBuffersToDelete.length > 0) {
      console.log(`🧹 GC: Cleaned ${toDelete.length} allocations, ${ringBuffersToDelete.length} ring buffers`);
      updateMemoryStats();
    }
  }, [returnBufferToPool]);
  
  // Update memory statistics
  const updateMemoryStats = useCallback(() => {
    const totalAllocated = Array.from(allocationsRef.current.values())
      .reduce((sum, alloc) => sum + alloc.size, 0);
    
    const ringBufferTotal = Array.from(ringBuffersRef.current.values())
      .reduce((sum, rb) => sum + (rb.capacity * rb.stride), 0);
    
    setMemoryStats({
      totalAllocated: totalAllocated + ringBufferTotal,
      poolSize: bufferPoolRef.current.length,
      activeAllocations: allocationsRef.current.size,
      ringBuffers: ringBuffersRef.current.size
    });
  }, []);
  
  // Initialize buffer pool only when device is available
  useEffect(() => {
    if (!device) return;
    
    const pool = bufferPoolRef.current;
    for (let i = 0; i < initialPoolSize; i++) {
      pool.push(createBuffer(bufferSize, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC));
    }
    updateMemoryStats();
  }, [device, initialPoolSize, bufferSize, createBuffer, updateMemoryStats]);
  
  // Set up garbage collection
  useEffect(() => {
    if (!enableGarbageCollection) return;
    
    gcTimeoutRef.current = setInterval(performGarbageCollection, gcInterval);
    
    return () => {
      if (gcTimeoutRef.current) {
        clearInterval(gcTimeoutRef.current);
      }
    };
  }, [enableGarbageCollection, gcInterval, performGarbageCollection]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up all allocations
      allocationsRef.current.forEach(allocation => {
        allocation.buffer.destroy();
      });
      allocationsRef.current.clear();
      
      // Clean up ring buffers
      ringBuffersRef.current.forEach(ringBuffer => {
        ringBuffer.buffer.destroy();
      });
      ringBuffersRef.current.clear();
      
      // Clean up buffer pool
      bufferPoolRef.current.forEach(buffer => {
        buffer.destroy();
      });
      bufferPoolRef.current.length = 0;
      
      if (gcTimeoutRef.current) {
        clearInterval(gcTimeoutRef.current);
      }
    };
  }, []);
  
  return {
    memoryStats,
    allocateBuffer,
    createRingBuffer,
    writeToRingBuffer,
    readFromRingBuffer,
    createSharedComputeBuffer,
    shareBufferWithCompute,
    performGarbageCollection,
    updateMemoryStats,
    getAllocation: useCallback((id: string) => allocationsRef.current.get(id), []),
    getRingBuffer: useCallback((id: string) => ringBuffersRef.current.get(id), []),
    releaseAllocation: useCallback((id: string) => {
      const allocation = allocationsRef.current.get(id);
      if (allocation) {
        returnBufferToPool(allocation.buffer);
        allocationsRef.current.delete(id);
        updateMemoryStats();
      }
    }, [returnBufferToPool, updateMemoryStats])
  };
}
